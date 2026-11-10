//! Forecasts by device, series and range (ADR 9, 15): the latest issue of each target, or the
//! latest before `issuedBefore`, so forecast accuracy can be compared.

use std::time::SystemTime;

use axum::Json;
use axum::extract::rejection::{PathRejection, QueryRejection};
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

use super::{Code, Problem, ProblemDetails};
use crate::api::internal;
use crate::bus::{DeviceId, Series};
use crate::storage::{Forecast, Reader};

const MAX_POINTS: usize = 1500;

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
    code: Code::ForecastRange,
};

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
#[serde(rename_all = "camelCase")]
pub struct Params {
    /// A series such as `pv.string.power[3]`.
    series: String,
    /// The first target, RFC 3339.
    from: String,
    /// The instant after the last target, RFC 3339.
    to: String,
    /// Only issues before this instant, RFC 3339; the latest issue when absent.
    issued_before: Option<String>,
}

/// One series' forecasts, at most 1,500 points.
#[derive(Serialize, ToSchema)]
pub struct Forecasts {
    /// By target.
    points: Vec<ForecastPoint>,
}

#[derive(Serialize, ToSchema)]
struct ForecastPoint {
    /// RFC 3339, UTC.
    target: String,
    /// When the value was issued, RFC 3339, UTC.
    issued: String,
    value: f64,
}

#[utoipa::path(get, path = "/api/v1/devices/{id}/forecasts",
    params(("id" = u32, Path, description = "The device id."), Params),
    responses(
        (status = 200, body = Forecasts),
        (status = 400, body = ProblemDetails, content_type = "application/problem+json"),
        (status = 401, body = ProblemDetails, content_type = "application/problem+json"),
        (status = 422, body = ProblemDetails, content_type = "application/problem+json"),
    ),
)]
pub async fn forecasts(
    State(reader): State<Reader>,
    device: Result<Path<u32>, PathRejection>,
    params: Result<Query<Params>, QueryRejection>,
) -> Result<Json<Forecasts>, Problem> {
    let Path(device) = device.map_err(|_| PATH)?;
    let Query(params) = params.map_err(|_| QUERY)?;
    let series = Series::parse(&params.series).ok_or(QUERY)?;
    let (from, to) = (instant(&params.from)?, instant(&params.to)?);
    if from >= to {
        return Err(RANGE);
    }
    let before = params.issued_before.as_deref().map(instant).transpose()?;
    let stored = reader
        .forecasts(DeviceId(device), &series, from, to)
        .await
        .map_err(internal)?;
    let points = latest(&stored, before);
    if points.len() > MAX_POINTS {
        return Err(RANGE);
    }
    Ok(Json(Forecasts { points }))
}

/// The latest issue of each target, of those issued before `before`; `stored` is by target,
/// then issue.
fn latest(stored: &[Forecast], before: Option<SystemTime>) -> Vec<ForecastPoint> {
    let wanted = stored
        .iter()
        .filter(|f| before.is_none_or(|before| f.issued < before));
    let mut points: Vec<&Forecast> = Vec::new();
    for forecast in wanted {
        match points.last_mut() {
            Some(last) if last.target == forecast.target => *last = forecast,
            _ => points.push(forecast),
        }
    }
    points
        .into_iter()
        .map(|f| ForecastPoint {
            target: rfc3339(f.target),
            issued: rfc3339(f.issued),
            value: f.value,
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
