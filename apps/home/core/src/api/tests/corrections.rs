//! The learned corrections the builder shows beside the scene (ADR 17, 20).

use axum::http::StatusCode;
use serde_json::json;

use super::layout::string;
use super::{Core, get, json, with_cookie};

#[tokio::test]
async fn a_viewer_reads_each_inputs_correction_before_anything_is_learned() {
    let dir = tempfile::tempdir().unwrap();
    let (core, admin) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let module_type = core.module_type(&admin).await;
    core.put_layout(
        &admin,
        "2026-01-01T00:00:00Z",
        &[string(None, "South", &module_type, 1, 0.0)],
    )
    .await;
    core.viewer(&admin, "grandma", "sunny days").await;
    let viewer = core
        .sign_in(super::viewers::login("grandma", "sunny days"))
        .await;

    let response = core
        .send(with_cookie(&viewer, get("/api/v1/corrections")))
        .await;

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        json(response).await,
        json!({ "inputs": [{ "device": 1, "input": 1, "factors": [], "recent": null }] })
    );
}
