//! A quantity's kind and storage class (ADR 3, 4, 5): an extra declares its kind, a named role's
//! is fixed.

use crate::{LoadError, Profile, RoleKind, StorageClass};
use serde_json::{Value, json};

fn case(quantities: &Value) -> Value {
    json!({
        "schema": 1, "id": "case", "name": "case", "manufacturer": "test", "version": "1.0.0",
        "requires": super::all(), "quantities": quantities,
    })
}

fn load(doc: &Value) -> Result<Profile, LoadError> {
    Profile::load(&doc.to_string())
}

#[test]
fn an_extra_is_of_the_kind_it_declares() {
    let doc = case(&json!([
        { "key": "m", "role": "extra.m", "register": 1, "type": "u16", "kind": "measurement" },
        { "key": "c", "role": "extra.c", "register": 2, "type": "u32", "kind": "counter" },
        { "key": "f", "role": "extra.f", "register": 4, "type": "u16", "kind": "status" },
        { "key": "s", "role": "extra.s", "register": 5, "type": "u16", "kind": "setting" },
    ]));

    let kinds: Vec<RoleKind> = load(&doc)
        .unwrap()
        .quantities()
        .iter()
        .map(crate::Quantity::kind)
        .collect();

    assert_eq!(
        kinds,
        [
            RoleKind::Measurement,
            RoleKind::Counter,
            RoleKind::Status,
            RoleKind::Setting
        ]
    );
}

#[test]
fn a_kind_and_a_storage_class_need_their_capabilities() {
    let with = |field: &str, value: Value| {
        let mut quantity = json!({ "key": "a", "role": "extra.a", "register": 1, "type": "u16",
                                   "kind": "measurement" });
        quantity[field] = value;
        let mut doc = case(&json!([quantity]));
        doc["requires"] = super::all_but(if field == "kind" { "kind" } else { "storage" });
        doc
    };

    assert_eq!(
        load(&with("kind", json!("status"))).unwrap_err(),
        LoadError::Unrequired("kind".to_owned())
    );
    assert_eq!(
        load(&with("storage", json!("none"))).unwrap_err(),
        LoadError::Unrequired("storage".to_owned())
    );
}

#[test]
fn an_extra_without_a_kind_is_refused() {
    let doc = case(&json!([{ "key": "a", "role": "extra.a", "register": 1, "type": "u16" }]));

    assert_eq!(
        load(&doc).unwrap_err().to_string(),
        "quantity `a`: an extra declares its kind"
    );
}

#[test]
fn a_named_role_refuses_a_kind() {
    let doc = case(&json!([
        { "key": "p", "role": "pv.power", "register": 1, "type": "u16", "kind": "measurement" },
    ]));

    assert_eq!(
        load(&doc).unwrap_err().to_string(),
        "quantity `p`: a named role's kind is fixed by ADR 4"
    );
}

#[test]
fn a_quantity_is_stored_as_a_series_unless_it_declares_none() {
    let doc = case(&json!([
        { "key": "p", "role": "pv.power", "register": 1, "type": "u16" },
        { "key": "i", "role": "extra.i", "compute": { "clamp": { "key": "p", "min": 0 } },
          "kind": "measurement", "storage": "none" },
    ]));

    let storage: Vec<StorageClass> = load(&doc)
        .unwrap()
        .quantities()
        .iter()
        .map(crate::Quantity::storage)
        .collect();

    assert_eq!(storage, [StorageClass::Series, StorageClass::None]);
}

#[test]
fn a_setting_has_no_deadband() {
    let doc = case(&json!([
        { "key": "s", "role": "extra.s", "register": 1, "type": "u16", "kind": "setting",
          "deadband": 1 },
    ]));

    assert_eq!(
        load(&doc).unwrap_err().to_string(),
        "quantity `s`: only a measurement has a deadband"
    );
}

#[test]
fn an_extra_reading_a_register_a_setting_reads_back_is_refused() {
    let mut doc = case(&json!([
        { "key": "a", "role": "extra.a", "register": 7, "type": "u32", "kind": "setting" },
    ]));
    doc["settings"] = json!([{
        "key": "s", "type": "u16", "range": { "min": 0, "max": 9 }, "minInterval": 60,
        "recipe": [{ "write": { "register": 8 } }], "readBack": { "register": 8 },
    }]);

    assert_eq!(
        load(&doc).unwrap_err().to_string(),
        "quantity `a`: a setting already reads its register"
    );
}
