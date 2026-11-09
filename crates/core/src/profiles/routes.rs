//! The index routes, behind the admin's session.

use axum::Json;
use axum::extract::rejection::{JsonRejection, PathRejection};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use super::{Profiles, Report, Update};
use crate::api::{Clock, Code, Problem, ProblemDetails};

const BODY: Problem = Problem {
    status: StatusCode::BAD_REQUEST,
    code: Code::RequestBody,
};
const PATH: Problem = Problem {
    status: StatusCode::BAD_REQUEST,
    code: Code::RequestPath,
};

impl Profiles {
    pub fn routes(self, clock: Clock) -> OpenApiRouter {
        OpenApiRouter::new()
            .routes(routes!(indexes, add_index))
            .routes(routes!(check))
            .routes(routes!(updates))
            .routes(routes!(apply))
            .with_state((self, clock))
    }
}

type ProfilesState = State<(Profiles, Clock)>;

#[derive(Serialize, ToSchema)]
struct Indexes {
    indexes: Vec<Report>,
}

#[derive(Deserialize, ToSchema)]
struct NewIndex {
    /// The `index.json` URL.
    url: String,
}

/// The official profile index, then each one the admin added, with the outcome of its last check.
#[utoipa::path(get, path = "/api/v1/profile-indexes", responses(
    (status = 200, body = Indexes),
    (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn indexes(State((profiles, _)): ProfilesState) -> Result<Json<Indexes>, Problem> {
    Ok(Json(Indexes {
        indexes: profiles.indexes().await?,
    }))
}

/// Adds a profile index and fetches it at once; its profiles load as community profiles unless
/// signed by the profile key.
#[utoipa::path(post, path = "/api/v1/profile-indexes", request_body = NewIndex, responses(
    (status = 200, body = Report),
    (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn add_index(
    State((profiles, clock)): ProfilesState,
    body: Result<Json<NewIndex>, JsonRejection>,
) -> Result<Json<Report>, Problem> {
    let Json(NewIndex { url }) = body.map_err(|_| BODY)?;
    Ok(Json(profiles.add(url, clock()).await?))
}

/// Checks every index for updates: the only fetch besides adding an index, never on a timer.
#[utoipa::path(post, path = "/api/v1/profile-indexes/check", responses(
    (status = 200, body = Indexes),
    (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn check(State((profiles, _)): ProfilesState) -> Result<Json<Indexes>, Problem> {
    Ok(Json(Indexes {
        indexes: profiles.check().await?,
    }))
}

#[derive(Serialize, ToSchema)]
struct Updates {
    updates: Vec<Update>,
}

/// The updates a check found for profiles served, each with what it changes; none is served
/// until the admin applies it.
#[utoipa::path(get, path = "/api/v1/profile-updates", responses(
    (status = 200, body = Updates),
    (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn updates(State((profiles, _)): ProfilesState) -> Result<Json<Updates>, Problem> {
    Ok(Json(Updates {
        updates: profiles.updates().await?,
    }))
}

/// Applies the update waiting for a profile. Each setting it adds or changes is off until the
/// admin enables it again (ADR 8).
#[utoipa::path(post, path = "/api/v1/profile-updates/{id}", params(("id" = String, Path)),
    responses(
    (status = 200, body = Update),
    (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn apply(
    State((profiles, clock)): ProfilesState,
    id: Result<Path<String>, PathRejection>,
) -> Result<Json<Update>, Problem> {
    let Path(id) = id.map_err(|_| PATH)?;
    Ok(Json(profiles.apply(&id, clock()).await?))
}
