//! Viewer accounts (ADR 9): the admin creates them, each with a name and password; a viewer reads
//! live values and history and nothing the admin configures.

use std::time::{Duration, UNIX_EPOCH};

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};

use super::devices::{delete, send};
use super::{Core, get, problem, with_cookie};

impl Core {
    /// The admin adds viewer `name`; returns its id.
    pub(super) async fn viewer(&self, set_cookie: &str, name: &str, password: &str) -> Value {
        let viewer = json!({ "name": name, "password": password });
        let (status, body) = self
            .ask(set_cookie, send("POST", "/api/v1/viewers", &viewer))
            .await;
        assert_eq!(status, StatusCode::CREATED, "{body}");
        assert_eq!(body["name"], json!(name));
        body["id"].clone()
    }
}

pub(super) fn login(name: &str, password: &str) -> Request<Body> {
    send(
        "POST",
        "/api/v1/login",
        &json!({ "name": name, "password": password }),
    )
}

#[tokio::test]
async fn a_viewer_signs_in_with_name_and_password_and_reads_live_values() {
    let dir = tempfile::tempdir().unwrap();
    let (core, admin) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    core.viewer(&admin, "grandma", "sunny days").await;

    let viewer = core.sign_in(login("grandma", "sunny days")).await;

    let response = core.send(with_cookie(&viewer, get("/api/v1/live"))).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        problem(
            core.send(with_cookie(&viewer, get("/api/v1/devices")))
                .await
        )
        .await,
        (StatusCode::FORBIDDEN, "auth.forbidden".to_owned())
    );
}

#[tokio::test]
async fn a_viewer_with_a_wrong_password_is_refused_and_backs_off() {
    let dir = tempfile::tempdir().unwrap();
    let (core, admin) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    core.viewer(&admin, "grandma", "sunny days").await;

    assert_eq!(
        problem(core.send(login("grandma", "rainy days")).await).await,
        (StatusCode::UNAUTHORIZED, "auth.credentials".to_owned())
    );
    assert_eq!(
        problem(core.send(login("grandma", "sunny days")).await).await,
        (StatusCode::TOO_MANY_REQUESTS, "auth.backoff".to_owned())
    );
    assert_eq!(
        problem(core.send(login("nobody", "sunny days")).await).await,
        (StatusCode::TOO_MANY_REQUESTS, "auth.backoff".to_owned())
    );
}

#[tokio::test]
async fn an_unknown_viewer_name_is_wrong_credentials() {
    let dir = tempfile::tempdir().unwrap();
    let core = Core::set_up(&dir.path().join("core.sqlite")).await;

    assert_eq!(
        problem(core.send(login("nobody", "correct horse")).await).await,
        (StatusCode::UNAUTHORIZED, "auth.credentials".to_owned())
    );
}

#[tokio::test]
async fn the_admin_lists_viewers_without_their_passwords() {
    let dir = tempfile::tempdir().unwrap();
    let (core, admin) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let grandma = core.viewer(&admin, "grandma", "sunny days").await;
    let tenant = core.viewer(&admin, "tenant", "flat 2").await;

    let (status, body) = core.ask(&admin, get("/api/v1/viewers")).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body,
        json!({ "viewers": [
            { "id": grandma, "name": "grandma" },
            { "id": tenant, "name": "tenant" },
        ] })
    );
}

#[tokio::test]
async fn a_viewer_name_is_taken_once() {
    let dir = tempfile::tempdir().unwrap();
    let (core, admin) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    core.viewer(&admin, "grandma", "sunny days").await;
    let again = json!({ "name": "grandma", "password": "other" });

    let response = core
        .send(with_cookie(&admin, send("POST", "/api/v1/viewers", &again)))
        .await;

    assert_eq!(
        problem(response).await,
        (StatusCode::CONFLICT, "viewer.name".to_owned())
    );
}

#[tokio::test]
async fn a_viewer_needs_a_name_and_a_password_bcrypt_can_hold() {
    let dir = tempfile::tempdir().unwrap();
    let (core, admin) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let add = |viewer: Value| with_cookie(&admin, send("POST", "/api/v1/viewers", &viewer));

    assert_eq!(
        problem(
            core.send(add(json!({ "name": " ", "password": "x" })))
                .await
        )
        .await,
        (StatusCode::UNPROCESSABLE_ENTITY, "viewer.value".to_owned())
    );
    let long = "x".repeat(73);
    assert_eq!(
        problem(
            core.send(add(json!({ "name": "a", "password": long })))
                .await
        )
        .await,
        (StatusCode::UNPROCESSABLE_ENTITY, "auth.password".to_owned())
    );
}

#[tokio::test]
async fn removing_a_viewer_signs_it_out() {
    let dir = tempfile::tempdir().unwrap();
    let (core, admin) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let id = core.viewer(&admin, "grandma", "sunny days").await;
    let viewer = core.sign_in(login("grandma", "sunny days")).await;

    let (status, _) = core
        .ask(&admin, delete(&format!("/api/v1/viewers/{id}")))
        .await;

    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(
        problem(
            core.send(with_cookie(&viewer, get("/api/v1/session")))
                .await
        )
        .await,
        (StatusCode::UNAUTHORIZED, "auth.required".to_owned())
    );
    assert_eq!(
        problem(core.send(login("grandma", "sunny days")).await).await,
        (StatusCode::UNAUTHORIZED, "auth.credentials".to_owned())
    );
    assert_eq!(
        problem(
            core.send(with_cookie(
                &admin,
                delete(&format!("/api/v1/viewers/{id}"))
            ))
            .await
        )
        .await,
        (StatusCode::NOT_FOUND, "viewer.none".to_owned())
    );
}

#[tokio::test]
async fn a_viewer_survives_a_restart() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("core.sqlite");
    let (core, admin) = Core::signed_in(&path).await;
    core.viewer(&admin, "grandma", "sunny days").await;
    drop(core);

    let core = Core::open(&path).await;

    core.sign_in(login("grandma", "sunny days")).await;
}

#[tokio::test]
async fn adding_and_removing_a_viewer_is_in_the_change_log_without_its_password() {
    let dir = tempfile::tempdir().unwrap();
    let (core, admin) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    core.set_clock(UNIX_EPOCH + Duration::from_hours(498_096));
    let id = core.viewer(&admin, "grandma", "sunny days").await;
    core.ask(&admin, delete(&format!("/api/v1/viewers/{id}")))
        .await;

    let (_, log) = core.ask(&admin, get("/api/v1/changes")).await;

    let entry = |action: &str, state: Value| {
        json!({
            "changed": "2026-10-28T00:00:00Z", "appliesFrom": "2026-10-28T00:00:00Z",
            "actor": "admin", "subject": "viewer", "id": id, "action": action, "state": state,
        })
    };
    assert_eq!(
        log,
        json!({ "changes": [
            entry("add", json!({ "id": id, "name": "grandma" })),
            entry("remove", Value::Null),
        ] })
    );
}
