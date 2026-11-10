//! The topology routes: configuration, so admin only (ADR 9).

use std::time::SystemTime;

use axum::Json;
use axum::extract::rejection::{JsonRejection, QueryRejection};
use axum::extract::{Query, State};
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use super::{Claim, PointDraft, Topologies, Version, in_force};
use crate::api::{Clock, Code, Problem, ProblemDetails, internal};
use crate::devices::Devices;

const BODY: Problem = Problem {
    status: StatusCode::BAD_REQUEST,
    code: Code::RequestBody,
};
const QUERY: Problem = Problem {
    status: StatusCode::BAD_REQUEST,
    code: Code::RequestQuery,
};
const NONE: Problem = Problem {
    status: StatusCode::NOT_FOUND,
    code: Code::TopologyNone,
};

impl Topologies {
    /// The topology routes; `devices` names the registered devices a claim may name.
    pub fn routes(self, devices: Devices, clock: Clock) -> OpenApiRouter {
        OpenApiRouter::new()
            .routes(routes!(topology, change_topology))
            .with_state((self, devices, clock))
    }
}

type TopologyState = State<(Topologies, Devices, Clock)>;

/// One point of a topology version.
#[derive(Serialize, ToSchema)]
struct PointView {
    /// Stable; never reused.
    id: u32,
    name: String,
    /// The parent point's id; `null` for the root.
    parent: Option<u32>,
    /// In order: the first with a reading is read.
    claims: Vec<Claim>,
    /// Claimed by more than one device: flagged, never summed (ADR 14).
    contested: bool,
}

/// One topology version, as the API reads it.
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(super) struct Topology {
    /// RFC 3339, UTC.
    applies_from: String,
    /// Each parent before its children, the root first.
    points: Vec<PointView>,
}

impl From<&Version> for Topology {
    fn from(version: &Version) -> Self {
        Self {
            applies_from: jiff::Timestamp::try_from(version.applies_from)
                .map(|t| t.to_string())
                .unwrap_or_default(),
            points: version
                .points
                .iter()
                .map(|p| PointView {
                    id: p.id,
                    name: p.name.clone(),
                    parent: p.parent,
                    claims: p.claims.clone(),
                    contested: p.contested(),
                })
                .collect(),
        }
    }
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
struct At {
    /// RFC 3339; now when absent.
    at: Option<String>,
}

/// The topology in force at an instant.
#[utoipa::path(get, path = "/api/v1/topology", params(At), responses(
    (status = 200, body = Topology),
    (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn topology(
    State((topologies, _, clock)): TopologyState,
    at: Result<Query<At>, QueryRejection>,
) -> Result<Json<Topology>, Problem> {
    let Query(At { at }) = at.map_err(|_| QUERY)?;
    let at = match at {
        Some(at) => instant(&at).ok_or(QUERY)?,
        None => clock(),
    };
    let versions = topologies.versions().await.map_err(internal)?;
    in_force(&versions, at).map(|v| Json(v.into())).ok_or(NONE)
}

/// A topology change: every point, applying from an instant on.
#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
struct Change {
    /// RFC 3339.
    applies_from: String,
    /// The root first, each parent before its children.
    points: Vec<PointDraft>,
}

/// Changes the topology from an instant on; new points get fresh ids. Aggregates already stored
/// keep the topology they were computed with (ADR 14).
#[utoipa::path(put, path = "/api/v1/topology", request_body = Change, responses(
    (status = 200, body = Topology),
    (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn change_topology(
    State((topologies, devices, clock)): TopologyState,
    body: Result<Json<Change>, JsonRejection>,
) -> Result<Json<Topology>, Problem> {
    let Json(change) = body.map_err(|_| BODY)?;
    let applies_from = instant(&change.applies_from).ok_or(BODY)?;
    let registered: Vec<u32> = devices
        .devices()
        .await
        .map_err(internal)?
        .iter()
        .map(|d| d.id)
        .collect();
    let version = topologies
        .change(applies_from, change.points, &registered, clock())
        .await?;
    Ok(Json((&version).into()))
}

fn instant(text: &str) -> Option<SystemTime> {
    text.parse::<jiff::Timestamp>().ok().map(Into::into)
}
