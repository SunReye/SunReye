//! Forecasts by device, series and range (ADR 9, 15): each target's one kept issue.

use std::time::SystemTime;

use axum::Json;
use axum::extract::rejection::{PathRejection, QueryRejection};
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

use super::{Code, Problem, ProblemDetails};
use crate::api::{internal, rfc3339};
use crate::bus::{DeviceId, Series};
use crate::storage::Reader;

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
    let stored = reader
        .forecasts(DeviceId(device), &series, from, to)
        .await
        .map_err(internal)?;
    if stored.len() > MAX_POINTS {
        return Err(RANGE);
    }
    let points = stored
        .iter()
        .map(|f| ForecastPoint {
            target: rfc3339(f.target),
            issued: rfc3339(f.issued),
            value: f.value,
        })
        .collect();
    Ok(Json(Forecasts { points }))
}

fn instant(text: &str) -> Result<SystemTime, Problem> {
    let instant: jiff::Timestamp = text.parse().map_err(|_| QUERY)?;
    Ok(instant.into())
}
