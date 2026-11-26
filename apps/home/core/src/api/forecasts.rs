//! Forecasts by device, series and range (ADR 9, 15): each target's one kept issue.

use std::time::SystemTime;

use axum::Json;
use axum::extract::rejection::{PathRejection, QueryRejection};
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

use super::{Code, Problem, ProblemDetails, Refused, range};
use crate::api::{internal, rfc3339};
use crate::bus::DeviceId;
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
    /// Series such as `pv.string.power[3]`, repeated: 1 to 16 of the device.
    #[param(min_items = 1, max_items = 16)]
    series: Vec<String>,
    /// The first target, RFC 3339.
    from: String,
    /// The instant after the last target, RFC 3339.
    to: String,
}

/// Each series asked, in the order asked.
#[derive(Serialize, ToSchema)]
pub struct ForecastsRead {
    series: Vec<Forecasts>,
}

/// One series' forecasts, at most 1,500 points.
#[derive(Serialize, ToSchema)]
pub struct Forecasts {
    /// As asked.
    series: String,
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
        (status = 200, body = ForecastsRead),
        (status = 400, body = ProblemDetails, content_type = "application/problem+json"),
        (status = 401, body = ProblemDetails, content_type = "application/problem+json"),
        (status = 422, body = ProblemDetails, content_type = "application/problem+json"),
    ),
)]
pub async fn forecasts(
    State(reader): State<Reader>,
    device: Result<Path<u32>, PathRejection>,
    params: Result<Query<Vec<(String, String)>>, QueryRejection>,
) -> Result<Json<ForecastsRead>, Refused> {
    let Path(device) = device.map_err(|_| PATH)?;
    let params: Params = range::query(params)?;
    let names = range::parse(&params.series)?;
    let (from, to) = (instant(&params.from)?, instant(&params.to)?);
    if from >= to {
        return Err(RANGE.into());
    }
    let mut list = Vec::with_capacity(names.len());
    // One series after another, each its own request to the storage thread (ADR 24).
    for (name, series) in names {
        let stored = reader
            .forecasts(DeviceId(device), &series, from, to)
            .await
            .map_err(|e| range::named(internal(e), &name))?;
        if stored.len() > MAX_POINTS {
            return Err(range::named(RANGE, &name));
        }
        let points = stored
            .iter()
            .map(|f| ForecastPoint {
                target: rfc3339(f.target),
                issued: rfc3339(f.issued),
                value: f.value,
            })
            .collect();
        list.push(Forecasts {
            series: name,
            points,
        });
    }
    Ok(Json(ForecastsRead { series: list }))
}

fn instant(text: &str) -> Result<SystemTime, Problem> {
    let instant: jiff::Timestamp = text.parse().map_err(|_| QUERY)?;
    Ok(instant.into())
}
