//! The MQTT export settings. The password is write-only.

use std::sync::Arc;

use axum::Json;
use axum::extract::State;

use super::{ApiError, ApiJson, ErrorBody};
use crate::mqtt::config::{KEY, MqttConfig, MqttPatch, MqttView};
use crate::run::Core;

#[utoipa::path(
    get,
    path = "/api/settings/mqtt",
    operation_id = "readMqtt",
    responses(
        (status = 200, body = MqttView),
        (status = 401, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 500, body = ErrorBody)
    )
)]
pub async fn read(State(core): State<Arc<Core>>) -> Result<Json<MqttView>, ApiError> {
    Ok(Json(MqttConfig::load(&core.store).await?.view()))
}

/// A patch: absent keeps the stored value, `null` clears a nullable one. The export restarts on it.
#[utoipa::path(
    put,
    path = "/api/settings/mqtt",
    operation_id = "saveMqtt",
    request_body = MqttPatch,
    responses(
        (status = 200, body = MqttView),
        (status = 400, body = ErrorBody),
        (status = 401, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 500, body = ErrorBody)
    )
)]
pub async fn save(
    State(core): State<Arc<Core>>,
    ApiJson(patch): ApiJson<MqttPatch>,
) -> Result<Json<MqttView>, ApiError> {
    let next = MqttConfig::load(&core.store).await?.patched(&patch).map_err(ApiError::bad_request)?;
    core.store.set_setting(KEY, &next.stored()).await?;
    Ok(Json(next.view()))
}
