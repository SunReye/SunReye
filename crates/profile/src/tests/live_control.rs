//! Live-control points (ADR 5, 7): declared now, written only by a controller under a lease.

use std::time::Duration;

use crate::{LiveControl, LoadError, Profile};
use serde_json::{Value, json};

/// SunSpec 704's export limit: a setpoint the device drops after its revert time.
fn limit(live: &Value) -> Value {
    json!({
        "schema": 1, "id": "case", "name": "case", "manufacturer": "test", "version": "1.0.0",
        "requires": super::all(), "quantities": [],
        "settings": [{
            "key": "limit", "type": "u16", "range": { "min": 0, "max": 100 }, "minInterval": 0,
            "recipe": [{ "write": { "register": 40 } }], "readBack": { "register": 40 },
            "liveControl": live,
        }],
    })
}

fn load(live: &Value) -> Result<Profile, LoadError> {
    Profile::load(&limit(live).to_string())
}

fn refused(problem: &'static str) -> LoadError {
    LoadError::Setting {
        key: "limit".to_owned(),
        problem,
    }
}

#[test]
fn a_live_control_point_declares_its_revert_heartbeat_and_fallback() {
    let live = json!({ "revert": 60, "heartbeat": { "register": 41, "interval": 30 },
                       "fallback": 100 });

    let profile = load(&live).unwrap();

    assert_eq!(
        profile.setting("limit").unwrap().live_control(),
        Some(&LiveControl {
            revert: Some(Duration::from_mins(1)),
            heartbeat: Some((41, Duration::from_secs(30))),
            fallback: Some(100.0),
        })
    );
    let ordinary = Profile::load(&{
        let mut doc = limit(&Value::Null);
        doc["settings"][0]
            .as_object_mut()
            .unwrap()
            .remove("liveControl");
        doc.to_string()
    })
    .unwrap();
    assert_eq!(ordinary.setting("limit").unwrap().live_control(), None);
}

#[test]
fn a_live_control_point_needs_a_revert_or_a_heartbeat_that_refreshes_in_time() {
    assert_eq!(
        load(&json!({ "revert": 0 })).unwrap_err(),
        refused("live control needs a revert time or a heartbeat; revert 0 is an ordinary setting")
    );
    assert_eq!(
        load(&json!({ "fallback": 100 })).unwrap_err(),
        refused("live control needs a revert time or a heartbeat; revert 0 is an ordinary setting")
    );
    assert_eq!(
        load(&json!({ "revert": 30, "heartbeat": { "register": 41, "interval": 30 } }))
            .unwrap_err(),
        refused("a heartbeat's interval is above 0 s and below the revert time")
    );
    assert_eq!(
        load(&json!({ "heartbeat": { "register": 41, "interval": 0 } })).unwrap_err(),
        refused("a heartbeat's interval is above 0 s and below the revert time")
    );
}

#[test]
fn a_fallback_is_a_value_the_setting_takes() {
    assert_eq!(
        load(&json!({ "revert": 60, "fallback": 101 })).unwrap_err(),
        refused("a fallback is a value the setting takes")
    );
}

#[test]
fn live_control_needs_its_capability() {
    let mut doc = limit(&json!({ "revert": 60 }));
    doc["requires"] = super::all_but("live-control");

    assert_eq!(
        Profile::load(&doc.to_string()).unwrap_err(),
        LoadError::Unrequired("live-control".to_owned())
    );
}
