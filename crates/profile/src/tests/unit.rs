//! A quantity's unit is its role's, from ADR 4's table.

use crate::{Profile, Quantity, RoleKind, Unit};
use serde_json::json;

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
            json!({ "key": format!("q{i}"), "role": role, "index": index,
                    "register": i, "type": "u16" })
        })
        .collect();
    let doc = json!({
        "schema": 1, "id": "case", "name": "case", "manufacturer": "test", "version": "1.0.0",
        "requires": ["modbus"], "quantities": quantities,
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
        ]),
        [
            Some(Unit::Watt),
            Some(Unit::Volt),
            Some(Unit::Ampere),
            Some(Unit::KilowattHour),
            Some(Unit::Percent),
            Some(Unit::Celsius),
            Some(Unit::Hertz),
        ]
    );
}

#[test]
fn a_status_role_and_an_extra_have_no_unit() {
    assert_eq!(
        units(&[("battery.mode", None), ("extra.radiator_temp", None)]),
        [None, None]
    );
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
