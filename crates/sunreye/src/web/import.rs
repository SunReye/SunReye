//! Archive import (ADR 0003): an upload streamed to a file beside the store, and the automation guard. One
//! import at a time; no device is added while one runs. Monitoring only (ADR 0005): nothing here writes a
//! register.

use std::fmt::Write as _;
use std::io::Write;
use std::path::Path;
use std::pin::Pin;
use std::sync::Arc;

use axum::body::{Body, HttpBody};
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use jiff::Timestamp;
use ring::digest::{Context, SHA256};
use serde::{Deserialize, Serialize};
use tokio::sync::MutexGuard;
use utoipa::ToSchema;

use super::{ApiError, ApiJson, ErrorBody};
use crate::archive::{self, Held, ImportError, Imported, Streams};
use crate::run::Core;

/// The held upload's file name in the data directory.
pub const UPLOAD_FILE: &str = "import.tar.gz";

/// The largest archive accepted, in bytes. A full 3.x archive (~9 M rows) is about a tenth of it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UploadLimit(pub u64);

impl Default for UploadLimit {
    fn default() -> Self {
        Self(512 << 20)
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

/// Streams `body` into `path`, hashing it; refuses it once it passes `limit`, removing what was written.
async fn receive(mut body: Body, path: &Path, limit: u64) -> Result<String, ApiError> {
    let mut file = std::fs::File::create(path).map_err(|e| unwritable(&e))?;
    let mut digest = Context::new(&SHA256);
    let mut size = 0_u64;
    while let Some(frame) = std::future::poll_fn(|cx| Pin::new(&mut body).poll_frame(cx)).await {
        let frame =
            frame.map_err(|e| ApiError::bad_request(format!("archive: the upload broke off: {e}")))?;
        let Ok(chunk) = frame.into_data() else { continue };
        size += chunk.len() as u64;
        if size > limit {
            return Err(ApiError::payload_too_large(format!("An archive is at most {limit} bytes")));
        }
        digest.update(&chunk);
        file.write_all(&chunk).map_err(|e| unwritable(&e))?;
    }
    file.sync_all().map_err(|e| unwritable(&e))?;
    Ok(digest.finish().as_ref().iter().fold(String::with_capacity(64), |mut hex, b| {
        let _ = write!(hex, "{b:02x}");
        hex
    }))
}

/// Imports the held upload, then polls what it added. The upload is removed either way.
async fn import(core: &Core) -> Result<Json<ImportReport>, ApiError> {
    let now = Timestamp::from_millisecond(core.now_ms()).map_err(|_| ApiError::internal())?;
    let imported = archive::import(&core.store, &core.bundle, &core.upload, now).await;
    drop(std::fs::remove_file(&core.upload));
    let imported = imported?;
    core.apply().await?;
    Ok(Json(imported.into()))
}

/// Takes an archive (`.tar.gz` as 3.x exports it) into an empty store. An archive whose automation is on, or
/// still holds a register, stops at the guard (202) and waits for `/api/admin/import/confirm`; a new upload
/// replaces it.
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
        (status = 409, body = ErrorBody),
        (status = 413, body = ErrorBody),
        (status = 500, body = ErrorBody)
    )
)]
pub async fn upload(
    State(core): State<Arc<Core>>,
    Extension(limit): Extension<UploadLimit>,
    body: Body,
) -> Result<Response, ApiError> {
    let mut held = no_import_running(&core)?;
    *held = None;
    let received = receive(body, &core.upload, limit.0).await;
    let guard = match received {
        Ok(sha256) => {
            let path = core.upload.clone();
            let guard = tokio::task::spawn_blocking(move || archive::guard(&path))
                .await
                .map_err(|_| ApiError::internal())?;
            guard.map(|g| g.map(|held| Guarded { sha256, held })).map_err(ApiError::from)
        }
        Err(error) => Err(error),
    };
    match guard {
        Ok(Some(guarded)) => {
            *held = Some(guarded.sha256.clone());
            Ok((StatusCode::ACCEPTED, Json(guarded)).into_response())
        }
        Ok(None) => Ok(import(&core).await?.into_response()),
        Err(error) => {
            drop(std::fs::remove_file(&core.upload));
            Err(error)
        }
    }
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
    import(&core).await
}
