//! The datasheet catalogue (ADR 27): inverter and battery entries refused when out of range or
//! inconsistent with themselves, as a module entry is.

use serde_json::{Value, json};

use crate::Invalid;
use crate::datasheets::Sheet;

/// A two-input 10 kW inverter and its battery, made up where the ticket is silent.
fn sheet() -> Value {
    json!({
        "source": { "title": "X10 hybrid series", "revision": "V1.2 2026-03",
            "url": "https://maker.example/x10.pdf" },
        "inverters": [{
            "inverter": {
                "maker": "Maker", "model": "X10", "makerCountry": "DE",
                "maxInputVoltage": 1000.0, "acRating": 10000.0, "efficiency": 97.5,
                "inputs": [
                    { "maxCurrent": 16.0, "minVoltage": 160.0, "maxVoltage": 950.0, "startVoltage": 180.0 },
                    { "maxCurrent": 16.0, "minVoltage": 160.0, "maxVoltage": 950.0, "startVoltage": 180.0 },
                ],
            },
            "profile": { "id": "maker-x", "variant": "10k" },
        }],
        "batteries": [{
            "battery": {
                "maker": "Maker", "model": "B10", "makerCountry": "DE", "madeIn": "CN",
                "usableCapacity": 9600.0, "chargePower": 5000.0, "dischargePower": 6000.0,
                "roundTripEfficiency": 95.0,
            },
            "profile": { "id": "maker-b" },
        }],
    })
}

fn parsed(sheet: &Value) -> Sheet {
    serde_json::from_value(sheet.clone()).unwrap()
}

fn load(sheet: &Value) -> Result<Sheet, Invalid> {
    let sheet = parsed(sheet);
    sheet.check().map(|()| sheet)
}

#[test]
fn a_sheet_copied_from_its_datasheet_passes() {
    let sheet = load(&sheet()).unwrap();

    assert_eq!(sheet.inverters[0].inverter.model, "X10");
    assert_eq!(sheet.batteries[0].battery.usable_capacity, 9600.0);
}

fn refused_at(sheet: &Value) -> (String, String) {
    match load(sheet) {
        Err(Invalid::Value { model, field }) => (model, field),
        other => panic!("not refused by value: {other:?}"),
    }
}

#[test]
fn a_sheet_without_its_source_or_models_is_refused() {
    let mut untitled = sheet();
    untitled["source"]["url"] = json!(" ");
    assert_eq!(load(&untitled), Err(Invalid::Source));

    let mut empty = sheet();
    empty["inverters"] = json!([]);
    empty["batteries"] = json!([]);
    assert_eq!(load(&empty), Err(Invalid::Source));
}

#[test]
fn every_entry_names_its_makers_seat() {
    let mut inverter = sheet();
    inverter["inverters"][0]["inverter"]
        .as_object_mut()
        .unwrap()
        .remove("makerCountry");
    assert_eq!(
        refused_at(&inverter),
        ("X10".into(), "inverter/makerCountry".into())
    );

    let mut battery = sheet();
    battery["batteries"][0]["battery"]
        .as_object_mut()
        .unwrap()
        .remove("makerCountry");
    assert_eq!(
        refused_at(&battery),
        ("B10".into(), "battery/makerCountry".into())
    );
}

#[test]
fn the_place_of_manufacture_is_left_out_where_the_datasheet_states_none() {
    let mut unstated = sheet();
    unstated["batteries"][0]["battery"]
        .as_object_mut()
        .unwrap()
        .remove("madeIn");

    assert!(load(&unstated).is_ok());
    assert_eq!(sheet()["inverters"][0]["inverter"].get("madeIn"), None);
}

#[test]
fn an_unphysical_type_is_refused_as_a_layout_would_refuse_it() {
    let mut country = sheet();
    country["inverters"][0]["inverter"]["makerCountry"] = json!("Germany");
    assert_eq!(
        refused_at(&country),
        ("X10".into(), "inverter/makerCountry".into())
    );

    let mut window = sheet();
    window["inverters"][0]["inverter"]["inputs"][1]["maxVoltage"] = json!(1100.0);
    assert_eq!(
        refused_at(&window),
        ("X10".into(), "inverter/inputs/1/maxVoltage".into())
    );
}

#[test]
fn an_inverter_value_copied_in_the_wrong_unit_or_out_of_its_range_is_refused() {
    let out_of_range = [
        ("maxInputVoltage", json!(2000.0)), // above the low-voltage directive's 1500 V DC
        ("acRating", json!(10.0)),          // kilowatts, not watts
        ("acRating", json!(600_000.0)),
        ("efficiency", json!(0.975)), // a fraction, not %
        ("efficiency", json!(100.0)),
        ("efficiency", json!(75.0)),
    ];
    for (field, value) in out_of_range {
        let mut bad = sheet();
        bad["inverters"][0]["inverter"][field] = value.clone();
        assert_eq!(
            refused_at(&bad),
            ("X10".into(), format!("inverter/{field}")),
            "{field} {value}"
        );
    }

    let mut current = sheet();
    current["inverters"][0]["inverter"]["inputs"][0]["maxCurrent"] = json!(160.0);
    assert_eq!(
        refused_at(&current),
        ("X10".into(), "inverter/inputs/0/maxCurrent".into())
    );
}

#[test]
fn a_battery_value_copied_in_the_wrong_unit_or_out_of_its_range_is_refused() {
    let out_of_range = [
        ("usableCapacity", json!(9.6)), // kilowatt-hours, not watt-hours
        ("chargePower", json!(5.0)),    // kilowatts, not watts
        ("dischargePower", json!(6.0)),
        ("roundTripEfficiency", json!(0.95)), // a fraction, not %
        ("roundTripEfficiency", json!(100.0)),
        ("roundTripEfficiency", json!(60.0)),
    ];
    for (field, value) in out_of_range {
        let mut bad = sheet();
        bad["batteries"][0]["battery"][field] = value.clone();
        assert_eq!(
            refused_at(&bad),
            ("B10".into(), format!("battery/{field}")),
            "{field} {value}"
        );
    }
}

#[test]
fn a_battery_whose_power_does_not_fit_its_capacity_is_refused() {
    // 9.6 kWh: above 4 C, below 0.05 C.
    for (field, value) in [("chargePower", 40_000.0), ("dischargePower", 400.0)] {
        let mut bad = sheet();
        bad["batteries"][0]["battery"][field] = json!(value);
        assert_eq!(
            refused_at(&bad),
            ("B10".into(), format!("battery/{field}")),
            "{field} {value}"
        );
    }
}

#[test]
fn an_entry_links_to_its_profile_by_model_id_where_one_exists() {
    let sheet = load(&sheet()).unwrap();
    let served = |id: &str, variant: Option<&str>| {
        id == "maker-x" && variant == Some("10k") || id == "maker-b" && variant.is_none()
    };
    let battery = |id: &str, _: Option<&str>| id == "maker-x";

    assert_eq!(sheet.unlinked(served), None);
    assert_eq!(sheet.unlinked(|_, _| false), Some("X10"));
    assert_eq!(sheet.unlinked(battery), Some("B10"));
}

#[test]
fn an_entry_without_a_profile_needs_none() {
    let mut unread = sheet();
    for entries in ["inverters", "batteries"] {
        unread[entries][0]
            .as_object_mut()
            .unwrap()
            .remove("profile");
    }
    let unread = load(&unread).unwrap();

    assert_eq!(unread.unlinked(|_, _| false), None);
}

#[test]
fn a_profile_link_that_names_no_model_is_refused() {
    let mut blank = sheet();
    blank["inverters"][0]["profile"]["id"] = json!(" ");
    assert_eq!(refused_at(&blank), ("X10".into(), "profile/id".into()));

    let mut variant = sheet();
    variant["inverters"][0]["profile"]["variant"] = json!("SUN-10K");
    assert_eq!(
        refused_at(&variant),
        ("X10".into(), "profile/variant".into())
    );
}

#[test]
fn a_member_the_format_does_not_know_is_refused() {
    let mut unknown = sheet();
    unknown["inverters"][0]["warranty"] = json!(10);

    assert!(serde_json::from_value::<Sheet>(unknown).is_err());
}

#[test]
fn an_entry_is_checked_on_its_own_as_in_a_sheet() {
    let sheet = parsed(&sheet());
    let mut battery = sheet.batteries[0].clone();
    battery.battery.round_trip_efficiency = 0.95;

    assert_eq!(sheet.inverters[0].check(), Ok(()));
    assert_eq!(
        battery.check(),
        Err(Invalid::Value {
            model: "B10".into(),
            field: "battery/roundTripEfficiency".into()
        })
    );
}
