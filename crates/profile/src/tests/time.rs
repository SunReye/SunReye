//! Time-valued settings (ADR 5, 7): minutes since midnight, written in the device's encoding.

use crate::{LoadError, Profile};
use serde_json::{Value, json};

fn doc(settings: &Value, requires: &Value) -> Value {
    json!({
        "schema": 1, "id": "case", "name": "case", "manufacturer": "test", "version": "1.0.0",
        "requires": requires, "quantities": [], "settings": settings,
    })
}

fn load(settings: &Value) -> Result<Profile, LoadError> {
    Profile::load(&doc(settings, &super::all()).to_string())
}

fn refusal(setting: &Value) -> &'static str {
    match load(&json!([setting.clone()])) {
        Err(LoadError::Setting { problem, .. }) => problem,
        other => panic!("expected a setting refusal, got {other:?}"),
    }
}

/// A Deye time-of-use slot's start: `HHMM` in register 148, in five-minute steps.
fn start() -> Value {
    json!({
        "key": "start", "type": "u16", "time": { "format": "hhmm", "step": 5 },
        "range": { "min": 0, "max": 1435 }, "minInterval": 60,
        "recipe": [{ "write": { "register": 148 } }], "readBack": { "register": 148 },
    })
}

#[test]
fn a_time_is_written_as_hours_and_minutes_on_its_step() {
    let profile = load(&json!([start()])).unwrap();
    let start = profile.setting("start").unwrap();

    assert!(start.time());
    assert!((start.step() - 5.0).abs() < f64::EPSILON);
    assert_eq!(start.range(), Some((0.0, 1435.0)));
    assert_eq!(start.encode(0.0), Some(vec![0]));
    assert_eq!(start.encode(1350.0), Some(vec![2230]));
    assert_eq!(start.encode(1435.0), Some(vec![2355]));
    for refused in [7.0, 1440.0, -5.0, 2.5, f64::NAN] {
        assert_eq!(start.encode(refused), None, "{refused}");
    }
}

#[test]
fn a_time_reads_back_from_hours_and_minutes() {
    let profile = load(&json!([start()])).unwrap();
    let start = profile.setting("start").unwrap();

    assert_eq!(start.decode(&[2230]), Some(1350.0));
    assert_eq!(start.decode(&[703]), Some(423.0));
    assert_eq!(start.decode(&[2400]), None);
    assert_eq!(start.decode(&[1260]), None);
}

#[test]
fn a_number_is_not_a_time() {
    let mut amps = start();
    amps.as_object_mut().unwrap().remove("time");
    let profile = load(&json!([amps])).unwrap();

    assert!(!profile.setting("start").unwrap().time());
}

#[test]
fn a_time_is_a_ranged_register_word_of_whole_minutes_within_a_day() {
    let mut wide = start();
    wide["type"] = json!("u32");
    assert_eq!(refusal(&wide), "a time is a `u16` at scale 1");
    let mut scaled = start();
    scaled["scale"] = json!(0.1);
    assert_eq!(refusal(&scaled), "a time is a `u16` at scale 1");
    let mut listed = start();
    listed.as_object_mut().unwrap().remove("range");
    listed["values"] = json!([0, 60]);
    assert_eq!(refusal(&listed), "a time declares a `range` within the day");
    let mut late = start();
    late["range"] = json!({ "min": 0, "max": 1440 });
    assert_eq!(refusal(&late), "a time declares a `range` within the day");
    let mut published = start();
    published["recipe"] = json!([{ "publish": { "topic": "start" } }]);
    assert_eq!(refusal(&published), "a time is written to a register");
    for step in [0, 7, 90] {
        let mut odd = start();
        odd["time"]["step"] = json!(step);
        assert_eq!(
            refusal(&odd),
            "a time's step is a whole number of minutes dividing an hour",
            "{step}"
        );
    }
}

#[test]
fn a_time_needs_its_capability() {
    let unrequired = Profile::load(&doc(&json!([start()]), &super::all_but("time")).to_string());

    assert_eq!(
        unrequired.unwrap_err().to_string(),
        "`requires` lacks `time`, which the profile uses"
    );
}
