//! The plant timezone (ADR 3): days are cut in it, the host's until the admin sets one. A change
//! applies from the instant it is made and is appended to the change log (ADR 19).

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
use crate::storage::{Error, Zones};

const BODY: Problem = Problem {
    status: StatusCode::BAD_REQUEST,
    code: Code::RequestBody,
};
const VALUE: Problem = Problem {
    status: StatusCode::UNPROCESSABLE_ENTITY,
    code: Code::ZoneValue,
};

/// The plant timezone.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct Zone {
    /// An IANA name, such as `Europe/Berlin`.
    pub name: String,
}

/// The timezone routes, behind the admin's session.
pub fn routes(zones: Zones, clock: Clock) -> OpenApiRouter {
    OpenApiRouter::new()
        .routes(routes!(timezone, set_timezone))
        .with_state((zones, clock))
}

type ZoneState = State<(Zones, Clock)>;

/// The plant timezone days are cut in.
#[utoipa::path(get, path = "/api/v1/timezone", responses(
    (status = 200, body = Zone),
    (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn timezone(State((zones, _)): ZoneState) -> Json<Zone> {
    let name = zones
        .watch()
        .borrow()
        .iana_name()
        .unwrap_or("UTC")
        .to_owned();
    Json(Zone { name })
}

/// Sets the plant timezone; days from now on are cut in it.
#[utoipa::path(put, path = "/api/v1/timezone", request_body = Zone, responses(
    (status = 200, body = Zone),
    (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn set_timezone(
    State((zones, clock)): ZoneState,
    body: Result<Json<Zone>, JsonRejection>,
) -> Result<Json<Zone>, Problem> {
    let Json(zone) = body.map_err(|_| BODY)?;
    let changed = clock();
    let entry = Entry {
        subject: Subject::Zone,
        id: 0,
        action: Action::Change,
        state: serde_json::to_value(&zone).ok(),
        actor: "admin",
        changed,
        applies_from: changed,
    };
    zones
        .set(&zone.name, Box::new(move |db| changes::append(db, &entry)))
        .await
        .map_err(|e| {
            if matches!(e, Error::Zone) {
                VALUE
            } else {
                internal(e)
            }
        })?;
    Ok(Json(zone))
}
