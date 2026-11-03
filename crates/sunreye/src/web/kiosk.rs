//! The kiosk view: while the admin has it on, the dashboard's reads and `/ws` answer without a session.

use std::sync::Arc;

use axum::Json;
use axum::extract::{Request, State};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use serde::{Deserialize, Serialize};
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
