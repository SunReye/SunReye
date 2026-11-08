//! The device roster on the 3.x paths and shapes: devices and connections listed, added, edited, retired
//! and removed by id.

use super::reads::oracle;
use super::*;
use crate::samples::{ClosedMinute, Sample};

async fn patch(api: &Api, path: &str, body: &Value) -> Answer {
    send(api, Method::PATCH, path, Some(&body.to_string())).await
}

/// The display name the 2.x engine recorded for a profile.
fn profile_name(id: &str) -> Value {
    let rows = oracle("profile-decode.ndjson");
    rows.into_iter().find(|row| row["profile"]["id"] == id).expect("oracle row")["profile"]["name"].clone()
}

/// An onboarded core: the active profile and the inverter connection saved through the settings form.
async fn onboarded(name: &str, port: u16) -> (Arc<Core>, Api) {
    let (core, admin) = open(&dir(name)).await;
    put(&admin, "/api/settings/active-profile", &json!({"id": PROFILE})).await;
    assert_eq!(put(&admin, "/api/settings/inverter", &connection(port)).await.status, StatusCode::OK);
    (core, admin)
}

fn modbus(host: &str, port: u16) -> Value {
    json!({"host": host, "port": port, "transport": "tcp", "timeoutMs": 500, "pollIntervalMs": 1000})
}

fn new_device(connection: &Value, name: &str, unit: u8) -> Value {
    json!({"connection": connection, "role": "meter", "name": name, "profileId": PROFILE, "unitId": unit})
}

async fn store_a_reading(core: &Core, device: i64) {
    let sample = Sample { at_ms: 6_000_000, values: vec![("pv".into(), 1.0)] };
    core.store
        .append_minute(device, &ClosedMinute { minute: 100, samples: vec![sample] })
        .await
        .expect("append");
}

#[tokio::test]
async fn the_onboarded_device_and_its_connection_answer_in_the_3x_roster_shape() {
    let port = unused_port();
    let (core, admin) = onboarded("roster", port).await;
    let answer = get(&admin, "/api/devices").await;
    assert_eq!(answer.status, StatusCode::OK);
    let connection = json!({
        "id": 1, "name": "Inverter", "kind": "modbus",
        "params": {"host": "127.0.0.1", "port": port, "transport": "tcp", "timeoutMs": 500, "pollIntervalMs": 1000}
    });
    assert_eq!(
        answer.json(),
        json!({
            "devices": [{
                "id": 1, "slug": "1", "name": profile_name(PROFILE), "profileId": PROFILE, "role": "inverter",
                "unitId": 1, "connectionId": 1, "params": {}, "arrays": [], "tempCoefficient": null,
                "systemLoss": null, "retiredAt": null, "connection": connection, "battery": null,
                "profileName": profile_name(PROFILE), "profileKnown": true, "kind": "modbus", "state": "polling",
                "integration": null
            }],
            "connections": [connection]
        })
    );
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn a_device_added_on_a_new_connection_is_listed_and_polled() {
    let (sim, _) = simulator().await;
    let (core, admin) = open(&dir("roster-add")).await;
    let create = json!({"create": {"name": "Garage", "kind": "modbus", "params": modbus("127.0.0.1", sim.addr.port())}});
    let added = post(&admin, "/api/devices", &new_device(&create, "Grid meter", 1)).await;
    assert_eq!(added.status, StatusCode::OK, "{}", added.json());
    let view = added.json();
    assert_eq!(
        (&view["slug"], &view["name"], &view["role"], &view["state"], &view["connection"]["name"]),
        (
            &json!(view["id"].to_string()),
            &json!("Grid meter"),
            &json!("meter"),
            &json!("polling"),
            &json!("Garage")
        )
    );
    wait_until_polled(&sim).await;

    let on_its_own = post(
        &admin,
        "/api/connections",
        &json!({"name": "Roof", "kind": "modbus", "params": modbus("gw", 1502)}),
    )
    .await;
    assert_eq!(on_its_own.status, StatusCode::OK);
    let id = on_its_own.json()["id"].clone();
    let second = post(&admin, "/api/devices", &new_device(&json!({"id": id}), "Wallbox", 3)).await;
    assert_eq!((second.status, &second.json()["connectionId"]), (StatusCode::OK, &id));
    let roster = get(&admin, "/api/devices").await.json();
    let names: Vec<&Value> =
        roster["devices"].as_array().expect("devices").iter().map(|d| &d["name"]).collect();
    assert_eq!(names, [&json!("Grid meter"), &json!("Wallbox")]);
    assert_eq!(roster["connections"].as_array().expect("connections").len(), 2);
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn an_add_the_core_cannot_hold_is_refused_by_field_and_adds_nothing() {
    let (core, admin) = onboarded("roster-refused", unused_port()).await;
    let existing = json!({"id": 1});
    let cases = [
        (json!({"profileId": "no-such"}), StatusCode::BAD_REQUEST, "profileId"),
        (json!({"connection": {"id": 99}}), StatusCode::BAD_REQUEST, "connection"),
        (json!({"unitId": 248}), StatusCode::BAD_REQUEST, "unitId"),
        (json!({"name": " "}), StatusCode::BAD_REQUEST, "name"),
        (json!({"name": "x".repeat(49)}), StatusCode::BAD_REQUEST, "name"),
        (json!({"role": "kettle"}), StatusCode::BAD_REQUEST, "role"),
        (json!({"via": "coded"}), StatusCode::BAD_REQUEST, "via"),
        (
            json!({"connection": {"create": {"name": "Broker", "kind": "mqtt", "params": {"brokerUrl": "mqtt://b"}}}}),
            StatusCode::BAD_REQUEST,
            "kind",
        ),
        (json!({"unitId": 1}), StatusCode::CONFLICT, "unitId"),
    ];
    for (change, status, field) in cases {
        let mut body = new_device(&existing, "Meter", 2);
        for (key, value) in change.as_object().expect("object") {
            body[key] = value.clone();
        }
        let answer = post(&admin, "/api/devices", &body).await;
        assert_eq!((answer.status, &answer.json()["field"]), (status, &json!(field)), "{change}");
    }
    let roster = get(&admin, "/api/devices").await.json();
    assert_eq!(
        (roster["devices"].as_array().map(Vec::len), roster["connections"].as_array().map(Vec::len)),
        (Some(1), Some(1))
    );
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn a_device_is_renamed_retired_and_restored_by_id() {
    let (core, admin) = onboarded("roster-patch", unused_port()).await;
    let renamed = patch(&admin, "/api/devices/1", &json!({"name": "Hybrid", "unitId": 7})).await;
    assert_eq!(
        (renamed.status, &renamed.json()["name"], &renamed.json()["unitId"]),
        (StatusCode::OK, &json!("Hybrid"), &json!(7))
    );

    post(&admin, "/api/devices", &new_device(&json!({"id": 1}), "Meter", 2)).await;
    let before = core.now_ms();
    let retired = patch(&admin, "/api/devices/2", &json!({"retired": true})).await.json();
    let after = core.now_ms();
    assert_eq!(retired["state"], "retired");
    let at: jiff::Timestamp = retired["retiredAt"].as_str().expect("retiredAt").parse().expect("ISO instant");
    assert!((before..=after).contains(&at.as_millisecond()), "retired at {at}, between {before} and {after}");
    let restored = patch(&admin, "/api/devices/2", &json!({"retired": false})).await.json();
    assert_eq!(
        (&restored["state"], &restored["retiredAt"], &restored["name"]),
        (&json!("polling"), &json!(null), &json!("Meter"))
    );

    assert_eq!(patch(&admin, "/api/devices/3", &json!({"name": "x"})).await.status, StatusCode::NOT_FOUND);
    for path in ["/api/devices/abc", "/api/devices/0", "/api/devices/-1"] {
        assert_eq!(
            patch(&admin, path, &json!({"name": "x"})).await.status,
            StatusCode::BAD_REQUEST,
            "{path}"
        );
    }
    assert_eq!(
        patch(&admin, "/api/devices/1", &json!({})).await.status,
        StatusCode::BAD_REQUEST,
        "nothing to change"
    );
    assert_eq!(
        patch(&admin, "/api/devices/1", &json!({"connectionId": 9})).await.json()["field"],
        "connectionId"
    );
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn a_device_with_stored_readings_is_refused_deletion_as_3x_refuses_it_and_one_without_is_deleted() {
    let (core, admin) = onboarded("roster-delete", unused_port()).await;
    post(&admin, "/api/devices", &new_device(&json!({"id": 1}), "Meter", 2)).await;
    let added = post(&admin, "/api/devices", &new_device(&json!({"id": 1}), "Meter", 3)).await.json();
    store_a_reading(&core, 2).await;

    let refused = delete(&admin, "/api/devices/2").await;
    assert_eq!(
        (refused.status, refused.json()),
        (
            StatusCode::CONFLICT,
            json!({"error": "this device has recorded history; retire it instead to keep that history", "field": "history"})
        )
    );
    assert_eq!(core.store.readings(2, 0, i64::MAX).await.expect("readings").len(), 1);
    let id = added["id"].as_i64().expect("id");
    let deleted = delete(&admin, &format!("/api/devices/{id}")).await;
    assert_eq!((deleted.status, deleted.json()), (StatusCode::OK, json!({"ok": true, "id": id})));
    assert_eq!(delete(&admin, &format!("/api/devices/{id}")).await.status, StatusCode::NOT_FOUND);
    let ids: Vec<Value> = get(&admin, "/api/devices").await.json()["devices"]
        .as_array()
        .expect("devices")
        .iter()
        .map(|d| d["id"].clone())
        .collect();
    assert_eq!(ids, [json!(1), json!(2)]);
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn a_connection_is_edited_in_place_and_removed_only_once_no_device_is_on_it() {
    let (core, admin) = onboarded("roster-connection", unused_port()).await;
    let edited = patch(
        &admin,
        "/api/connections/1",
        &json!({"name": "Gateway", "kind": "modbus", "params": modbus("gw", 1502)}),
    )
    .await;
    assert_eq!(edited.status, StatusCode::OK);
    assert_eq!((&edited.json()["name"], &edited.json()["params"]["host"]), (&json!("Gateway"), &json!("gw")));
    assert_eq!(get(&admin, "/api/devices").await.json()["devices"][0]["connection"]["params"]["port"], 1502);
    let rekinded = patch(&admin, "/api/connections/1", &json!({"kind": "mqtt"})).await;
    assert_eq!((rekinded.status, &rekinded.json()["field"]), (StatusCode::CONFLICT, &json!("kind")));
    assert_eq!(
        patch(&admin, "/api/connections/9", &json!({"name": "x"})).await.status,
        StatusCode::NOT_FOUND
    );

    post(&admin, "/api/devices", &new_device(&json!({"id": 1}), "Meter", 2)).await;
    patch(&admin, "/api/devices/2", &json!({"retired": true})).await;
    let held = delete(&admin, "/api/connections/1").await;
    assert_eq!(
        (held.status, held.json()),
        (StatusCode::CONFLICT, json!({"error": "connection still has 2 device(s): 1, 2"})),
        "a retired device holds it too"
    );
    let empty = post(
        &admin,
        "/api/connections",
        &json!({"name": "Spare", "kind": "modbus", "params": modbus("spare", 502)}),
    )
    .await
    .json();
    let id = empty["id"].as_i64().expect("id");
    let removed = delete(&admin, &format!("/api/connections/{id}")).await;
    assert_eq!((removed.status, removed.json()), (StatusCode::OK, json!({"ok": true, "id": id})));
    assert_eq!(delete(&admin, &format!("/api/connections/{id}")).await.status, StatusCode::NOT_FOUND);
    assert_eq!(
        post(&admin, "/api/connections", &json!({"name": "Broker", "kind": "mqtt", "params": {}}))
            .await
            .status,
        StatusCode::BAD_REQUEST
    );
    drop(admin);
    core.stop().await;
}

const POLLED: &str = "this device is the one being polled; change the inverter connection first";

#[tokio::test]
async fn the_device_the_inverter_settings_edit_is_refused_retirement_and_deletion_as_3x_refuses_it() {
    let (core, admin) = onboarded("roster-polled", unused_port()).await;
    for answer in [
        patch(&admin, "/api/devices/1", &json!({"retired": true})).await,
        delete(&admin, "/api/devices/1").await,
    ] {
        assert_eq!((answer.status, answer.json()), (StatusCode::CONFLICT, json!({"error": POLLED})));
    }
    let device = &get(&admin, "/api/devices").await.json()["devices"][0];
    assert_eq!((&device["id"], &device["state"]), (&json!(1), &json!("polling")));
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn the_inverter_settings_edit_the_device_a_read_without_source_is_from() {
    let (core, admin) = open(&dir("roster-settings-device")).await;
    let spare = json!({"name": "Roof", "kind": "modbus", "params": modbus("roof", 502)});
    assert_eq!(post(&admin, "/api/connections", &spare).await.status, StatusCode::OK);
    let create = json!({"create": {"name": "Garage", "kind": "modbus", "params": modbus("garage", 502)}});
    let mut body = new_device(&create, "Hybrid", 1);
    body["role"] = json!("inverter");
    assert_eq!(post(&admin, "/api/devices", &body).await.status, StatusCode::OK);

    let port = unused_port();
    put(&admin, "/api/settings/active-profile", &json!({"id": PROFILE})).await;
    assert_eq!(put(&admin, "/api/settings/inverter", &connection(port)).await.status, StatusCode::OK);
    let roster = get(&admin, "/api/devices").await.json();
    let devices: Vec<(&Value, &Value, &Value)> = roster["devices"]
        .as_array()
        .expect("devices")
        .iter()
        .map(|d| (&d["id"], &d["connection"]["name"], &d["connection"]["params"]["port"]))
        .collect();
    assert_eq!(devices, [(&json!(1), &json!("Garage"), &json!(port))]);
    assert_eq!(roster["connections"][0]["params"]["host"], "roof", "the spare stays as it was");
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn a_device_with_readings_held_for_the_open_minute_is_refused_deletion() {
    let (core, admin) = onboarded("roster-held", unused_port()).await;
    post(&admin, "/api/devices", &new_device(&json!({"id": 1}), "Meter", 2)).await;
    core.unstored.push(2, Sample { at_ms: 6_000_000, values: vec![("pv".into(), 1.0)] });
    let refused = delete(&admin, "/api/devices/2").await;
    assert_eq!((refused.status, &refused.json()["field"]), (StatusCode::CONFLICT, &json!("history")));
    assert_eq!(get(&admin, "/api/devices").await.json()["devices"].as_array().map(Vec::len), Some(2));
    drop(admin);
    core.stop().await;
}

/// `modbus("gw", 1502)` with `key` set to `value`, or left out when `value` is `None`.
fn timing(key: &str, value: Option<Value>) -> Value {
    let mut params = modbus("gw", 1502);
    match value {
        Some(value) => params[key] = value,
        None => _ = params.as_object_mut().expect("object").remove(key),
    }
    params
}

/// An answer's status, and the refused field or the poll timing it reports.
fn timing_answer(answer: &Answer, params: impl Fn(&Value) -> &Value, key: &str) -> (StatusCode, Value) {
    let json = answer.json();
    let reported =
        if answer.status == StatusCode::OK { params(&json)[key].clone() } else { json["field"].clone() };
    (answer.status, reported)
}

const OK: StatusCode = StatusCode::OK;
const REFUSED: StatusCode = StatusCode::BAD_REQUEST;

// The onboarded core polls with timeoutMs 500 and pollIntervalMs 1000.
#[tokio::test]
async fn a_connection_edit_takes_only_the_cores_poll_timing_and_a_connection_add_ignores_it() {
    let (core, admin) = onboarded("roster-timing", unused_port()).await;
    let cells = [
        ("timeoutMs", None, OK, OK),
        ("timeoutMs", Some(json!(null)), REFUSED, OK),
        ("timeoutMs", Some(json!(0)), REFUSED, OK),
        ("timeoutMs", Some(json!(-1)), REFUSED, OK),
        ("timeoutMs", Some(json!(500)), OK, OK),
        ("timeoutMs", Some(json!(2000)), REFUSED, OK),
        ("pollIntervalMs", None, OK, OK),
        ("pollIntervalMs", Some(json!(null)), REFUSED, OK),
        ("pollIntervalMs", Some(json!(0)), REFUSED, OK),
        ("pollIntervalMs", Some(json!(-1)), REFUSED, OK),
        ("pollIntervalMs", Some(json!(1000)), OK, OK),
        ("pollIntervalMs", Some(json!(5000)), REFUSED, OK),
    ];
    for (key, value, edit, add) in cells {
        let core_value = if key == "timeoutMs" { json!(500) } else { json!(1000) };
        let expected = |status| (status, if status == OK { core_value.clone() } else { json!("params") });
        let params = timing(key, value.clone());
        let edited = patch(&admin, "/api/connections/1", &json!({"params": params})).await;
        assert_eq!(timing_answer(&edited, |v| &v["params"], key), expected(edit), "edit {key}: {value:?}");
        let body = json!({"name": "Roof", "kind": "modbus", "params": params});
        let added = post(&admin, "/api/connections", &body).await;
        assert_eq!(timing_answer(&added, |v| &v["params"], key), expected(add), "add {key}: {value:?}");
    }
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn a_device_created_with_its_connection_ignores_a_stated_poll_timing() {
    let (core, admin) = onboarded("roster-create-timing", unused_port()).await;
    let cells = [
        ("timeoutMs", None, OK),
        ("timeoutMs", Some(json!(null)), OK),
        ("timeoutMs", Some(json!(0)), OK),
        ("timeoutMs", Some(json!(-1)), OK),
        ("timeoutMs", Some(json!(500)), OK),
        ("timeoutMs", Some(json!(2000)), OK),
        ("pollIntervalMs", None, OK),
        ("pollIntervalMs", Some(json!(null)), OK),
        ("pollIntervalMs", Some(json!(0)), OK),
        ("pollIntervalMs", Some(json!(-1)), OK),
        ("pollIntervalMs", Some(json!(1000)), OK),
        ("pollIntervalMs", Some(json!(5000)), OK),
    ];
    for (key, value, create) in cells {
        let core_value = if key == "timeoutMs" { json!(500) } else { json!(1000) };
        let expected = (create, if create == OK { core_value } else { json!("params") });
        let choice =
            json!({"create": {"name": "Garage", "kind": "modbus", "params": timing(key, value.clone())}});
        let added = post(&admin, "/api/devices", &new_device(&choice, "Meter", 2)).await;
        assert_eq!(
            timing_answer(&added, |v| &v["connection"]["params"], key),
            expected,
            "create {key}: {value:?}"
        );
    }
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn an_empty_core_lists_no_device_and_no_connection() {
    let (core, admin) = open(&dir("roster-empty")).await;
    let answer = get(&admin, "/api/devices").await;
    assert_eq!((answer.status, answer.json()), (StatusCode::OK, json!({"devices": [], "connections": []})));
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn an_endpoint_or_unit_out_of_range_is_refused_and_the_unit_ends_are_accepted() {
    let (core, admin) = onboarded("roster-bounds", unused_port()).await;
    let solarman = |serial: i64| json!({"host": "stick", "port": 8899, "transport": "solarman-v5", "loggerSerial": serial});
    let endpoints = [
        (json!({"host": "gw", "port": 0}), "params"),
        (json!({"host": "gw", "port": 65_536}), "params"),
        (json!({"host": "gw", "port": -1}), "params"),
        (json!({"host": " ", "port": 502}), "host"),
        (solarman(0), "params"),
        (solarman(4_294_967_297), "params"),
    ];
    for (params, field) in endpoints {
        let create = json!({"create": {"name": "Gateway", "kind": "modbus", "params": params}});
        let added = post(&admin, "/api/devices", &new_device(&create, "Meter", 2)).await;
        assert_eq!(
            (added.status, &added.json()["field"]),
            (StatusCode::BAD_REQUEST, &json!(field)),
            "{params}"
        );
        let edited = patch(&admin, "/api/connections/1", &json!({"params": params})).await;
        assert_eq!(
            (edited.status, &edited.json()["field"]),
            (StatusCode::BAD_REQUEST, &json!(field)),
            "{params}"
        );
    }
    let unit = |unit: i64| json!({"connection": {"id": 1}, "role": "meter", "name": "Meter", "profileId": PROFILE, "unitId": unit});
    for negative in [-1, -256] {
        let added = post(&admin, "/api/devices", &unit(negative)).await;
        assert_eq!(
            (added.status, &added.json()["field"]),
            (StatusCode::BAD_REQUEST, &json!("unitId")),
            "{negative}"
        );
    }
    let edited = patch(&admin, "/api/devices/1", &json!({"unitId": -1})).await;
    assert_eq!((edited.status, &edited.json()["field"]), (StatusCode::BAD_REQUEST, &json!("unitId")));
    let roster = get(&admin, "/api/devices").await.json();
    assert_eq!(
        (roster["devices"].as_array().map(Vec::len), roster["connections"].as_array().map(Vec::len)),
        (Some(1), Some(1))
    );
    assert_eq!(roster["connections"][0]["params"]["host"], "127.0.0.1", "no refused edit landed");
    for end in [0, 247] {
        let added = post(&admin, "/api/devices", &unit(end)).await;
        assert_eq!((added.status, &added.json()["unitId"]), (StatusCode::OK, &json!(end)));
    }
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn an_endpoint_at_its_range_ends_is_accepted() {
    let (core, admin) = onboarded("roster-ends", unused_port()).await;
    let solarman = |serial: i64| json!({"host": "stick", "port": 8899, "transport": "solarman-v5", "loggerSerial": serial});
    let ends = [
        json!({"host": "gw", "port": 1}),
        json!({"host": "gw", "port": 65_535}),
        solarman(1),
        solarman(4_294_967_295),
    ];
    for params in ends {
        let edited = patch(&admin, "/api/connections/1", &json!({"params": params})).await;
        assert_eq!(edited.status, StatusCode::OK, "{params}");
    }
    drop(admin);
    core.stop().await;
}

fn probe_body(port: u16) -> Value {
    json!({"kind": "modbus", "params": modbus("127.0.0.1", port)})
}

#[tokio::test]
async fn a_connection_probe_answers_the_3x_shape_and_reads_nothing() {
    let (sim, _) = simulator().await;
    let (core, admin) = open(&dir("probe")).await;
    let answer = post(&admin, "/api/connections/probe", &probe_body(sim.addr.port())).await;
    assert_eq!(answer.status, StatusCode::OK);
    let body = answer.json();
    assert_eq!((&body["ok"], body["ms"].is_u64(), body.get("logger")), (&json!(true), true, None), "{body}");
    let closed = post(&admin, "/api/connections/probe", &probe_body(unused_port())).await.json();
    assert_eq!(closed["ok"], false);
    assert!(closed["error"].as_str().is_some_and(|error| error.starts_with("i/o error")), "{closed}");
    let mqtt = json!({"kind": "mqtt", "params": {"brokerUrl": "mqtt://broker"}});
    let refused = post(&admin, "/api/connections/probe", &mqtt).await;
    assert_eq!((refused.status, &refused.json()["field"]), (StatusCode::BAD_REQUEST, &json!("kind")));
    assert_eq!(sim.requests(), []);
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn a_unit_scan_tries_unit_1_first_and_issues_only_reads() {
    let (sim, _) = simulator().await;
    let (core, admin) = open(&dir("scan")).await;
    let scan = |extra: Value| {
        let mut body = probe_body(sim.addr.port());
        body["profileId"] = json!(PROFILE);
        body.as_object_mut().expect("body").extend(extra.as_object().expect("extra").clone());
        body
    };
    let found = post(&admin, "/api/connections/scan-units", &scan(json!({}))).await;
    assert_eq!(found.status, StatusCode::OK);
    let body = found.json();
    assert_eq!((&body["scanned"], &body["found"]["unitId"]), (&json!([1]), &json!(1)), "{body}");
    assert!(body["found"]["ms"].is_u64());
    let requests = sim.requests();
    assert!(!requests.is_empty() && requests.iter().all(|r| r.function == FC_READ_HOLDING), "{requests:?}");
    let refusals = [
        (json!({"profileId": "no-such"}), "profileId"),
        (json!({"candidates": []}), "candidates"),
        (json!({"candidates": [1, 1]}), "candidates"),
        (json!({"candidates": [248]}), "candidates"),
        (json!({"candidates": (0..17).collect::<Vec<u8>>()}), "candidates"),
        (json!({"kind": "mqtt"}), "kind"),
    ];
    for (extra, field) in refusals {
        let refused = post(&admin, "/api/connections/scan-units", &scan(extra.clone())).await;
        assert_eq!(
            (refused.status, &refused.json()["field"]),
            (StatusCode::BAD_REQUEST, &json!(field)),
            "{extra}"
        );
    }
    let mut unreachable = probe_body(unused_port());
    unreachable["profileId"] = json!(PROFILE);
    let closed = post(&admin, "/api/connections/scan-units", &unreachable).await;
    assert_eq!(closed.status, StatusCode::BAD_REQUEST);
    assert!(closed.json()["error"].as_str().is_some_and(|error| error.starts_with("i/o error")));
    drop(admin);
    core.stop().await;
}
