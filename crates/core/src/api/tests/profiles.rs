//! Profile indexes over HTTP (ADR 8): added by the admin, fetched only then or on a check, and a
//! community profile read-only.

use std::time::{Duration, UNIX_EPOCH};

use axum::http::StatusCode;
use serde_json::{Value, json};

use super::devices::{gateway, send};
use super::{Core, get};
use crate::profiles::fake::{Signer, entry};

const INDEX: &str = "https://example.org/index.json";

/// The owner's Deye, published as a community profile `my-deye` by `INDEX`.
/// The bundled Deye's version, which each change to its source bumps.
fn bundled_version() -> String {
    let profile: Value =
        serde_json::from_str(include_str!("../../../../../profiles/deye-sg05lp3.json")).unwrap();
    profile["version"].as_str().unwrap().to_owned()
}

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
        "profiles": [{ "id": "my-deye", "version": bundled_version(), "status": "loaded" }] });
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
        json!({ "key": "battery.max_charge_current", "name": "Max battery charge current",
            "unit": "A", "range": { "min": 0.0, "max": 350.0 }, "step": 1.0,
            "enable": "community" })
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

/// A signed profile `box` at `version` with settings `a` and `b` verified on hardware and `c`
/// not; `a` and `c` reach up to `max`.
fn boxed(version: &str, max: u16) -> Vec<u8> {
    let setting = |key: &str, max: u16, verified: bool| {
        json!({ "key": key, "type": "u16", "range": { "min": 0, "max": max }, "minInterval": 60,
            "recipe": [{ "write": { "register": 108 } }], "readBack": { "register": 108 },
            "verified": verified })
    };
    json!({
        "schema": 1, "id": "box", "name": "box", "manufacturer": "test", "version": version,
        "requires": sunreye_profile::CAPABILITIES, "quantities": [],
        "settings": [setting("a", max, true), setting("b", 100, true), setting("c", max, false)],
    })
    .to_string()
    .into_bytes()
}

/// Lists `box` at `version` in the signed index `INDEX`.
fn publish(core: &Core, signer: &Signer, version: &str, max: u16) {
    let file = format!("https://example.org/box-{version}.json");
    let profile = boxed(version, max);
    let index = json!({ "profiles": [entry(&profile, &file, Some(&signer.active))] });
    core.host.serve(&file, profile);
    core.host.serve(INDEX, index.to_string());
}

/// A core trusting `signer`, with device `box` behind a gateway nothing listens on.
struct Boxed {
    core: Core,
    set_cookie: String,
    signer: Signer,
    device: Value,
    _dir: tempfile::TempDir,
}

impl Boxed {
    async fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let signer = Signer::default();
        let core = Core::trusting(&dir.path().join("core.sqlite"), None, Some(signer.keys())).await;
        core.send(super::post("/api/v1/setup", "correct horse"))
            .await;
        let set_cookie = core
            .sign_in(super::post("/api/v1/login", "correct horse"))
            .await;
        publish(&core, &signer, "1.0.0", 350);
        core.ask(
            &set_cookie,
            send("POST", "/api/v1/profile-indexes", &json!({ "url": INDEX })),
        )
        .await;
        let connection = core.connection(&set_cookie, &gateway()).await;
        let device = json!({ "name": "box", "connection": connection, "profile": "box",
            "unit": 1, "writes": true });
        let (_, device) = core
            .ask(&set_cookie, send("POST", "/api/v1/devices", &device))
            .await;
        Self {
            core,
            set_cookie,
            signer,
            device: device["id"].clone(),
            _dir: dir,
        }
    }

    async fn ask(&self, method: &str, uri: &str) -> (StatusCode, Value) {
        let request = if method == "GET" {
            get(uri)
        } else {
            send(method, uri, &json!({}))
        };
        self.core.ask(&self.set_cookie, request).await
    }

    async fn enable(&self, key: &str) {
        let uri = format!("/api/v1/devices/{}/settings/{key}/enabled", self.device);
        assert_eq!(self.ask("PUT", &uri).await.0, StatusCode::NO_CONTENT);
    }

    async fn enables(&self) -> Vec<Value> {
        let (_, body) = self.ask("GET", "/api/v1/capabilities").await;
        let settings = body["devices"][self.device.to_string()]["settings"].clone();
        let settings = settings.as_array().unwrap().iter();
        settings.map(|s| s["enable"].clone()).collect()
    }
}

#[tokio::test]
async fn a_checked_update_changes_nothing_until_the_admin_reviews_and_applies_it() {
    let plant = Boxed::new().await;
    plant.enable("c").await;
    assert_eq!(
        plant.enables().await,
        [json!("verified"), json!("verified"), json!("on")]
    );
    publish(&plant.core, &plant.signer, "1.1.0", 400);

    plant.ask("POST", "/api/v1/profile-indexes/check").await;

    assert_eq!(
        plant.enables().await,
        [json!("verified"), json!("verified"), json!("on")]
    );
    let (status, updates) = plant.ask("GET", "/api/v1/profile-updates").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        updates["updates"][0]["settings"][0],
        json!({ "key": "a", "change": "changed",
            "before": { "range": { "min": 0.0, "max": 350.0 }, "step": 1.0 },
            "after": { "range": { "min": 0.0, "max": 400.0 }, "step": 1.0 } })
    );
    assert_eq!(updates["updates"][0]["settings"][1]["key"], "c");
}

#[tokio::test]
async fn an_applied_update_switches_off_each_setting_it_changed_until_re_enabled() {
    let plant = Boxed::new().await;
    plant.enable("c").await;
    publish(&plant.core, &plant.signer, "1.1.0", 400);
    plant.ask("POST", "/api/v1/profile-indexes/check").await;

    let (status, applied) = plant.ask("POST", "/api/v1/profile-updates/box").await;

    assert_eq!((status, &applied["to"]), (StatusCode::OK, &json!("1.1.0")));
    assert_eq!(
        plant.enables().await,
        [json!("off"), json!("verified"), json!("off")]
    );
    let (_, updates) = plant.ask("GET", "/api/v1/profile-updates").await;
    assert_eq!(updates, json!({ "updates": [] }));
    let (_, log) = plant.ask("GET", "/api/v1/changes").await;
    let entry = log["changes"].as_array().unwrap().last().unwrap().clone();
    assert_eq!(
        (&entry["subject"], &entry["action"], &entry["state"]),
        (
            &json!("profile"),
            &json!("change"),
            &json!({ "id": "box", "version": "1.1.0" })
        )
    );
    plant.enable("a").await;
    assert_eq!(
        plant.enables().await,
        [json!("on"), json!("verified"), json!("off")]
    );
    assert_eq!(
        plant.ask("POST", "/api/v1/profile-updates/box").await.1["code"],
        "update.none"
    );
}
