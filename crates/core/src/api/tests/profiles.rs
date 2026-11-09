//! Profile indexes over HTTP (ADR 8): added by the admin, fetched only then or on a check, and a
//! community profile read-only.

use std::time::{Duration, UNIX_EPOCH};

use axum::http::StatusCode;
use serde_json::{Value, json};

use super::devices::{gateway, send};
use super::{Core, get};
use crate::profiles::fake::entry;

const INDEX: &str = "https://example.org/index.json";

/// The owner's Deye, published as a community profile `my-deye` by `INDEX`.
fn community(core: &Core) {
    let profile = include_str!("../../../../../profiles/deye-sg05lp3.json")
        .replace("\"deye-sg05lp3\"", "\"my-deye\"")
        .into_bytes();
    let index = json!({ "profiles": [entry(&profile, "my-deye.json", None)] });
    core.host.serve("https://example.org/my-deye.json", profile);
    core.host.serve(INDEX, index.to_string());
}

#[tokio::test]
async fn the_admin_adds_an_index_which_is_fetched_listed_and_logged() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    core.set_clock(UNIX_EPOCH + Duration::from_hours(498_384));
    community(&core);

    let (status, report) = core
        .ask(
            &set_cookie,
            send("POST", "/api/v1/profile-indexes", &json!({ "url": INDEX })),
        )
        .await;

    let added = json!({ "url": INDEX, "official": false, "checked": true, "problem": null,
        "profiles": [{ "id": "my-deye", "version": "2.2.1", "status": "loaded" }] });
    assert_eq!((status, &report), (StatusCode::OK, &added));
    let (_, listed) = core.ask(&set_cookie, get("/api/v1/profile-indexes")).await;
    assert_eq!(listed["indexes"][1], added);
    let (_, log) = core.ask(&set_cookie, get("/api/v1/changes")).await;
    assert_eq!(
        log["changes"][0],
        json!({ "changed": "2026-11-09T00:00:00Z", "appliesFrom": "2026-11-09T00:00:00Z",
            "actor": "admin", "subject": "index", "id": 1, "action": "add",
            "state": { "url": INDEX } })
    );
}

#[tokio::test]
async fn checking_for_updates_fetches_every_index_and_nothing_else_does() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    assert_eq!(core.host.fetched(), Vec::<String>::new());

    let (status, body) = core
        .ask(
            &set_cookie,
            send("POST", "/api/v1/profile-indexes/check", &json!({})),
        )
        .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["indexes"][0]["problem"], "unreachable");
    assert_eq!(
        core.host.fetched(),
        vec![crate::profiles::OFFICIAL_INDEX.to_owned()]
    );
}

#[tokio::test]
async fn a_setting_of_a_community_profile_is_not_written() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    community(&core);
    core.ask(
        &set_cookie,
        send("POST", "/api/v1/profile-indexes", &json!({ "url": INDEX })),
    )
    .await;
    let gateway = json!({ "name": "gateway", "transport": "modbus-tcp", "host": "127.0.0.1",
        "port": 1 });
    let connection = core.connection(&set_cookie, &gateway).await;
    let device = json!({ "name": "Deye", "connection": connection, "profile": "my-deye",
        "unit": 1, "writes": true });
    let (status, device) = core
        .ask(&set_cookie, send("POST", "/api/v1/devices", &device))
        .await;
    assert_eq!(status, StatusCode::CREATED, "{device}");

    let uri = format!(
        "/api/v1/devices/{}/settings/battery.max_charge_current",
        device["id"]
    );
    let (status, body) = core
        .ask(&set_cookie, send("PUT", &uri, &json!({ "value": 50 })))
        .await;

    assert_eq!(
        (status, &body["code"]),
        (StatusCode::CONFLICT, &json!("setting.community"))
    );
}

#[tokio::test]
async fn a_community_setting_is_enabled_one_by_one_with_its_bounds_shown() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    community(&core);
    core.ask(
        &set_cookie,
        send("POST", "/api/v1/profile-indexes", &json!({ "url": INDEX })),
    )
    .await;
    let connection = core.connection(&set_cookie, &gateway()).await;
    let device = json!({ "name": "Deye", "connection": connection, "profile": "my-deye",
        "unit": 1, "writes": true });
    let (_, device) = core
        .ask(&set_cookie, send("POST", "/api/v1/devices", &device))
        .await;
    let settings = async || {
        let (_, body) = core.ask(&set_cookie, get("/api/v1/capabilities")).await;
        body["devices"][device["id"].to_string()]["settings"].clone()
    };
    assert_eq!(
        settings().await[0],
        json!({ "key": "battery.max_charge_current", "range": { "min": 0.0, "max": 350.0 },
            "step": 1.0, "enable": "community" })
    );

    let uri = format!(
        "/api/v1/devices/{}/settings/battery.max_charge_current/enabled",
        device["id"]
    );
    let (status, _) = core.ask(&set_cookie, send("PUT", &uri, &json!({}))).await;

    assert_eq!(status, StatusCode::NO_CONTENT);
    let enables: Vec<Value> = settings()
        .await
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["enable"].clone())
        .collect();
    assert_eq!(
        enables,
        [
            json!("on"),
            json!("community"),
            json!("community"),
            json!("community"),
            json!("community"),
        ]
    );
}
