//! The kiosk view: while the admin has it on, the dashboard's reads and `/ws` answer without a session.

use std::sync::Arc;
use std::time::Duration;

use axum::Json;
use axum::extract::{FromRequestParts, Request, State};
use axum::http::request::Parts;
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use serde::{Deserialize, Serialize};
use tokio::sync::OwnedSemaphorePermit;
use utoipa::ToSchema;

use super::auth::AuthSession;
use super::{ApiError, ApiJson, ErrorBody};
use crate::run::Core;
use crate::settings;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, ToSchema)]
pub struct Kiosk {
    pub enabled: bool,
}

/// Public, so the login page can offer the kiosk view.
#[utoipa::path(
    get,
    path = "/api/kiosk",
    operation_id = "kioskStatus",
    responses((status = 200, body = Kiosk), (status = 500, body = ErrorBody))
)]
pub async fn status(State(core): State<Arc<Core>>) -> Result<Json<Kiosk>, ApiError> {
    Ok(Json(Kiosk { enabled: settings::kiosk(&core.store).await? }))
}

#[utoipa::path(
    put,
    path = "/api/settings/kiosk",
    operation_id = "setKiosk",
    request_body = Kiosk,
    responses(
        (status = 200, body = Kiosk),
        (status = 400, body = ErrorBody),
        (status = 401, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 500, body = ErrorBody)
    )
)]
pub async fn switch(
    State(core): State<Arc<Core>>,
    ApiJson(kiosk): ApiJson<Kiosk>,
) -> Result<Json<Kiosk>, ApiError> {
    core.switch_kiosk(kiosk.enabled).await?;
    tracing::info!(enabled = kiosk.enabled, "kiosk view switched");
    Ok(Json(kiosk))
}

/// Any session passes; a request without one passes only while the kiosk view is on.
pub async fn session_or_kiosk(auth: AuthSession, request: Request, next: Next) -> Response {
    if auth.user.is_some() {
        return next.run(request).await;
    }
    match auth.backend.kiosk().await {
        Ok(true) => next.run(request).await,
        Ok(false) => ApiError::unauthorized("Not signed in").into_response(),
        Err(error) => ApiError::from(error).into_response(),
    }
}

/// How long a stranger's history read waits for a [`Core::stranger_permit`] before a 503: a page of
/// history cards drains in well under this, and a client gives up long after it. Waiters are not
/// counted: each is an open request, which a stranger can hold anyway, and leaves when this runs out.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StrangerWait(pub Duration);

impl Default for StrangerWait {
    fn default() -> Self {
        Self(Duration::from_secs(5))
    }
}

/// The SPA's widest read, `LIMIT` in `live-rollup.ts`, on any tier.
const STRANGER_MAX_LIMIT: u32 = 12_000;

/// A history read's allowance: a session reads at once and as wide as the route allows; a stranger
/// holds a [`Core::stranger_permit`] for the whole read and asks for at most [`STRANGER_MAX_LIMIT`]
/// buckets.
#[derive(Debug)]
pub struct HistoryRead {
    _permit: Option<OwnedSemaphorePermit>,
    /// Most buckets one read may ask for; `None` for a session.
    pub max_limit: Option<u32>,
}

impl FromRequestParts<Arc<Core>> for HistoryRead {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, core: &Arc<Core>) -> Result<Self, ApiError> {
        let signed_in = parts.extensions.get::<AuthSession>().is_some_and(|auth| auth.user.is_some());
        if signed_in {
            return Ok(Self { _permit: None, max_limit: None });
        }
        let wait = parts.extensions.get::<StrangerWait>().copied().unwrap_or_default();
        let permit = core
            .stranger_permit(wait.0)
            .await
            .ok_or_else(|| ApiError::unavailable("Too many history reads without a session"))?;
        Ok(Self { _permit: Some(permit), max_limit: Some(STRANGER_MAX_LIMIT) })
    }
}
