//! The plant's location (ADR 17): set by the admin, stored to 0.01°, every change logged (ADR 19).

use std::time::{Duration, UNIX_EPOCH};

use axum::http::StatusCode;
use serde_json::json;

use super::devices::send;
use super::{Core, get};

#[tokio::test]
async fn the_admin_sets_the_location_which_is_stored_to_a_hundredth_of_a_degree_and_logged() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    core.set_clock(UNIX_EPOCH + Duration::from_hours(498_384));
    let (status, body) = core.ask(&set_cookie, get("/api/v1/location")).await;
    assert_eq!(
        (status, &body["code"]),
        (StatusCode::NOT_FOUND, &json!("location.none"))
    );

    let berlin = json!({ "latitude": 52.516_3, "longitude": 13.377_7 });
    let (status, set) = core
        .ask(&set_cookie, send("PUT", "/api/v1/location", &berlin))
        .await;

    let rounded = json!({ "latitude": 52.52, "longitude": 13.38 });
    assert_eq!((status, &set), (StatusCode::OK, &rounded));
    let (status, read) = core.ask(&set_cookie, get("/api/v1/location")).await;
    assert_eq!((status, read), (StatusCode::OK, rounded.clone()));
    let (_, log) = core.ask(&set_cookie, get("/api/v1/changes")).await;
    assert_eq!(
        log,
        json!({ "changes": [{
            "changed": "2026-11-09T00:00:00Z", "appliesFrom": "2026-11-09T00:00:00Z",
            "actor": "admin", "subject": "location", "id": 0, "action": "change",
            "state": rounded,
        }] })
    );
}

#[tokio::test]
async fn a_location_off_the_globe_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;

    for off in [
        json!({ "latitude": 90.5, "longitude": 0.0 }),
        json!({ "latitude": 0.0, "longitude": -180.5 }),
    ] {
        let (status, body) = core
            .ask(&set_cookie, send("PUT", "/api/v1/location", &off))
            .await;
        assert_eq!(
            (status, &body["code"]),
            (StatusCode::UNPROCESSABLE_ENTITY, &json!("location.value"))
        );
    }
    let (status, _) = core.ask(&set_cookie, get("/api/v1/location")).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}
