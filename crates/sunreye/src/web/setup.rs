//! The gates the SPA reads before it shows anything, what this core serves, and the choice of the
//! profile the device is read with.

use std::sync::Arc;

use axum::Json;
use axum::extract::State;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::{ApiError, ApiJson, ErrorBody};
use crate::manifest::{InverterManifest, manifest as manifest_of};
use crate::profile::Profile;
use crate::run::Core;
use crate::settings::{active_profile, set_active_profile};
use crate::sources::installed;

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SetupStatus {
    /// No account exists yet: the first sign-up creates the admin.
    pub needs_setup: bool,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProfileStatus {
    pub needs_profile: bool,
    #[schema(required = true)]
    pub active_profile_id: Option<String>,
}

/// The SPA areas this core serves; the SPA hides every area that reads false.
#[derive(Debug, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
#[allow(clippy::struct_excessive_bools, reason = "one flag per SPA area, serialised as a flat object")]
pub struct Capabilities {
    pub history: bool,
    pub statistics: bool,
    pub controls: bool,
    pub automations: bool,
    pub restart: bool,
    pub profile_sources: bool,
}

impl Capabilities {
    /// Monitoring only (ADR 0005): nothing writes, and nothing here restarts the core.
    pub const SERVED: Self = Self {
        history: false,
        statistics: false,
        controls: false,
        automations: false,
        restart: false,
        profile_sources: false,
    };
}

#[utoipa::path(
    get,
    path = "/api/setup-status",
    operation_id = "setupStatus",
    responses((status = 200, body = SetupStatus), (status = 500, body = ErrorBody))
)]
pub async fn setup_status(State(core): State<Arc<Core>>) -> Result<Json<SetupStatus>, ApiError> {
    Ok(Json(SetupStatus { needs_setup: !core.store.has_accounts().await? }))
}

#[utoipa::path(
    get,
    path = "/api/profile-status",
    operation_id = "profileStatus",
    responses((status = 200, body = ProfileStatus), (status = 500, body = ErrorBody))
)]
pub async fn profile_status(State(core): State<Arc<Core>>) -> Result<Json<ProfileStatus>, ApiError> {
    let active_profile_id = active_profile(&core.store).await?;
    Ok(Json(ProfileStatus { needs_profile: active_profile_id.is_none(), active_profile_id }))
}

#[utoipa::path(get, path = "/api/capabilities",
    operation_id = "capabilities", responses((status = 200, body = Capabilities), (status = 401, body = ErrorBody)))]
pub async fn capabilities() -> Json<Capabilities> {
    Json(Capabilities::SERVED)
}

/// The active profile as the dashboard builds itself from it.
#[utoipa::path(
    get,
    path = "/api/profile",
    operation_id = "profileManifest",
    responses(
        (status = 200, body = InverterManifest),
        (status = 401, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 500, body = ErrorBody)
    )
)]
pub async fn manifest(State(core): State<Arc<Core>>) -> Result<Json<InverterManifest>, ApiError> {
    let profile = match active_profile(&core.store).await? {
        Some(id) => core.profile(&id).await?,
        None => None,
    };
    let Some(profile) = profile else { return Err(ApiError::not_found("No active profile")) };
    Ok(Json(manifest_of(&profile)))
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ProfileEntry {
    pub id: String,
    pub name: String,
    pub manufacturer: String,
    pub active: bool,
    /// Downloaded from a profile source. The compiled-in profiles are not.
    pub installed: bool,
    /// Compiled into the binary.
    pub builtin: bool,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ActiveProfileRequest {
    pub id: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ActiveProfile {
    pub id: String,
    /// Always false: the device is polled with the new profile at once.
    pub restart_required: bool,
}

#[utoipa::path(
    get,
    path = "/api/profiles",
    operation_id = "listProfiles",
    responses(
        (status = 200, body = Vec<ProfileEntry>),
        (status = 401, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 500, body = ErrorBody)
    )
)]
pub async fn list_profiles(State(core): State<Arc<Core>>) -> Result<Json<Vec<ProfileEntry>>, ApiError> {
    let active = active_profile(&core.store).await?;
    let entry = |profile: &Profile, builtin: bool| ProfileEntry {
        id: profile.id.clone(),
        name: profile.name.clone(),
        manufacturer: profile.manufacturer.clone(),
        active: active.as_deref() == Some(profile.id.as_str()),
        installed: !builtin,
        builtin,
    };
    let compiled_in = core.bundle.profiles.iter().map(|pinned| entry(&pinned.profile, true));
    let sourced = installed(&core.store).await?;
    let sourced = sourced.iter().filter(|p| core.bundle.profile(&p.profile.id).is_none());
    Ok(Json(compiled_in.chain(sourced.map(|p| entry(&p.profile, false))).collect()))
}

#[utoipa::path(
    put,
    path = "/api/settings/active-profile",
    operation_id = "chooseProfile",
    request_body = ActiveProfileRequest,
    responses(
        (status = 200, body = ActiveProfile),
        (status = 400, body = ErrorBody),
        (status = 401, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 500, body = ErrorBody)
    )
)]
pub async fn choose_profile(
    State(core): State<Arc<Core>>,
    ApiJson(request): ApiJson<ActiveProfileRequest>,
) -> Result<Json<ActiveProfile>, ApiError> {
    if core.profile(&request.id).await?.is_none() {
        return Err(ApiError::bad_request(format!("Unknown profile \"{}\"", request.id)));
    }
    set_active_profile(&core.store, &request.id).await?;
    core.apply().await?;
    Ok(Json(ActiveProfile { id: request.id, restart_required: false }))
}
