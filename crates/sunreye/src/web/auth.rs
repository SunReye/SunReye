//! Accounts and sessions: the credential check `axum-login` runs, and the routes that sign in and out.

use std::collections::HashSet;
use std::net::SocketAddr;
use std::sync::Arc;

use axum::extract::{ConnectInfo, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use axum_login::{AuthUser, AuthnBackend, AuthzBackend};
use serde::{Deserialize, Serialize};
use tower_sessions::Expiry;
use tower_sessions::cookie::time::Duration as Span;
use utoipa::ToSchema;

use super::origin::client_ip;
use super::password::{Passwords, unhashable};
use super::{ApiError, ApiJson, ErrorBody};
use crate::run::Core;
use crate::store::{AccountRow, NewAccount, Store, StoreError};

pub type AuthSession = axum_login::AuthSession<Accounts>;

/// How long a remember-me session lasts without a request.
const REMEMBERED: Span = Span::days(365);

const MIN_PASSWORD_CHARS: usize = 8;

impl AuthUser for AccountRow {
    type Id = i64;

    fn id(&self) -> i64 {
        self.id
    }

    /// Nothing changes a password, so no session is bound to one (#375 records the change it needs).
    fn session_auth_hash(&self) -> &[u8] {
        &[]
    }
}

/// The credential check and account lookup behind every session.
#[derive(Debug, Clone)]
pub struct Accounts {
    store: Arc<Store>,
    passwords: Passwords,
}

impl Accounts {
    pub fn new(store: Arc<Store>) -> Self {
        Self { store, passwords: Passwords::new() }
    }

    /// The one hashing cap every password goes through.
    pub fn passwords(&self) -> &Passwords {
        &self.passwords
    }

    pub async fn kiosk(&self) -> Result<bool, StoreError> {
        crate::settings::kiosk(&self.store).await
    }
}

#[allow(missing_debug_implementations, reason = "holds a password")]
pub struct Credentials {
    email: String,
    password: String,
}

impl AuthnBackend for Accounts {
    type User = AccountRow;
    type Credentials = Credentials;
    type Error = StoreError;

    async fn authenticate(&self, credentials: Credentials) -> Result<Option<AccountRow>, StoreError> {
        let account = self.store.account_by_email(credentials.email.trim()).await?;
        let hash = account.as_ref().map(|a| a.password_hash.clone());
        let verified = self.passwords.verify(credentials.password, hash).await;
        Ok(account.filter(|_| verified))
    }

    async fn get_user(&self, id: &i64) -> Result<Option<AccountRow>, StoreError> {
        self.store.account(*id).await
    }
}

/// Every signed-in account is a user; only an admin changes settings.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Permission {
    Admin,
}

impl AuthzBackend for Accounts {
    type Permission = Permission;

    fn get_user_permissions(
        &self,
        account: &AccountRow,
    ) -> impl Future<Output = Result<HashSet<Permission>, StoreError>> + Send {
        let permissions = if account.admin { HashSet::from([Permission::Admin]) } else { HashSet::new() };
        std::future::ready(Ok(permissions))
    }
}

/// Gives a guard's bare 401 or 403 the API's error shape; answers with a body pass through.
pub async fn guard_body(response: Response) -> Response {
    let bare = axum::body::HttpBody::size_hint(response.body()).exact() == Some(0);
    match response.status() {
        StatusCode::UNAUTHORIZED if bare => ApiError::unauthorized("Not signed in").into_response(),
        StatusCode::FORBIDDEN if bare => ApiError::forbidden("Admin only").into_response(),
        _ => response,
    }
}

impl From<axum_login::Error<Accounts>> for ApiError {
    fn from(error: axum_login::Error<Accounts>) -> Self {
        match error {
            axum_login::Error::Backend(error) => error.into(),
            axum_login::Error::Session(error) => StoreError::Sessions(error.to_string()).into(),
        }
    }
}

/// The signed-in account as the SPA reads it.
#[derive(Debug, PartialEq, Eq, Serialize, ToSchema)]
pub struct Account {
    pub id: i64,
    pub email: String,
    pub name: String,
    pub admin: bool,
}

impl From<&AccountRow> for Account {
    fn from(row: &AccountRow) -> Self {
        Self { id: row.id, email: row.email.clone(), name: row.name.clone(), admin: row.admin }
    }
}

#[derive(Deserialize, ToSchema)]
pub struct SignUpRequest {
    pub email: String,
    pub name: String,
    pub password: String,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
    /// Keep the session for a year instead of until the browser closes.
    #[serde(default)]
    pub remember_me: bool,
}

impl SignUpRequest {
    fn validate(&self) -> Result<(), ApiError> {
        validate_account(&self.email, &self.name, &self.password)
    }
}

/// The checks every new account passes, from sign-up or from an admin.
pub fn validate_account(email: &str, name: &str, password: &str) -> Result<(), ApiError> {
    let email = email.trim();
    if email.is_empty() || !email.contains('@') {
        return Err(ApiError::bad_request("Email is invalid"));
    }
    if name.trim().is_empty() {
        return Err(ApiError::bad_request("Name is required"));
    }
    if password.chars().count() < MIN_PASSWORD_CHARS {
        return Err(ApiError::bad_request("Password must be at least 8 characters"));
    }
    unhashable(password).map_or(Ok(()), |why| Err(ApiError::bad_request(why)))
}

/// Always under a fresh session id, whatever id the browser arrived with.
async fn start_session(
    auth: &mut AuthSession,
    account: &AccountRow,
    remember_me: bool,
) -> Result<(), ApiError> {
    auth.session.cycle_id().await.map_err(|e| StoreError::Sessions(e.to_string()))?;
    auth.login(account).await?;
    auth.session.set_expiry(Some(if remember_me {
        Expiry::OnInactivity(REMEMBERED)
    } else {
        Expiry::OnSessionEnd
    }));
    Ok(())
}

/// Only while no account exists: the first one is the admin, every later one is created by an admin.
#[utoipa::path(
    post,
    path = "/api/auth/sign-up",
    operation_id = "signUp",
    request_body = SignUpRequest,
    responses(
        (status = 200, body = Account),
        (status = 400, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 500, body = ErrorBody)
    )
)]
pub async fn sign_up(
    State(core): State<Arc<Core>>,
    mut auth: AuthSession,
    ApiJson(request): ApiJson<SignUpRequest>,
) -> Result<Json<Account>, ApiError> {
    request.validate()?;
    let closed = || ApiError::forbidden("Sign-up is closed");
    if core.store.has_accounts().await? {
        return Err(closed());
    }
    let password_hash = auth.backend.passwords.hash(request.password).await.ok_or_else(ApiError::internal)?;
    let new = NewAccount {
        email: request.email.trim().to_owned(),
        name: request.name.trim().to_owned(),
        password_hash,
    };
    let Some(id) = core.store.create_first_account(&new).await? else { return Err(closed()) };
    let account = core.store.account(id).await?.ok_or_else(ApiError::internal)?;
    start_session(&mut auth, &account, false).await?;
    Ok(Json(Account::from(&account)))
}

#[utoipa::path(
    post,
    path = "/api/auth/login",
    operation_id = "login",
    request_body = LoginRequest,
    responses(
        (status = 200, body = Account),
        (status = 400, body = ErrorBody),
        (status = 401, body = ErrorBody),
        (status = 500, body = ErrorBody)
    )
)]
pub async fn login(
    mut auth: AuthSession,
    peer: Option<Extension<ConnectInfo<SocketAddr>>>,
    headers: HeaderMap,
    ApiJson(request): ApiJson<LoginRequest>,
) -> Result<Json<Account>, ApiError> {
    let credentials = Credentials { email: request.email, password: request.password };
    let Some(account) = auth.authenticate(credentials).await? else {
        let client = client_ip(&headers, peer.map(|Extension(ConnectInfo(addr))| addr));
        tracing::warn!(client = ?client, "login refused");
        return Err(ApiError::unauthorized("Invalid email or password"));
    };
    start_session(&mut auth, &account, request.remember_me).await?;
    Ok(Json(Account::from(&account)))
}

#[utoipa::path(
    get,
    path = "/api/auth/session",
    operation_id = "currentSession",
    responses((status = 200, body = Account), (status = 401, body = ErrorBody))
)]
pub async fn current(auth: AuthSession) -> Result<Json<Account>, ApiError> {
    let account = auth.user.as_ref().ok_or_else(|| ApiError::unauthorized("Not signed in"))?;
    Ok(Json(Account::from(account)))
}

#[utoipa::path(
    delete,
    path = "/api/auth/session",
    operation_id = "logout",
    responses((status = 204), (status = 401, body = ErrorBody), (status = 500, body = ErrorBody))
)]
pub async fn logout(mut auth: AuthSession) -> Result<StatusCode, ApiError> {
    auth.logout().await?;
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn accounts_print_without_a_hash_after_hashing() {
        let accounts = Accounts::new(Arc::new(Store::in_memory().await.expect("store")));
        accounts.passwords.hash("correct horse battery".into()).await.expect("hash");
        let printed = format!("{accounts:?}");
        assert!(printed.len() < 1024 && !printed.contains("$2b$"), "{printed}");
    }
}
