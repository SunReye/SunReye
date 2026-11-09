//! Settings writes (ADR 7): one funnel that validates before the device, writes with function code
//! 16, reads back, and logs every attempt with its actor.

use std::time::{Duration, UNIX_EPOCH};

use axum::http::StatusCode;
use serde_json::{Value, json};

use super::devices::{delete, send};
use super::{Core, get, problem};
use crate::transport::fake::{self, Fake, Write, Writes};

const CHARGE: &str = "battery.max_charge_current";

/// A core signed in, with the owner's Deye at unit 1 behind `device`, its writes `on` or off.
struct Plant {
    core: Core,
    set_cookie: String,
    device: Fake,
    id: Value,
    _dir: tempfile::TempDir,
}

/// Every setting the owner's Deye declares; none is verified on hardware.
const SETTINGS: [&str; 5] = [
    CHARGE,
    "battery.max_discharge_current",
    "battery.grid_charge",
    "work_mode",
    "battery.discharge_lock",
];

impl Plant {
    /// The plant with every setting enabled by the admin (ADR 8).
    async fn new(writes: Writes, on: bool) -> Self {
        let plant = Self::bare(writes, on).await;
        for key in SETTINGS {
            assert_eq!(plant.enable("PUT", key).await.0, StatusCode::NO_CONTENT);
        }
        plant
    }

    /// The plant with no setting enabled.
    async fn bare(writes: Writes, on: bool) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
        core.set_clock(UNIX_EPOCH + Duration::from_hours(498_384));
        let device = fake::serve_with(writes).await;
        let gateway = json!({ "name": "gateway", "transport": "modbus-tcp", "host": "127.0.0.1",
            "port": device.address.port() });
        let connection = core.connection(&set_cookie, &gateway).await;
        let deye = json!({ "name": "Deye", "connection": connection, "profile": "deye-sg05lp3",
            "unit": 1, "writes": on });
        let (status, body) = core
            .ask(&set_cookie, send("POST", "/api/v1/devices", &deye))
            .await;
        assert_eq!(status, StatusCode::CREATED, "{body}");
        Self {
            core,
            set_cookie,
            device,
            id: body["id"].clone(),
            _dir: dir,
        }
    }

    /// Enables (`PUT`) or disables (`DELETE`) the writes of setting `key`.
    async fn enable(&self, method: &str, key: &str) -> (StatusCode, Value) {
        let uri = format!("/api/v1/devices/{}/settings/{key}/enabled", self.id);
        let request = if method == "DELETE" {
            delete(&uri)
        } else {
            send(method, &uri, &json!({}))
        };
        self.core.ask(&self.set_cookie, request).await
    }

    async fn capability(&self, key: &str) -> Value {
        let (_, body) = self
            .core
            .ask(&self.set_cookie, get("/api/v1/capabilities"))
            .await;
        let settings = body["devices"][self.id.to_string()]["settings"].clone();
        let found = settings
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["key"] == key);
        found.unwrap().clone()
    }

    async fn write(&self, key: &str, value: Value) -> (StatusCode, Value) {
        self.put(&self.id, key, value).await
    }

    async fn put(&self, device: &Value, key: &str, value: Value) -> (StatusCode, Value) {
        let uri = format!("/api/v1/devices/{device}/settings/{key}");
        let body = json!({ "value": value });
        self.core
            .ask(&self.set_cookie, send("PUT", &uri, &body))
            .await
    }

    async fn log(&self) -> Value {
        let (status, log) = self.core.ask(&self.set_cookie, get("/api/v1/writes")).await;
        assert_eq!(status, StatusCode::OK);
        log["writes"].clone()
    }

    /// The writes the device received so far.
    fn received(&mut self) -> Vec<Write> {
        let mut received = Vec::new();
        while let Ok(write) = self.device.writes.try_recv() {
            received.push(write);
        }
        received
    }

    fn entry(&self, before: &Value, requested: f64, after: &Value, outcome: &str) -> Value {
        json!({
            "time": "2026-11-09T00:00:00Z", "device": self.id, "setting": CHARGE,
            "before": before, "requested": requested, "after": after, "outcome": outcome,
            "failedStep": null, "actor": "admin", "via": null,
        })
    }
}

fn refused(status: StatusCode, code: &str) -> (StatusCode, Value) {
    (status, json!({ "status": status.as_u16(), "code": code }))
}

#[tokio::test]
async fn a_write_is_refused_until_the_devices_writes_are_on() {
    let mut plant = Plant::new(Writes::Store, false).await;

    assert_eq!(
        plant.write(CHARGE, json!(50)).await,
        refused(StatusCode::CONFLICT, "setting.writes-off")
    );
    assert_eq!(plant.received(), []);
    assert_eq!(plant.log().await, json!([]));

    let on = json!({ "name": "Deye", "connection": 1, "profile": "deye-sg05lp3", "unit": 1,
        "writes": true });
    let uri = format!("/api/v1/devices/{}", plant.id);
    let (status, _) = plant
        .core
        .ask(&plant.set_cookie, send("PUT", &uri, &on))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        plant.write(CHARGE, json!(50)).await.1["outcome"],
        "verified"
    );
}

#[tokio::test]
async fn a_write_is_refused_before_the_device_unless_it_is_known_writable_and_in_range() {
    let mut plant = Plant::new(Writes::Store, true).await;

    assert_eq!(
        plant.write("battery.bogus", json!(50)).await,
        refused(StatusCode::NOT_FOUND, "setting.none")
    );
    assert_eq!(
        plant.write("battery.power", json!(50)).await,
        refused(StatusCode::CONFLICT, "setting.read-only")
    );
    for value in [json!(351), json!(-1), json!(12.5)] {
        assert_eq!(
            plant.write(CHARGE, value).await,
            refused(StatusCode::UNPROCESSABLE_ENTITY, "setting.value")
        );
    }
    assert_eq!(
        plant.write("work_mode", json!(3)).await,
        refused(StatusCode::UNPROCESSABLE_ENTITY, "setting.value")
    );
    assert_eq!(
        plant.write(CHARGE, json!("50")).await,
        refused(StatusCode::BAD_REQUEST, "request.body")
    );
    assert_eq!(
        plant.put(&json!(42), CHARGE, json!(50)).await,
        refused(StatusCode::NOT_FOUND, "device.none")
    );

    assert_eq!(plant.received(), []);
    assert_eq!(plant.log().await, json!([]));
}

#[tokio::test]
async fn a_write_with_function_16_is_verified_by_its_read_back_and_logged_with_its_actor() {
    let mut plant = Plant::new(Writes::Store, true).await;

    let (status, written) = plant.write(CHARGE, json!(50)).await;

    assert_eq!(status, StatusCode::OK);
    // Register 108 read 108 before the write.
    let entry = plant.entry(&json!(108.0), 50.0, &json!(50.0), "verified");
    assert_eq!(written, entry);
    assert_eq!(
        plant.received(),
        [Write {
            unit: 1,
            start: 108,
            words: vec![50]
        }]
    );
    assert_eq!(plant.log().await, json!([entry]));
}

#[tokio::test]
async fn a_value_equal_to_the_current_one_is_unchanged_and_not_written() {
    let mut plant = Plant::new(Writes::Store, true).await;

    let (_, written) = plant.write(CHARGE, json!(108)).await;

    let entry = plant.entry(&json!(108.0), 108.0, &Value::Null, "unchanged");
    assert_eq!(written, entry);
    assert_eq!(plant.received(), []);
    assert_eq!(plant.log().await, json!([entry]));
}

#[tokio::test]
async fn a_write_inside_the_minimum_interval_is_refused() {
    let plant = Plant::new(Writes::Store, true).await;
    let start = UNIX_EPOCH + Duration::from_hours(498_384);
    assert_eq!(plant.write(CHARGE, json!(50)).await.0, StatusCode::OK);

    plant.core.set_clock(start + Duration::from_secs(59));
    assert_eq!(
        plant.write(CHARGE, json!(60)).await,
        refused(StatusCode::TOO_MANY_REQUESTS, "setting.interval")
    );
    // Another setting keeps its own interval.
    assert_eq!(plant.write("work_mode", json!(1)).await.0, StatusCode::OK);

    plant.core.set_clock(start + Duration::from_secs(60));
    assert_eq!(
        plant.write(CHARGE, json!(60)).await.1["outcome"],
        "verified"
    );
}

#[tokio::test]
async fn a_device_that_ignores_a_write_is_a_mismatch() {
    let plant = Plant::new(Writes::Ignore, true).await;

    let (status, written) = plant.write(CHARGE, json!(50)).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        written,
        plant.entry(&json!(108.0), 50.0, &json!(108.0), "mismatch")
    );
}

#[tokio::test]
async fn a_timeout_is_unknown_and_never_retried() {
    let mut plant = Plant::new(Writes::Silent, true).await;

    let (_, written) = plant.write(CHARGE, json!(50)).await;

    let mut entry = plant.entry(&json!(108.0), 50.0, &json!(108.0), "unknown");
    entry["failedStep"] = json!(1);
    assert_eq!(written, entry);
    assert_eq!(plant.received().len(), 1);
}

#[tokio::test]
async fn the_write_log_and_every_write_need_the_admins_session() {
    let mut plant = Plant::new(Writes::Store, true).await;
    let uri = format!("/api/v1/devices/{}/settings/{CHARGE}", plant.id);
    let write = send("PUT", &uri, &json!({ "value": 50 }));

    for request in [get("/api/v1/writes"), write] {
        assert_eq!(
            problem(plant.core.send(request).await).await,
            (StatusCode::UNAUTHORIZED, "auth.required".to_owned())
        );
    }
    assert_eq!(plant.received(), []);
    assert_eq!(plant.log().await, json!([]));
}

#[tokio::test]
async fn capabilities_list_each_devices_settings_from_its_profile() {
    let plant = Plant::new(Writes::Store, true).await;

    let (status, body) = plant
        .core
        .ask(&plant.set_cookie, get("/api/v1/capabilities"))
        .await;

    assert_eq!(status, StatusCode::OK);
    let device = &body["devices"][plant.id.to_string()];
    assert_eq!(device["writes"], true);
    assert_eq!(
        device["settings"],
        json!([
            { "key": CHARGE, "name": "Max battery charge current", "unit": "A",
                "range": { "min": 0.0, "max": 350.0 }, "step": 1.0, "enable": "on" },
            { "key": "battery.max_discharge_current", "name": "Max battery discharge current",
                "unit": "A", "range": { "min": 0.0, "max": 350.0 }, "step": 1.0, "enable": "on" },
            { "key": "battery.grid_charge", "name": "Grid charge", "values": [0.0, 1.0],
                "labels": [{ "value": 0.0, "text": "Off" }, { "value": 1.0, "text": "On" }],
                "step": 1.0, "enable": "on" },
            { "key": "work_mode", "name": "Work mode", "values": [0.0, 1.0, 2.0],
                "labels": [
                    { "value": 0.0, "text": "Selling first" },
                    { "value": 1.0, "text": "Zero export to load" },
                    { "value": 2.0, "text": "Zero export to CT" },
                ],
                "step": 1.0, "enable": "on" },
            { "key": "battery.discharge_lock", "name": "Battery discharge lock",
                "values": [0.0, 1.0],
                "labels": [{ "value": 0.0, "text": "Unlocked" }, { "value": 1.0, "text": "Locked" }],
                "step": 1.0, "enable": "on" },
        ])
    );
}

#[tokio::test]
async fn an_unverified_setting_writes_only_while_the_admin_has_it_enabled() {
    let mut plant = Plant::bare(Writes::Store, true).await;
    assert_eq!(
        plant.capability(CHARGE).await,
        json!({ "key": CHARGE, "name": "Max battery charge current", "unit": "A",
            "range": { "min": 0.0, "max": 350.0 }, "step": 1.0, "enable": "off" })
    );
    assert_eq!(
        plant.write(CHARGE, json!(50)).await,
        refused(StatusCode::CONFLICT, "setting.not-enabled")
    );

    assert_eq!(plant.enable("PUT", CHARGE).await.0, StatusCode::NO_CONTENT);
    assert_eq!(plant.capability(CHARGE).await["enable"], "on");
    assert_eq!(
        plant.write(CHARGE, json!(50)).await.1["outcome"],
        "verified"
    );

    assert_eq!(
        plant.enable("DELETE", CHARGE).await.0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(plant.capability(CHARGE).await["enable"], "off");
    plant
        .core
        .set_clock(UNIX_EPOCH + Duration::from_hours(498_385));
    assert_eq!(
        plant.write(CHARGE, json!(60)).await,
        refused(StatusCode::CONFLICT, "setting.not-enabled")
    );
    assert_eq!(plant.received(), [written_charge(50)]);
}

#[tokio::test]
async fn only_a_declared_setting_of_a_known_device_is_enabled() {
    let plant = Plant::bare(Writes::Store, true).await;

    assert_eq!(
        plant.enable("PUT", "battery.bogus").await,
        refused(StatusCode::NOT_FOUND, "setting.none")
    );
    assert_eq!(
        plant.enable("PUT", "battery.power").await,
        refused(StatusCode::CONFLICT, "setting.read-only")
    );
    let uri = format!("/api/v1/devices/42/settings/{CHARGE}/enabled");
    let (status, body) = plant
        .core
        .ask(&plant.set_cookie, send("PUT", &uri, &json!({})))
        .await;
    assert_eq!(
        (status, body),
        refused(StatusCode::NOT_FOUND, "device.none")
    );
}

fn written_charge(value: u16) -> Write {
    Write {
        unit: 1,
        start: 108,
        words: vec![value],
    }
}

const LOCK: &str = "battery.discharge_lock";
const DISCHARGE: &str = "battery.max_discharge_current";

/// The write log entry of a write to the lock's target.
fn discharge(before: &Value, requested: f64, after: &Value, outcome: &str, plant: &Plant) -> Value {
    let mut entry = plant.entry(before, requested, after, outcome);
    entry["setting"] = json!(DISCHARGE);
    entry
}

fn written(value: u16) -> Write {
    Write {
        unit: 1,
        start: 109,
        words: vec![value],
    }
}

#[tokio::test]
async fn the_discharge_lock_writes_zero_and_its_release_restores_the_value_it_held() {
    let mut plant = Plant::new(Writes::Store, true).await;
    let start = UNIX_EPOCH + Duration::from_hours(498_384);

    // Register 109 holds 109 before the lock.
    let (status, engaged) = plant.write(LOCK, json!(1)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        engaged,
        discharge(&json!(109.0), 0.0, &json!(0.0), "verified", &plant)
    );
    assert_eq!(plant.received(), [written(0)]);

    plant.core.set_clock(start + Duration::from_secs(60));
    let (status, released) = plant.write(LOCK, json!(0)).await;
    assert_eq!(status, StatusCode::OK);
    let mut restored = discharge(&json!(0.0), 109.0, &json!(109.0), "verified", &plant);
    restored["time"] = json!("2026-11-09T00:01:00Z");
    assert_eq!(released, restored);
    assert_eq!(plant.received(), [written(109)]);
    assert_eq!(plant.log().await, json!([engaged, released]));
}

#[tokio::test]
async fn releasing_the_lock_with_no_stored_value_is_refused_before_the_device() {
    let mut plant = Plant::new(Writes::Store, true).await;

    assert_eq!(
        plant.write(LOCK, json!(0)).await,
        refused(StatusCode::CONFLICT, "setting.no-snapshot")
    );
    assert_eq!(
        plant.write(LOCK, json!(2)).await,
        refused(StatusCode::UNPROCESSABLE_ENTITY, "setting.value")
    );
    assert_eq!(plant.received(), []);
    assert_eq!(plant.log().await, json!([]));
}

#[tokio::test]
async fn a_verified_release_clears_the_stored_value_and_a_second_release_is_refused() {
    let plant = Plant::new(Writes::Store, true).await;
    let start = UNIX_EPOCH + Duration::from_hours(498_384);
    assert_eq!(plant.write(LOCK, json!(1)).await.0, StatusCode::OK);
    plant.core.set_clock(start + Duration::from_secs(60));
    assert_eq!(plant.write(LOCK, json!(0)).await.1["outcome"], "verified");

    plant.core.set_clock(start + Duration::from_secs(120));
    assert_eq!(
        plant.write(LOCK, json!(0)).await,
        refused(StatusCode::CONFLICT, "setting.no-snapshot")
    );
}

#[tokio::test]
async fn engaging_an_engaged_lock_keeps_the_value_stored_first() {
    let mut plant = Plant::new(Writes::Store, true).await;
    let start = UNIX_EPOCH + Duration::from_hours(498_384);
    assert_eq!(plant.write(LOCK, json!(1)).await.0, StatusCode::OK);

    plant.core.set_clock(start + Duration::from_secs(60));
    // The target already holds 0: nothing is written, and 0 is not stored over 109.
    assert_eq!(plant.write(LOCK, json!(1)).await.1["outcome"], "unchanged");
    plant.core.set_clock(start + Duration::from_secs(120));
    assert_eq!(plant.write(LOCK, json!(0)).await.1["requested"], 109.0);
    assert_eq!(plant.received(), [written(0), written(109)]);
}

#[tokio::test]
async fn the_value_is_stored_before_the_write_so_a_lock_that_never_answered_still_releases() {
    let mut plant = Plant::new(Writes::Silent, true).await;
    let start = UNIX_EPOCH + Duration::from_hours(498_384);

    assert_eq!(plant.write(LOCK, json!(1)).await.1["outcome"], "unknown");

    plant.core.set_clock(start + Duration::from_secs(60));
    // The silent device kept 109, so restoring it writes nothing.
    let (status, released) = plant.write(LOCK, json!(0)).await;
    assert_eq!(status, StatusCode::OK);
    let mut restored = discharge(&json!(109.0), 109.0, &Value::Null, "unchanged", &plant);
    restored["time"] = json!("2026-11-09T00:01:00Z");
    assert_eq!(released, restored);
    assert_eq!(plant.received(), [written(0)]);
}

#[tokio::test]
async fn a_release_the_device_ignores_keeps_the_stored_value_for_a_retry() {
    let mut plant = Plant::new(Writes::First, true).await;
    let start = UNIX_EPOCH + Duration::from_hours(498_384);
    assert_eq!(plant.write(LOCK, json!(1)).await.1["outcome"], "verified");

    for minute in 1..=2 {
        plant.core.set_clock(start + Duration::from_mins(minute));
        let (status, released) = plant.write(LOCK, json!(0)).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            (&released["requested"], &released["outcome"]),
            (&json!(109.0), &json!("mismatch"))
        );
    }
    assert_eq!(plant.received(), [written(0), written(109), written(109)]);
}
