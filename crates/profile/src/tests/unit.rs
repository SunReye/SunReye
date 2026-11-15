//! A quantity's unit is its role's, from ADR 4's table, or the one an extra declares.

use crate::{LoadError, Profile, Quantity, RoleKind, Unit};
use serde_json::{Value, json};

fn units(roles: &[(&str, Option<u32>)]) -> Vec<Option<Unit>> {
    load(roles)
        .quantities()
        .iter()
        .map(Quantity::unit)
        .collect()
}

fn load(roles: &[(&str, Option<u32>)]) -> Profile {
    let quantities: Vec<_> = roles
        .iter()
        .enumerate()
        .map(|(i, (role, index))| {
            let mut quantity = json!({ "key": format!("q{i}"), "role": role, "index": index,
                                       "register": i, "type": "u16" });
            if role.starts_with("extra.") {
                quantity["kind"] = json!("measurement");
                quantity["unit"] = json!("°C");
            }
            quantity
        })
        .collect();
    let doc = json!({
        "schema": 1, "id": "case", "name": "case", "manufacturer": "test", "version": "1.0.0",
        "requires": super::all(), "quantities": quantities,
    });
    Profile::load(&doc.to_string()).unwrap()
}

#[test]
fn each_role_carries_its_unit_from_adr_4() {
    assert_eq!(
        units(&[
            ("pv.mppt.power", Some(1)),
            ("pv.mppt.voltage", Some(1)),
            ("battery.current", None),
            ("grid.energy.imported.total", None),
            ("battery.soc", None),
            ("battery.temperature", None),
            ("grid.frequency", None),
            ("inverter.power", None),
        ]),
        [
            Some(Unit::Watt),
            Some(Unit::Volt),
            Some(Unit::Ampere),
            Some(Unit::KilowattHour),
            Some(Unit::Percent),
            Some(Unit::Celsius),
            Some(Unit::Hertz),
            Some(Unit::Watt),
        ]
    );
}

#[test]
fn a_status_role_has_no_unit() {
    assert_eq!(units(&[("battery.mode", None)]), [None]);
}

fn case(quantities: &Value) -> Value {
    json!({
        "schema": 1, "id": "case", "name": "case", "manufacturer": "test", "version": "1.0.0",
        "requires": super::all(), "quantities": quantities,
    })
}

fn refusal(doc: &Value) -> String {
    Profile::load(&doc.to_string()).unwrap_err().to_string()
}

#[test]
fn an_extra_has_the_unit_it_declares() {
    let doc = case(&json!([
        { "key": "a", "role": "extra.a", "register": 1, "type": "u16", "kind": "measurement",
          "unit": "A" },
        { "key": "h", "role": "extra.h", "register": 2, "type": "u32", "kind": "counter",
          "unit": "h" },
        { "key": "n", "role": "extra.n", "register": 4, "type": "u16", "kind": "measurement",
          "unit": "none" },
    ]));

    let units: Vec<Option<Unit>> = Profile::load(&doc.to_string())
        .unwrap()
        .quantities()
        .iter()
        .map(Quantity::unit)
        .collect();

    assert_eq!(
        units,
        [
            Some(Unit::Ampere),
            Some(Unit::Hour),
            Some(Unit::Dimensionless)
        ]
    );
}

#[test]
fn a_unit_needs_its_capability() {
    let mut doc = case(&json!([
        { "key": "a", "role": "extra.a", "register": 1, "type": "u16", "kind": "measurement",
          "unit": "A" },
    ]));
    doc["requires"] = super::all_but("unit");

    assert_eq!(
        Profile::load(&doc.to_string()).unwrap_err(),
        LoadError::Unrequired("unit".to_owned())
    );
}

#[test]
fn a_measurement_or_counter_extra_without_a_unit_is_refused() {
    for kind in ["measurement", "counter"] {
        let doc = case(&json!([
            { "key": "a", "role": "extra.a", "register": 1, "type": "u16", "kind": kind },
        ]));

        assert_eq!(refusal(&doc), "quantity `a`: an extra declares its unit");
    }
}

#[test]
fn a_named_role_refuses_a_unit() {
    let doc = case(&json!([
        { "key": "p", "role": "pv.power", "register": 1, "type": "u16", "unit": "W" },
    ]));

    assert_eq!(
        refusal(&doc),
        "quantity `p`: a named role's unit is fixed by ADR 4"
    );
}

#[test]
fn a_status_or_held_extra_refuses_a_unit() {
    for kind in ["status", "held"] {
        let doc = case(&json!([
            { "key": "a", "role": "extra.a", "register": 1, "type": "u16", "kind": kind,
              "unit": "A" },
        ]));

        assert_eq!(
            refusal(&doc),
            "quantity `a`: only a measurement or counter has a unit"
        );
    }
}

#[test]
fn each_role_carries_its_kind_from_adr_4() {
    let profile = load(&[
        ("pv.mppt.power", Some(1)),
        ("grid.energy.imported.total", None),
        ("ev.session.energy", None),
        ("battery.mode", None),
        ("ev.charging", None),
        ("extra.radiator_temp", None),
    ]);
    let kinds: Vec<RoleKind> = profile.quantities().iter().map(Quantity::kind).collect();
    assert_eq!(
        kinds,
        [
            RoleKind::Measurement,
            RoleKind::Counter,
            RoleKind::Counter,
            RoleKind::Status,
            RoleKind::Status,
            RoleKind::Measurement,
        ]
    );
}

#[test]
fn a_loadpoints_settings_read_as_ev_roles() {
    let profile = load(&[
        ("ev.mode", None),
        ("ev.battery.boost", None),
        ("ev.limit.soc", None),
    ]);
    let read: Vec<(RoleKind, Option<Unit>)> = profile
        .quantities()
        .iter()
        .map(|q| (q.kind(), q.unit()))
        .collect();
    assert_eq!(
        read,
        [
            (RoleKind::Status, None),
            (RoleKind::Status, None),
            (RoleKind::Measurement, Some(Unit::Percent)),
        ]
    );
}

#[test]
fn inverter_temperature_and_status_per_phase_load_and_battery_cycles_follow_adr_4() {
    let profile = load(&[
        ("inverter.temperature", None),
        ("inverter.status", None),
        ("load.phase.power", Some(2)),
        ("battery.cycles", None),
    ]);
    let read: Vec<(RoleKind, Option<Unit>)> = profile
        .quantities()
        .iter()
        .map(|q| (q.kind(), q.unit()))
        .collect();
    assert_eq!(
        read,
        [
            (RoleKind::Measurement, Some(Unit::Celsius)),
            (RoleKind::Status, None),
            (RoleKind::Measurement, Some(Unit::Watt)),
            (RoleKind::Counter, None),
        ]
    );
}

#[test]
fn the_plants_shares_read_as_watts() {
    let profile = load(&[
        ("battery.charge.power", None),
        ("battery.discharge.power", None),
        ("grid.import.power", None),
        ("grid.export.power", None),
        ("self.consumption.power", None),
        ("self.supply.power", None),
    ]);
    let units: Vec<Option<Unit>> = profile.quantities().iter().map(Quantity::unit).collect();
    assert_eq!(units, [Some(Unit::Watt); 6]);
}
