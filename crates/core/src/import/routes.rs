//! The import from the SPA (ADR 18): an archive under `/share` or uploaded, run inside the core
//! through the storage thread one series at a time, so polling carries on.

use std::io::Write as _;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};

use axum::Json;
use axum::body::Body;
use axum::extract::State;
use axum::extract::rejection::JsonRejection;
use axum::http::StatusCode;
use futures_util::StreamExt as _;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use super::{Error, Report, archive, log, run, targets};
use crate::api::{Code, Problem, ProblemDetails};
use crate::bus::Bus;
use crate::profiles::Catalogue;
use crate::storage::{Database, Importer, Storage};

const BODY: Problem = Problem {
    status: StatusCode::BAD_REQUEST,
    code: Code::RequestBody,
};
const BUSY: Problem = Problem {
    status: StatusCode::CONFLICT,
    code: Code::ImportBusy,
};
const PATH: Problem = Problem {
    status: StatusCode::UNPROCESSABLE_ENTITY,
    code: Code::ImportPath,
};
const SIZE: Problem = Problem {
    status: StatusCode::PAYLOAD_TOO_LARGE,
    code: Code::ImportSize,
};
const FILE: Problem = Problem {
    status: StatusCode::UNPROCESSABLE_ENTITY,
    code: Code::ImportFile,
};
const INTERNAL: Problem = Problem {
    status: StatusCode::INTERNAL_SERVER_ERROR,
    code: Code::Internal,
};

/// The largest upload, in bytes; a larger export goes through `/share`.
pub const MAX: u64 = 1 << 30;
/// How deep under `/share` archives are listed.
const DEPTH: usize = 4;

/// The import feature module: where archives are found, and the one import that may run.
#[derive(Clone)]
pub struct Imports(Arc<Inner>);

struct Inner {
    share: PathBuf,
    upload: PathBuf,
    max: u64,
    importer: Importer,
    database: Database,
    bus: Bus,
    catalogue: Catalogue,
    status: Mutex<ImportStatus>,
}

impl Imports {
    /// Imports read archives under `share` and keep an uploaded one of at most `max` bytes at
    /// `upload`.
    #[must_use]
    pub fn new(
        (share, upload, max): (PathBuf, PathBuf, u64),
        storage: &Storage,
        bus: &Bus,
        catalogue: Catalogue,
    ) -> Self {
        Self(Arc::new(Inner {
            share,
            upload,
            max,
            importer: storage.importer(),
            database: storage.database(),
            bus: bus.clone(),
            catalogue,
            status: Mutex::new(ImportStatus::default()),
        }))
    }

    pub fn routes(self) -> OpenApiRouter {
        OpenApiRouter::new()
            .routes(routes!(import_status, start_import))
            .routes(routes!(import_files))
            .routes(routes!(upload_import))
            .with_state(self)
    }

    fn status(&self) -> ImportStatus {
        self.0
            .status
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    fn set(&self, status: ImportStatus) {
        *self.0.status.lock().unwrap_or_else(PoisonError::into_inner) = status;
    }

    /// Marks an import running unless one already is.
    fn claim(&self) -> Result<ImportStatus, Problem> {
        let mut status = self.0.status.lock().unwrap_or_else(PoisonError::into_inner);
        if status.state == ImportPhase::Running {
            return Err(BUSY);
        }
        *status = ImportStatus {
            state: ImportPhase::Running,
            ..ImportStatus::default()
        };
        Ok(status.clone())
    }

    async fn import(self, file: PathBuf, mappings: Vec<(String, u32)>) {
        tracing::info!(file = %file.display(), "import started");
        let inner = &self.0;
        let imported = async {
            let targets = targets(&inner.database, &inner.catalogue, mappings).await?;
            let progress = |done, total| {
                tracing::info!(done, total, "import progress");
                self.set(ImportStatus {
                    state: ImportPhase::Running,
                    done,
                    total,
                    ..ImportStatus::default()
                });
            };
            run(file, &inner.importer, &inner.bus, targets, progress).await
        }
        .await;
        let status = self.status();
        self.set(match imported {
            Ok(report) => {
                log(&report);
                ImportStatus {
                    state: ImportPhase::Done,
                    report: Some(ImportReport::from(report)),
                    ..status
                }
            }
            Err(e) => {
                tracing::error!("import: {e}");
                ImportStatus {
                    state: ImportPhase::Failed,
                    problem: Some(code(&e)),
                    ..status
                }
            }
        });
    }
}

/// Where an import stands.
#[derive(Debug, Clone, Default, Serialize, ToSchema)]
pub struct ImportStatus {
    state: ImportPhase,
    /// Series written so far.
    done: usize,
    /// Series the archive feeds; 0 until it is read.
    total: usize,
    /// Once done, what was written and left out.
    report: Option<ImportReport>,
    /// Once failed, why.
    problem: Option<Code>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
enum ImportPhase {
    /// None has run since the core started.
    #[default]
    Idle,
    Running,
    Done,
    Failed,
}

/// What an import wrote and left out.
#[derive(Debug, Clone, Serialize, ToSchema)]
struct ImportReport {
    series: usize,
    /// Change points written.
    points: usize,
    /// Hourly rollups written.
    hours: usize,
    /// Daily rollups written.
    days: usize,
    /// v3 metrics no v5 quantity reads, as `slug/key`: not imported.
    unread: Vec<String>,
    /// v3 devices with readings and no v5 device: not imported.
    unmapped: Vec<String>,
}

impl From<Report> for ImportReport {
    fn from(report: Report) -> Self {
        Self {
            series: report.series,
            points: report.written.points,
            hours: report.written.hours,
            days: report.written.days,
            unread: report.unread.into_iter().collect(),
            unmapped: report.unmapped.into_iter().collect(),
        }
    }
}

const fn code(e: &Error) -> Code {
    match e {
        Error::Archive(_) => Code::ImportFile,
        Error::UnknownDevice(_) | Error::UnknownTarget(_) => Code::ImportDevice,
        Error::NoProfile(_) => Code::ImportProfile,
        Error::Profiles(_) | Error::Storage(_) => Code::Internal,
    }
}

/// An import to start.
#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
struct ImportStart {
    /// The archive's path under `/share`; without it, the uploaded archive.
    #[serde(default)]
    path: Option<String>,
    /// Each v3 device and the v5 device its history goes to.
    devices: Vec<ImportMapping>,
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
struct ImportMapping {
    /// The v3 device's slug.
    slug: String,
    /// The v5 device's id.
    device: u32,
}

/// A v3 device an archive holds.
#[derive(Serialize, ToSchema)]
struct ArchiveDevice {
    slug: String,
    /// Its v3 profile's id.
    profile: String,
}

/// The v3 devices an archive holds.
#[derive(Serialize, ToSchema)]
struct ImportArchive {
    devices: Vec<ArchiveDevice>,
}

/// An archive under `/share`.
#[derive(Serialize, ToSchema)]
struct SharedArchive {
    /// Its path under `/share`.
    path: String,
    devices: Vec<ArchiveDevice>,
}

#[derive(Serialize, ToSchema)]
struct ArchiveFiles {
    files: Vec<SharedArchive>,
}

fn devices(path: &Path) -> Option<Vec<ArchiveDevice>> {
    let devices = archive::devices(path).ok()?;
    let devices = devices.into_iter().map(|d| ArchiveDevice {
        slug: d.slug,
        profile: d.profile_id,
    });
    Some(devices.collect())
}

/// The v3 archives under `/share`, by path. Symlinks are not followed.
#[utoipa::path(get, path = "/api/v1/import/files", responses(
    (status = 200, body = ArchiveFiles),
    (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn import_files(State(imports): State<Imports>) -> Result<Json<ArchiveFiles>, Problem> {
    let share = imports.0.share.clone();
    let files = tokio::task::spawn_blocking(move || {
        let mut found = Vec::new();
        archives(&share, Path::new(""), DEPTH, &mut found);
        found.sort();
        let files = found.into_iter().filter_map(|relative| {
            let devices = devices(&share.join(&relative))?;
            let path = relative.to_str()?.to_owned();
            Some(SharedArchive { path, devices })
        });
        files.collect()
    })
    .await
    .map_err(|_| INTERNAL)?;
    Ok(Json(ArchiveFiles { files }))
}

/// Collects into `found` each `.tar.gz` file under `root/relative`, `depth` levels down.
fn archives(root: &Path, relative: &Path, depth: usize, found: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(root.join(relative)) else {
        return;
    };
    for entry in entries.flatten() {
        let (Ok(kind), path) = (entry.file_type(), relative.join(entry.file_name())) else {
            continue;
        };
        if kind.is_dir() && depth > 1 {
            archives(root, &path, depth - 1, found);
        } else if kind.is_file() && path.to_string_lossy().ends_with(".tar.gz") {
            found.push(path);
        }
    }
}

/// Stores an uploaded v3 archive for the next import, replacing the last; answers its devices.
#[utoipa::path(post, path = "/api/v1/import/upload",
    request_body(content = Vec<u8>, content_type = "application/gzip"),
    responses(
        (status = 201, body = ImportArchive),
        (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
    ),
)]
async fn upload_import(
    State(imports): State<Imports>,
    request: Body,
) -> Result<(StatusCode, Json<ImportArchive>), Problem> {
    if imports.status().state == ImportPhase::Running {
        return Err(BUSY);
    }
    let path = imports.0.upload.clone();
    let part = path.with_extension("part");
    let written = write(request, &part, imports.0.max).await;
    let checked = match written {
        Ok(()) => {
            let part = part.clone();
            tokio::task::spawn_blocking(move || {
                let devices = devices(&part).ok_or(FILE)?;
                std::fs::rename(&part, &path).map_err(|_| INTERNAL)?;
                Ok(devices)
            })
            .await
            .map_err(|_| INTERNAL)?
        }
        Err(problem) => Err(problem),
    };
    if checked.is_err() {
        std::fs::remove_file(&part).ok();
    }
    Ok((
        StatusCode::CREATED,
        Json(ImportArchive { devices: checked? }),
    ))
}

/// Streams `request` into `file`, refused once it passes `max` bytes without reading the rest.
/// Chunks are written as they arrive, so a large upload never sits in memory.
async fn write(request: Body, file: &Path, max: u64) -> Result<(), Problem> {
    let mut out = std::fs::File::create(file).map_err(|_| INTERNAL)?;
    let mut stream = request.into_data_stream();
    let mut size: u64 = 0;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| BODY)?;
        size += chunk.len() as u64;
        if size > max {
            return Err(SIZE);
        }
        out.write_all(&chunk).map_err(|_| INTERNAL)?;
    }
    Ok(())
}

/// Where the import stands: idle, running with its progress, or its result.
#[utoipa::path(get, path = "/api/v1/import", responses(
    (status = 200, body = ImportStatus),
    (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn import_status(State(imports): State<Imports>) -> Json<ImportStatus> {
    Json(imports.status())
}

/// Starts importing an archive; one import runs at a time, while the core keeps polling.
#[utoipa::path(post, path = "/api/v1/import", request_body = ImportStart, responses(
    (status = 202, body = ImportStatus),
    (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn start_import(
    State(imports): State<Imports>,
    body: Result<Json<ImportStart>, JsonRejection>,
) -> Result<(StatusCode, Json<ImportStatus>), Problem> {
    let Json(start) = body.map_err(|_| BODY)?;
    let file = match start.path {
        Some(path) => {
            let share = imports.0.share.clone();
            tokio::task::spawn_blocking(move || confined(&share, &path))
                .await
                .ok()
                .flatten()
        }
        None => Some(imports.0.upload.clone()).filter(|upload| upload.is_file()),
    }
    .ok_or(PATH)?;
    let status = imports.claim()?;
    let mappings = start.devices.into_iter().map(|m| (m.slug, m.device));
    tokio::spawn(imports.import(file, mappings.collect()));
    Ok((StatusCode::ACCEPTED, Json(status)))
}

/// The regular file at `relative` under `root`, if neither `..`, an absolute path nor a symlink
/// leads it out of `root`.
fn confined(root: &Path, relative: &str) -> Option<PathBuf> {
    let relative = Path::new(relative);
    if !relative
        .components()
        .all(|c| matches!(c, Component::Normal(_)))
    {
        return None;
    }
    let root = root.canonicalize().ok()?;
    let file = root.join(relative).canonicalize().ok()?;
    (file.starts_with(&root) && file.is_file()).then_some(file)
}
