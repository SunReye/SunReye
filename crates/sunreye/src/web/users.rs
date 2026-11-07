//! Account administration: an admin lists, invites, promotes, demotes and removes accounts.

use std::sync::Arc;

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use serde::Deserialize;
use utoipa::ToSchema;

use super::auth::{Account, AuthSession, validate_account};
use super::{ApiError, ApiJson, ApiPath, ErrorBody};
use crate::events::SessionEnded;
use crate::run::Core;
use crate::store::{NewAccount, Refusal};

impl From<Refusal> for ApiError {
    fn from(refusal: Refusal) -> Self {
        match refusal {
            Refusal::Unknown => Self::not_found("Unknown user"),
            Refusal::LastAdmin => Self::conflict("The last admin cannot be demoted or removed"),
        }
    }
}

/// An account an admin creates; the admin hands the password to its person.
#[derive(Deserialize, ToSchema)]
pub struct NewUserRequest {
    pub email: String,
    pub name: String,
    pub password: String,
    pub admin: bool,
}

#[derive(Deserialize, ToSchema)]
pub struct RoleRequest {
    pub admin: bool,
}

#[utoipa::path(
    get,
    path = "/api/admin/users",
    operation_id = "listUsers",
    responses(
        (status = 200, body = Vec<Account>),
        (status = 401, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 500, body = ErrorBody)
    )
)]
pub async fn list(State(core): State<Arc<Core>>) -> Result<Json<Vec<Account>>, ApiError> {
    Ok(Json(core.store.accounts().await?.iter().map(Account::from).collect()))
}

#[utoipa::path(
    post,
    path = "/api/admin/users",
    operation_id = "createUser",
    request_body = NewUserRequest,
    responses(
        (status = 200, body = Account),
        (status = 400, body = ErrorBody),
        (status = 401, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 409, body = ErrorBody),
        (status = 500, body = ErrorBody)
    )
)]
pub async fn create(
    State(core): State<Arc<Core>>,
    auth: AuthSession,
    ApiJson(request): ApiJson<NewUserRequest>,
) -> Result<Json<Account>, ApiError> {
    validate_account(&request.email, &request.name, &request.password)?;
    let password_hash =
        auth.backend.passwords().hash(request.password).await.ok_or_else(ApiError::internal)?;
    let new = NewAccount {
        email: request.email.trim().to_owned(),
        name: request.name.trim().to_owned(),
        password_hash,
    };
    let Some(id) = core.store.add_account(&new, request.admin).await? else {
        return Err(ApiError::conflict("Email is taken"));
    };
    let account = core.store.account(id).await?.ok_or_else(ApiError::internal)?;
    Ok(Json(Account::from(&account)))
}

#[utoipa::path(
    put,
    path = "/api/admin/users/{id}/role",
    operation_id = "setUserRole",
    params(("id" = i64, Path)),
    request_body = RoleRequest,
    responses(
        (status = 200, body = Account),
        (status = 400, body = ErrorBody),
        (status = 401, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 409, body = ErrorBody),
        (status = 500, body = ErrorBody)
    )
)]
pub async fn set_role(
    State(core): State<Arc<Core>>,
    ApiPath(id): ApiPath<i64>,
    ApiJson(request): ApiJson<RoleRequest>,
) -> Result<Json<Account>, ApiError> {
    let account = core.store.set_admin(id, request.admin).await??;
    core.bus.sessions.publish(SessionEnded(id));
    Ok(Json(Account::from(&account)))
}

#[utoipa::path(
    delete,
    path = "/api/admin/users/{id}",
    operation_id = "removeUser",
    params(("id" = i64, Path)),
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
    ApiPath(id): ApiPath<i64>,
) -> Result<StatusCode, ApiError> {
    core.store.remove_account(id).await??;
    core.bus.sessions.publish(SessionEnded(id));
    Ok(StatusCode::NO_CONTENT)
}
