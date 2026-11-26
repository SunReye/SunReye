//! Inverter and battery types in the PV layout (ADR 27): copied by value per device, read before
//! the device's profile.

use axum::http::StatusCode;
use serde_json::{Value, json};

use super::layout::{send, string};
use super::{Core, get, json as body_of, with_cookie};

/// A three-input inverter whose datasheet differs from the Deye profile's two inputs and 800 V,
/// made up where the ticket is silent.
fn inverter_type() -> Value {
    let input = json!({ "maxCurrent": 16.0, "minVoltage": 120.0, "maxVoltage": 550.0, "startVoltage": 150.0 });
    json!({
        "maker": "Maker", "model": "X6", "makerCountry": "DE", "maxInputVoltage": 600.0,
        "acRating": 6000.0, "efficiency": 97.5, "inputs": [input, input, input],
    })
}

fn battery_type() -> Value {
    json!({
        "maker": "Maker", "model": "B10", "madeIn": "CN", "usableCapacity": 9600.0,
        "chargePower": 5000.0, "dischargePower": 6000.0, "roundTripEfficiency": 95.0,
    })
}

impl Core {
    /// The answer to a layout change of `strings` from 1 November with `extra` members.
    async fn put_typed(
        &self,
        set_cookie: &str,
        strings: &[Value],
        extra: Value,
    ) -> (StatusCode, Value) {
        let mut body = json!({ "appliesFrom": "2026-11-01T00:00:00Z", "strings": strings });
        for (key, value) in extra.as_object().unwrap() {
            body[key] = value.clone();
        }
        let response = self
            .send(with_cookie(
                set_cookie,
                send("PUT", "/api/v1/layout", &body),
            ))
            .await;
        (response.status(), body_of(response).await)
    }

    async fn read(&self, set_cookie: &str, uri: &str) -> Value {
        body_of(self.send(with_cookie(set_cookie, get(uri))).await).await
    }
}

#[tokio::test]
async fn a_layout_carries_inverter_and_battery_types_by_device() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let module = core.module_type(&set_cookie).await;
    let types = json!({
        "inverterTypes": { "1": inverter_type() },
        "batteryTypes": { "2": battery_type() },
    });

    let (status, saved) = core
        .put_typed(&set_cookie, &[string(None, "s", &module, 1, 0.0)], types)
        .await;

    assert_eq!(status, StatusCode::OK, "{saved}");
    let read = core.read(&set_cookie, "/api/v1/layout").await;
    for layout in [&saved, &read] {
        assert_eq!(layout["inverterTypes"], json!({ "1": inverter_type() }));
        assert_eq!(layout["batteryTypes"], json!({ "2": battery_type() }));
    }
}

/// A layout stored without types reads as before: the members are left out, not empty.
#[tokio::test]
async fn a_layout_without_types_reads_without_them_and_gaining_one_is_a_change() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let module = core.module_type(&set_cookie).await;
    let saved = core
        .put_layout(
            &set_cookie,
            "2026-11-01T00:00:00Z",
            &[string(None, "s", &module, 1, 0.0)],
        )
        .await;
    let id = saved["strings"][0]["id"].as_u64();
    assert_eq!(saved.get("inverterTypes"), None, "{saved}");
    assert_eq!(saved.get("batteryTypes"), None, "{saved}");

    let types = json!({ "inverterTypes": { "1": inverter_type() } });
    let (status, _) = core
        .put_typed(&set_cookie, &[string(id, "s", &module, 1, 0.0)], types)
        .await;

    assert_eq!(status, StatusCode::OK);
    let read = core.read(&set_cookie, "/api/v1/layout").await;
    assert_eq!(read["inverterTypes"]["1"], inverter_type(), "{read}");
}

/// A member a later schema adds is refused, not dropped (ADR 25).
#[tokio::test]
async fn a_change_with_a_member_this_core_does_not_know_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let module = core.module_type(&set_cookie).await;
    let strings = [string(None, "s", &module, 1, 0.0)];
    let mut newer = inverter_type();
    newer["batteryWindow"] = json!([40.0, 60.0]);

    for extra in [
        json!({ "inverterTypes": { "1": newer } }),
        json!({ "heatPumpTypes": {} }),
    ] {
        let (status, body) = core.put_typed(&set_cookie, &strings, extra).await;

        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
        assert_eq!(body["code"], json!("request.body"));
    }
}

#[tokio::test]
async fn an_unphysical_type_is_refused_pointing_at_its_value() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let module = core.module_type(&set_cookie).await;
    let strings = [string(None, "s", &module, 1, 0.0)];
    let mut inverter = inverter_type();
    inverter["inputs"][2]["maxVoltage"] = json!(700.0);
    let mut battery = battery_type();
    battery["roundTripEfficiency"] = json!(101.0);

    for (extra, pointer) in [
        (
            json!({ "inverterTypes": { "1": inverter } }),
            "/inverterTypes/1/inputs/2/maxVoltage",
        ),
        (
            json!({ "batteryTypes": { "4": battery } }),
            "/batteryTypes/4/roundTripEfficiency",
        ),
    ] {
        let (status, body) = core.put_typed(&set_cookie, &strings, extra).await;

        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
        assert_eq!(body["code"], json!("layout.value"));
        assert_eq!(body["pointer"], json!(pointer));
    }
}

/// The type's three inputs and 600 V stand in for the profile's two inputs and 800 V.
#[tokio::test]
async fn an_inverter_type_gives_the_devices_inputs_and_voltage_before_its_profile() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let module = core.module_type(&set_cookie).await;
    let types = json!({ "inverterTypes": { "1": inverter_type() } });

    let (status, saved) = core
        .put_typed(
            &set_cookie,
            &[string(None, "third", &module, 3, 0.0)],
            types,
        )
        .await;

    assert_eq!(status, StatusCode::OK, "{saved}");
    // 16 × 41 V × (1 + 0.27 %/K × 35 K) at −10 °C: 718 V, above the type's 600 V.
    assert_eq!(
        saved["warnings"][0]["maxInputVoltage"],
        json!(600.0),
        "{saved}"
    );
    let capabilities = core.read(&set_cookie, "/api/v1/capabilities").await;
    let device = &capabilities["devices"]["1"];
    assert_eq!(device["maxInputVoltage"], json!(600.0));
    assert_eq!(device["inputs"].as_array().map(Vec::len), Some(3));
    assert_eq!(device["inputs"][0]["maxVoltage"], json!(550.0));
}
