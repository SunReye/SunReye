//! Settings writes (ADR 7): one funnel that validates before the device, writes with function code
//! 16, reads back, and logs every attempt with its actor.

use std::time::{Duration, UNIX_EPOCH};

use axum::http::StatusCode;
use serde_json::{Value, json};

use super::devices::send;
use super::{Core, get};
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

impl Plant {
    async fn new(writes: Writes, on: bool) -> Self {
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
            "failedStep": null, "actor": "admin",
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
