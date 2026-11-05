//! `axum-login` answers a session store or account lookup that fails with a bare 500. When the cause is
//! a busy database, [`surface`] answers the 503 every other busy read gets.

use std::cell::Cell;

use async_trait::async_trait;
use axum::extract::Request;
use axum::http::StatusCode;
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use tower_sessions::session::{Id, Record};
use tower_sessions::session_store::{self, SessionStore};
use tower_sessions_sqlx_store::SqliteStore;

use super::ApiError;
use crate::store::busy_text;

tokio::task_local! {
    /// Whether the request in this task met a busy database inside a layer that cannot say so.
    static BUSY: Cell<bool>;
}

/// Marks the request as having met a busy database.
pub fn note() {
    BUSY.try_with(|busy| busy.set(true)).ok();
}

/// The session store, noting a busy database in the request that met it.
#[derive(Debug, Clone)]
pub struct Watched(pub SqliteStore);

fn watch<T>(result: session_store::Result<T>) -> session_store::Result<T> {
    if let Err(session_store::Error::Backend(text)) = &result
        && busy_text(text)
    {
        tracing::warn!(error = %text, "session store busy");
        note();
    }
    result
}

#[async_trait]
impl SessionStore for Watched {
    async fn create(&self, record: &mut Record) -> session_store::Result<()> {
        watch(self.0.create(record).await)
    }

    async fn save(&self, record: &Record) -> session_store::Result<()> {
        watch(self.0.save(record).await)
    }

    async fn load(&self, id: &Id) -> session_store::Result<Option<Record>> {
        watch(self.0.load(id).await)
    }

    async fn delete(&self, id: &Id) -> session_store::Result<()> {
        watch(self.0.delete(id).await)
    }
}

/// Turns a bodiless 500 into the busy 503 when a layer under it [`note`]d a busy database.
pub async fn surface(request: Request, next: Next) -> Response {
    let (response, busy) = BUSY
        .scope(Cell::new(false), async {
            let response = next.run(request).await;
            (response, BUSY.with(Cell::get))
        })
        .await;
    let bare = axum::body::HttpBody::size_hint(response.body()).exact() == Some(0);
    if busy && bare && response.status() == StatusCode::INTERNAL_SERVER_ERROR {
        return ApiError::busy().into_response();
    }
    response
}
