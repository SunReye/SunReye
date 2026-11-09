//! What the loader refuses, and why.

use crate::{LoadError, Profile};
use serde_json::{Value, json};

fn doc(quantities: &Value) -> Value {
    json!({
        "schema": 1, "id": "case", "name": "case", "manufacturer": "test", "version": "1.0.0",
        "requires": ["modbus"], "quantities": quantities,
    })
}

fn load(doc: &Value) -> Result<Profile, LoadError> {
    Profile::load(&doc.to_string())
}

fn refusal(quantities: &Value) -> (String, &'static str) {
    match load(&doc(quantities)) {
        Err(LoadError::Quantity { key, problem }) => (key, problem),
        other => panic!("expected a quantity refusal, got {other:?}"),
    }
}

#[test]
fn the_unit_id_is_not_part_of_a_profile() {
    let mut with_unit = doc(&json!([]));
    with_unit["unitId"] = json!(1);
    let Err(LoadError::Malformed(reason)) = load(&with_unit) else {
        panic!("loaded a unit id")
    };
    assert!(reason.contains("unitId"), "{reason}");
}

#[test]
fn another_schema_is_refused_by_its_number() {
    let mut next = doc(&json!([]));
    next["schema"] = json!(2);
    next["field from the future"] = json!(true);
    let error = load(&next).unwrap_err();
    assert_eq!(error, LoadError::Schema(2));
    assert_eq!(
        error.to_string(),
        "schema 2 is not supported; this build loads schema 1"
    );
}

#[test]
fn a_missing_capability_is_refused_by_name() {
    let mut needs = doc(&json!([]));
    needs["requires"] = json!(["modbus", "udp"]);
    let error = load(&needs).unwrap_err();
    assert_eq!(
        error.to_string(),
        "this build lacks the required capability `udp`"
    );
}

#[test]
fn a_computed_input_must_be_a_quantity_declared_earlier() {
    let later = json!([
        { "key": "x", "role": "extra.x", "compute": { "sum": ["a"] } },
        { "key": "a", "role": "extra.a", "register": 1, "type": "u16" },
    ]);
    assert_eq!(
        refusal(&later),
        ("x".into(), "an input is not a quantity declared earlier")
    );
    let cycle = json!([{ "key": "x", "role": "extra.x", "compute": { "sum": ["x"] } }]);
    assert_eq!(refusal(&cycle).0, "x");
}

#[test]
fn a_quantity_reads_a_register_or_computes_never_both() {
    let both = json!([{ "key": "a", "role": "extra.a", "register": 1, "type": "u16", "compute": { "sum": [] } }]);
    assert_eq!(
        refusal(&both).1,
        "declare one of `register`, `topic`, `get` or `compute`"
    );
    let untyped = json!([{ "key": "a", "role": "extra.a", "register": 1 }]);
    assert_eq!(refusal(&untyped).1, "a register needs a type");
    let scaled = json!([{ "key": "a", "role": "extra.a", "compute": { "sum": [] }, "scale": 2 }]);
    assert_eq!(
        refusal(&scaled).1,
        "a computed quantity takes no scale or offset"
    );
}

#[test]
fn a_key_is_declared_once() {
    let twice = json!([
        { "key": "a", "role": "extra.a", "register": 1, "type": "u16" },
        { "key": "a", "role": "extra.b", "register": 2, "type": "u16" },
    ]);
    assert_eq!(refusal(&twice), ("a".into(), "the key is declared twice"));
}

#[test]
fn a_u32_cannot_start_at_the_last_register() {
    let edge = json!([{ "key": "a", "role": "extra.a", "register": 65535, "type": "u32" }]);
    assert_eq!(refusal(&edge).1, "a double word needs two registers");
}

#[test]
fn an_inverter_section_is_optional() {
    assert_eq!(load(&doc(&json!([]))).unwrap().inverter(), None);
}

#[test]
fn an_mppt_voltage_window_must_not_be_inverted() {
    let mut inverted = doc(&json!([]));
    inverted["inverter"] = json!({
        "maxInputVoltage": 800,
        "mppt": [{ "maxCurrent": 20, "minVoltage": 650, "maxVoltage": 200, "startVoltage": 160 }],
    });
    assert_eq!(
        load(&inverted).unwrap_err().to_string(),
        "MPPT input 1: the voltage window is inverted"
    );
}

#[test]
fn a_sunspec_point_is_refused_where_it_cannot_be_read() {
    let model = json!([103]);
    let cases = [
        (
            json!([{ "key": "a", "role": "extra.a", "register": 1, "type": "acc32" }]),
            "an acc32 is a SunSpec point",
        ),
        (
            json!([{ "key": "a", "role": "extra.a", "model": model, "register": 1, "type": "u16" }]),
            "registers 0 and 1 of a SunSpec model are its header",
        ),
        (
            json!([{ "key": "a", "role": "extra.a", "model": [], "register": 2, "type": "u16" }]),
            "list at least one SunSpec model",
        ),
        (
            json!([
                { "key": "a", "role": "extra.a", "register": 2, "type": "u16" },
                { "key": "b", "role": "extra.b", "model": model, "register": 2, "type": "u16" },
            ]),
            "a profile reads through one binding",
        ),
    ];
    for (quantities, problem) in cases {
        assert_eq!(refusal(&quantities).1, problem);
    }
}
