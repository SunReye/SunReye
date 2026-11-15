//! Which deadband each role of a device is stored with (ADR 4).

use std::collections::BTreeMap;

use serde_json::json;
use sunreye_profile::Profile;

use super::{DeadbandSource, RoleDeadband, deadbands};

fn profile() -> Profile {
    let doc = json!({
        "schema": 1, "id": "case", "name": "case", "manufacturer": "test", "version": "1.0.0",
        "requires": ["modbus", "i16", "u16", "u32", "deadband", "kind", "unit"], "quantities": [
            { "key": "battery", "role": "battery.power", "register": 1, "type": "i16",
              "deadband": 20 },
            { "key": "grid", "role": "grid.power", "register": 2, "type": "i16" },
            { "key": "volts", "role": "battery.voltage", "register": 3, "type": "u16",
              "scale": 0.01, "deadband": 0.2 },
            { "key": "energy", "role": "pv.energy.total", "register": 4, "type": "u32" },
            { "key": "odd", "role": "extra.odd", "kind": "measurement", "unit": "none", "register": 6, "type": "u16" },
        ],
    });
    Profile::load(&doc.to_string()).unwrap()
}

fn deadband(role: &str, deadband: Option<f64>, source: DeadbandSource) -> RoleDeadband {
    RoleDeadband {
        role: role.to_owned(),
        deadband,
        source,
    }
}

#[test]
fn an_override_wins_then_the_profile_then_the_role_default_else_none() {
    let overrides = BTreeMap::from([("battery.voltage".to_owned(), 1.0)]);

    assert_eq!(
        deadbands(&profile(), &overrides),
        [
            deadband("battery.power", Some(20.0), DeadbandSource::Profile),
            deadband("grid.power", Some(5.0), DeadbandSource::Default),
            deadband("battery.voltage", Some(1.0), DeadbandSource::Override),
            deadband("pv.energy.total", None, DeadbandSource::None),
            deadband("extra.odd", None, DeadbandSource::None),
        ]
    );
}

#[test]
fn a_series_in_a_poll_group_is_stored_at_its_groups_cadence() {
    let doc = json!({
        "schema": 1, "id": "case", "name": "case", "manufacturer": "test", "version": "1.0.0",
        "requires": ["modbus", "u16", "poll-group", "kind", "unit"], "pollGroups": { "slow": 60 },
        "quantities": [
            { "key": "temp", "role": "extra.temp", "kind": "measurement", "unit": "none", "register": 1, "type": "u16",
              "pollGroup": "slow" },
        ],
    });
    let profile = Profile::load(&doc.to_string()).unwrap();

    let policy = super::policy(&profile.quantities()[0], &BTreeMap::new()).unwrap();

    assert_eq!(policy.cadence, std::time::Duration::from_mins(1));
}

#[test]
fn a_counter_extra_is_stored_as_a_counter_with_every_change() {
    let doc = json!({
        "schema": 1, "id": "case", "name": "case", "manufacturer": "test", "version": "1.0.0",
        "requires": ["modbus", "u32", "kind", "unit"], "quantities": [
            { "key": "runtime", "role": "extra.runtime", "register": 1, "type": "u32",
              "scale": 0.1, "kind": "counter", "unit": "h" },
        ],
    });
    let profile = Profile::load(&doc.to_string()).unwrap();

    let policy = super::policy(&profile.quantities()[0], &BTreeMap::new()).unwrap();

    assert_eq!(
        (policy.kind, policy.deadband),
        (sunreye_profile::RoleKind::Counter, 0.0)
    );
}

#[test]
fn a_quantity_stored_nowhere_has_no_storage_policy() {
    let doc = json!({
        "schema": 1, "id": "case", "name": "case", "manufacturer": "test", "version": "1.0.0",
        "requires": ["modbus", "i16", "kind", "storage", "unit"], "quantities": [
            { "key": "grid", "role": "grid.power", "register": 1, "type": "i16" },
            { "key": "import", "role": "extra.import", "register": 2, "type": "i16",
              "kind": "measurement", "unit": "none", "storage": "none" },
        ],
    });
    let profile = Profile::load(&doc.to_string()).unwrap();

    let stored: Vec<bool> = profile
        .quantities()
        .iter()
        .map(|q| super::policy(q, &BTreeMap::new()).is_some())
        .collect();

    assert_eq!(stored, [true, false]);
}

fn stored_deadbands(quantities: &serde_json::Value) -> Vec<f64> {
    let doc = json!({
        "schema": 1, "id": "case", "name": "case", "manufacturer": "test", "version": "1.0.0",
        "requires": ["modbus", "u16", "kind", "unit"], "quantities": quantities,
    });
    let profile = Profile::load(&doc.to_string()).unwrap();
    profile
        .quantities()
        .iter()
        .map(|q| super::policy(q, &BTreeMap::new()).unwrap().deadband)
        .collect()
}

#[test]
fn an_extra_takes_its_units_default_and_a_unitless_one_stores_every_change() {
    let deadbands = stored_deadbands(&json!([
        { "key": "a", "role": "extra.a", "kind": "measurement", "unit": "A", "register": 1,
          "type": "u16", "scale": 0.01 },
        { "key": "n", "role": "extra.n", "kind": "measurement", "unit": "none", "register": 2,
          "type": "u16", "scale": 0.01 },
    ]));

    assert_eq!(deadbands, [0.1, 0.0]);
}

#[test]
fn a_percentage_holds_a_one_percent_deadband() {
    let deadbands = stored_deadbands(&json!([
        { "key": "soc", "role": "battery.soc", "register": 1, "type": "u16" },
        { "key": "e", "role": "extra.e", "kind": "measurement", "unit": "%", "register": 2,
          "type": "u16", "scale": 0.1 },
    ]));

    assert_eq!(deadbands, [1.0, 1.0]);
}

/// An override saved while a role was a measurement outlives the profile update that made it a
/// held value, a status or a counter: the kind wins, and every change is stored.
#[test]
fn an_override_left_on_a_role_that_is_no_longer_a_measurement_is_ignored() {
    let doc = json!({
        "schema": 1, "id": "case", "name": "case", "manufacturer": "test", "version": "1.0.0",
        "requires": ["modbus", "u16", "kind", "unit"], "quantities": [
            { "key": "limit", "role": "extra.limit", "kind": "held", "register": 1, "type": "u16" },
            { "key": "state", "role": "extra.state", "kind": "status", "register": 2, "type": "u16" },
            { "key": "runs", "role": "extra.runs", "kind": "counter", "unit": "none",
              "register": 3, "type": "u16" },
        ],
    });
    let profile = Profile::load(&doc.to_string()).unwrap();
    let stale = ["extra.limit", "extra.state", "extra.runs"].map(|role| (role.to_owned(), 5.0));
    let overrides = BTreeMap::from(stale);

    let stored: Vec<f64> = profile
        .quantities()
        .iter()
        .map(|q| super::policy(q, &overrides).unwrap().deadband)
        .collect();

    assert_eq!(stored, [0.0, 0.0, 0.0]);
    assert_eq!(
        deadbands(&profile, &overrides),
        [
            deadband("extra.limit", None, DeadbandSource::None),
            deadband("extra.state", None, DeadbandSource::None),
            deadband("extra.runs", None, DeadbandSource::None),
        ]
    );
}
