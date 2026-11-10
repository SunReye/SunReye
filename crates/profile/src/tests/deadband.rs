//! A profile's deadband per quantity (ADR 3, 4, 5).

use crate::{LoadError, Profile, Quantity};
use serde_json::{Value, json};

fn load(quantities: &Value) -> Result<Profile, LoadError> {
    let doc = json!({
        "schema": 1, "id": "case", "name": "case", "manufacturer": "test", "version": "1.0.0",
        "requires": super::all(), "quantities": quantities,
    });
    Profile::load(&doc.to_string())
}

fn refusal(key: &str, problem: &'static str) -> Result<(), LoadError> {
    Err(LoadError::Quantity {
        key: key.to_owned(),
        problem,
    })
}

#[test]
fn a_quantity_declares_its_deadband_in_its_roles_unit() {
    let profile = load(&json!([
        { "key": "battery", "role": "battery.power", "register": 1, "type": "i16",
          "deadband": 20 },
        { "key": "grid", "role": "grid.power", "register": 2, "type": "i16" },
    ]))
    .unwrap();

    let deadbands: Vec<_> = profile
        .quantities()
        .iter()
        .map(Quantity::deadband)
        .collect();
    assert_eq!(deadbands, [Some(20.0), None]);
}

#[test]
fn a_deadband_below_the_quantisation_step_is_refused() {
    let below = load(&json!([
        { "key": "voltage", "role": "battery.voltage", "register": 1, "type": "u16",
          "scale": 0.1, "deadband": 0.05 },
    ]));
    let negative = load(&json!([
        { "key": "power", "role": "battery.power", "register": 1, "type": "i16",
          "deadband": -5 },
    ]));

    assert_eq!(
        below.map(drop),
        refusal("voltage", "a deadband is below the quantisation step")
    );
    assert_eq!(
        negative.map(drop),
        refusal("power", "a deadband is below the quantisation step")
    );
}

#[test]
fn counters_and_enums_refuse_any_deadband() {
    let counter = load(&json!([
        { "key": "energy", "role": "pv.energy.total", "register": 1, "type": "u32",
          "deadband": 1 },
    ]));
    let status = load(&json!([
        { "key": "mode", "role": "battery.mode", "register": 1, "type": "u16", "deadband": 1 },
    ]));

    assert_eq!(
        counter.map(drop),
        refusal("energy", "a counter or enum has no deadband")
    );
    assert_eq!(
        status.map(drop),
        refusal("mode", "a counter or enum has no deadband")
    );
}

#[test]
fn a_deadband_needs_its_capability() {
    let doc = json!({
        "schema": 1, "id": "case", "name": "case", "manufacturer": "test", "version": "1.0.0",
        "requires": super::all_but("deadband"), "quantities": [
            { "key": "power", "role": "battery.power", "register": 1, "type": "i16",
              "deadband": 20 },
        ],
    });

    assert_eq!(
        Profile::load(&doc.to_string()).unwrap_err().to_string(),
        "`requires` lacks `deadband`, which the profile uses"
    );
}
