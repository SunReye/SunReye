//! The profiles the admin adds, by source URL or one file at a time: validated and stored as core settings.

use std::sync::Arc;

use axum::Json;
use axum::body::{Body, to_bytes};
use axum::extract::State;
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::{ApiError, ApiJson, ApiPath, ApiQuery, ErrorBody};
use crate::run::Core;
use crate::settings::active_profile;
use crate::sources::{
    BUDGET, ImportError, Installed, Listed, REQUEST_LIMITS, RESERVED_ID, RemoveError, Skipped, Source, fetch,
    import_profile, list_sources, remove_profile, remove_source, save_source,
};

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

/// Fetches the source and replaces what an earlier fetch of it stored, polling devices by the new
/// definitions. An invalid profile is skipped and reported; the rest load.
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
    core.apply().await?;
    let profile_ids = fetched.profiles.iter().map(|p| p.id.clone()).collect();
    Ok(Json(AddedSource { source, profile_ids, skipped: fetched.skipped }))
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ImportedProfile {
    pub id: String,
}

/// Validates the uploaded profile file and stores it, replacing an earlier import of its id; devices are
/// polled by the new definition. The rejection names the field, never the value.
#[utoipa::path(
    post,
    path = "/api/settings/profiles/import",
    operation_id = "importProfile",
    request_body(content = String, content_type = "text/plain", description = "The profile JSON file, as text"),
    responses(
        (status = 200, body = ImportedProfile),
        (status = 400, body = ErrorBody),
        (status = 401, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 413, body = ErrorBody),
        (status = 500, body = ErrorBody)
    )
)]
pub async fn import(State(core): State<Arc<Core>>, body: Body) -> Result<Json<ImportedProfile>, ApiError> {
    let limit = REQUEST_LIMITS.max_bytes;
    let bytes = to_bytes(body, limit)
        .await
        .map_err(|_| ApiError::payload_too_large(format!("a profile file is at most {limit} bytes")))?;
    let text = std::str::from_utf8(&bytes).map_err(|_| ApiError::bad_request("not JSON: not UTF-8"))?;
    let profile = Installed::validate(text).map_err(ApiError::bad_request)?;
    if core.bundle.profile(&profile.id).is_some() {
        return Err(ApiError::bad_request(RESERVED_ID));
    }
    import_profile(&core.store, &profile).await.map_err(|error| match error {
        ImportError::Refused(reason) => ApiError::bad_request(reason),
        ImportError::Store(error) => error.into(),
    })?;
    core.apply().await?;
    Ok(Json(ImportedProfile { id: profile.id }))
}

impl From<RemoveError> for ApiError {
    fn from(error: RemoveError) -> Self {
        match error {
            RemoveError::Missing => Self::not_found("Nothing stored under that name"),
            RemoveError::InUse(reason) => Self::conflict(reason),
            RemoveError::Store(error) => error.into(),
        }
    }
}

/// Removes an imported profile, or one a source supplied, and stops polling devices by it. A compiled-in
/// profile and the active one stay.
#[utoipa::path(
    delete,
    path = "/api/settings/profiles/{id}",
    operation_id = "removeProfile",
    params(("id" = String, Path)),
    responses(
        (status = 204),
        (status = 400, body = ErrorBody),
        (status = 401, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 409, body = ErrorBody),
        (status = 500, body = ErrorBody)
    )
)]
pub async fn remove(
    State(core): State<Arc<Core>>,
    ApiPath(id): ApiPath<String>,
) -> Result<StatusCode, ApiError> {
    if core.bundle.profile(&id).is_some() {
        return Err(ApiError::bad_request("a compiled-in profile cannot be removed"));
    }
    remove_profile(&core.store, &id, active_profile(&core.store).await?.as_deref()).await?;
    core.apply().await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[serde(rename_all = "camelCase")]
#[into_params(parameter_in = Query)]
pub struct SourceQuery {
    /// The base URL as the source was added.
    base_url: String,
    /// The index path as the source was added.
    index_path: String,
}

/// Removes a stored source and the profiles only it supplied. The source that supplies the active
/// profile stays.
#[utoipa::path(
    delete,
    path = "/api/settings/profile-sources",
    operation_id = "removeProfileSource",
    params(SourceQuery),
    responses(
        (status = 204),
        (status = 400, body = ErrorBody),
        (status = 401, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 409, body = ErrorBody),
        (status = 500, body = ErrorBody)
    )
)]
pub async fn remove_source_by_url(
    State(core): State<Arc<Core>>,
    ApiQuery(query): ApiQuery<SourceQuery>,
) -> Result<StatusCode, ApiError> {
    let source = Source { base_url: query.base_url, index_path: query.index_path }
        .normalised()
        .map_err(|error| ApiError::bad_request(error.to_string()))?;
    remove_source(&core.store, &source, active_profile(&core.store).await?.as_deref()).await?;
    core.apply().await?;
    Ok(StatusCode::NO_CONTENT)
}
