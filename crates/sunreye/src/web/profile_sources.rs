//! The profiles the admin adds, by source URL or one file at a time: validated and stored as core settings.

use std::sync::Arc;

use axum::Json;
use axum::body::{Body, to_bytes};
use axum::extract::State;
use serde::Serialize;
use utoipa::ToSchema;

use super::{ApiError, ApiJson, ErrorBody};
use crate::run::Core;
use crate::sources::{
    BUDGET, ImportError, Installed, Listed, REQUEST_LIMITS, RESERVED_ID, Skipped, Source, fetch,
    import_profile, list_sources, save_source,
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
