//! Accounts and sessions: the credential check `axum-login` runs, and the routes that sign in and out.

use std::collections::HashSet;
use std::net::SocketAddr;
use std::sync::{Arc, LazyLock};

use axum::extract::{ConnectInfo, State};
use axum::http::{HeaderMap, StatusCode};
use axum::{Extension, Json};
use axum_login::{AuthUser, AuthnBackend, AuthzBackend};
use serde::{Deserialize, Serialize};
use tower_sessions::Expiry;
use tower_sessions::cookie::time::Duration as Span;
use utoipa::ToSchema;

use super::origin::client_ip;
use super::{ApiError, ApiJson, ErrorBody};
use crate::run::Core;
use crate::store::{AccountRow, NewAccount, Store, StoreError};

pub type AuthSession = axum_login::AuthSession<Accounts>;

/// How long a remember-me session lasts without a request.
const REMEMBERED: Span = Span::days(365);

/// Bounds the Argon2 input, so a request cannot make one check arbitrarily long.
const PASSWORD_CHARS: std::ops::RangeInclusive<usize> = 8..=128;

impl AuthUser for AccountRow {
    type Id = i64;

    fn id(&self) -> i64 {
        self.id
    }

    /// A changed password ends the sessions signed in with the old one.
    fn session_auth_hash(&self) -> &[u8] {
        self.password_hash.as_bytes()
    }
}

/// The credential check and account lookup behind every session.
#[derive(Debug, Clone)]
pub struct Accounts {
    store: Arc<Store>,
}

impl Accounts {
    pub fn new(store: Arc<Store>) -> Self {
        Self { store }
    }
}

#[allow(missing_debug_implementations, reason = "holds a password")]
pub struct Credentials {
    email: String,
    password: String,
}

/// Checked against an unknown email, so it takes as long as a wrong password.
static UNKNOWN_ACCOUNT: LazyLock<String> = LazyLock::new(|| password_auth::generate_hash("no such account"));

impl AuthnBackend for Accounts {
    type User = AccountRow;
    type Credentials = Credentials;
    type Error = StoreError;

    async fn authenticate(&self, credentials: Credentials) -> Result<Option<AccountRow>, StoreError> {
        let account = self.store.account_by_email(credentials.email.trim()).await?;
        let hash = account.as_ref().map_or_else(|| UNKNOWN_ACCOUNT.clone(), |a| a.password_hash.clone());
        let checked =
            tokio::task::spawn_blocking(move || password_auth::verify_password(credentials.password, &hash));
        let verified = checked.await.is_ok_and(|result| result.is_ok());
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
        let email = self.email.trim();
        if email.is_empty() || !email.contains('@') {
            return Err(ApiError::bad_request("Email is invalid"));
        }
        if self.name.trim().is_empty() {
            return Err(ApiError::bad_request("Name is required"));
        }
        if !PASSWORD_CHARS.contains(&self.password.chars().count()) {
            return Err(ApiError::bad_request("Password must be 8–128 characters"));
        }
        Ok(())
    }
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
    let password = request.password;
    let password_hash = tokio::task::spawn_blocking(move || password_auth::generate_hash(password))
        .await
        .map_err(|_| ApiError::internal())?;
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
    responses((status = 200, body = Account), (status = 401))
)]
pub async fn current(auth: AuthSession) -> Result<Json<Account>, ApiError> {
    let account = auth.user.as_ref().ok_or_else(|| ApiError::unauthorized("Not signed in"))?;
    Ok(Json(Account::from(account)))
}

#[utoipa::path(
    delete,
    path = "/api/auth/session",
    operation_id = "logout",
    responses((status = 204), (status = 401), (status = 500, body = ErrorBody))
)]
pub async fn logout(mut auth: AuthSession) -> Result<StatusCode, ApiError> {
    auth.logout().await?;
    Ok(StatusCode::NO_CONTENT)
}
