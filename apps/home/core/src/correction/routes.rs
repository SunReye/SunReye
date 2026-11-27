//! The learned corrections route (ADR 17, 20): each MPPT input's grid and its last 30 days
//! against the model, so the builder shows where the scene is wrong. Read by viewers, as history.

use axum::Json;
use axum::extract::State;
use serde::Serialize;
use tokio::sync::watch;
use utoipa::ToSchema;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use super::{Corrections, InputReport};
use crate::api::{Problem, ProblemDetails, internal};
use crate::location::Location;

type Routed = (Corrections, watch::Receiver<Option<Location>>);

impl Corrections {
    /// The last 30 days are reported while the plant has a `location`.
    pub fn routes() -> OpenApiRouter<crate::api::App> {
        OpenApiRouter::new().routes(routes!(corrections))
    }
}

/// Every MPPT input any layout version wires a string to.
#[derive(Serialize, ToSchema)]
struct CorrectionList {
    inputs: Vec<InputCorrection>,
}

#[derive(Serialize, ToSchema)]
struct InputCorrection {
    /// The inverter.
    device: u32,
    /// The `pv.mppt.*` index.
    input: u32,
    /// The learned cells; an unlearned month and hour applies 1.
    factors: Vec<LearnedCell>,
    /// The last 30 days measured against the model as the learner last stored them, absent until
    /// both exist.
    recent: Option<RecentEnergy>,
}

/// The multiplier for a plant-local month and hour.
#[derive(Serialize, ToSchema)]
struct LearnedCell {
    /// 1 to 12.
    month: u8,
    /// 0 to 23.
    hour: u8,
    factor: f64,
}

/// In kWh, over the whole hours of the last 30 days the input is modelled on archive weather and
/// measured, short of the inverter's AC limit; the model uncorrected.
#[derive(Serialize, ToSchema)]
struct RecentEnergy {
    measured: f64,
    modelled: f64,
}

impl From<InputReport> for InputCorrection {
    fn from(report: InputReport) -> Self {
        Self {
            device: report.device.0,
            input: report.input,
            factors: report
                .grid
                .cells()
                .map(|(month, hour, _)| LearnedCell {
                    month,
                    hour,
                    factor: report.grid.factor(month, hour),
                })
                .collect(),
            recent: report.recent.map(|r| RecentEnergy {
                measured: r.measured,
                modelled: r.modelled,
            }),
        }
    }
}

#[utoipa::path(get, path = "/api/v1/corrections",
    responses(
        (status = 200, body = CorrectionList),
        (status = 401, body = ProblemDetails, content_type = "application/problem+json"),
        (status = 500, body = ProblemDetails, content_type = "application/problem+json"),
    ),
)]
async fn corrections(
    State((corrections, location)): State<Routed>,
) -> Result<Json<CorrectionList>, Problem> {
    let located = location.borrow().is_some();
    let reports = corrections
        .report(located)
        .await
        .map_err(|e| internal(format_args!("corrections: {e}")))?;
    Ok(Json(CorrectionList {
        inputs: reports.into_iter().map(InputCorrection::from).collect(),
    }))
}
