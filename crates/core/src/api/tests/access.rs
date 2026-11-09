//! Who reaches which route (ADR 9): every route of the served document is classified, and a
//! viewer or `read` token never reaches an admin route.

use axum::http::Method;
use serde_json::Value;

use super::{Core, get, json};
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
