//! The HTTP API (ADR 9). Every route is registered with its OpenAPI description, so the document
//! served at `/openapi.json` cannot miss one.

use axum::Router;
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use serde::Serialize;
use utoipa::{OpenApi, ToSchema};
use utoipa_axum::router::OpenApiRouter;

use crate::auth::Auth;

const ROUTE: Problem = Problem {
    status: StatusCode::NOT_FOUND,
    code: "request.route",
};
const METHOD: Problem = Problem {
    status: StatusCode::METHOD_NOT_ALLOWED,
    code: "request.method",
};

#[derive(OpenApi)]
#[openapi(info(title = "SunReye", version = "1"))]
struct Document;

pub fn router(auth: &Auth) -> Router {
    let (router, document) = auth
        .routes(OpenApiRouter::with_openapi(Document::openapi()))
        .split_for_parts();
    // Serialised once: the document changes only with the build.
    let document = document.to_json().unwrap_or_default();
    router
        .route(
            "/openapi.json",
            get(|| async { ([(header::CONTENT_TYPE, "application/json")], document) }),
        )
        .fallback(|| async { ROUTE })
        .method_not_allowed_fallback(|| async { METHOD })
}

/// A refusal as `application/problem+json` (RFC 9457): a stable code and no localised text.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Problem {
    pub status: StatusCode,
    pub code: &'static str,
}

/// The body of a refusal.
#[derive(Serialize, ToSchema)]
pub struct ProblemDetails {
    /// The HTTP status.
    status: u16,
    /// A stable machine code, such as `auth.required`.
    code: &'static str,
}

impl IntoResponse for Problem {
    fn into_response(self) -> Response {
        let details = ProblemDetails {
            status: self.status.as_u16(),
            code: self.code,
        };
        let mut response = (self.status, axum::Json(details)).into_response();
        response.headers_mut().insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/problem+json"),
        );
        response
    }
}

#[cfg(test)]
mod tests;
