//! Which deadband each role of a device is stored with (ADR 4).

use std::collections::BTreeMap;

use serde_json::json;
use sunreye_profile::Profile;

use super::{DeadbandSource, RoleDeadband, deadbands};

fn profile() -> Profile {
    let doc = json!({
        "schema": 1, "id": "case", "name": "case", "manufacturer": "test", "version": "1.0.0",
        "requires": ["modbus", "i16", "u16", "u32", "deadband"], "quantities": [
            { "key": "battery", "role": "battery.power", "register": 1, "type": "i16",
              "deadband": 20 },
            { "key": "grid", "role": "grid.power", "register": 2, "type": "i16" },
            { "key": "volts", "role": "battery.voltage", "register": 3, "type": "u16",
              "scale": 0.01, "deadband": 0.2 },
            { "key": "energy", "role": "pv.energy.total", "register": 4, "type": "u32" },
            { "key": "odd", "role": "extra.odd", "register": 6, "type": "u16" },
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
