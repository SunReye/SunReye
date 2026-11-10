//! `requires`: every capability a profile uses is listed, so an older core names what it lacks
//! instead of calling the profile malformed.

use crate::{LoadError, Profile};
use serde_json::{Value, json};

fn case(requires: &Value, quantities: &Value) -> Value {
    json!({
        "schema": 1, "id": "case", "name": "case", "manufacturer": "test", "version": "1.0.0",
        "requires": requires, "quantities": quantities,
    })
}

fn unrequired(doc: &Value) -> LoadError {
    Profile::load(&doc.to_string()).unwrap_err()
}

#[test]
fn a_used_capability_missing_from_requires_is_refused() {
    let doc = case(
        &json!(["modbus", "u16"]),
        &json!([
            { "key": "a", "role": "extra.a", "register": 1, "type": "u16" },
            { "key": "b", "role": "extra.b", "register": 2, "type": "u32" },
            { "key": "c", "role": "extra.c", "compute": { "sum": ["a", "b"] } },
        ]),
    );

    let refused = unrequired(&doc);

    assert_eq!(refused, LoadError::Unrequired("u32".to_owned()));
    assert_eq!(
        refused.to_string(),
        "`requires` lacks `u32`, which the profile uses"
    );
}

#[test]
fn a_required_capability_this_build_lacks_is_named_before_any_field_it_does_not_know() {
    let doc = case(
        &json!(["modbus", "u16", "future"]),
        &json!([{ "key": "a", "role": "extra.a", "register": 1, "type": "u16", "future": 1 }]),
    );

    assert_eq!(
        unrequired(&doc),
        LoadError::MissingCapability("future".to_owned())
    );
}

#[test]
fn the_owners_profile_requires_all_it_uses() {
    let profile = Profile::load(include_str!("../../../../profiles/deye-sg05lp3.json")).unwrap();
    assert!(profile.warnings().is_empty(), "{:?}", profile.warnings());
}

#[test]
fn each_optional_field_of_a_quantity_needs_its_capability() {
    let register = json!({ "key": "a", "role": "extra.a", "register": 1, "type": "u16" });
    let with = |field: &str, value: Value| {
        let mut quantity = register.clone();
        quantity[field] = value;
        case(&json!(["modbus", "u16"]), &json!([quantity]))
    };
    let cases = [
        (with("scaleFactor", json!(2)), "scale-factor"),
        (with("resolution", json!(0.1)), "resolution"),
        (with("deadband", json!(2)), "deadband"),
    ];
    for (doc, capability) in cases {
        assert_eq!(
            unrequired(&doc),
            LoadError::Unrequired(capability.to_owned()),
            "{doc}"
        );
    }
    let texts = json!([{ "key": "m", "role": "extra.m", "topic": "m", "enum": { "pv": 1 } }]);
    assert_eq!(
        unrequired(&case(&json!(["mqtt"]), &texts)),
        LoadError::Unrequired("text-enum".to_owned())
    );
}

#[test]
fn an_identify_probe_and_an_ac_rating_need_their_capabilities() {
    let quantities = json!([{ "key": "a", "role": "extra.a", "register": 1, "type": "u16" }]);
    let mut identify = case(&json!(["modbus", "u16"]), &quantities);
    identify["identify"] = json!([{ "register": 0, "values": [5] }]);
    let mut rated = case(&json!(["modbus", "u16"]), &quantities);
    rated["inverter"] = json!({ "maxInputVoltage": 500, "acRating": 5000, "mppt": [] });

    assert_eq!(
        unrequired(&identify),
        LoadError::Unrequired("identify".to_owned())
    );
    assert_eq!(
        unrequired(&rated),
        LoadError::Unrequired("ac-rating".to_owned())
    );
}

#[test]
fn a_settings_text_and_verified_flag_need_their_capabilities() {
    let setting = json!({
        "key": "s", "type": "u16", "range": { "min": 0, "max": 9 }, "minInterval": 60,
        "recipe": [{ "write": { "register": 1 } }], "readBack": { "register": 1 },
    });
    let with = |field: &str, value: Value| {
        let mut setting = setting.clone();
        setting[field] = value;
        let quantities = json!([{ "key": "a", "role": "extra.a", "register": 1, "type": "u16" }]);
        let mut doc = case(&json!(["modbus", "u16", "write"]), &quantities);
        doc["settings"] = json!([setting]);
        doc
    };
    let cases = [
        (with("name", json!("S")), "setting-text"),
        (with("unit", json!("A")), "setting-text"),
        (with("verified", json!(true)), "verified"),
    ];
    for (doc, capability) in cases {
        assert_eq!(
            unrequired(&doc),
            LoadError::Unrequired(capability.to_owned()),
            "{doc}"
        );
    }
}
