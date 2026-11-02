//! The profile sources the admin adds: fetched, validated and stored as core settings.

use std::sync::Arc;

use axum::Json;
use axum::extract::State;
use serde::Serialize;
use utoipa::ToSchema;

use super::{ApiError, ApiJson, ErrorBody};
use crate::run::Core;
use crate::sources::{BUDGET, Listed, REQUEST_LIMITS, Skipped, Source, fetch, list_sources, save_source};

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AddedSource {
    #[serde(flatten)]
    pub source: Source,
    pub profile_ids: Vec<String>,
    /// Files the index listed that did not load, with why.
    pub skipped: Vec<Skipped>,
}

#[utoipa::path(
    get,
    path = "/api/settings/profile-sources",
    operation_id = "listProfileSources",
    responses(
        (status = 200, body = Vec<Listed>),
        (status = 401, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 500, body = ErrorBody)
    )
)]
pub async fn list(State(core): State<Arc<Core>>) -> Result<Json<Vec<Listed>>, ApiError> {
    Ok(Json(list_sources(&core.store).await?))
}

/// Fetches the source and replaces what an earlier fetch of it stored. An invalid profile is skipped and
/// reported; the rest load.
#[utoipa::path(
    post,
    path = "/api/settings/profile-sources",
    operation_id = "addProfileSource",
    request_body = Source,
    responses(
        (status = 200, body = AddedSource),
        (status = 400, body = ErrorBody),
        (status = 401, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 500, body = ErrorBody)
    )
)]
pub async fn add(
    State(core): State<Arc<Core>>,
    ApiJson(request): ApiJson<Source>,
) -> Result<Json<AddedSource>, ApiError> {
    let refused = |error: crate::sources::SourceError| ApiError::bad_request(error.to_string());
    let source = request.normalised().map_err(refused)?;
    let fetched = fetch(&source, REQUEST_LIMITS, BUDGET, &core.roots, |id| core.bundle.profile(id).is_some())
        .await
        .map_err(refused)?;
    save_source(&core.store, &source, &fetched.profiles).await?;
    let profile_ids = fetched.profiles.iter().map(|p| p.profile.id.clone()).collect();
    Ok(Json(AddedSource { source, profile_ids, skipped: fetched.skipped }))
}
