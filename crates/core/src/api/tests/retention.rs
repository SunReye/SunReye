//! Change-point retention (ADR 3): five years until the admin sets it, every change logged
//! (ADR 19).

use axum::http::StatusCode;
use serde_json::json;

use super::devices::send;
use super::{Core, get};

#[tokio::test]
async fn the_admin_shortens_retention_which_is_logged_and_bounds_reprice() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::on_2026_11_09(&dir.path().join("core.sqlite")).await;
    let (status, before) = core.ask(&set_cookie, get("/api/v1/retention")).await;
    assert_eq!((status, before), (StatusCode::OK, json!({ "days": 1827 })));

    let month = json!({ "days": 30 });
    let (status, set) = core
        .ask(&set_cookie, send("PUT", "/api/v1/retention", &month))
        .await;

    assert_eq!((status, &set), (StatusCode::OK, &month));
    let (_, read) = core.ask(&set_cookie, get("/api/v1/retention")).await;
    assert_eq!(read, month);
    let (_, log) = core.ask(&set_cookie, get("/api/v1/changes")).await;
    assert_eq!(
        log,
        json!({ "changes": [{
            "changed": "2026-11-09T00:00:00Z", "appliesFrom": "2026-11-09T00:00:00Z",
            "actor": "admin", "subject": "retention", "id": 0, "action": "change",
            "state": month,
        }] })
    );
    let (status, body) = core
        .ask(
            &set_cookie,
            send(
                "POST",
                "/api/v1/tariff/reprice",
                &super::tariff::weeknights("2026-10-09T23:59:59Z"),
            ),
        )
        .await;
    assert_eq!(
        (status, &body["code"]),
        (StatusCode::UNPROCESSABLE_ENTITY, &json!("tariff.retention"))
    );
}

#[tokio::test]
async fn a_retention_of_no_days_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;

    let (status, body) = core
        .ask(
            &set_cookie,
            send("PUT", "/api/v1/retention", &json!({ "days": 0 })),
        )
        .await;

    assert_eq!(
        (status, &body["code"]),
        (StatusCode::UNPROCESSABLE_ENTITY, &json!("retention.value"))
    );
    let (_, read) = core.ask(&set_cookie, get("/api/v1/retention")).await;
    assert_eq!(read, json!({ "days": 1827 }));
}
