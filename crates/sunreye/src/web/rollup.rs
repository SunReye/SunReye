//! `GET /api/history/rollup`: one metric's buckets, for the history charts.

use std::sync::Arc;
use std::time::Duration;

use axum::Json;
use axum::extract::State;
use jiff::Timestamp;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::history::source_device;
use super::{ApiError, ApiQuery, ErrorBody};
use crate::rollup::{Bucket, Tier};
use crate::run::Core;
use crate::store::{BucketWindow, Store, StoreError};

const DEFAULT_HOURS: f64 = 168.0;
const DEFAULT_LIMIT: u32 = 5000;
const MAX_LIMIT: u32 = 50_000;

#[derive(Debug, Clone, Copy, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
enum Width {
    Minute,
    Hour,
    Day,
}

#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[serde(rename_all = "camelCase")]
#[into_params(parameter_in = Query)]
pub struct RollupQuery {
    metric: String,
    /// `plant`, or a device's decimal id. Without it, the first device in service.
    source: Option<String>,
    /// As `source`, which wins when both are set.
    inverter_id: Option<String>,
    /// Bucket width. Default `hour`.
    #[param(inline)]
    bucket: Option<Width>,
    /// How far back from now. Default 168. Ignored when `from` and `to` are both set.
    #[param(minimum = 1)]
    hours: Option<f64>,
    /// Start of the window, RFC 3339, inclusive.
    from: Option<String>,
    /// End of the window, RFC 3339, exclusive.
    to: Option<String>,
    /// Most buckets, oldest first. Default 5000.
    #[param(minimum = 1, maximum = 50000)]
    limit: Option<u32>,
}

impl RollupQuery {
    fn window(&self, now_ms: i64) -> Result<BucketWindow, ApiError> {
        let limit = self.limit.unwrap_or(DEFAULT_LIMIT);
        if !(1..=MAX_LIMIT).contains(&limit) {
            return Err(ApiError::bad_request(format!("limit must be 1–{MAX_LIMIT}")));
        }
        let hours = self.hours.unwrap_or(DEFAULT_HOURS);
        if !(hours.is_finite() && hours >= 1.0) {
            return Err(ApiError::bad_request("hours must be at least 1"));
        }
        let (from, to) = match (non_empty(self.from.as_deref()), non_empty(self.to.as_deref())) {
            (Some(from), Some(to)) => (instant("from", from)?, instant("to", to)?),
            _ => (since(Timestamp::from_millisecond(now_ms).unwrap_or_default(), hours), Timestamp::MAX),
        };
        Ok(BucketWindow { from, to, limit })
    }

    fn tier(&self) -> Tier {
        match self.bucket.unwrap_or(Width::Hour) {
            Width::Minute => Tier::Minute,
            Width::Hour => Tier::Hour,
            Width::Day => Tier::Day,
        }
    }

    /// The device the read is from: `source` before `inverterId`.
    async fn device(&self, store: &Store) -> Result<Option<i64>, StoreError> {
        let wanted = non_empty(self.source.as_deref()).or(non_empty(self.inverter_id.as_deref()));
        source_device(store, wanted).await
    }
}

fn non_empty(text: Option<&str>) -> Option<&str> {
    text.filter(|text| !text.is_empty())
}

fn instant(name: &str, text: &str) -> Result<Timestamp, ApiError> {
    text.parse().map_err(|_| ApiError::bad_request(format!("{name} must be an RFC 3339 instant")))
}

/// `hours` before `now`, or as far back as time goes.
fn since(now: Timestamp, hours: f64) -> Timestamp {
    Duration::try_from_secs_f64(hours * 3600.0)
        .ok()
        .and_then(|span| now.checked_sub(span).ok())
        .unwrap_or(Timestamp::MIN)
}

#[derive(Debug, PartialEq, Serialize, ToSchema)]
pub struct RollupPoint {
    /// UTC start of the bucket.
    time: String,
    avg: f64,
    max: f64,
    min: f64,
}

impl From<Bucket> for RollupPoint {
    fn from(bucket: Bucket) -> Self {
        Self {
            time: bucket.start.strftime("%Y-%m-%dT%H:%M:%S%.3fZ").to_string(),
            avg: bucket.avg,
            max: bucket.max,
            min: bucket.min,
        }
    }
}

/// Minute, hour or day buckets of one metric, UTC, oldest first; the newest hour and day are open.
#[utoipa::path(
    get,
    path = "/api/history/rollup",
    operation_id = "rollupHistory",
    params(RollupQuery),
    responses(
        (status = 200, body = Vec<RollupPoint>),
        (status = 400, body = ErrorBody),
        (status = 401, body = ErrorBody),
        (status = 500, body = ErrorBody)
    )
)]
pub async fn buckets(
    State(core): State<Arc<Core>>,
    ApiQuery(query): ApiQuery<RollupQuery>,
) -> Result<Json<Vec<RollupPoint>>, ApiError> {
    let window = query.window(core.now_ms())?;
    let Some(device) = query.device(&core.store).await? else { return Ok(Json(Vec::new())) };
    let buckets = core.store.buckets_between(query.tier(), device, &query.metric, window).await?;
    Ok(Json(buckets.into_iter().map(RollupPoint::from).collect()))
}
