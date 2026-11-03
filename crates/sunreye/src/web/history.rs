//! The stored-readings reads the dashboard makes while it is open.

use std::sync::Arc;

use axum::Json;
use axum::extract::State;
use serde::Deserialize;

use super::{ApiError, ApiQuery, ErrorBody};
use crate::recent::{Recent, RecentError, Window, fold};
use crate::run::Core;
use crate::samples::with_unstored;
use crate::store::{Store, StoreError};

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
        (status = 500, body = ErrorBody)
    )
)]
pub async fn recent(
    State(core): State<Arc<Core>>,
    ApiQuery(query): ApiQuery<RecentQuery>,
) -> Result<Json<Recent>, ApiError> {
    let window = query.window(core.now_ms())?;
    let (from, to) = (window.reach_ms(), window.now_ms + 1);
    let Some(device) = source_device(&core.store, query.source.as_deref()).await? else {
        return Ok(Json(fold(window, std::iter::empty())?));
    };
    // Held before the store is read: a minute written in between is then in one or both, never neither.
    // A copy of up to two minutes of readings per request.
    let held = core.unstored.held(device);
    let minutes = core.store.minutes(device, from, to).await?;
    Ok(Json(fold(window, with_unstored(minutes.samples(from, to), held))?))
}

/// The device a history read is from: `source` names one by its decimal id, retired or not; none, empty or
/// `plant` is the first in service. An id no device has reads nothing, as 3.x reads an unknown slug.
pub(super) async fn source_device(store: &Store, source: Option<&str>) -> Result<Option<i64>, StoreError> {
    let devices = store.devices().await?;
    Ok(match source.filter(|source| !source.is_empty()) {
        None | Some("plant") => {
            devices.iter().find(|device| device.retired_at.is_none()).map(|device| device.id)
        }
        Some(id) => devices.iter().find(|device| device.id.to_string() == id).map(|device| device.id),
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
