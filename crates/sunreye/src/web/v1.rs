//! The integration API under `/api/v1`: answers an API key, never a session.

use std::sync::Arc;

use axum::Json;
use axum::extract::{FromRequestParts, State};
use axum::http::request::Parts;
use axum::http::{HeaderMap, header};
use serde::Serialize;
use utoipa::ToSchema;

use super::api_keys::digest;
use super::{ApiError, ErrorBody};
use crate::run::Core;
use crate::settings::active_profile;

/// A request that presented an unrevoked key.
#[derive(Debug)]
pub struct ApiKey;

/// `Authorization: Bearer <key>`, else `x-api-key`.
fn presented(headers: &HeaderMap) -> Option<&str> {
    let text = |name| headers.get(name).and_then(|value| value.to_str().ok());
    let bearer = text(header::AUTHORIZATION.as_str())
        .and_then(|value| value.split_once(' '))
        .filter(|(scheme, _)| scheme.eq_ignore_ascii_case("bearer"))
        .map(|(_, key)| key.trim());
    bearer.or_else(|| text("x-api-key")).filter(|key| !key.is_empty())
}

impl FromRequestParts<Arc<Core>> for ApiKey {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, core: &Arc<Core>) -> Result<Self, ApiError> {
        let refused = || ApiError::unauthorized("Invalid or missing API key");
        let key = presented(&parts.headers).ok_or_else(refused)?;
        core.store.api_key_account(&digest(key)).await?.map(|_| Self).ok_or_else(refused)
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct Entity {
    pub key: String,
    #[schema(required = true)]
    pub label: Option<String>,
    #[schema(required = true)]
    pub unit: Option<String>,
    #[schema(required = true)]
    pub group: Option<String>,
}

/// The active profile and the entities it reads.
#[derive(Debug, Serialize, ToSchema)]
pub struct Catalog {
    pub id: String,
    pub name: String,
    pub manufacturer: String,
    pub entities: Vec<Entity>,
}

#[utoipa::path(
    get,
    path = "/api/v1/entities",
    operation_id = "listEntities",
    responses(
        (status = 200, body = Catalog),
        (status = 401, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 500, body = ErrorBody)
    )
)]
pub async fn entities(_: ApiKey, State(core): State<Arc<Core>>) -> Result<Json<Catalog>, ApiError> {
    let id = active_profile(&core.store).await?;
    let profile = id.and_then(|id| core.bundle.profile(&id).cloned());
    let Some(profile) = profile else { return Err(ApiError::not_found("No active profile")) };
    let entities = profile
        .metrics
        .iter()
        .map(|metric| Entity {
            key: metric.key.clone(),
            label: metric.label.clone(),
            unit: metric.unit.clone(),
            group: metric.group.clone(),
        })
        .collect();
    Ok(Json(Catalog {
        id: profile.id.clone(),
        name: profile.name.clone(),
        manufacturer: profile.manufacturer.clone(),
        entities,
    }))
}
