//! A role's live value for EVCC's HTTP custom meter (ADR 10).

use axum::Json;
use axum::extract::rejection::{PathRejection, QueryRejection};
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use serde::Deserialize;
use utoipa::IntoParams;

use super::{Code, Problem, ProblemDetails};
use crate::bus::{DeviceId, Series};
use crate::live::Live;
use crate::plant;

const PATH: Problem = Problem {
    status: StatusCode::BAD_REQUEST,
    code: Code::RequestPath,
};
const QUERY: Problem = Problem {
    status: StatusCode::BAD_REQUEST,
    code: Code::RequestQuery,
};
const NONE: Problem = Problem {
    status: StatusCode::NOT_FOUND,
    code: Code::RoleNone,
};

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct Params {
    /// One device's id; the `plant` device when absent.
    device: Option<u32>,
}

/// The live value of a series such as `grid.power` or `grid.phase.current[2]`, from the `plant`
/// device or one device, in EVCC's sign convention: a battery is positive when discharging. A
/// series without a live value, such as one the device does not report, is `role.none`.
#[utoipa::path(get, path = "/api/v1/roles/{role}",
    params(("role" = String, Path, description = "A series such as `grid.power`."), Params),
    responses(
        (status = 200, body = f64),
        (status = 400, body = ProblemDetails, content_type = "application/problem+json"),
        (status = 401, body = ProblemDetails, content_type = "application/problem+json"),
        (status = 404, body = ProblemDetails, content_type = "application/problem+json"),
    ),
)]
pub async fn role(
    State(live): State<Live>,
    role: Result<Path<String>, PathRejection>,
    params: Result<Query<Params>, QueryRejection>,
) -> Result<Json<f64>, Problem> {
    let Path(role) = role.map_err(|_| PATH)?;
    let Query(params) = params.map_err(|_| QUERY)?;
    let series = Series::parse(&role).ok_or(PATH)?;
    let device = params.device.map_or(plant::DEVICE, DeviceId);
    let value = live.value(device, &series).ok_or(NONE)?;
    Ok(Json(evcc(&series.role, value)))
}

/// Converts at this edge (ADR 4, 10): EVCC reads a battery as positive when discharging, ours is
/// positive when charging. Grid import and PV production are positive in both.
fn evcc(role: &str, value: f64) -> f64 {
    if matches!(role, "battery.power" | "battery.current") {
        -value
    } else {
        value
    }
}
