//! The forecast settings and the PV forecast on 3.x's paths and shapes (`apps/server/src/routes/settings.ts`).
//! The forecast reads need a session, as in 3.x, but stay off the kiosk view's allow-list.

use std::sync::Arc;

use axum::Json;
use axum::extract::State;
use serde::Serialize;
use serde_json::Value;
use utoipa::ToSchema;

use super::{ApiError, ApiJson, ErrorBody};
use crate::forecast::{DetailedPoint, ForecastView, Variant};
use crate::live::iso;
use crate::run::Core;
use crate::solar::Served;
use crate::weather::{self, OPEN_METEO, WeatherConfig, WeatherPatch};

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    dni: bool,
    wind_speed: bool,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct Provider {
    id: &'static str,
    label: &'static str,
    capabilities: Capabilities,
}

/// One view as 3.x exports it, with the age of its irradiance.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ForecastExport {
    provider: String,
    step_minutes: i64,
    utc_offset_seconds: i32,
    #[serde(flatten)]
    view: ForecastView,
    /// The Solcast-shaped curve Home Assistant PV blueprints read.
    detailed_forecast: Vec<DetailedPoint>,
    /// When the irradiance was fetched, UTC ISO 8601.
    fetched_at: String,
    /// The last fetch failed: this is built from the irradiance before it.
    stale: bool,
}

fn export(served: &Served, variant: Variant) -> ForecastExport {
    let view = served.forecast.export(variant);
    ForecastExport {
        provider: view.provider.to_owned(),
        step_minutes: view.step_minutes,
        utc_offset_seconds: view.utc_offset_seconds,
        view: view.view.clone(),
        detailed_forecast: view.detailed_forecast,
        fetched_at: iso(served.fetched_ms),
        stale: served.stale,
    }
}

#[utoipa::path(
    get,
    path = "/api/settings/weather",
    operation_id = "readWeather",
    responses(
        (status = 200, body = WeatherConfig),
        (status = 401, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 500, body = ErrorBody)
    )
)]
pub async fn read(State(core): State<Arc<Core>>) -> Result<Json<WeatherConfig>, ApiError> {
    Ok(Json(weather::read(&core.store).await?))
}

/// A patch of the plant-level fields; arrays, panel physics and the battery are edited on the inverter.
#[utoipa::path(
    put,
    path = "/api/settings/weather",
    operation_id = "saveWeather",
    request_body = WeatherPatch,
    responses(
        (status = 200, body = WeatherConfig),
        (status = 400, body = ErrorBody),
        (status = 401, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 500, body = ErrorBody)
    )
)]
pub async fn save(
    State(core): State<Arc<Core>>,
    ApiJson(body): ApiJson<Value>,
) -> Result<Json<WeatherConfig>, ApiError> {
    let current = core.store.plant_settings().await?.unwrap_or_default();
    let next = current.patched(&body).map_err(ApiError::bad_request)?;
    core.store.save_plant_settings(&next).await?;
    Ok(Json(weather::read(&core.store).await?))
}

#[utoipa::path(
    get,
    path = "/api/forecast/providers",
    operation_id = "forecastProviders",
    responses(
        (status = 200, body = Vec<Provider>),
        (status = 401, body = ErrorBody),
        (status = 403, body = ErrorBody)
    )
)]
pub async fn providers() -> Json<[Provider; 1]> {
    let capabilities = Capabilities { dni: true, wind_speed: true };
    Json([Provider { id: OPEN_METEO, label: "Open-Meteo", capabilities }])
}

/// The uncurtailed PV potential; null while the forecast is off or unconfigured, or no irradiance was had.
#[utoipa::path(
    get,
    path = "/api/forecast",
    operation_id = "rawForecast",
    responses(
        (status = 200, body = Option<ForecastExport>),
        (status = 401, body = ErrorBody),
        (status = 500, body = ErrorBody)
    )
)]
pub async fn raw(State(core): State<Arc<Core>>) -> Result<Json<Option<ForecastExport>>, ApiError> {
    Ok(Json(core.solar.serve(&core).await?.map(|served| export(&served, Variant::Raw))))
}

/// What the feed-in cap and the battery leave of it; null as for the raw forecast.
#[utoipa::path(
    get,
    path = "/api/forecast/usable",
    operation_id = "usableForecast",
    responses(
        (status = 200, body = Option<ForecastExport>),
        (status = 401, body = ErrorBody),
        (status = 500, body = ErrorBody)
    )
)]
pub async fn usable(State(core): State<Arc<Core>>) -> Result<Json<Option<ForecastExport>>, ApiError> {
    Ok(Json(core.solar.serve(&core).await?.map(|served| export(&served, Variant::Usable))))
}
