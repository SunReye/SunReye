//! The identify probe: the registers a profile reads to tell its device from any other (ADR 5).

use crate::{Block, LoadError, Profile, Registers};
use serde_json::{Value, json};

fn profile(identify: &Value) -> Result<Profile, LoadError> {
    let mut doc = json!({
        "schema": 1, "id": "case", "name": "case", "manufacturer": "test", "version": "1.0.0",
        "requires": ["modbus", "u16"],
        "quantities": [{ "key": "a", "role": "pv.power", "register": 500, "type": "u16" }],
    });
    if !identify.is_null() {
        doc["identify"] = identify.clone();
    }
    Profile::load(&doc.to_string())
}

fn answered(runs: &[(u16, &[u16])]) -> Registers {
    let mut registers = Registers::default();
    for (start, words) in runs {
        registers.answer(*start, words);
    }
    registers
}

fn deye() -> Profile {
    profile(&json!([
        { "register": 0, "values": [0x0500] },
        { "register": 20, "type": "u32", "values": [50_000, 60_000] },
    ]))
    .unwrap()
}

#[test]
fn the_probe_reads_each_field_it_declares() {
    let block = |start, count| Block {
        start,
        count,
        grouped: false,
        merged: false,
    };
    assert_eq!(deye().identify_plan(), [block(0, 1), block(20, 2)]);
}

#[test]
fn a_device_is_identified_only_when_every_field_holds_one_of_its_values() {
    let profile = deye();
    let lp3_6k = answered(&[(0, &[0x0500]), (20, &[60_000, 0])]);
    let hp3 = answered(&[(0, &[0x0600]), (20, &[60_000, 0])]);
    let lp3_8k = answered(&[(0, &[0x0500]), (20, &[14_464, 1])]);
    assert!(profile.identifies(&lp3_6k));
    assert!(!profile.identifies(&hp3));
    assert!(!profile.identifies(&lp3_8k), "80 000 is low word first");
}

#[test]
fn an_unanswered_field_identifies_nothing() {
    assert!(!deye().identifies(&answered(&[(0, &[0x0500])])));
}

#[test]
fn a_profile_without_a_probe_has_an_empty_plan_and_identifies_nothing() {
    let profile = profile(&Value::Null).unwrap();
    assert_eq!(profile.identify_plan(), []);
    assert!(!profile.identifies(&answered(&[(500, &[1])])));
}

#[test]
fn a_field_without_values_is_refused() {
    let error = profile(&json!([{ "register": 0, "values": [] }])).unwrap_err();
    assert_eq!(
        error.to_string(),
        "identify register 0: a field lists the values it may hold"
    );
}

#[test]
fn a_value_wider_than_its_field_is_refused() {
    let error = profile(&json!([{ "register": 0, "values": [65_536] }])).unwrap_err();
    assert_eq!(
        error.to_string(),
        "identify register 0: a value does not fit the field's type"
    );
}
