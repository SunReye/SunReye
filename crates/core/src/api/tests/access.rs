//! Who reaches which route (ADR 9): every route of the served document is classified, and a
//! viewer or `read` token never reaches an admin route.

use axum::http::{Method, StatusCode};
use serde_json::Value;

use super::tokens::bearer;
use super::{Core, get, json, problem, with_cookie};
use crate::auth::{Access, access};

/// Every operation the served OpenAPI document describes, as `(method, path)`.
async fn operations(core: &Core) -> Vec<(Method, String)> {
    let document = json(core.send(get("/openapi.json")).await).await;
    let Value::Object(paths) = &document["paths"] else {
        panic!("the document has no paths");
    };
    let mut operations = Vec::new();
    for (path, item) in paths {
        for method in item.as_object().unwrap().keys() {
            let method = Method::from_bytes(method.to_ascii_uppercase().as_bytes()).unwrap();
            operations.push((method, path.clone()));
        }
    }
    operations
}

#[tokio::test]
async fn every_route_in_the_openapi_document_is_classified() {
    let dir = tempfile::tempdir().unwrap();
    let core = Core::open(&dir.path().join("core.sqlite")).await;

    let unclassified: Vec<_> = operations(&core)
        .await
        .into_iter()
        .filter(|(method, path)| access(method, path).is_none())
        .collect();

    assert!(unclassified.is_empty(), "unclassified: {unclassified:?}");
}

#[test]
fn an_unknown_route_is_unclassified() {
    assert_eq!(access(&Method::GET, "/api/v1/undocumented"), None);
    assert_eq!(access(&Method::DELETE, "/api/v1/live"), None);
}

#[test]
fn live_values_and_history_are_read_and_configuration_is_admin() {
    for (method, path, expected) in [
        (Method::GET, "/api/v1/live", Access::Read),
        (Method::GET, "/api/v1/devices/{id}/history", Access::Read),
        (Method::GET, "/api/v1/devices", Access::Admin),
        (Method::GET, "/api/v1/connections", Access::Admin),
        (Method::GET, "/api/v1/writes", Access::Admin),
        (Method::POST, "/api/v1/profile-indexes", Access::Admin),
        (
            Method::PUT,
            "/api/v1/devices/{id}/settings/{key}",
            Access::Admin,
        ),
        (Method::POST, "/api/v1/login", Access::Public),
    ] {
        assert_eq!(access(&method, path), Some(expected), "{method} {path}");
    }
}

/// A request to `path` with each parameter filled in.
fn request(method: &Method, path: &str) -> axum::http::Request<axum::body::Body> {
    let uri = path.replace("{id}", "1").replace("{key}", "x");
    let request = axum::http::Request::builder()
        .method(method)
        .uri(uri)
        .body(axum::body::Body::empty())
        .unwrap();
    super::from(super::HOME, request)
}

/// Sends every operation of the document as `who` and checks what each answers.
async fn check_every_route(core: &Core, who: &str, sign: impl Fn(Request) -> Request) {
    for (method, path) in operations(core).await {
        let access = access(&method, &path).unwrap();
        let response = core.send(sign(request(&method, &path))).await;
        let status = response.status();
        match access {
            Access::Admin => assert_eq!(
                problem(response).await,
                (StatusCode::FORBIDDEN, "auth.forbidden".to_owned()),
                "{who} reached {method} {path}"
            ),
            Access::Read | Access::Public => assert!(
                status != StatusCode::UNAUTHORIZED && status != StatusCode::FORBIDDEN,
                "{who} was refused {method} {path}: {status}"
            ),
        }
    }
}

type Request = axum::http::Request<axum::body::Body>;

#[tokio::test]
async fn a_viewer_reaches_every_read_route_and_no_admin_route() {
    let dir = tempfile::tempdir().unwrap();
    let (core, admin) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    core.viewer(&admin, "grandma", "sunny days").await;
    let viewer = core
        .sign_in(super::viewers::login("grandma", "sunny days"))
        .await;

    check_every_route(&core, "a viewer", |request| with_cookie(&viewer, request)).await;
}

#[tokio::test]
async fn a_read_token_reaches_every_read_route_and_no_admin_route() {
    let dir = tempfile::tempdir().unwrap();
    let (core, admin) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let (_, token) = core.token(&admin, "evcc", "read").await;

    check_every_route(&core, "a read token", |request| bearer(&token, request)).await;
}

#[tokio::test]
async fn an_admin_token_reaches_every_route() {
    let dir = tempfile::tempdir().unwrap();
    let (core, admin) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    // Token 1 is the one `DELETE /api/v1/tokens/{id}` removes.
    core.token(&admin, "spare", "read").await;
    let (_, token) = core.token(&admin, "script", "admin").await;

    for (method, path) in operations(&core).await {
        let response = core.send(bearer(&token, request(&method, &path))).await;

        let status = response.status();
        assert!(
            status != StatusCode::UNAUTHORIZED && status != StatusCode::FORBIDDEN,
            "an admin token was refused {method} {path}: {status}"
        );
    }
}
