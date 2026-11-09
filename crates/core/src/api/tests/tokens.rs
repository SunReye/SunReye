//! Bearer tokens (ADR 9): scoped `read` or `admin`, shown once, stored only as a hash.

use std::time::{Duration, UNIX_EPOCH};

use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use serde_json::{Value, json};

use super::devices::{delete, send};
use super::{Core, get, problem, with_cookie};

impl Core {
    /// The admin creates token `name` of `scope`; returns its id and the token.
    pub(super) async fn token(&self, set_cookie: &str, name: &str, scope: &str) -> (Value, String) {
        let token = json!({ "name": name, "scope": scope });
        let (status, body) = self
            .ask(set_cookie, send("POST", "/api/v1/tokens", &token))
            .await;
        assert_eq!(status, StatusCode::CREATED, "{body}");
        assert_eq!(
            (&body["name"], &body["scope"]),
            (&json!(name), &json!(scope))
        );
        (
            body["id"].clone(),
            body["token"].as_str().unwrap().to_owned(),
        )
    }
}

pub(super) fn bearer(token: &str, mut request: Request<Body>) -> Request<Body> {
    let value = format!("Bearer {token}").parse().unwrap();
    request.headers_mut().insert(header::AUTHORIZATION, value);
    request
}

#[tokio::test]
async fn a_read_token_reads_live_values_and_nothing_the_admin_configures() {
    let dir = tempfile::tempdir().unwrap();
    let (core, admin) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let (_, token) = core.token(&admin, "evcc", "read").await;

    let response = core.send(bearer(&token, get("/api/v1/live"))).await;

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        problem(core.send(bearer(&token, get("/api/v1/devices"))).await).await,
        (StatusCode::FORBIDDEN, "auth.forbidden".to_owned())
    );
}

#[tokio::test]
async fn an_admin_token_configures() {
    let dir = tempfile::tempdir().unwrap();
    let (core, admin) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let (_, token) = core.token(&admin, "script", "admin").await;

    let response = core.send(bearer(&token, get("/api/v1/devices"))).await;

    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn a_token_is_shown_once_and_listed_without_it() {
    let dir = tempfile::tempdir().unwrap();
    let (core, admin) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let (id, token) = core.token(&admin, "evcc", "read").await;
    assert_eq!(token.len(), 64);

    let (status, body) = core.ask(&admin, get("/api/v1/tokens")).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body,
        json!({ "tokens": [{ "id": id, "name": "evcc", "scope": "read" }] })
    );
}

#[tokio::test]
async fn the_database_holds_only_a_tokens_hash() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("core.sqlite");
    let (core, admin) = Core::signed_in(&path).await;
    let (_, token) = core.token(&admin, "evcc", "read").await;
    drop(core);

    for file in std::fs::read_dir(dir.path()).unwrap() {
        let bytes = std::fs::read(file.unwrap().path()).unwrap();
        assert!(
            !bytes
                .windows(token.len())
                .any(|window| window == token.as_bytes()),
            "the token is stored"
        );
    }
    let core = Core::open(&path).await;
    let response = core.send(bearer(&token, get("/api/v1/live"))).await;
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn a_removed_or_unknown_token_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let (core, admin) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let (id, token) = core.token(&admin, "evcc", "read").await;
    let remove = || with_cookie(&admin, delete(&format!("/api/v1/tokens/{id}")));

    assert_eq!(core.send(remove()).await.status(), StatusCode::NO_CONTENT);

    for token in [token.as_str(), "0123"] {
        assert_eq!(
            problem(core.send(bearer(token, get("/api/v1/live"))).await).await,
            (StatusCode::UNAUTHORIZED, "auth.required".to_owned())
        );
    }
    assert_eq!(
        problem(core.send(remove()).await).await,
        (StatusCode::NOT_FOUND, "token.none".to_owned())
    );
}

#[tokio::test]
async fn a_token_needs_a_name_and_a_known_scope() {
    let dir = tempfile::tempdir().unwrap();
    let (core, admin) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let add = |token: Value| with_cookie(&admin, send("POST", "/api/v1/tokens", &token));

    assert_eq!(
        problem(core.send(add(json!({ "name": "", "scope": "read" }))).await).await,
        (StatusCode::UNPROCESSABLE_ENTITY, "token.value".to_owned())
    );
    assert_eq!(
        problem(
            core.send(add(json!({ "name": "x", "scope": "root" })))
                .await
        )
        .await,
        (StatusCode::BAD_REQUEST, "request.body".to_owned())
    );
}

#[tokio::test]
async fn creating_and_removing_a_token_is_in_the_change_log_without_the_token() {
    let dir = tempfile::tempdir().unwrap();
    let (core, admin) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    core.set_clock(UNIX_EPOCH + Duration::from_hours(498_096));
    let (id, _) = core.token(&admin, "evcc", "read").await;
    core.ask(&admin, delete(&format!("/api/v1/tokens/{id}")))
        .await;

    let (_, log) = core.ask(&admin, get("/api/v1/changes")).await;

    let entry = |action: &str, state: Value| {
        json!({
            "changed": "2026-10-28T00:00:00Z", "appliesFrom": "2026-10-28T00:00:00Z",
            "actor": "admin", "subject": "token", "id": id, "action": action, "state": state,
        })
    };
    assert_eq!(
        log,
        json!({ "changes": [
            entry("add", json!({ "id": id, "name": "evcc", "scope": "read" })),
            entry("remove", Value::Null),
        ] })
    );
}
