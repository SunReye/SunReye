//! Viewer accounts (ADR 9): read-only sign-ins the admin creates, each with a name and password.

use axum::Json;
use axum::extract::rejection::{JsonRejection, PathRejection};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::sessions::Grant;
use super::{Auth, BODY, PASSWORD, PATH, blocking, hash};
use crate::api::{Clock, Code, Problem, ProblemDetails, internal};
use crate::changes::{self, Action, Entry, Subject};

const ACTOR: &str = "admin";
/// The longest name, in bytes.
const LONGEST_NAME: usize = 64;

const NONE: Problem = Problem {
    status: StatusCode::NOT_FOUND,
    code: Code::ViewerNone,
};
const NAME: Problem = Problem {
    status: StatusCode::CONFLICT,
    code: Code::ViewerName,
};
const VALUE: Problem = Problem {
    status: StatusCode::UNPROCESSABLE_ENTITY,
    code: Code::ViewerValue,
};

/// A viewer as the admin adds it.
#[derive(Deserialize, ToSchema)]
pub struct ViewerDraft {
    /// What the viewer signs in with; unique.
    name: String,
    password: String,
}

/// A viewer as the API reads it: never its password.
#[derive(Serialize, ToSchema)]
pub struct Viewer {
    id: u32,
    name: String,
}

#[derive(Serialize, ToSchema)]
pub struct Viewers {
    viewers: Vec<Viewer>,
}

type ViewersState = State<(Auth, Clock)>;

/// The id and bcrypt hash of viewer `name`.
pub fn find(db: &Connection, name: &str) -> rusqlite::Result<Option<(u32, String)>> {
    db.query_row(
        "SELECT id, hash FROM viewer WHERE name = ?1",
        [name],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .optional()
}

#[utoipa::path(get, path = "/api/v1/viewers", responses(
    (status = 200, body = Viewers),
    (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
))]
pub async fn list_viewers(State((auth, _)): ViewersState) -> Result<Json<Viewers>, Problem> {
    let viewers = auth
        .0
        .database
        .run(|db| {
            db.prepare("SELECT id, name FROM viewer ORDER BY id")?
                .query_map([], |row| {
                    Ok(Viewer {
                        id: row.get(0)?,
                        name: row.get(1)?,
                    })
                })?
                .collect()
        })
        .await
        .map_err(internal)?;
    Ok(Json(Viewers { viewers }))
}

/// Adds a viewer, who reads live values and history.
#[utoipa::path(post, path = "/api/v1/viewers", request_body = ViewerDraft, responses(
    (status = 201, body = Viewer),
    (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
))]
pub async fn add_viewer(
    State((auth, clock)): ViewersState,
    body: Result<Json<ViewerDraft>, JsonRejection>,
) -> Result<(StatusCode, Json<Viewer>), Problem> {
    let Json(ViewerDraft { name, password }) = body.map_err(|_| BODY)?;
    if name.trim().is_empty() || name.len() > LONGEST_NAME {
        return Err(VALUE);
    }
    if password.len() > super::LONGEST {
        return Err(PASSWORD);
    }
    let hash = blocking(move || hash(&password)).await?;
    let changed = clock();
    let added = auth
        .0
        .database
        .run(move |db| insert(db, name, &hash, changed))
        .await
        .map_err(internal)??;
    Ok((StatusCode::CREATED, Json(added)))
}

fn insert(
    db: &Connection,
    name: String,
    hash: &str,
    changed: std::time::SystemTime,
) -> rusqlite::Result<Result<Viewer, Problem>> {
    let tx = db.unchecked_transaction()?;
    let inserted = tx.execute(
        "INSERT INTO viewer (name, hash) VALUES (?1, ?2) ON CONFLICT (name) DO NOTHING",
        params![name, hash],
    )?;
    if inserted == 0 {
        return Ok(Err(NAME));
    }
    let id = u32::try_from(tx.last_insert_rowid()).unwrap_or(u32::MAX);
    let viewer = Viewer { id, name };
    changes::append(
        &tx,
        &Entry {
            subject: Subject::Viewer,
            id,
            action: Action::Add,
            state: serde_json::to_value(&viewer).ok(),
            actor: ACTOR,
            changed,
            applies_from: changed,
        },
    )?;
    tx.commit()?;
    Ok(Ok(viewer))
}

/// Removes a viewer and ends its sessions.
#[utoipa::path(delete, path = "/api/v1/viewers/{id}", params(("id" = u32, Path)), responses(
    (status = 204),
    (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
))]
pub async fn remove_viewer(
    State((auth, clock)): ViewersState,
    id: Result<Path<u32>, PathRejection>,
) -> Result<StatusCode, Problem> {
    let Path(id) = id.map_err(|_| PATH)?;
    let changed = clock();
    let removed = auth
        .0
        .database
        .run(move |db| {
            let tx = db.unchecked_transaction()?;
            if tx.execute("DELETE FROM viewer WHERE id = ?1", [id])? == 0 {
                return Ok(false);
            }
            changes::append(
                &tx,
                &Entry {
                    subject: Subject::Viewer,
                    id,
                    action: Action::Remove,
                    state: None,
                    actor: ACTOR,
                    changed,
                    applies_from: changed,
                },
            )?;
            tx.commit()?;
            Ok(true)
        })
        .await
        .map_err(internal)?;
    if !removed {
        return Err(NONE);
    }
    auth.sessions().end(Grant::Viewer(id));
    Ok(StatusCode::NO_CONTENT)
}
