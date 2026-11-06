//! Archive import (ADR 0003): an upload streamed to a file beside the store, and the automation guard. One
//! import at a time; no device is added while one runs. Monitoring only (ADR 0005): nothing here writes a
//! register.

use std::fmt::Write as _;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use axum::body::{Body, HttpBody};
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use jiff::Timestamp;
use ring::digest::{Context, SHA256};
use serde::{Deserialize, Serialize};
use tokio::sync::MutexGuard;
use utoipa::ToSchema;

use super::{ApiError, ApiJson, ErrorBody};
use crate::archive::{self, Checked, Held, ImportError, Imported, Streams};
use crate::run::Core;

/// The held upload's file name in the data directory.
pub const UPLOAD_FILE: &str = "import.tar.gz";
/// An upload being received; it replaces the held upload only once received whole.
pub const PART_FILE: &str = "import.tar.gz.part";

/// The largest archive accepted, in bytes. A full 3.x archive (~9 M rows) is about a tenth of it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UploadLimit(pub u64);

impl Default for UploadLimit {
    fn default() -> Self {
        Self(512 << 20)
    }
}

/// The longest wait for an upload's next bytes; a stalled client would hold the import lock.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UploadIdle(pub Duration);

impl Default for UploadIdle {
    fn default() -> Self {
        Self(Duration::from_secs(60))
    }
}

/// The import lock, or a 409 while an import holds it.
pub(super) fn no_import_running(core: &Core) -> Result<MutexGuard<'_, Option<String>>, ApiError> {
    core.imports
        .try_lock()
        .map_err(|_| ApiError::conflict("An archive import is running: try again when it ends"))
}

/// The archive turns on 3.x automation or still holds a register: it imports once the user confirms
/// automation is off in 3.x, which restores these values.
#[derive(Debug, Serialize, ToSchema)]
pub struct Guarded {
    /// The upload's sha256, hex: what the confirmation names.
    sha256: String,
    held: Vec<Held>,
}

/// The archive file's bytes.
#[derive(ToSchema)]
#[schema(value_type = String, format = Binary)]
pub struct ArchiveFile(#[allow(dead_code, reason = "the schema only")] Vec<u8>);

#[derive(Debug, Deserialize, ToSchema)]
pub struct Confirmation {
    /// The sha256 the guard answered with.
    sha256: String,
}

/// A device's span no tier covers whole: its bucket rows were not imported.
#[derive(Debug, Serialize, ToSchema)]
pub struct Gap {
    device: String,
    start: String,
    end: String,
}

/// The first of two archive lines at one device, metric and instant with different values.
#[derive(Debug, Serialize, ToSchema)]
pub struct Conflict {
    device: String,
    metric: String,
    at: String,
    kept: f64,
    dropped: f64,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    read: Streams,
    gaps: Vec<Gap>,
    /// Lines dropped because an earlier line at their device, metric and instant held another value.
    conflicts: u64,
    first_conflict: Option<Conflict>,
}

fn iso(at: Timestamp) -> String {
    format!("{at:.3}")
}

impl From<Imported> for ImportReport {
    fn from(imported: Imported) -> Self {
        let gap = |g: archive::Gap| Gap { device: g.device, start: iso(g.start), end: iso(g.end) };
        let conflict = |c: archive::Conflict| Conflict {
            device: c.device,
            metric: c.metric,
            at: iso(c.at),
            kept: c.kept,
            dropped: c.dropped,
        };
        Self {
            read: imported.read,
            gaps: imported.gaps.into_iter().map(gap).collect(),
            conflicts: imported.conflicts,
            first_conflict: imported.first_conflict.map(conflict),
        }
    }
}

impl From<ImportError> for ApiError {
    fn from(error: ImportError) -> Self {
        match error {
            ImportError::NotEmpty => Self::conflict(error.to_string()),
            ImportError::Store(error) => error.into(),
            other => Self::bad_request(other.to_string()),
        }
    }
}

fn unwritable(error: &std::io::Error) -> ApiError {
    tracing::error!(%error, "the archive upload cannot be written");
    ApiError::internal()
}

fn too_large(limit: u64) -> ApiError {
    ApiError::payload_too_large(format!("An archive is at most {limit} bytes"))
}

fn hex(digest: Context) -> String {
    digest.finish().as_ref().iter().fold(String::with_capacity(64), |mut hex, b| {
        let _ = write!(hex, "{b:02x}");
        hex
    })
}

/// Files removed when the request ends, however it ends: a cancelled request runs no other cleanup. Dropped
/// before the import lock, so no other upload sees them.
struct Discard(Vec<PathBuf>);

impl Drop for Discard {
    fn drop(&mut self) {
        for path in &self.0 {
            drop(std::fs::remove_file(path));
        }
    }
}

/// Streams `body` into `path`, hashing it; refuses it once it passes `limit` or waits longer than `idle`
/// for its next bytes.
async fn receive(mut body: Body, path: &Path, limit: u64, idle: Duration) -> Result<String, ApiError> {
    let mut file = std::fs::File::create(path).map_err(|e| unwritable(&e))?;
    let mut digest = Context::new(&SHA256);
    let mut size = 0_u64;
    loop {
        let next = std::future::poll_fn(|cx| Pin::new(&mut body).poll_frame(cx));
        let Some(frame) = tokio::time::timeout(idle, next).await.map_err(|_| {
            ApiError::new(StatusCode::REQUEST_TIMEOUT, "The upload stalled: send the archive again")
        })?
        else {
            break;
        };
        let frame =
            frame.map_err(|e| ApiError::bad_request(format!("archive: the upload broke off: {e}")))?;
        let Ok(chunk) = frame.into_data() else { continue };
        size += chunk.len() as u64;
        if size > limit {
            return Err(too_large(limit));
        }
        digest.update(&chunk);
        file.write_all(&chunk).map_err(|e| unwritable(&e))?;
    }
    file.sync_all().map_err(|e| unwritable(&e))?;
    Ok(hex(digest))
}

/// The sha256 of the file at `path`, hex.
async fn sha256(path: &Path) -> std::io::Result<String> {
    let path = path.to_owned();
    let hashed = tokio::task::spawn_blocking(move || {
        let mut file = std::fs::File::open(path)?;
        let mut digest = Context::new(&SHA256);
        let mut buf = vec![0; 64 << 10];
        loop {
            let read = file.read(&mut buf)?;
            if read == 0 {
                return Ok(hex(digest));
            }
            digest.update(&buf[..read]);
        }
    });
    hashed.await.map_err(std::io::Error::other)?
}

/// Reads the held upload whole: what both the guard and the import read.
async fn check(core: &Core) -> Result<Checked, ApiError> {
    let path = core.upload.clone();
    let checked = tokio::task::spawn_blocking(move || archive::check(&path));
    Ok(checked.await.map_err(|_| ApiError::internal())??)
}

/// Imports the held upload, then polls what it added.
async fn import(core: &Core, checked: Checked) -> Result<Json<ImportReport>, ApiError> {
    let now = Timestamp::from_millisecond(core.now_ms()).map_err(|_| ApiError::internal())?;
    let imported = archive::import_checked(&core.store, &core.bundle, &core.upload, checked, now).await?;
    core.apply().await?;
    Ok(Json(imported.into()))
}

/// Takes an archive (`.tar.gz` as 3.x exports it) into an empty store. An archive whose automation is on, or
/// still holds a register, stops at the guard (202) and waits for `/api/admin/import/confirm`; a new upload
/// received whole replaces it.
#[utoipa::path(
    post,
    path = "/api/admin/import",
    operation_id = "importArchive",
    request_body(content = ArchiveFile, content_type = "application/gzip", description = "The 3.x archive"),
    responses(
        (status = 200, body = ImportReport),
        (status = 202, body = Guarded),
        (status = 400, body = ErrorBody),
        (status = 401, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 408, body = ErrorBody),
        (status = 409, body = ErrorBody),
        (status = 413, body = ErrorBody),
        (status = 500, body = ErrorBody)
    )
)]
pub async fn upload(
    State(core): State<Arc<Core>>,
    Extension(limit): Extension<UploadLimit>,
    Extension(idle): Extension<UploadIdle>,
    headers: HeaderMap,
    body: Body,
) -> Result<Response, ApiError> {
    let declared = headers.get(header::CONTENT_LENGTH).and_then(|v| v.to_str().ok()?.parse::<u64>().ok());
    if declared.is_some_and(|length| length > limit.0) {
        return Err(too_large(limit.0));
    }
    let mut held = no_import_running(&core)?;
    let part = core.upload.with_file_name(PART_FILE);
    let mut discard = Discard(vec![part.clone()]);
    let sha256 = receive(body, &part, limit.0, idle.0).await?;
    *held = None;
    discard.0.push(core.upload.clone());
    std::fs::rename(&part, &core.upload).map_err(|e| unwritable(&e))?;
    let checked = check(&core).await?;
    if let Some(saved) = checked.guard()? {
        *held = Some(sha256.clone());
        discard.0.clear();
        return Ok((StatusCode::ACCEPTED, Json(Guarded { sha256, held: saved })).into_response());
    }
    Ok(import(&core, checked).await?.into_response())
}

/// Imports the upload the guard stopped, once: the confirmation names its sha256.
#[utoipa::path(
    post,
    path = "/api/admin/import/confirm",
    operation_id = "confirmArchiveImport",
    request_body = Confirmation,
    responses(
        (status = 200, body = ImportReport),
        (status = 400, body = ErrorBody),
        (status = 401, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 409, body = ErrorBody),
        (status = 500, body = ErrorBody)
    )
)]
pub async fn confirm(
    State(core): State<Arc<Core>>,
    ApiJson(confirmation): ApiJson<Confirmation>,
) -> Result<Json<ImportReport>, ApiError> {
    let mut held = no_import_running(&core)?;
    if held.as_deref() != Some(confirmation.sha256.as_str()) {
        return Err(ApiError::conflict("No upload awaits confirmation for that archive: upload it again"));
    }
    *held = None;
    let _discard = Discard(vec![core.upload.clone()]);
    if sha256(&core.upload).await.ok().as_deref() != Some(confirmation.sha256.as_str()) {
        return Err(ApiError::conflict("The held upload changed: upload it again"));
    }
    let checked = check(&core).await?;
    import(&core, checked).await
}
