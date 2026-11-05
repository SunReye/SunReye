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
use crate::learn;
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

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CorrectionSkill {
    /// Decayed mean absolute error without the correction, W.
    mae_raw: f64,
    /// The same with the correction applied, W.
    mae_corrected: f64,
    improvement_pct: f64,
    samples: f64,
}

/// One learned (month, hour) cell.
#[derive(Debug, Serialize, ToSchema)]
pub struct CorrectionCellView {
    month: i8,
    hour: i8,
    /// The multiplier applied, shrunk and clamped.
    factor: f64,
    /// Effective sample count behind it.
    weight: f64,
}

/// The learned forecast correction as 3.x's `ForecastCorrectionView`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CorrectionView {
    /// Applied to the forecast; it learns either way.
    enabled: bool,
    /// The last plant-local day learned, `YYYY-MM-DD`; null before the first run.
    #[schema(required = true)]
    learned_through: Option<String>,
    skill: CorrectionSkill,
    /// In month, hour order.
    cells: Vec<CorrectionCellView>,
}

#[utoipa::path(
    get,
    path = "/api/forecast/correction",
    operation_id = "forecastCorrection",
    responses(
        (status = 200, body = CorrectionView),
        (status = 401, body = ErrorBody),
        (status = 500, body = ErrorBody)
    )
)]
pub async fn correction(State(core): State<Arc<Core>>) -> Result<Json<CorrectionView>, ApiError> {
    let enabled = weather::read(&core.store).await?.forecast.correction.enabled;
    let (model, state) = learn::stored(&core.store).await?.unwrap_or_default();
    let skill = state.map(|s| s.skill).unwrap_or_default();
    Ok(Json(CorrectionView {
        enabled,
        learned_through: state.map(|s| s.learned_through.to_string()),
        skill: CorrectionSkill {
            mae_raw: skill.mae_raw,
            mae_corrected: skill.mae_corrected,
            improvement_pct: skill.improvement_pct(),
            samples: skill.samples,
        },
        cells: model
            .cells()
            .map(|(month, hour, cell)| CorrectionCellView {
                month,
                hour,
                factor: model.factor(month, hour),
                weight: cell.weight,
            })
            .collect(),
    }))
}
