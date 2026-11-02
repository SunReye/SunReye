//! API keys: an admin issues one to an account for an integration, which presents it on `/api/v1`.
//!
//! A key carries 256 random bits, so one SHA-256 is enough to store it: no bcrypt cost per request,
//! and the store finds a key by its digest.

use std::fmt::Write;
use std::sync::Arc;

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use password_hash::rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::{ApiError, ApiJson, ErrorBody};
use crate::run::Core;
use crate::store::{ApiKeyRow, NewApiKey};

const PREFIX: &str = "sunreye_";
/// The prefix and four characters of the random part, enough to tell a household's keys apart.
const START_CHARS: usize = PREFIX.len() + 4;

/// What the store keeps of a key.
pub fn digest(key: &str) -> Vec<u8> {
    ring::digest::digest(&ring::digest::SHA256, key.as_bytes()).as_ref().to_vec()
}

fn generate() -> String {
    let mut random = [0_u8; 32];
    OsRng.fill_bytes(&mut random);
    let mut key = String::from(PREFIX);
    for byte in random {
        // Writing to a `String` cannot fail.
        let _ = write!(key, "{byte:02x}");
    }
    key
}

/// A key as listed: never the key itself.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ApiKeyView {
    pub id: i64,
    pub name: String,
    /// The key's first characters.
    pub start: String,
    pub created_at: String,
    pub user_id: i64,
    pub user_email: String,
    pub user_name: String,
}

impl From<ApiKeyRow> for ApiKeyView {
    fn from(row: ApiKeyRow) -> Self {
        Self {
            id: row.id,
            name: row.name,
            start: row.start,
            created_at: row.created_at,
            user_id: row.account_id,
            user_email: row.account_email,
            user_name: row.account_name,
        }
    }
}

/// The only answer that holds the key.
#[derive(Serialize, ToSchema)]
pub struct CreatedApiKey {
    pub key: String,
    #[serde(flatten)]
    pub view: ApiKeyView,
}

/// Leaves the key out of logs.
impl std::fmt::Debug for CreatedApiKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CreatedApiKey").field("view", &self.view).finish_non_exhaustive()
    }
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct NewApiKeyRequest {
    pub user_id: i64,
    pub name: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct RevokeRequest {
    pub id: i64,
}

#[utoipa::path(
    get,
    path = "/api/admin/api-keys",
    operation_id = "listApiKeys",
    responses(
        (status = 200, body = Vec<ApiKeyView>),
        (status = 401, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 500, body = ErrorBody)
    )
)]
pub async fn list(State(core): State<Arc<Core>>) -> Result<Json<Vec<ApiKeyView>>, ApiError> {
    let rows = core.store.api_keys().await?;
    Ok(Json(rows.into_iter().map(ApiKeyView::from).collect()))
}

#[utoipa::path(
    post,
    path = "/api/admin/api-keys",
    operation_id = "createApiKey",
    request_body = NewApiKeyRequest,
    responses(
        (status = 200, body = CreatedApiKey),
        (status = 400, body = ErrorBody),
        (status = 401, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 500, body = ErrorBody)
    )
)]
pub async fn create(
    State(core): State<Arc<Core>>,
    ApiJson(request): ApiJson<NewApiKeyRequest>,
) -> Result<Json<CreatedApiKey>, ApiError> {
    let name = request.name.trim();
    if name.is_empty() {
        return Err(ApiError::bad_request("Name is required"));
    }
    let key = generate();
    let new = NewApiKey {
        account_id: request.user_id,
        name: name.to_owned(),
        start: key[..START_CHARS].to_owned(),
        key_hash: digest(&key),
    };
    let Some(id) = core.store.add_api_key(&new).await? else {
        return Err(ApiError::not_found("Unknown user"));
    };
    let row = core.store.api_key(id).await?.ok_or_else(ApiError::internal)?;
    Ok(Json(CreatedApiKey { key, view: row.into() }))
}

#[utoipa::path(
    post,
    path = "/api/admin/api-keys/revoke",
    operation_id = "revokeApiKey",
    request_body = RevokeRequest,
    responses(
        (status = 204),
        (status = 400, body = ErrorBody),
        (status = 401, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 500, body = ErrorBody)
    )
)]
pub async fn revoke(
    State(core): State<Arc<Core>>,
    ApiJson(request): ApiJson<RevokeRequest>,
) -> Result<StatusCode, ApiError> {
    if core.store.revoke_api_key(request.id).await? {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(ApiError::not_found("Unknown API key"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_created_key_prints_without_the_key() {
        let key = generate();
        let created = CreatedApiKey {
            key: key.clone(),
            view: ApiKeyView {
                id: 7,
                name: "Home Assistant".into(),
                start: key[..START_CHARS].to_owned(),
                created_at: "2026-11-02T10:00:00.000Z".into(),
                user_id: 1,
                user_email: "ada@example.org".into(),
                user_name: "Ada".into(),
            },
        };
        let random = &key[START_CHARS..];
        for printed in [format!("{created:?}"), format!("{created:#?}")] {
            assert!(printed.contains("Home Assistant"), "{printed}");
            assert!(!printed.contains(random), "{printed}");
        }
    }
}
