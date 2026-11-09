//! History by device, series and range (ADR 9): the server picks the tier, so a series never
//! exceeds 1,500 points.

use std::ops::Range;
use std::time::{Duration, SystemTime};

use axum::Json;
use axum::extract::rejection::{PathRejection, QueryRejection};
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

use super::{Problem, ProblemDetails};
use crate::bus::{DeviceId, Series};
use crate::storage::{self, Aggregate, ChangePoint, Reader, Rollup};

const MAX_POINTS: usize = 1500;
const HOUR: Duration = Duration::from_hours(1);
const DAY: Duration = Duration::from_hours(24);
/// The longest range read as raw intervals.
const RAW_SPAN: Duration = DAY;
/// The longest range of hours: the hour it starts in and 1,499 more.
#[expect(clippy::cast_possible_truncation, reason = "1,499 fits")]
const HOUR_SPAN: Duration = HOUR.saturating_mul(MAX_POINTS as u32 - 1);
/// The longest range of plant-local days: 1,498 of the shortest, 23 hours, and the two it cuts.
#[expect(clippy::cast_possible_truncation, reason = "1,498 fits")]
const DAY_SPAN: Duration = HOUR.saturating_mul(23 * (MAX_POINTS as u32 - 2));

const QUERY: Problem = Problem {
    status: StatusCode::BAD_REQUEST,
    code: "request.query",
};
const PATH: Problem = Problem {
    status: StatusCode::BAD_REQUEST,
    code: "request.path",
};
const RANGE: Problem = Problem {
    status: StatusCode::UNPROCESSABLE_ENTITY,
    code: "history.range",
};
const COUNTER: Problem = Problem {
    status: StatusCode::UNPROCESSABLE_ENTITY,
    code: "history.counter",
};
const INTERNAL: Problem = Problem {
    status: StatusCode::INTERNAL_SERVER_ERROR,
    code: "internal",
};

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct Params {
    /// A series such as `pv.mppt.power[2]`.
    series: String,
    /// The first instant, RFC 3339.
    from: String,
    /// The instant after the last, RFC 3339.
    to: String,
}

/// Time-weighted means of one series over a range, at the tier the server picked.
#[derive(Serialize, ToSchema)]
pub struct History {
    tier: Tier,
    /// In time order; a gap has no point.
    points: Vec<Point>,
}

/// `raw` intervals between change points, or `hour` (UTC) or `day` (plant-local) rollups.
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
enum Tier {
    Raw,
    Hour,
    Day,
}

#[derive(Serialize, ToSchema)]
struct Point {
    /// RFC 3339, UTC.
    start: String,
    /// RFC 3339, UTC.
    end: String,
    /// The value weighted by the time it held between `start` and `end`.
    mean: f64,
}

#[utoipa::path(get, path = "/api/v1/devices/{id}/history",
    params(("id" = u32, Path, description = "The device id."), Params),
    responses(
        (status = 200, body = History),
        (status = 400, body = ProblemDetails, content_type = "application/problem+json"),
        (status = 401, body = ProblemDetails, content_type = "application/problem+json"),
        (status = 422, body = ProblemDetails, content_type = "application/problem+json"),
    ),
)]
pub async fn history(
    State(reader): State<Reader>,
    device: Result<Path<u32>, PathRejection>,
    params: Result<Query<Params>, QueryRejection>,
) -> Result<Json<History>, Problem> {
    let Path(device) = device.map_err(|_| PATH)?;
    let Query(params) = params.map_err(|_| QUERY)?;
    let series = Series::parse(&params.series).ok_or(QUERY)?;
    let range = instant(&params.from)?..instant(&params.to)?;
    let span = range.end.duration_since(range.start).map_err(|_| RANGE)?;
    if span.is_zero() || span > DAY_SPAN {
        return Err(RANGE);
    }
    let device = DeviceId(device);
    if span <= RAW_SPAN {
        let points = reader
            .history(device, &series, range.start, range.end)
            .await
            .map_err(|_| INTERNAL)?;
        let points = raw(&points, &range);
        if points.len() <= MAX_POINTS {
            return Ok(Json(History {
                tier: Tier::Raw,
                points,
            }));
        }
    }
    // Rollups from a tier's longest window early, for the window the range starts in.
    let (tier, lead, name) = if span <= HOUR_SPAN {
        (storage::Tier::Hour, HOUR, Tier::Hour)
    } else {
        (storage::Tier::Day, 2 * DAY, Tier::Day)
    };
    let start = range.start.checked_sub(lead).unwrap_or(range.start);
    let rollups = reader
        .rollups(device, &series, tier, start..range.end)
        .await
        .map_err(|_| INTERNAL)?;
    Ok(Json(History {
        tier: name,
        points: rolled(&rollups, range.start)?,
    }))
}

/// The rollups that end after `from`, as their means. A counter's rollup has no mean.
fn rolled(rollups: &[Rollup], from: SystemTime) -> Result<Vec<Point>, Problem> {
    rollups
        .iter()
        .filter(|r| r.end > from)
        .map(|r| match r.aggregate {
            Aggregate::Measurement { mean, .. } => Ok(Point {
                start: rfc3339(r.start),
                end: rfc3339(r.end),
                mean,
            }),
            Aggregate::Counter { .. } => Err(COUNTER),
        })
        .collect()
}

fn instant(text: &str) -> Result<SystemTime, Problem> {
    let instant: jiff::Timestamp = text.parse().map_err(|_| QUERY)?;
    Ok(instant.into())
}

fn rfc3339(time: SystemTime) -> String {
    jiff::Timestamp::try_from(time)
        .map(|t| t.to_string())
        .unwrap_or_default()
}

/// The intervals between change points, clipped to `range`; a gap is no interval.
fn raw(points: &[ChangePoint], range: &Range<SystemTime>) -> Vec<Point> {
    let ends = points.iter().skip(1).map(|p| p.time).chain([range.end]);
    points
        .iter()
        .zip(ends)
        .filter_map(|(point, end)| {
            let (start, end) = (point.time.max(range.start), end.min(range.end));
            Some(Point {
                start: rfc3339(start),
                end: rfc3339(end),
                mean: point.value.filter(|_| start < end)?,
            })
        })
        .collect()
}
