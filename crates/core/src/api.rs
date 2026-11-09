//! The HTTP API (ADR 9).

use axum::Router;
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde::Serialize;

use crate::auth::Auth;

pub fn router(auth: &Auth) -> Router {
    auth.routes(Router::new())
}

/// A refusal as `application/problem+json` (RFC 9457): a stable code and no localised text.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Problem {
    pub status: StatusCode,
    pub code: &'static str,
}

#[derive(Serialize)]
struct Document {
    status: u16,
    code: &'static str,
}

impl IntoResponse for Problem {
    fn into_response(self) -> Response {
        let document = Document {
            status: self.status.as_u16(),
            code: self.code,
        };
        let mut response = (self.status, axum::Json(document)).into_response();
        response.headers_mut().insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/problem+json"),
        );
        response
    }
}

#[cfg(test)]
mod tests;
