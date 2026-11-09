//! A role's live value for EVCC's HTTP custom meter (ADR 10).

use std::time::Duration;

use axum::http::StatusCode;
use serde_json::{Value, json};
use tempfile::TempDir;

use super::tokens::bearer;
use super::{Core, get, json as body};
use crate::plant;

/// A core with a `read` token, the scope EVCC is given, and paused time.
async fn core() -> (TempDir, Core, String) {
    let dir = tempfile::tempdir().unwrap();
    let (core, admin) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let (_, token) = core.token(&admin, "evcc", "read").await;
    tokio::time::pause();
    (dir, core, token)
}

impl Core {
    /// After the live tick, what EVCC reads at `uri`.
    async fn role(&self, token: &str, uri: &str) -> (StatusCode, Value) {
        tokio::time::sleep(Duration::from_secs(1)).await;
        let response = self.send(bearer(token, get(uri))).await;
        (response.status(), body(response).await)
    }
}

#[tokio::test]
async fn a_role_is_read_from_the_plant_device_by_default() {
    let (_dir, core, token) = core().await;
    core.publish(plant::DEVICE.0, "grid.power", None, 1500.0);
    core.publish(7, "grid.power", None, 900.0);

    let read = core.role(&token, "/api/v1/roles/grid.power").await;

    assert_eq!(read, (StatusCode::OK, json!(1500.0)));
}

#[tokio::test]
async fn a_device_is_read_by_its_id() {
    let (_dir, core, token) = core().await;
    core.publish(plant::DEVICE.0, "pv.mppt.power", Some(2), 1500.0);
    core.publish(7, "pv.mppt.power", Some(2), 900.0);

    let read = core
        .role(&token, "/api/v1/roles/pv.mppt.power%5B2%5D?device=7")
        .await;

    assert_eq!(read, (StatusCode::OK, json!(900.0)));
}

/// EVCC's convention, from <https://docs.evcc.io/en/user-defined-devices>: a positive `power`
/// is grid import, PV production, and a battery discharging ("negative: charging"). Ours
/// (ADR 4): grid import and battery charging are positive.
#[tokio::test]
async fn values_follow_evccs_documented_sign_convention() {
    let (_dir, core, token) = core().await;
    let plant = plant::DEVICE.0;
    // Importing 300 W, producing 4 kW and charging the battery at 2 kW, 40 A.
    core.publish(plant, "grid.power", None, 300.0);
    core.publish(plant, "pv.power", None, 4000.0);
    core.publish(plant, "battery.power", None, 2000.0);
    core.publish(7, "battery.current", None, 40.0);

    let mut read = Vec::new();
    for uri in [
        "/api/v1/roles/grid.power",
        "/api/v1/roles/pv.power",
        "/api/v1/roles/battery.power",
        "/api/v1/roles/battery.current?device=7",
    ] {
        read.push(core.role(&token, uri).await.1);
    }

    assert_eq!(
        read,
        [json!(300.0), json!(4000.0), json!(-2000.0), json!(-40.0)]
    );
}

#[tokio::test]
async fn a_role_without_a_live_value_is_refused() {
    let (_dir, core, token) = core().await;
    core.publish(7, "grid.power", None, 300.0);

    let read = core.role(&token, "/api/v1/roles/grid.power").await;

    assert_eq!(
        read,
        (
            StatusCode::NOT_FOUND,
            json!({ "status": 404, "code": "role.none" })
        )
    );
}

#[tokio::test]
async fn a_malformed_series_or_device_is_refused() {
    let (_dir, core, token) = core().await;

    let series = core.role(&token, "/api/v1/roles/grid.power%5Bx%5D").await;
    let device = core.role(&token, "/api/v1/roles/grid.power?device=x").await;

    assert_eq!(
        (series.1["code"].clone(), device.1["code"].clone()),
        (json!("request.path"), json!("request.query"))
    );
}
