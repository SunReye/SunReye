//! Change-point retention (ADR 3): how many days change points are kept, five years until the
//! admin sets it. A change applies from the instant it is made and is appended to the change log
//! (ADR 19).

use std::time::Duration;

use axum::Json;
use axum::extract::State;
use axum::extract::rejection::JsonRejection;
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::api::{Clock, Code, Problem, ProblemDetails, internal};
use crate::changes::{self, Action, Entry, Subject};
use crate::storage::Retention;

const BODY: Problem = Problem {
    status: StatusCode::BAD_REQUEST,
    code: Code::RequestBody,
};
const VALUE: Problem = Problem {
    status: StatusCode::UNPROCESSABLE_ENTITY,
    code: Code::RetentionValue,
};
const DAY: Duration = Duration::from_hours(24);

/// How long change points are kept; hourly and daily rollups are kept forever.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct Kept {
    /// Whole days, at least one.
    pub days: u32,
}

/// The retention routes, behind the admin's session.
pub fn routes(kept: Retention, clock: Clock) -> OpenApiRouter {
    OpenApiRouter::new()
        .routes(routes!(retention, set_retention))
        .with_state((kept, clock))
}

type RetentionState = State<(Retention, Clock)>;

/// How many days change points are kept.
#[utoipa::path(get, path = "/api/v1/retention", responses(
    (status = 200, body = Kept),
    (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn retention(State((retention, _)): RetentionState) -> Json<Kept> {
    let days = retention.get().as_secs() / DAY.as_secs();
    Json(Kept {
        days: u32::try_from(days).unwrap_or(u32::MAX),
    })
}

/// Sets how many days change points are kept; older ones expire within minutes.
#[utoipa::path(put, path = "/api/v1/retention", request_body = Kept, responses(
    (status = 200, body = Kept),
    (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn set_retention(
    State((retention, clock)): RetentionState,
    body: Result<Json<Kept>, JsonRejection>,
) -> Result<Json<Kept>, Problem> {
    let Json(kept) = body.map_err(|_| BODY)?;
    if kept.days == 0 {
        return Err(VALUE);
    }
    let changed = clock();
    let entry = Entry {
        subject: Subject::Retention,
        id: 0,
        action: Action::Change,
        state: serde_json::to_value(&kept).ok(),
        actor: "admin",
        changed,
        applies_from: changed,
    };
    retention
        .set(
            DAY * kept.days,
            Box::new(move |db| changes::append(db, &entry)),
        )
        .await
        .map_err(internal)?;
    Ok(Json(kept))
}
