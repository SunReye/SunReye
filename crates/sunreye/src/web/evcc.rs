//! The EVCC ingest settings. Nothing subscribes yet; the record only says what would.

use std::sync::Arc;

use axum::Json;
use axum::extract::State;

use super::{ApiError, ApiJson, ErrorBody};
use crate::run::Core;
use crate::settings::{EVCC_KEY, EvccConfig};

#[utoipa::path(
    get,
    path = "/api/settings/evcc",
    operation_id = "readEvcc",
    responses(
        (status = 200, body = EvccConfig),
        (status = 401, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 500, body = ErrorBody)
    )
)]
pub async fn read(State(core): State<Arc<Core>>) -> Result<Json<EvccConfig>, ApiError> {
    Ok(Json(EvccConfig::load(&core.store).await?))
}

/// The whole record: an absent field takes its default.
#[utoipa::path(
    put,
    path = "/api/settings/evcc",
    operation_id = "saveEvcc",
    request_body = EvccConfig,
    responses(
        (status = 200, body = EvccConfig),
        (status = 400, body = ErrorBody),
        (status = 401, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 500, body = ErrorBody)
    )
)]
pub async fn save(
    State(core): State<Arc<Core>>,
    ApiJson(config): ApiJson<EvccConfig>,
) -> Result<Json<EvccConfig>, ApiError> {
    config.validate().map_err(ApiError::bad_request)?;
    core.store.set_setting(EVCC_KEY, &config.stored()).await?;
    Ok(Json(config))
}
