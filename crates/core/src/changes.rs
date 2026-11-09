//! The change log (ADR 19): every configuration change, appended with its actor, the instant it
//! was made and the instant it applies from.
//!
//! The change-log module owns the `change` table. A module appends inside its own transaction, so
//! a change and its entry commit together.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use rusqlite::{Connection, params};
use serde::Serialize;
use utoipa::ToSchema;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::api::{Code, Problem, ProblemDetails};
use crate::storage::Database;

const INTERNAL: Problem = Problem {
    status: StatusCode::INTERNAL_SERVER_ERROR,
    code: Code::Internal,
};

/// What a change is about.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Subject {
    Connection,
    Device,
    /// A profile index an admin added (ADR 8).
    Index,
    /// The plant's location, id 0.
    Location,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Action {
    Add,
    Change,
    Remove,
}

/// One configuration change.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    pub subject: Subject,
    pub id: u32,
    pub action: Action,
    /// The subject after the change, as the API reads it: never a secret. `None` once removed.
    pub state: Option<serde_json::Value>,
    pub actor: &'static str,
    pub changed: SystemTime,
    pub applies_from: SystemTime,
}

/// Appends `entry` on `db`, inside the caller's transaction.
///
/// # Errors
/// The file cannot be written.
pub fn append(db: &Connection, entry: &Entry) -> rusqlite::Result<()> {
    let state = entry.state.as_ref().map(serde_json::Value::to_string);
    db.execute(
        "INSERT INTO change (changed, applies_from, actor, subject, subject_id, action, state)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            seconds(entry.changed),
            seconds(entry.applies_from),
            entry.actor,
            name(&entry.subject),
            entry.id,
            name(&entry.action),
            state
        ],
    )?;
    Ok(())
}

/// The change-log feature module.
#[derive(Debug, Clone)]
pub struct Changes {
    database: Database,
}

impl Changes {
    #[must_use]
    pub const fn new(database: Database) -> Self {
        Self { database }
    }

    /// The change log route, behind the admin's session.
    pub fn routes(self) -> OpenApiRouter {
        OpenApiRouter::new()
            .routes(routes!(changes))
            .with_state(self)
    }
}

/// A unit enum's serde name, as stored.
fn name(value: &impl Serialize) -> String {
    serde_json::to_value(value)
        .ok()
        .and_then(|v| v.as_str().map(str::to_owned))
        .unwrap_or_default()
}

pub(crate) fn seconds(time: SystemTime) -> i64 {
    let since = time.duration_since(UNIX_EPOCH).unwrap_or_default();
    i64::try_from(since.as_secs()).unwrap_or(i64::MAX)
}

pub(crate) fn rfc3339(seconds: i64) -> String {
    let time = UNIX_EPOCH + Duration::from_secs(u64::try_from(seconds).unwrap_or(0));
    jiff::Timestamp::try_from(time)
        .map(|t| t.to_string())
        .unwrap_or_default()
}

/// One entry of the change log.
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
struct Change {
    /// RFC 3339, UTC.
    changed: String,
    /// RFC 3339, UTC.
    applies_from: String,
    actor: String,
    /// `connection`, `device`, `index` or `location`.
    subject: String,
    /// The subject's id.
    id: u32,
    /// `add`, `change` or `remove`.
    action: String,
    /// The subject after the change, as its own route reads it; `null` once removed.
    state: Option<serde_json::Value>,
}

#[derive(Serialize, ToSchema)]
struct Log {
    changes: Vec<Change>,
}

fn read(db: &Connection) -> rusqlite::Result<Vec<Change>> {
    db.prepare(
        "SELECT changed, applies_from, actor, subject, subject_id, action, state
         FROM change ORDER BY id",
    )?
    .query_map([], |row| {
        let state: Option<String> = row.get(6)?;
        Ok(Change {
            changed: rfc3339(row.get(0)?),
            applies_from: rfc3339(row.get(1)?),
            actor: row.get(2)?,
            subject: row.get(3)?,
            id: row.get(4)?,
            action: row.get(5)?,
            state: state.and_then(|s| serde_json::from_str(&s).ok()),
        })
    })?
    .collect()
}

/// Every configuration change, oldest first.
#[utoipa::path(get, path = "/api/v1/changes", responses(
    (status = 200, body = Log),
    (status = 401, body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn changes(State(changes): State<Changes>) -> Result<Json<Log>, Problem> {
    let changes = changes.database.run(read).await.map_err(|_| INTERNAL)?;
    Ok(Json(Log { changes }))
}
