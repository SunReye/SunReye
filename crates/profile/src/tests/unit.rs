//! A quantity's unit is its role's, from ADR 4's table.

use crate::{Profile, Unit};
use serde_json::json;

fn units(roles: &[(&str, Option<u32>)]) -> Vec<Option<Unit>> {
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
    Profile::load(&doc.to_string())
        .unwrap()
        .quantities()
        .iter()
        .map(crate::Quantity::unit)
        .collect()
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
