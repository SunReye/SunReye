//! The `http` binding: a quantity reads a JSON Pointer into the answer of a GET on the
//! connection's host, at the device's address.
//!
//! The answer is the Shelly Pro 3EM's `EM.GetStatus` example from Shelly's Gen2 API,
//! <https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/EM>: active power in W,
//! negative when returned to the grid.

use crate::{LoadError, Profile};
use serde_json::{Value, json};

const STATUS: &str = include_str!("shelly-pro-3em-status.json");
const GET: &str = "/rpc/EM.GetStatus?id={address}";

fn doc(quantities: &Value) -> Value {
    json!({
        "schema": 1, "id": "case", "name": "case", "manufacturer": "test", "version": "1.0.0",
        "requires": ["http", "compute"], "quantities": quantities,
    })
}

fn profile(quantities: &Value) -> Profile {
    Profile::load(&doc(quantities).to_string()).unwrap()
}

fn refusal(quantities: &Value) -> (String, &'static str) {
    match Profile::load(&doc(quantities).to_string()) {
        Err(LoadError::Quantity { key, problem }) => (key, problem),
        other => panic!("expected a quantity refusal, got {other:?}"),
    }
}

/// The values after `body` answers `get` at address 0.
fn answered(profile: &Profile, get: &str, body: &str) -> Vec<Option<f64>> {
    let mut values = vec![None; profile.quantities().len()];
    profile.answer(0, get, body.as_bytes(), &mut values);
    values
}

fn point(key: &str, role: &str, json: &str) -> Value {
    json!({ "key": key, "role": role, "get": GET, "json": json })
}

#[test]
fn json_pointers_into_an_answer_decode_to_roles() {
    let p = profile(&json!([
        point("power", "grid.power", "/total_act_power"),
        { "key": "l2", "role": "grid.phase.power", "index": 2, "get": GET, "json": "/b_act_power" },
        { "key": "kw", "role": "extra.kw", "get": GET, "json": "/c_act_power", "scale": 0.001 },
    ]));
    assert_eq!(
        answered(&p, "/rpc/EM.GetStatus?id=0", STATUS),
        [Some(2484.782), Some(-951.1), Some(0.7154)]
    );
}

#[test]
fn each_get_is_asked_once_at_the_device_address() {
    let p = profile(&json!([
        point("power", "grid.power", "/total_act_power"),
        point("current", "extra.current", "/total_current"),
        { "key": "on", "role": "extra.on", "get": "/rpc/Switch.GetStatus?id={address}", "json": "/output" },
    ]));
    assert_eq!(
        p.requests(2),
        ["/rpc/EM.GetStatus?id=2", "/rpc/Switch.GetStatus?id=2"]
    );
}

#[test]
fn a_missing_or_unreadable_point_is_no_value_and_a_boolean_one_or_zero() {
    let p = profile(&json!([
        point("errors", "extra.errors", "/errors"),
        point("absent", "extra.absent", "/d_act_power"),
        point("ok", "extra.ok", "/ok"),
    ]));
    let get = "/rpc/EM.GetStatus?id=0";
    assert_eq!(answered(&p, get, STATUS), [None, None, None]);
    assert_eq!(answered(&p, get, r#"{"ok":true}"#), [None, None, Some(1.0)]);
    assert_eq!(answered(&p, get, "<html>"), [None, None, None]);
}

#[test]
fn an_answer_leaves_the_points_of_other_gets_alone_and_recomputes() {
    let p = profile(&json!([
        point("a", "extra.a", "/a_act_power"),
        { "key": "on", "role": "extra.on", "get": "/other", "json": "/on" },
        { "key": "sum", "role": "extra.sum", "compute": { "sum": ["a", "on"] } },
    ]));
    let mut values = vec![None; 3];
    p.answer(0, "/other", br#"{"on":true}"#, &mut values);
    p.answer(0, "/rpc/EM.GetStatus?id=0", STATUS.as_bytes(), &mut values);
    assert_eq!(values, [Some(951.2), Some(1.0), Some(952.2)]);
}

#[test]
fn a_get_is_a_path_with_a_json_pointer_and_no_type() {
    let alone = json!([{ "key": "a", "role": "extra.a", "get": GET }]);
    assert_eq!(
        refusal(&alone).1,
        "a GET and its JSON Pointer come together"
    );
    let typed = json!([{ "key": "a", "role": "extra.a", "get": GET, "json": "/a", "type": "u16" }]);
    assert_eq!(refusal(&typed).1, "a JSON Pointer takes no type");
    let pointer = json!([{ "key": "a", "role": "extra.a", "get": GET, "json": "a" }]);
    assert_eq!(refusal(&pointer).1, "a JSON Pointer starts with `/`");
    let url = json!([{ "key": "a", "role": "extra.a", "get": "http://host/x", "json": "/a" }]);
    assert_eq!(refusal(&url).1, "a GET is a path on the connection's host");
}

#[test]
fn a_profile_reads_registers_or_gets_not_both() {
    let mixed = json!([
        { "key": "a", "role": "extra.a", "register": 1, "type": "u16" },
        point("b", "extra.b", "/b"),
    ]);
    assert_eq!(
        refusal(&mixed),
        ("b".to_owned(), "a profile reads through one binding")
    );
}

#[test]
fn a_get_without_http_in_requires_is_a_warning() {
    let mut unrequired = doc(&json!([point("power", "grid.power", "/total_act_power")]));
    unrequired["requires"] = json!([]);
    let p = Profile::load(&unrequired.to_string()).unwrap();
    assert_eq!(
        p.warnings(),
        ["`requires` lacks `http`, which the profile uses"]
    );
}

#[test]
fn an_http_profile_writes_no_setting() {
    let mut writes = doc(&json!([point("power", "grid.power", "/total_act_power")]));
    writes["requires"] = json!(["http", "u16", "write"]);
    writes["settings"] = json!([{ "key": "limit", "type": "u16", "range": { "min": 0, "max": 10 },
        "minInterval": 0, "recipe": [{ "write": { "register": 1 } }], "writeOnly": true }]);
    match Profile::load(&writes.to_string()) {
        Err(LoadError::Setting { problem, .. }) => {
            assert_eq!(problem, "a setting writes through its profile's binding");
        }
        other => panic!("expected a setting refusal, got {other:?}"),
    }
}

#[test]
fn an_http_profile_has_no_read_plan_and_reads_http() {
    let p = profile(&json!([point("power", "grid.power", "/total_act_power")]));
    assert_eq!(p.read_plan(0), []);
    assert!(p.reads_http());
    assert!(!p.reads_topics());
}

#[test]
fn a_point_is_stored_in_its_resolution_or_else_its_scale() {
    let p = profile(&json!([
        { "key": "v", "role": "grid.phase.voltage", "index": 1, "get": GET, "json": "/a_voltage",
          "resolution": 0.1 },
        { "key": "kw", "role": "extra.kw", "get": GET, "json": "/c_act_power", "scale": 0.001 },
    ]));
    assert_eq!(p.quantities()[0].step(), 0.1);
    assert_eq!(p.quantities()[1].step(), 0.001);
}

#[test]
fn the_shelly_pro_3em_reads_its_status_as_grid_roles() {
    let p = Profile::load(include_str!("../../../../profiles/shelly-pro-3em.json")).unwrap();
    let get = "/rpc/EM.GetStatus?id=0";
    assert_eq!(p.requests(0), [get]);
    let values = answered(&p, get, STATUS);
    let read: Vec<_> = p
        .quantities()
        .iter()
        .zip(values)
        .map(|(q, v)| (q.role.as_str(), q.index, v.unwrap()))
        .collect();
    assert_eq!(
        read,
        [
            ("grid.power", None, 2484.782),
            ("grid.frequency", None, 50.0),
            ("grid.phase.power", Some(1), 951.2),
            ("grid.phase.voltage", Some(1), 236.1),
            ("grid.phase.current", Some(1), 4.029),
            ("grid.phase.power", Some(2), -951.1),
            ("grid.phase.voltage", Some(2), 236.201),
            ("grid.phase.current", Some(2), 4.027),
            ("grid.phase.power", Some(3), 715.4),
            ("grid.phase.voltage", Some(3), 236.402),
            ("grid.phase.current", Some(3), 3.03),
        ]
    );
}
