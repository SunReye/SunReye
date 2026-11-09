//! The log buffer over HTTP (ADR 2): the admin reads what the core logged.

use axum::http::StatusCode;
use serde_json::json;
use tracing_subscriber::util::SubscriberInitExt as _;

use super::{Core, get, json, with_cookie};

#[tokio::test]
async fn the_admin_reads_the_lines_logged_oldest_first() {
    let dir = tempfile::tempdir().unwrap();
    let (core, admin) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let subscriber = tracing_subscriber::fmt()
        .with_ansi(false)
        .without_time()
        .with_target(false)
        .with_writer(core.logs.clone())
        .finish();
    let logging = subscriber.set_default();
    tracing::info!("serving");
    tracing::warn!(device = 1, "unreachable");
    drop(logging);

    let response = core.send(with_cookie(&admin, get("/api/v1/logs"))).await;

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        json(response).await,
        json!({ "lines": [" INFO serving", " WARN unreachable device=1"] })
    );
}
