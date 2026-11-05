//! The stored-readings reads the dashboard makes while it is open.

use std::sync::Arc;

use axum::Json;
use axum::extract::State;
use serde::Deserialize;

use super::kiosk::HistoryRead;
use super::{ApiError, ApiQuery, ErrorBody};
use crate::plant::{self, Aggregates};
use crate::recent::{Recent, RecentError, Window, fold};
use crate::run::Core;
use crate::samples::with_unstored;
use crate::store::{StoreError, first_in_service};

const DEFAULT_SECONDS: u32 = 300;
const MAX_SECONDS: u32 = 3600;
const MAX_STEP: u32 = 60;

#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[serde(rename_all = "camelCase")]
#[into_params(parameter_in = Query)]
pub struct RecentQuery {
    /// How far back the window reaches. Default 300.
    #[param(minimum = 1, maximum = 3600)]
    seconds: Option<u32>,
    /// Width of one bucket. Default 1.
    #[param(minimum = 1, maximum = 60)]
    step_seconds: Option<u32>,
    /// `plant`, or a device's decimal id. Without it, the first device in service.
    source: Option<String>,
}

impl RecentQuery {
    fn window(&self, now_ms: i64) -> Result<Window, ApiError> {
        let seconds = self.seconds.unwrap_or(DEFAULT_SECONDS);
        let step = self.step_seconds.unwrap_or(1);
        if !(1..=MAX_SECONDS).contains(&seconds) {
            return Err(ApiError::bad_request(format!("seconds must be 1–{MAX_SECONDS}")));
        }
        if !(1..=MAX_STEP).contains(&step) {
            return Err(ApiError::bad_request(format!("stepSeconds must be 1–{MAX_STEP}")));
        }
        Ok(Window { now_ms, seconds, step })
    }
}

impl From<RecentError> for ApiError {
    fn from(error: RecentError) -> Self {
        match error {
            RecentError::TooDense => {
                Self::bad_request("The window holds too many readings: ask for fewer seconds")
            }
            RecentError::Sample(error) => {
                tracing::error!(%error, "a stored minute is damaged");
                Self::internal()
            }
        }
    }
}

/// The last readings of every metric, bucketed, to seed the live sparklines.
#[utoipa::path(
    get,
    path = "/api/history/recent",
    operation_id = "recentHistory",
    params(RecentQuery),
    responses(
        (status = 200, body = Recent),
        (status = 400, body = ErrorBody),
        (status = 401, body = ErrorBody),
        (status = 500, body = ErrorBody),
        (status = 503, body = ErrorBody)
    )
)]
pub async fn recent(
    State(core): State<Arc<Core>>,
    _read: HistoryRead,
    ApiQuery(query): ApiQuery<RecentQuery>,
) -> Result<Json<Recent>, ApiError> {
    let window = query.window(core.now_ms())?;
    Ok(Json(match source(&core, query.source.as_deref()).await? {
        Source::Nothing => fold(window, std::iter::empty())?,
        Source::Device(device) => device_recent(&core, device, window).await?,
        Source::Plant(plant) => {
            let mut members = Vec::with_capacity(plant.members.len());
            for device in &plant.members {
                members.push(device_recent(&core, *device, window).await?);
            }
            plant::fold_recent(&members, &plant.aggregates, window.step)
        }
    }))
}

async fn device_recent(core: &Core, device: i64, window: Window) -> Result<Recent, ApiError> {
    let (from, to) = (window.reach_ms(), window.now_ms + 1);
    // Held before the store is read: a minute written in between is then in one or both, never neither.
    // A copy of up to two minutes of readings per request.
    let held = core.unstored.held(device);
    let minutes = core.store.minutes(device, from, to).await?;
    Ok(fold(window, with_unstored(minutes.samples(from, to), held))?)
}

/// What a history read is from.
pub(super) enum Source {
    /// No device: the read answers empty.
    Nothing,
    Device(i64),
    /// Two or more members, or none; a plant of one member is read as that device.
    Plant(PlantRead),
}

/// The plant's history members, retired ones included, and how the first member with a known profile folds each
/// metric.
pub(super) struct PlantRead {
    pub members: Vec<i64>,
    pub aggregates: Aggregates,
}

/// `source` names a device by its decimal id, retired or not, or `plant`; none or empty is the first device in
/// service. An id no device has reads nothing, as 3.x reads an unknown slug.
pub(super) async fn source(core: &Core, source: Option<&str>) -> Result<Source, StoreError> {
    let devices = core.store.devices().await?;
    let device = |id: Option<i64>| id.map_or(Source::Nothing, Source::Device);
    Ok(match source.filter(|source| !source.is_empty()) {
        None => device(first_in_service(&devices).map(|d| d.id)),
        Some("plant") => match plant::members(&devices, false).as_slice() {
            [sole] => Source::Device(sole.id),
            members => {
                let mut aggregates = Aggregates::default();
                for member in members {
                    if let Some(profile) = core.profile(&member.profile_id).await? {
                        aggregates = Aggregates::of_profile(&profile);
                        break;
                    }
                }
                let members = members.iter().map(|d| d.id).collect();
                Source::Plant(PlantRead { members, aggregates })
            }
        },
        Some(id) => device(devices.iter().find(|d| d.id.to_string() == id).map(|d| d.id)),
    })
}

#[cfg(test)]
mod tests {
    use axum::body::to_bytes;
    use axum::http::StatusCode;
    use axum::response::IntoResponse;
    use serde_json::{Value, json};

    use super::*;
    use crate::samples::SampleError;

    async fn answer(error: RecentError) -> (StatusCode, Value) {
        let response = ApiError::from(error).into_response();
        let status = response.status();
        let bytes = to_bytes(response.into_body(), usize::MAX).await.expect("body");
        (status, serde_json::from_slice(&bytes).expect("json"))
    }

    #[tokio::test]
    async fn a_window_with_too_many_readings_is_the_callers_400() {
        assert_eq!(
            answer(RecentError::TooDense).await,
            (
                StatusCode::BAD_REQUEST,
                json!({"error": "The window holds too many readings: ask for fewer seconds"})
            )
        );
    }

    #[tokio::test]
    async fn a_damaged_minute_is_a_500_that_names_nothing() {
        let damaged = RecentError::Sample(SampleError::Corrupt("truncated"));
        assert_eq!(
            answer(damaged).await,
            (StatusCode::INTERNAL_SERVER_ERROR, json!({"error": "internal error"}))
        );
    }
}
