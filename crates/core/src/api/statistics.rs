//! Statistics by plant-local day, week and month (ADR 3, 9): daily rollups folded into periods cut
//! in the plant timezone, so a week or month spans its 23- and 25-hour days exactly.

use std::ops::Range;
use std::time::SystemTime;

use axum::Json;
use axum::extract::rejection::{PathRejection, QueryRejection};
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use jiff::civil::Date;
use jiff::tz::TimeZone;
use jiff::{Timestamp, ToSpan};
use serde::{Deserialize, Serialize};
use tokio::sync::watch;
use utoipa::{IntoParams, ToSchema};

use super::history::DAY_SPAN;
use super::{Code, Problem, ProblemDetails};
use crate::bus::{DeviceId, Series};
use crate::storage::{Aggregate, Reader, Rollup, Tier};

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
const INTERNAL: Problem = Problem {
    status: StatusCode::INTERNAL_SERVER_ERROR,
    code: Code::Internal,
};

pub type StatisticsState = State<(Reader, watch::Receiver<TimeZone>)>;

/// A plant-local calendar period.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum Period {
    Day,
    /// From Monday, as ISO 8601 weeks are.
    Week,
    Month,
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct Params {
    /// A series such as `pv.mppt.power[2]`.
    series: String,
    period: Period,
    /// The first instant, RFC 3339: each period starting from it on is read.
    from: String,
    /// The instant after the last, RFC 3339.
    to: String,
}

/// One series' figures per period.
#[derive(Serialize, ToSchema)]
pub struct Statistics {
    period: Period,
    /// In time order; a period without rolled-up history has none.
    points: Vec<Figures>,
}

/// One period's figures: a measurement's, or a counter's delta.
#[derive(Serialize, ToSchema)]
struct Figures {
    /// The plant-local date the period begins on, `YYYY-MM-DD`.
    date: String,
    /// RFC 3339, UTC.
    start: String,
    /// RFC 3339, UTC.
    end: String,
    /// Time-weighted over the time with a value.
    #[serde(skip_serializing_if = "Option::is_none")]
    mean: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    min: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max: Option<f64>,
    /// `Σ value·duration` in the unit times hours: Wh for power.
    #[serde(skip_serializing_if = "Option::is_none")]
    integral: Option<f64>,
    /// A counter's rises, resets excluded.
    #[serde(skip_serializing_if = "Option::is_none")]
    delta: Option<f64>,
}

/// One series' figures for each plant-local period starting in the range, folded from its
/// daily rollups.
#[utoipa::path(get, path = "/api/v1/devices/{id}/statistics",
    params(("id" = u32, Path, description = "The device id."), Params),
    responses(
        (status = 200, body = Statistics),
        (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
    ),
)]
pub async fn statistics(
    State((reader, zone)): StatisticsState,
    device: Result<Path<u32>, PathRejection>,
    params: Result<Query<Params>, QueryRejection>,
) -> Result<Json<Statistics>, Problem> {
    let Path(device) = device.map_err(|_| PATH)?;
    let Query(params) = params.map_err(|_| QUERY)?;
    let series = Series::parse(&params.series).ok_or(QUERY)?;
    let range = instant(&params.from)?..instant(&params.to)?;
    let span = range.end.duration_since(range.start).map_err(|_| RANGE)?;
    if span.is_zero() || span > DAY_SPAN {
        return Err(RANGE);
    }
    let zone = zone.borrow().clone();
    let periods = periods(&zone, params.period, &range).ok_or(RANGE)?;
    let (Some(first), Some(last)) = (periods.first(), periods.last()) else {
        return Ok(Json(Statistics {
            period: params.period,
            points: Vec::new(),
        }));
    };
    let rollups = reader
        .rollups(
            DeviceId(device),
            &series,
            Tier::Day,
            first.1.start..last.1.end,
        )
        .await
        .map_err(|_| INTERNAL)?;
    let points = periods
        .iter()
        .filter_map(|(date, bounds)| {
            let days = rollups.iter().filter(|r| bounds.contains(&r.start));
            Some(figures(*date, bounds, fold(days)?))
        })
        .collect();
    Ok(Json(Statistics {
        period: params.period,
        points,
    }))
}

/// Each period of `zone` starting in `range`, by its first date, with its bounds.
fn periods(
    zone: &TimeZone,
    period: Period,
    range: &Range<SystemTime>,
) -> Option<Vec<(Date, Range<SystemTime>)>> {
    let from = Timestamp::try_from(range.start).ok()?;
    let mut date = begin(period, from.to_zoned(zone.clone()).date())?;
    if midnight(zone, date)? < range.start {
        date = next(period, date)?;
    }
    let mut periods = Vec::new();
    loop {
        let start = midnight(zone, date)?;
        if start >= range.end {
            return Some(periods);
        }
        let after = next(period, date)?;
        periods.push((date, start..midnight(zone, after)?));
        date = after;
    }
}

/// The first date of the period `date` falls in.
fn begin(period: Period, date: Date) -> Option<Date> {
    match period {
        Period::Day => Some(date),
        Period::Week => date
            .checked_sub(i64::from(date.weekday().to_monday_zero_offset()).days())
            .ok(),
        Period::Month => Some(date.first_of_month()),
    }
}

/// The first date of the period after the one starting on `date`.
fn next(period: Period, date: Date) -> Option<Date> {
    let span = match period {
        Period::Day => 1.day(),
        Period::Week => 1.week(),
        Period::Month => 1.month(),
    };
    date.checked_add(span).ok()
}

/// The first instant of `date`, which a DST change may move off 00:00.
fn midnight(zone: &TimeZone, date: Date) -> Option<SystemTime> {
    let start = date.to_zoned(zone.clone()).ok()?.start_of_day().ok()?;
    Some(start.timestamp().into())
}

/// The days' aggregate; `None` for none, or for days of both kinds.
fn fold<'a>(mut days: impl Iterator<Item = &'a Rollup>) -> Option<Aggregate> {
    let first = days.next()?.aggregate;
    days.try_fold(first, |total, day| match (total, day.aggregate) {
        (
            Aggregate::Measurement {
                duration,
                mean,
                min,
                max,
                integral,
            },
            Aggregate::Measurement {
                duration: d,
                min: lo,
                max: hi,
                integral: i,
                ..
            },
        ) => {
            let (held, integral) = (duration + d, integral + i);
            // From the integral, in unit·hours, so a whole-number mean stays whole.
            let hours = held.as_secs_f64() / 3600.0;
            Some(Aggregate::Measurement {
                duration: held,
                mean: if hours > 0.0 { integral / hours } else { mean },
                min: min.min(lo),
                max: max.max(hi),
                integral,
            })
        }
        (Aggregate::Counter { first, delta, .. }, Aggregate::Counter { last, delta: d, .. }) => {
            Some(Aggregate::Counter {
                first,
                last,
                delta: delta + d,
            })
        }
        _ => None,
    })
}

fn figures(date: Date, bounds: &Range<SystemTime>, aggregate: Aggregate) -> Figures {
    let mut figures = Figures {
        date: date.to_string(),
        start: rfc3339(bounds.start),
        end: rfc3339(bounds.end),
        mean: None,
        min: None,
        max: None,
        integral: None,
        delta: None,
    };
    match aggregate {
        Aggregate::Measurement {
            mean,
            min,
            max,
            integral,
            ..
        } => {
            figures.mean = Some(mean);
            figures.min = Some(min);
            figures.max = Some(max);
            figures.integral = Some(integral);
        }
        Aggregate::Counter { delta, .. } => figures.delta = Some(delta),
    }
    figures
}

fn instant(text: &str) -> Result<SystemTime, Problem> {
    let instant: Timestamp = text.parse().map_err(|_| QUERY)?;
    Ok(instant.into())
}

fn rfc3339(time: SystemTime) -> String {
    Timestamp::try_from(time)
        .map(|t| t.to_string())
        .unwrap_or_default()
}
