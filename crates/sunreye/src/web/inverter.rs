//! The device connection the onboarding form reads, tests and saves.

use std::sync::Arc;

use axum::Json;
use axum::extract::State;
use serde::Deserialize;
use utoipa::ToSchema;

use super::import::no_import_running;
use super::{ApiError, ApiJson, ErrorBody};
use crate::probe::{TestResult, test_connection};
use crate::run::Core;
use crate::settings::{InverterConfig, active_profile, read_inverter, save_inverter};

/// A connection to test, with the profile to read it with. Without one the active profile is used.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TestRequest {
    #[serde(flatten)]
    pub config: InverterConfig,
    pub profile_id: Option<String>,
}

#[utoipa::path(
    get,
    path = "/api/settings/inverter",
    operation_id = "readInverter",
    responses(
        (status = 200, body = InverterConfig),
        (status = 401, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 500, body = ErrorBody)
    )
)]
pub async fn read(State(core): State<Arc<Core>>) -> Result<Json<InverterConfig>, ApiError> {
    Ok(Json(read_inverter(&core.store).await?))
}

/// Saving polls the device as soon as a profile is chosen too.
#[utoipa::path(
    put,
    path = "/api/settings/inverter",
    operation_id = "saveInverter",
    request_body = InverterConfig,
    responses(
        (status = 200, body = InverterConfig),
        (status = 400, body = ErrorBody),
        (status = 401, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 500, body = ErrorBody)
    )
)]
pub async fn save(
    State(core): State<Arc<Core>>,
    ApiJson(config): ApiJson<InverterConfig>,
) -> Result<Json<InverterConfig>, ApiError> {
    config.validate().map_err(ApiError::bad_request)?;
    let _import = no_import_running(&core)?;
    save_inverter(&core.store, &config).await?;
    core.apply().await?;
    Ok(Json(read_inverter(&core.store).await?))
}

/// A device that cannot be reached is a result (`ok: false`), not an error of the request.
#[utoipa::path(
    post,
    path = "/api/settings/inverter/test",
    operation_id = "testInverter",
    request_body = TestRequest,
    responses(
        (status = 200, body = TestResult),
        (status = 400, body = ErrorBody),
        (status = 401, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 500, body = ErrorBody)
    )
)]
pub async fn test(
    State(core): State<Arc<Core>>,
    ApiJson(request): ApiJson<TestRequest>,
) -> Result<Json<TestResult>, ApiError> {
    request.config.validate().map_err(ApiError::bad_request)?;
    let id = match request.profile_id {
        Some(id) => Some(id),
        None => active_profile(&core.store).await?,
    };
    let Some(id) = id else { return Ok(Json(TestResult::failed("No profile selected"))) };
    let Some(profile) = core.profile(&id).await? else {
        return Ok(Json(TestResult::failed(format!("Unknown profile \"{id}\""))));
    };
    Ok(Json(test_connection(&profile, &request.config).await))
}
