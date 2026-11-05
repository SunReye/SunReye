//! The plant time zone setting.

use std::sync::Arc;

use axum::Json;
use axum::extract::State;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::{ApiError, ApiJson, ErrorBody};
use crate::plant_zone::{self, SaveError};
use crate::run::Core;

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PlantTimeZone {
    /// IANA name, e.g. `Europe/Berlin`.
    pub time_zone: String,
}

/// The saved zone, or the host's while none is saved.
#[utoipa::path(
    get,
    path = "/api/settings/time-zone",
    operation_id = "readTimeZone",
    responses(
        (status = 200, body = PlantTimeZone),
        (status = 401, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 500, body = ErrorBody)
    )
)]
pub async fn read(State(core): State<Arc<Core>>) -> Result<Json<PlantTimeZone>, ApiError> {
    // The zone every reader cuts days in: a stored name the database lost reads as UTC.
    let zone = plant_zone::plant_zone(&core.store).await?;
    Ok(Json(PlantTimeZone { time_zone: zone.iana_name().unwrap_or("UTC").to_owned() }))
}

#[utoipa::path(
    put,
    path = "/api/settings/time-zone",
    operation_id = "saveTimeZone",
    request_body = PlantTimeZone,
    responses(
        (status = 200, body = PlantTimeZone),
        (status = 400, body = ErrorBody),
        (status = 401, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 500, body = ErrorBody)
    )
)]
pub async fn save(
    State(core): State<Arc<Core>>,
    ApiJson(body): ApiJson<PlantTimeZone>,
) -> Result<Json<PlantTimeZone>, ApiError> {
    match plant_zone::save(&core.store, &body.time_zone).await {
        Ok(time_zone) => Ok(Json(PlantTimeZone { time_zone })),
        Err(SaveError::Unknown(refused)) => Err(ApiError::bad_request(refused.to_string())),
        Err(SaveError::Store(error)) => Err(error.into()),
    }
}
