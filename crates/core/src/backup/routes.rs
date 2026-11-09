//! Backup through the API (ADR 3): into a file the admin names under `/share`, where the import
//! reads too. A restore needs the core stopped, so it is the CLI's alone.

use std::path::PathBuf;
use std::sync::Arc;

use axum::Json;
use axum::extract::State;
use axum::extract::rejection::JsonRejection;
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use super::{Error, write};
use crate::api::{Code, Problem, ProblemDetails};
use crate::storage::Database;

const BODY: Problem = Problem {
    status: StatusCode::BAD_REQUEST,
    code: Code::RequestBody,
};
const NAME: Problem = Problem {
    status: StatusCode::UNPROCESSABLE_ENTITY,
    code: Code::BackupName,
};
const EXISTS: Problem = Problem {
    status: StatusCode::CONFLICT,
    code: Code::BackupExists,
};
const INTERNAL: Problem = Problem {
    status: StatusCode::INTERNAL_SERVER_ERROR,
    code: Code::Internal,
};

/// The backup feature module: the store, the data directory and where backups are written.
#[derive(Debug, Clone)]
pub struct Backups(Arc<Inner>);

#[derive(Debug)]
struct Inner {
    database: Database,
    data_dir: PathBuf,
    share: PathBuf,
}

impl Backups {
    /// Backs up the store behind `database` and the car bodies of `data_dir` into `share`.
    #[must_use]
    pub fn new(database: Database, data_dir: PathBuf, share: PathBuf) -> Self {
        Self(Arc::new(Inner {
            database,
            data_dir,
            share,
        }))
    }

    pub fn routes(self) -> OpenApiRouter {
        OpenApiRouter::new()
            .routes(routes!(back_up))
            .with_state(self)
    }
}

/// A backup to write.
#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
struct BackupRequest {
    /// The new file's name under `/share`: no path, not hidden.
    name: String,
    /// Whether it holds the connections' secrets.
    #[serde(default)]
    secrets: bool,
}

/// A backup written.
#[derive(Serialize, ToSchema)]
struct BackupWritten {
    name: String,
    /// Its size in bytes.
    bytes: u64,
}

/// Backs up the store and the car bodies into a new file under `/share`, readable by the core's
/// user alone; the secrets only when asked.
#[utoipa::path(post, path = "/api/v1/backups", request_body = BackupRequest, responses(
    (status = 201, body = BackupWritten),
    (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn back_up(
    State(backups): State<Backups>,
    body: Result<Json<BackupRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<BackupWritten>), Problem> {
    let Json(request) = body.map_err(|_| BODY)?;
    if !plain(&request.name) {
        return Err(NAME);
    }
    let inner = &backups.0;
    std::fs::create_dir_all(&inner.share).map_err(|_| INTERNAL)?;
    let file = inner.share.join(&request.name);
    let written = write(&inner.database, &inner.data_dir, &file, request.secrets).await;
    match written {
        Ok(bytes) => {
            tracing::info!(file = %file.display(), bytes, secrets = request.secrets, "backed up");
            let name = request.name;
            Ok((StatusCode::CREATED, Json(BackupWritten { name, bytes })))
        }
        Err(Error::Exists) => Err(EXISTS),
        Err(e) => {
            tracing::error!("backup: {e}");
            Err(INTERNAL)
        }
    }
}

/// A file name with no path in it that is not hidden, nor `.` or `..`.
fn plain(name: &str) -> bool {
    !name.is_empty() && !name.starts_with('.') && !name.contains(['/', '\0'])
}
