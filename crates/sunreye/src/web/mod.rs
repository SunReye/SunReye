//! The HTTP surface: accounts, the onboarding API, its `OpenAPI` document and the SPA, on one origin.

mod api_keys;
mod assets;
mod auth;
mod busy;
mod devices;
mod forecast;
mod history;
mod import;
mod inverter;
mod kiosk;
mod mqtt;
mod origin;
mod password;
mod plant;
mod profile_sources;
mod reachability;
mod rollup;
mod setup;
mod statistics;
mod time_zone;
mod users;
mod v1;
mod ws;

use std::sync::Arc;

use axum::extract::rejection::{JsonRejection, PathRejection, QueryRejection};
use axum::extract::{FromRequest, FromRequestParts, Path, Query, Request};
use axum::http::request::Parts;
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Extension, Json, Router, middleware};
use axum_login::{AuthManagerLayerBuilder, login_required, permission_required};
use serde::Serialize;
use tower_sessions::cookie::SameSite;
use tower_sessions::{Expiry, SessionManagerLayer};
use utoipa::openapi::OpenApi as Document;
use utoipa::{OpenApi, ToSchema};
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use self::auth::{Accounts, Permission};
pub(crate) use self::import::{Awaiting, PART_FILE, UPLOAD_FILE};
pub use self::import::{UploadDeadline, UploadIdle, UploadLimit};
use self::kiosk::StrangerWait;
pub use self::origin::origin_authority;
pub use self::ws::Limits as LiveLimits;
use crate::run::Core;
use crate::store::StoreError;

#[derive(OpenApi)]
#[openapi(info(
    title = "SunReye Core API",
    description = "Monitoring core: accounts, onboarding and capabilities."
))]
struct ApiDoc;

/// What the startup flags decide about sessions and origins.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Config {
    /// Origins besides the core's own host that may send state-changing requests, e.g. a TLS proxy.
    pub trusted_origins: Vec<String>,
    /// Session cookie only over HTTPS.
    pub secure_cookies: bool,
    /// Fixed in the binary; tests shorten them.
    pub live: LiveLimits,
    pub stranger_wait: StrangerWait,
    pub upload_limit: UploadLimit,
    pub upload_idle: UploadIdle,
    pub upload_deadline: UploadDeadline,
}

/// The API routes with their `OpenAPI` document. Anonymous callers reach the setup gates, the sign-in
/// routes and, with the kiosk view on, the dashboard; `/api/v1` takes an API key instead of a session.
fn api() -> (Router<Arc<Core>>, Document) {
    OpenApiRouter::with_openapi(ApiDoc::openapi())
        .routes(routes!(setup::setup_status))
        .routes(routes!(setup::profile_status))
        .routes(routes!(kiosk::status))
        .routes(routes!(auth::sign_up))
        .routes(routes!(auth::login))
        .routes(routes!(v1::entities))
        .merge(dashboard())
        .merge(signed_in())
        .merge(admin())
        .split_for_parts()
}

/// What the dashboard reads: any session, or anyone while the kiosk view is on. An allow-list: nothing
/// else may join it. `/ws` is here too, outside the `OpenAPI` document.
fn dashboard() -> OpenApiRouter<Arc<Core>> {
    OpenApiRouter::new()
        .routes(routes!(setup::capabilities))
        .routes(routes!(setup::manifest))
        .routes(routes!(plant::sources))
        .routes(routes!(history::recent))
        .routes(routes!(rollup::buckets))
        .route("/ws", get(ws::upgrade))
        .route_layer(middleware::from_fn(kiosk::session_or_kiosk))
}

/// Any session, user or admin.
fn signed_in() -> OpenApiRouter<Arc<Core>> {
    OpenApiRouter::new()
        .routes(routes!(auth::current, auth::logout))
        .routes(routes!(statistics::energy_series))
        .routes(routes!(forecast::raw))
        .routes(routes!(forecast::usable))
        .routes(routes!(forecast::correction))
        .routes(routes!(forecast::weather))
        .route_layer(login_required!(Accounts))
        .route_layer(middleware::map_response(auth::guard_body))
}

/// Settings and accounts: 401 without a session, 403 for an account that is not an admin.
fn admin() -> OpenApiRouter<Arc<Core>> {
    settings()
        .merge(accounts())
        .routes(routes!(import::upload))
        .routes(routes!(import::confirm))
        .routes(routes!(import::discard))
        .route_layer(permission_required!(Accounts, Permission::Admin))
        .route_layer(login_required!(Accounts))
        .route_layer(middleware::map_response(auth::guard_body))
}

fn settings() -> OpenApiRouter<Arc<Core>> {
    OpenApiRouter::new()
        .routes(routes!(setup::list_profiles))
        .routes(routes!(setup::choose_profile))
        .routes(routes!(inverter::read, inverter::save))
        .routes(routes!(inverter::test))
        .routes(routes!(kiosk::switch))
        .merge(plant_settings())
        .merge(profile_settings())
        .merge(roster())
}

fn plant_settings() -> OpenApiRouter<Arc<Core>> {
    OpenApiRouter::new()
        .routes(routes!(forecast::read, forecast::save))
        .routes(routes!(forecast::providers))
        .routes(routes!(time_zone::read, time_zone::save))
        .routes(routes!(mqtt::read, mqtt::save))
}

fn roster() -> OpenApiRouter<Arc<Core>> {
    OpenApiRouter::new()
        .routes(routes!(devices::list, devices::add))
        .routes(routes!(devices::patch, devices::remove))
        .routes(routes!(devices::add_connection))
        .routes(routes!(reachability::probe_connection))
        .routes(routes!(reachability::scan_units))
        .routes(routes!(devices::patch_connection, devices::remove_connection))
}

fn profile_settings() -> OpenApiRouter<Arc<Core>> {
    OpenApiRouter::new()
        .routes(routes!(profile_sources::list, profile_sources::add, profile_sources::remove_source_by_url))
        .routes(routes!(profile_sources::import))
        .routes(routes!(profile_sources::remove))
}

fn accounts() -> OpenApiRouter<Arc<Core>> {
    OpenApiRouter::new()
        .routes(routes!(users::list, users::create))
        .routes(routes!(users::set_role))
        .routes(routes!(users::remove))
        .routes(routes!(api_keys::list, api_keys::create))
        .routes(routes!(api_keys::revoke))
}

/// The `OpenAPI` document of every route [`router`] serves under `/api`.
pub fn openapi() -> Document {
    api().1
}

pub fn router(core: Arc<Core>, config: &Config) -> Router {
    let (routes, document) = api();
    let document = Arc::new(document);
    let sessions = SessionManagerLayer::new(busy::Watched(core.store.sessions()))
        .with_secure(config.secure_cookies)
        .with_same_site(SameSite::Lax)
        .with_http_only(true)
        .with_expiry(Expiry::OnSessionEnd);
    let accounts = AuthManagerLayerBuilder::new(Accounts::new(Arc::clone(&core.store)), sessions).build();
    let trusted: Arc<[String]> = config.trusted_origins.clone().into();
    routes
        .route("/openapi/json", get(move || std::future::ready(Json(Arc::clone(&document)))))
        .fallback(get(assets::serve))
        .layer(Extension(config.live))
        .layer(Extension(config.stranger_wait))
        .layer(Extension((config.upload_limit, config.upload_idle, config.upload_deadline)))
        .layer(accounts)
        .layer(middleware::from_fn(busy::surface))
        .layer(middleware::from_fn_with_state(trusted, origin::refuse_untrusted))
        .with_state(core)
}

/// What a failed request answers: `{"error": "..."}` with the status that names the fault.

#[derive(Debug, Serialize, ToSchema)]
pub struct ErrorBody {
    pub error: String,
    /// The request field the refusal concerns, when the client acts on it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub field: Option<&'static str>,
}

#[derive(Debug)]
pub struct ApiError {
    status: StatusCode,
    message: String,
    field: Option<&'static str>,
    /// Seconds a client waits before it asks again; sent as `Retry-After`.
    retry_after: Option<u32>,
}

/// Seconds a client waits after a busy database: the pool's connection frees within one.
const BUSY_RETRY_AFTER: u32 = 1;

impl ApiError {
    fn new(status: StatusCode, message: impl Into<String>) -> Self {
        Self { status, message: message.into(), field: None, retry_after: None }
    }

    pub fn bad_request(message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, message)
    }

    pub fn unauthorized(message: impl Into<String>) -> Self {
        Self::new(StatusCode::UNAUTHORIZED, message)
    }

    pub fn forbidden(message: impl Into<String>) -> Self {
        Self::new(StatusCode::FORBIDDEN, message)
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(StatusCode::NOT_FOUND, message)
    }

    pub fn payload_too_large(message: impl Into<String>) -> Self {
        Self::new(StatusCode::PAYLOAD_TOO_LARGE, message)
    }

    pub fn unavailable(message: impl Into<String>) -> Self {
        Self::new(StatusCode::SERVICE_UNAVAILABLE, message)
    }

    /// The database cannot answer now: a 503 that says when to ask again.
    pub fn busy() -> Self {
        Self { retry_after: Some(BUSY_RETRY_AFTER), ..Self::unavailable("The database is busy: try again") }
    }

    pub fn conflict(message: impl Into<String>) -> Self {
        Self::new(StatusCode::CONFLICT, message)
    }

    pub fn internal() -> Self {
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, "internal error")
    }

    /// Names the request field the refusal concerns.
    #[must_use]
    pub const fn on(mut self, field: &'static str) -> Self {
        self.field = Some(field);
        self
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let body = Json(ErrorBody { error: self.message, field: self.field });
        match self.retry_after {
            Some(seconds) => {
                (self.status, [(header::RETRY_AFTER, seconds.to_string())], body).into_response()
            }
            None => (self.status, body).into_response(),
        }
    }
}

/// A busy store is a 503 to retry; any other store failure is the core's fault: logged here, answered
/// without its detail.
impl From<StoreError> for ApiError {
    fn from(error: StoreError) -> Self {
        if error.is_busy() { busy(&error) } else { failed(&error) }
    }
}

fn busy(error: &StoreError) -> ApiError {
    tracing::warn!(%error, "store busy while answering a request");
    ApiError::busy()
}

fn failed(error: &StoreError) -> ApiError {
    tracing::error!(%error, "store failed while answering a request");
    ApiError::internal()
}

/// `Json` whose rejection is a 400 in the shape above, so the SPA reads one error format.
#[derive(Debug)]
pub struct ApiJson<T>(pub T);

impl<T, S> FromRequest<S> for ApiJson<T>
where
    Json<T>: FromRequest<S, Rejection = JsonRejection>,
    S: Send + Sync,
{
    type Rejection = ApiError;

    async fn from_request(request: Request, state: &S) -> Result<Self, Self::Rejection> {
        match Json::<T>::from_request(request, state).await {
            Ok(Json(value)) => Ok(Self(value)),
            Err(rejection) => Err(ApiError::bad_request(rejection.body_text())),
        }
    }
}

/// `Path` whose rejection is a 400 in the shape above.
#[derive(Debug)]
pub struct ApiPath<T>(pub T);

impl<T, S> FromRequestParts<S> for ApiPath<T>
where
    Path<T>: FromRequestParts<S, Rejection = PathRejection>,
    S: Send + Sync,
{
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        match Path::<T>::from_request_parts(parts, state).await {
            Ok(Path(value)) => Ok(Self(value)),
            Err(rejection) => Err(ApiError::bad_request(rejection.body_text())),
        }
    }
}

/// `Query` whose rejection is a 400 in the shape above.
#[derive(Debug)]
pub struct ApiQuery<T>(pub T);

impl<T, S> FromRequestParts<S> for ApiQuery<T>
where
    Query<T>: FromRequestParts<S, Rejection = QueryRejection>,
    S: Send + Sync,
{
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        match Query::<T>::from_request_parts(parts, state).await {
            Ok(Query(value)) => Ok(Self(value)),
            Err(rejection) => Err(ApiError::bad_request(rejection.body_text())),
        }
    }
}

#[cfg(test)]
mod tests;
