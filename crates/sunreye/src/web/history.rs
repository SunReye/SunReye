//! The stored-readings reads the dashboard makes while it is open.

use std::sync::Arc;

use axum::Json;
use axum::extract::State;
use serde::Deserialize;

use super::{ApiError, ApiQuery, ErrorBody};
use crate::recent::{Recent, RecentError, Window, fold};
use crate::run::Core;
use crate::store::Minutes;

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
    let minutes = match core.store.devices().await?.first() {
        Some(device) => core.store.minutes(device.id, from, to).await?,
        None => Minutes::default(),
    };
    Ok(Json(fold(window, minutes.samples(from, to))?))
}
