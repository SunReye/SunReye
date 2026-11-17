//! Explore's saved views (ADR 22, ADR 9): up to 20 named route queries for the whole plant, in
//! the order saved. The admin writes them, every write appended to the change log (ADR 19);
//! viewers read them.
//!
//! The views module owns the `saved_view` table. A query is opaque to the core: the SPA grows its
//! parameters without a migration.

use std::time::SystemTime;

use axum::Json;
use axum::extract::rejection::{JsonRejection, PathRejection};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::api::{Clock, Code, Problem, ProblemDetails, internal};
use crate::changes::{self, Action, Entry, Subject};
use crate::storage::Database;

/// Who saves views: the one admin (ADR 9).
const ACTOR: &str = "admin";
/// The most views kept.
const MOST: u32 = 20;
/// The longest query, in bytes.
const LONGEST_QUERY: usize = 2048;
/// The longest name, in bytes: the SPA pre-fills it from up to six series' labels.
const LONGEST_NAME: usize = 256;

const BODY: Problem = Problem {
    status: StatusCode::BAD_REQUEST,
    code: Code::RequestBody,
};
const PATH: Problem = Problem {
    status: StatusCode::BAD_REQUEST,
    code: Code::RequestPath,
};
const NONE: Problem = Problem {
    status: StatusCode::NOT_FOUND,
    code: Code::ViewsNone,
};
const NAME: Problem = Problem {
    status: StatusCode::CONFLICT,
    code: Code::ViewsName,
};
const FULL: Problem = Problem {
    status: StatusCode::CONFLICT,
    code: Code::ViewsFull,
};
const VALUE: Problem = Problem {
    status: StatusCode::UNPROCESSABLE_ENTITY,
    code: Code::ViewsValue,
};

/// A view as the admin saves it.
#[derive(Deserialize, ToSchema)]
pub struct SavedViewDraft {
    /// Unique.
    name: String,
    /// Explore's route query, at most 2 KB, kept as given.
    query: String,
}

/// A saved view.
#[derive(Serialize, ToSchema)]
pub struct SavedView {
    id: u32,
    name: String,
    query: String,
}

/// Every saved view, in the order saved.
#[derive(Serialize, ToSchema)]
pub struct SavedViews {
    views: Vec<SavedView>,
}

/// The saved-views feature module.
#[derive(Debug, Clone)]
pub struct Views {
    database: Database,
}

impl Views {
    #[must_use]
    pub const fn new(database: Database) -> Self {
        Self { database }
    }

    /// The saved-views routes: everyone's list, the admin's writes.
    pub fn routes(self, clock: Clock) -> OpenApiRouter {
        OpenApiRouter::new()
            .routes(routes!(list_views, add_view))
            .routes(routes!(change_view, remove_view))
            .with_state((self, clock))
    }
}

type ViewsState = State<(Views, Clock)>;

#[utoipa::path(get, path = "/api/v1/views", responses(
    (status = 200, body = SavedViews),
    (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn list_views(State((views, _)): ViewsState) -> Result<Json<SavedViews>, Problem> {
    let views = views.database.run(read).await.map_err(internal)?;
    Ok(Json(SavedViews { views }))
}

fn read(db: &Connection) -> rusqlite::Result<Vec<SavedView>> {
    db.prepare("SELECT id, name, query FROM saved_view ORDER BY id")?
        .query_map([], |row| {
            Ok(SavedView {
                id: row.get(0)?,
                name: row.get(1)?,
                query: row.get(2)?,
            })
        })?
        .collect()
}

/// A draft the core keeps: a name and a query of at most 2 KB.
fn checked(body: Result<Json<SavedViewDraft>, JsonRejection>) -> Result<SavedViewDraft, Problem> {
    let Json(draft) = body.map_err(|_| BODY)?;
    let named = !draft.name.trim().is_empty() && draft.name.len() <= LONGEST_NAME;
    if !named || draft.query.len() > LONGEST_QUERY {
        return Err(VALUE);
    }
    Ok(draft)
}

/// Saves a view after the others; a taken name is refused before a full list.
#[utoipa::path(post, path = "/api/v1/views", request_body = SavedViewDraft, responses(
    (status = 201, body = SavedView),
    (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn add_view(
    State((views, clock)): ViewsState,
    body: Result<Json<SavedViewDraft>, JsonRejection>,
) -> Result<(StatusCode, Json<SavedView>), Problem> {
    let draft = checked(body)?;
    let changed = clock();
    let added = views
        .database
        .run(move |db| insert(db, draft, changed))
        .await
        .map_err(internal)??;
    Ok((StatusCode::CREATED, Json(added)))
}

fn insert(
    db: &Connection,
    SavedViewDraft { name, query }: SavedViewDraft,
    changed: SystemTime,
) -> rusqlite::Result<Result<SavedView, Problem>> {
    let tx = db.unchecked_transaction()?;
    if taken(&tx, &name, None)? {
        return Ok(Err(NAME));
    }
    let count: u32 = tx.query_row("SELECT count(*) FROM saved_view", [], |row| row.get(0))?;
    if count >= MOST {
        return Ok(Err(FULL));
    }
    tx.execute(
        "INSERT INTO saved_view (name, query) VALUES (?1, ?2)",
        params![name, query],
    )?;
    let rowid = tx.last_insert_rowid();
    let id =
        u32::try_from(rowid).map_err(|_| rusqlite::Error::IntegralValueOutOfRange(0, rowid))?;
    let view = SavedView { id, name, query };
    log(&tx, id, Action::Add, Some(&view), changed)?;
    tx.commit()?;
    Ok(Ok(view))
}

/// Whether a view other than `except` holds `name`.
fn taken(db: &Connection, name: &str, except: Option<u32>) -> rusqlite::Result<bool> {
    Ok(db
        .query_row("SELECT id FROM saved_view WHERE name = ?1", [name], |row| {
            row.get::<_, u32>(0)
        })
        .optional()?
        .is_some_and(|id| Some(id) != except))
}

/// Replaces a view's name and query; it keeps its place.
#[utoipa::path(put, path = "/api/v1/views/{id}", params(("id" = u32, Path)),
    request_body = SavedViewDraft, responses(
    (status = 200, body = SavedView),
    (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn change_view(
    State((views, clock)): ViewsState,
    id: Result<Path<u32>, PathRejection>,
    body: Result<Json<SavedViewDraft>, JsonRejection>,
) -> Result<Json<SavedView>, Problem> {
    let Path(id) = id.map_err(|_| PATH)?;
    let draft = checked(body)?;
    let changed = clock();
    let view = views
        .database
        .run(move |db| update(db, id, draft, changed))
        .await
        .map_err(internal)??;
    Ok(Json(view))
}

fn update(
    db: &Connection,
    id: u32,
    SavedViewDraft { name, query }: SavedViewDraft,
    changed: SystemTime,
) -> rusqlite::Result<Result<SavedView, Problem>> {
    let tx = db.unchecked_transaction()?;
    let exists = tx
        .query_row("SELECT 1 FROM saved_view WHERE id = ?1", [id], |_| Ok(()))
        .optional()?
        .is_some();
    if !exists {
        return Ok(Err(NONE));
    }
    if taken(&tx, &name, Some(id))? {
        return Ok(Err(NAME));
    }
    tx.execute(
        "UPDATE saved_view SET name = ?2, query = ?3 WHERE id = ?1",
        params![id, name, query],
    )?;
    let view = SavedView { id, name, query };
    log(&tx, id, Action::Change, Some(&view), changed)?;
    tx.commit()?;
    Ok(Ok(view))
}

/// Removes a view.
#[utoipa::path(delete, path = "/api/v1/views/{id}", params(("id" = u32, Path)), responses(
    (status = 204),
    (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn remove_view(
    State((views, clock)): ViewsState,
    id: Result<Path<u32>, PathRejection>,
) -> Result<StatusCode, Problem> {
    let Path(id) = id.map_err(|_| PATH)?;
    let changed = clock();
    views
        .database
        .run(move |db| delete(db, id, changed))
        .await
        .map_err(internal)??;
    Ok(StatusCode::NO_CONTENT)
}

fn delete(db: &Connection, id: u32, changed: SystemTime) -> rusqlite::Result<Result<(), Problem>> {
    let tx = db.unchecked_transaction()?;
    if tx.execute("DELETE FROM saved_view WHERE id = ?1", [id])? == 0 {
        return Ok(Err(NONE));
    }
    log(&tx, id, Action::Remove, None, changed)?;
    tx.commit()?;
    Ok(Ok(()))
}

fn log(
    db: &Connection,
    id: u32,
    action: Action,
    view: Option<&SavedView>,
    changed: SystemTime,
) -> rusqlite::Result<()> {
    changes::append(
        db,
        &Entry {
            subject: Subject::View,
            id,
            action,
            state: view.and_then(|v| serde_json::to_value(v).ok()),
            actor: ACTOR,
            changed,
            applies_from: changed,
        },
    )
}
