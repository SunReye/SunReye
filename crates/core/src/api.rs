//! The HTTP API (ADR 9). Every route is registered with its OpenAPI description, so the document
//! served at `/openapi.json` cannot miss one.

use axum::Json;
use axum::Router;
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use serde::Serialize;
use utoipa::{OpenApi, ToSchema};
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::auth::Auth;
use crate::transport::Endpoint;

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
    let protected = OpenApiRouter::with_openapi(Document::openapi()).routes(routes!(capabilities));
    let (router, document) = auth.routes(protected).split_for_parts();
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

/// What this core supports (ADR 9). The schemas and capabilities are the profile crate's table,
/// the one its WASM build reports.
#[derive(Serialize, ToSchema)]
struct Support {
    /// The core's version.
    version: &'static str,
    /// The profile schemas this core loads.
    schema: Schemas,
    /// The bindings, decoders and computed quantities a profile may require.
    capabilities: &'static [&'static str],
    transports: &'static [&'static str],
}

/// An inclusive range of profile schemas.
#[derive(Serialize, ToSchema)]
struct Schemas {
    min: u32,
    max: u32,
}

#[utoipa::path(get, path = "/api/v1/capabilities", responses(
    (status = 200, body = Support),
    (status = 401, body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn capabilities() -> Json<Support> {
    let support = sunreye_profile::SUPPORT;
    Json(Support {
        version: env!("CARGO_PKG_VERSION"),
        schema: Schemas {
            min: support.schema.min,
            max: support.schema.max,
        },
        capabilities: support.capabilities,
        transports: Endpoint::TRANSPORTS,
    })
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
