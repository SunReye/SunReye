//! The plant timezone (ADR 3): the host's until the admin sets one, every change logged (ADR 19).

use std::time::{Duration, UNIX_EPOCH};

use axum::http::StatusCode;
use serde_json::json;

use super::devices::send;
use super::{Core, get};

#[tokio::test]
async fn the_admin_sets_the_plant_timezone_which_is_logged() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    core.set_clock(UNIX_EPOCH + Duration::from_hours(498_384));
    let (status, before) = core.ask(&set_cookie, get("/api/v1/timezone")).await;
    // The test core opens on UTC, as a host without a zone does.
    assert_eq!((status, before), (StatusCode::OK, json!({ "name": "UTC" })));

    let berlin = json!({ "name": "Europe/Berlin" });
    let (status, set) = core
        .ask(&set_cookie, send("PUT", "/api/v1/timezone", &berlin))
        .await;

    assert_eq!((status, &set), (StatusCode::OK, &berlin));
    let (_, read) = core.ask(&set_cookie, get("/api/v1/timezone")).await;
    assert_eq!(read, berlin);
    let (_, log) = core.ask(&set_cookie, get("/api/v1/changes")).await;
    assert_eq!(
        log,
        json!({ "changes": [{
            "changed": "2026-11-09T00:00:00Z", "appliesFrom": "2026-11-09T00:00:00Z",
            "actor": "admin", "subject": "zone", "id": 0, "action": "change",
            "state": berlin,
        }] })
    );
}

#[tokio::test]
async fn a_zone_the_core_does_not_know_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;

    let (status, body) = core
        .ask(
            &set_cookie,
            send(
                "PUT",
                "/api/v1/timezone",
                &json!({ "name": "Mars/Olympus" }),
            ),
        )
        .await;

    assert_eq!(
        (status, &body["code"]),
        (StatusCode::UNPROCESSABLE_ENTITY, &json!("zone.value"))
    );
    let (_, read) = core.ask(&set_cookie, get("/api/v1/timezone")).await;
    assert_eq!(read, json!({ "name": "UTC" }));
}
