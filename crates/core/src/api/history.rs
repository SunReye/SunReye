//! History by device, series and range (ADR 9): the server picks the tier, so a series never
//! exceeds 1,500 points.

use std::ops::Range;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::Json;
use axum::extract::rejection::{PathRejection, QueryRejection};
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

use super::{Clock, Code, Problem, ProblemDetails};
use crate::bus::{DeviceId, Series};
use crate::storage::{self, Aggregate, ChangePoint, Reader, Rollup};

const MAX_POINTS: usize = 1500;
const MINUTE: Duration = Duration::from_mins(1);
const HOUR: Duration = Duration::from_hours(1);
const DAY: Duration = Duration::from_hours(24);
/// The longest range read as raw intervals, or past 1,500 of them as minutes: 1,441 at most.
const RAW_SPAN: Duration = DAY;
/// The longest range of hours: the hour it starts in and 1,499 more.
#[expect(clippy::cast_possible_truncation, reason = "1,499 fits")]
const HOUR_SPAN: Duration = HOUR.saturating_mul(MAX_POINTS as u32 - 1);
/// The longest range of plant-local days: 1,498 of the shortest, 23 hours, and the two it cuts.
#[expect(clippy::cast_possible_truncation, reason = "1,498 fits")]
const DAY_SPAN: Duration = HOUR.saturating_mul(23 * (MAX_POINTS as u32 - 2));

const QUERY: Problem = Problem {
    status: StatusCode::BAD_REQUEST,
    code: Code::RequestQuery,
};
const PATH: Problem = Problem {
    status: StatusCode::BAD_REQUEST,
    code: Code::RequestPath,
};
const RANGE: Problem = Problem {
    status: StatusCode::UNPROCESSABLE_ENTITY,
    code: Code::HistoryRange,
};
const COUNTER: Problem = Problem {
    status: StatusCode::UNPROCESSABLE_ENTITY,
    code: Code::HistoryCounter,
};
const INTERNAL: Problem = Problem {
    status: StatusCode::INTERNAL_SERVER_ERROR,
    code: Code::Internal,
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
    /// A `bucket`'s width in seconds.
    #[serde(skip_serializing_if = "Option::is_none")]
    width: Option<u64>,
    /// In time order; a gap has no point.
    points: Vec<Point>,
}

/// `raw` intervals between change points, UTC-aligned buckets of them, or `hour` (UTC) or
/// `day` (plant-local) rollups.
#[derive(Serialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum Tier {
    Raw,
    Bucket,
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
    State((reader, clock)): State<(Reader, Clock)>,
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
    let read = Read {
        reader,
        device: DeviceId(device),
        series,
        range,
        now: clock(),
    };
    let history = if span <= RAW_SPAN {
        read.short().await?
    } else {
        read.rolled_up(span).await?
    };
    Ok(Json(history))
}

/// One history request.
struct Read {
    reader: Reader,
    device: DeviceId,
    series: Series,
    range: Range<SystemTime>,
    now: SystemTime,
}

impl Read {
    /// Raw intervals, or minute means past 1,500 of them.
    async fn short(&self) -> Result<History, Problem> {
        let (range, now) = (&self.range, self.now);
        // Whole minutes, so buckets need no second read.
        let window = floor(range.start, MINUTE)..ceil(range.end, MINUTE);
        let points = self.change_points(window.clone()).await?;
        let raw = intervals(&points, range.start..range.end.min(now));
        if raw.len() <= MAX_POINTS {
            let points = raw.iter().map(|&(start, end, mean)| Point {
                start: rfc3339(start),
                end: rfc3339(end),
                mean,
            });
            return Ok(History {
                tier: Tier::Raw,
                width: None,
                points: points.collect(),
            });
        }
        let intervals = intervals(&points, window.start..window.end.min(now));
        Ok(History {
            tier: Tier::Bucket,
            width: Some(MINUTE.as_secs()),
            points: buckets(&intervals, window.start, MINUTE),
        })
    }

    /// Hourly or daily rollups; the hour in progress is read from change points (ADR 3).
    async fn rolled_up(&self, span: Duration) -> Result<History, Problem> {
        let range = &self.range;
        // Rollups from a tier's longest window early, for the window the range starts in.
        let (tier, lead, name) = if span <= HOUR_SPAN {
            (storage::Tier::Hour, HOUR, Tier::Hour)
        } else {
            (storage::Tier::Day, 2 * DAY, Tier::Day)
        };
        let start = range.start.checked_sub(lead).unwrap_or(range.start);
        let rollups = self
            .reader
            .rollups(self.device, &self.series, tier, start..range.end)
            .await
            .map_err(|_| INTERNAL)?;
        let mut points = rolled(&rollups, range.start)?;
        let tail = floor(range.start, HOUR).max(rollups.last().map_or(UNIX_EPOCH, |r| r.end));
        let end = range.end.min(self.now);
        if name == Tier::Hour && tail < end {
            let change = self.change_points(tail..end).await?;
            points.extend(buckets(&intervals(&change, tail..end), tail, HOUR));
        }
        Ok(History {
            tier: name,
            width: None,
            points,
        })
    }

    async fn change_points(&self, range: Range<SystemTime>) -> Result<Vec<ChangePoint>, Problem> {
        self.reader
            .history(self.device, &self.series, range.start, range.end)
            .await
            .map_err(|_| INTERNAL)
    }
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

/// A value and the span it held.
type Interval = (SystemTime, SystemTime, f64);

/// The intervals between change points, clipped to `range`; a gap is no interval.
fn intervals(points: &[ChangePoint], range: Range<SystemTime>) -> Vec<Interval> {
    let ends = points.iter().skip(1).map(|p| p.time).chain([range.end]);
    points
        .iter()
        .zip(ends)
        .filter_map(|(point, end)| {
            let (start, end) = (point.time.max(range.start), end.min(range.end));
            Some((start, end, point.value.filter(|_| start < end)?))
        })
        .collect()
}

/// Time-weighted means over buckets of `width` from `origin`; gaps are not part of a mean, and
/// a bucket without a value has no point.
fn buckets(intervals: &[Interval], origin: SystemTime, width: Duration) -> Vec<Point> {
    let bound =
        |index: u64| origin + width.saturating_mul(u32::try_from(index).unwrap_or(u32::MAX));
    // Bucket index, Σ value·seconds and Σ seconds, in time order.
    let mut sums: Vec<(u64, f64, f64)> = Vec::new();
    for &(mut start, end, value) in intervals {
        while start < end {
            let index = seconds(start, origin) / width.as_secs();
            let until = end.min(bound(index + 1));
            let held = until
                .duration_since(start)
                .unwrap_or_default()
                .as_secs_f64();
            match sums.last_mut() {
                Some(last) if last.0 == index => {
                    last.1 = value.mul_add(held, last.1);
                    last.2 += held;
                }
                _ => sums.push((index, value * held, held)),
            }
            start = until;
        }
    }
    sums.into_iter()
        .map(|(index, sum, held)| Point {
            start: rfc3339(bound(index)),
            end: rfc3339(bound(index + 1)),
            mean: sum / held,
        })
        .collect()
}

fn seconds(time: SystemTime, since: SystemTime) -> u64 {
    time.duration_since(since).unwrap_or_default().as_secs()
}

/// `time` rounded down to a multiple of `width` since the epoch.
fn floor(time: SystemTime, width: Duration) -> SystemTime {
    let seconds = seconds(time, UNIX_EPOCH);
    UNIX_EPOCH + Duration::from_secs(seconds - seconds % width.as_secs())
}

/// `time` rounded up to a multiple of `width` since the epoch.
fn ceil(time: SystemTime, width: Duration) -> SystemTime {
    let down = floor(time, width);
    if down < time { down + width } else { down }
}
