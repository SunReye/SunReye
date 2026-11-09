//! The bidding zone the spot-price device fetches for (ADR 12): none until the admin chooses one,
//! every change logged (ADR 19).

use std::time::{Duration, UNIX_EPOCH};

use axum::http::StatusCode;
use serde_json::json;

use super::devices::send;
use super::{Core, get};

#[tokio::test]
async fn the_admin_chooses_and_clears_the_bidding_zone_which_is_logged() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    core.set_clock(UNIX_EPOCH + Duration::from_hours(498_384));
    let (status, before) = core.ask(&set_cookie, get("/api/v1/spot-prices")).await;
    assert_eq!((status, before), (StatusCode::OK, json!({ "zone": null })));

    let de_lu = json!({ "zone": "DE-LU" });
    let (status, set) = core
        .ask(&set_cookie, send("PUT", "/api/v1/spot-prices", &de_lu))
        .await;
    assert_eq!((status, &set), (StatusCode::OK, &de_lu));
    let (_, read) = core.ask(&set_cookie, get("/api/v1/spot-prices")).await;
    assert_eq!(read, de_lu);

    let none = json!({ "zone": null });
    let (status, cleared) = core
        .ask(&set_cookie, send("PUT", "/api/v1/spot-prices", &none))
        .await;
    assert_eq!((status, &cleared), (StatusCode::OK, &none));
    let (_, read) = core.ask(&set_cookie, get("/api/v1/spot-prices")).await;
    assert_eq!(read, none);
    let (_, log) = core.ask(&set_cookie, get("/api/v1/changes")).await;
    let entry = |state| {
        json!({
            "changed": "2026-11-09T00:00:00Z", "appliesFrom": "2026-11-09T00:00:00Z",
            "actor": "admin", "subject": "spot", "id": 0, "action": "change", "state": state,
        })
    };
    assert_eq!(log, json!({ "changes": [entry(de_lu), entry(none)] }));
}

#[tokio::test]
async fn a_bidding_zone_the_core_has_no_source_for_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;

    let (status, body) = core
        .ask(
            &set_cookie,
            send("PUT", "/api/v1/spot-prices", &json!({ "zone": "AT" })),
        )
        .await;

    assert_eq!(
        (status, &body["code"]),
        (StatusCode::BAD_REQUEST, &json!("request.body"))
    );
    let (_, read) = core.ask(&set_cookie, get("/api/v1/spot-prices")).await;
    assert_eq!(read, json!({ "zone": null }));
}
