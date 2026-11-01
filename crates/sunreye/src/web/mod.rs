//! The HTTP surface: the onboarding API, its `OpenAPI` document and the SPA, on one origin.

mod assets;
mod inverter;
mod setup;

use std::sync::Arc;

use axum::extract::rejection::JsonRejection;
use axum::extract::{FromRequest, Request};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use serde::Serialize;
use utoipa::openapi::OpenApi as Document;
use utoipa::{OpenApi, ToSchema};
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::run::Core;
use crate::store::StoreError;

#[derive(OpenApi)]
#[openapi(info(title = "SunReye Core API", description = "Monitoring core: onboarding and capabilities."))]
struct ApiDoc;

/// The API routes with their `OpenAPI` document.
fn api() -> (Router<Arc<Core>>, Document) {
    OpenApiRouter::with_openapi(ApiDoc::openapi())
        .routes(routes!(setup::setup_status))
        .routes(routes!(setup::profile_status))
        .routes(routes!(setup::capabilities))
        .routes(routes!(setup::list_profiles))
        .routes(routes!(setup::choose_profile))
        .routes(routes!(inverter::read, inverter::save))
        .routes(routes!(inverter::test))
        .split_for_parts()
}

/// The `OpenAPI` document of every route [`router`] serves under `/api`.
pub fn openapi() -> Document {
    api().1
}

pub fn router(core: Arc<Core>) -> Router {
    let (routes, document) = api();
    let document = Arc::new(document);
    routes
        .route("/openapi/json", get(move || std::future::ready(Json(Arc::clone(&document)))))
        .fallback(get(assets::serve))
        .with_state(core)
}

/// What a failed request answers: `{"error": "..."}` with the status that names the fault.

#[derive(Debug, Serialize, ToSchema)]
pub struct ErrorBody {
    pub error: String,
}

#[derive(Debug)]
pub struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    pub fn bad_request(message: impl Into<String>) -> Self {
        Self { status: StatusCode::BAD_REQUEST, message: message.into() }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(ErrorBody { error: self.message })).into_response()
    }
}

/// A store failure is the core's fault: logged here, answered without its detail.
impl From<StoreError> for ApiError {
    fn from(error: StoreError) -> Self {
        tracing::error!(%error, "store failed while answering a request");
        Self { status: StatusCode::INTERNAL_SERVER_ERROR, message: "internal error".into() }
    }
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

#[cfg(test)]
mod tests;
