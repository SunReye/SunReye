//! Deadband overrides (ADR 4): per device and role, refused below the quantisation step and on
//! counters and enums, and each change in the change log (ADR 19).

use std::time::Duration;

use axum::http::StatusCode;
use serde_json::{Value, json};

use super::devices::{delete, gateway, send};
use super::{Core, get, problem, with_cookie};
use tokio::sync::broadcast;

use crate::bus::{DeviceId, Reading, SeriesId};
use crate::transport::fake;

fn put(device: &Value, role: &str, deadband: f64) -> axum::http::Request<axum::body::Body> {
    send(
        "PUT",
        &format!("/api/v1/devices/{device}/deadbands/{role}"),
        &json!({ "deadband": deadband }),
    )
}

/// The deadband `role` of `device` is stored with, as listed.
async fn listed(core: &Core, set_cookie: &str, device: &Value, role: &str) -> Value {
    let uri = format!("/api/v1/devices/{device}/deadbands");
    let (status, body) = core.ask(set_cookie, get(&uri)).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body["deadbands"]
        .as_array()
        .unwrap()
        .iter()
        .find(|d| d["role"] == role)
        .cloned()
        .unwrap()
}

#[tokio::test]
async fn the_admin_overrides_a_roles_deadband_and_removes_the_override() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let connection = core.connection(&set_cookie, &gateway()).await;
    let device = core.deye(&set_cookie, &connection, 0).await;
    let voltage = |deadband: Value, source: &str| json!({ "role": "battery.voltage", "deadband": deadband, "source": source });
    assert_eq!(
        listed(&core, &set_cookie, &device, "battery.voltage").await,
        voltage(json!(0.5), "default")
    );
    assert_eq!(
        listed(&core, &set_cookie, &device, "battery.mode").await,
        json!({ "role": "battery.mode", "deadband": null, "source": "none" })
    );

    let (status, set) = core
        .ask(&set_cookie, put(&device, "battery.voltage", 0.2))
        .await;

    assert_eq!(status, StatusCode::OK, "{set}");
    assert_eq!(set, voltage(json!(0.2), "override"));
    assert_eq!(
        listed(&core, &set_cookie, &device, "battery.voltage").await,
        voltage(json!(0.2), "override")
    );
    let uri = format!("/api/v1/devices/{device}/deadbands/battery.voltage");
    let (status, _) = core.ask(&set_cookie, delete(&uri)).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(
        listed(&core, &set_cookie, &device, "battery.voltage").await,
        voltage(json!(0.5), "default")
    );
}

#[tokio::test]
async fn each_override_and_its_removal_is_in_the_change_log() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let connection = core.connection(&set_cookie, &gateway()).await;
    let device = core.deye(&set_cookie, &connection, 0).await;
    let uri = format!("/api/v1/devices/{device}/deadbands/battery.voltage");
    core.ask(&set_cookie, put(&device, "battery.voltage", 0.2))
        .await;
    core.ask(&set_cookie, put(&device, "battery.voltage", 0.3))
        .await;
    core.ask(&set_cookie, delete(&uri)).await;
    // Removing no override changes nothing.
    core.ask(&set_cookie, delete(&uri)).await;

    let (_, log) = core.ask(&set_cookie, get("/api/v1/changes")).await;
    let entries: Vec<_> = log["changes"].as_array().unwrap()[2..]
        .iter()
        .map(|e| {
            (
                e["subject"].clone(),
                e["id"].clone(),
                e["action"].clone(),
                e["state"].clone(),
            )
        })
        .collect();
    assert_eq!(
        entries,
        [
            (
                json!("deadband"),
                device.clone(),
                json!("add"),
                json!({ "role": "battery.voltage", "deadband": 0.2 })
            ),
            (
                json!("deadband"),
                device.clone(),
                json!("change"),
                json!({ "role": "battery.voltage", "deadband": 0.3 })
            ),
            (
                json!("deadband"),
                device.clone(),
                json!("remove"),
                json!({ "role": "battery.voltage" })
            ),
        ]
    );
}

#[tokio::test]
async fn an_override_below_the_step_or_on_a_counter_or_enum_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let connection = core.connection(&set_cookie, &gateway()).await;
    let device = core.deye(&set_cookie, &connection, 0).await;
    let refused =
        |request| async { problem(core.send(with_cookie(&set_cookie, request)).await).await };
    let unprocessable = |code: &str| (StatusCode::UNPROCESSABLE_ENTITY, code.to_owned());

    // Battery voltage is read in steps of 0.01 V.
    assert_eq!(
        refused(put(&device, "battery.voltage", 0.005)).await,
        unprocessable("deadband.step")
    );
    assert_eq!(
        refused(put(&device, "pv.energy.total", 1.0)).await,
        unprocessable("deadband.kind")
    );
    assert_eq!(
        refused(put(&device, "battery.mode", 1.0)).await,
        unprocessable("deadband.kind")
    );
    assert_eq!(
        refused(put(&device, "heat.energy.total", 1.0)).await,
        (StatusCode::NOT_FOUND, "deadband.role".to_owned())
    );
    assert_eq!(
        refused(put(&json!(42), "battery.voltage", 1.0)).await,
        (StatusCode::NOT_FOUND, "device.none".to_owned())
    );
    let (_, log) = core.ask(&set_cookie, get("/api/v1/changes")).await;
    assert_eq!(log["changes"].as_array().unwrap().len(), 2);
}

/// The first reading of `series`.
async fn first(readings: &mut broadcast::Receiver<Reading>, series: SeriesId) -> Reading {
    loop {
        let reading = readings.recv().await.unwrap();
        if reading.series == series {
            return reading;
        }
    }
}

#[tokio::test]
async fn a_changed_deadband_writes_the_pending_change_points() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let fake = fake::serve().await;
    let mut readings = core.bus.subscribe();
    let gateway = json!({ "name": "gateway", "transport": "modbus-tcp", "host": "127.0.0.1",
        "port": fake.address.port() });
    let connection = core.connection(&set_cookie, &gateway).await;
    let device = core.deye(&set_cookie, &connection, 0).await;
    let voltage = core.bus.intern("battery.voltage", None);
    let read = tokio::time::timeout(Duration::from_secs(20), first(&mut readings, voltage))
        .await
        .unwrap();
    // Offered again, so storage holds it before the change whatever the bus's pace; a repeat
    // of its instant is not stored twice.
    core.storage.record(read).await.unwrap();

    let (status, _) = core
        .ask(&set_cookie, put(&device, "battery.voltage", 0.2))
        .await;

    assert_eq!(status, StatusCode::OK);
    let id = DeviceId(u32::try_from(device.as_u64().unwrap()).unwrap());
    let history = core
        .storage
        .history(
            id,
            voltage,
            read.time - Duration::from_secs(60),
            read.time + Duration::from_secs(60),
        )
        .await
        .unwrap();
    assert_eq!(history.iter().find_map(|p| p.value), Some(5.87));
}
