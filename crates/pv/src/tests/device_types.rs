//! Inverter and battery types (ADR 27): datasheet values, refused when unphysical.

use crate::{BatteryType, InverterType, MpptInput, MpptLimits};

/// A field's pointer and how to put a bad value in it.
type Spoil<T> = (&'static str, fn(&mut T));

/// A two-input 10 kW inverter, made up where the ticket is silent.
fn inverter() -> InverterType {
    InverterType {
        maker: "Maker".into(),
        model: "X10".into(),
        maker_country: Some("DE".into()),
        made_in: None,
        max_input_voltage: 1000.0,
        ac_rating: 10_000.0,
        efficiency: 97.5,
        inputs: vec![
            MpptInput {
                max_current: 16.0,
                min_voltage: 160.0,
                max_voltage: 950.0,
                start_voltage: 180.0,
            };
            2
        ],
    }
}

fn battery() -> BatteryType {
    BatteryType {
        maker: "Maker".into(),
        model: "B10".into(),
        maker_country: None,
        made_in: Some("CN".into()),
        usable_capacity: 9_600.0,
        charge_power: 5_000.0,
        discharge_power: 6_000.0,
        round_trip_efficiency: 95.0,
    }
}

#[test]
fn a_datasheets_inverter_type_is_physical() {
    assert_eq!(inverter().unphysical(), None);
}

#[test]
fn an_inverter_types_limits_are_its_inputs_in_order() {
    let mut inverter = inverter();
    inverter.inputs[1].max_current = 32.0;

    let limits = inverter.limits();

    assert_eq!(
        limits,
        vec![
            MpptLimits {
                max_current: 16.0,
                min_voltage: 160.0,
                max_voltage: 950.0,
                start_voltage: 180.0,
            },
            MpptLimits {
                max_current: 32.0,
                min_voltage: 160.0,
                max_voltage: 950.0,
                start_voltage: 180.0,
            },
        ]
    );
}

#[test]
fn an_unphysical_inverter_type_names_its_first_bad_value() {
    let cases: [Spoil<InverterType>; 11] = [
        ("maker", |t| t.maker.clear()),
        ("model", |t| t.model = " ".into()),
        ("makerCountry", |t| t.maker_country = Some("Germany".into())),
        ("madeIn", |t| t.made_in = Some("de".into())),
        ("maxInputVoltage", |t| t.max_input_voltage = f64::NAN),
        ("acRating", |t| t.ac_rating = 0.0),
        ("efficiency", |t| t.efficiency = 100.5),
        ("inputs", |t| t.inputs.clear()),
        ("inputs/1/maxCurrent", |t| t.inputs[1].max_current = -1.0),
        ("inputs/0/minVoltage", |t| t.inputs[0].min_voltage = 960.0),
        ("inputs/1/maxVoltage", |t| t.inputs[1].max_voltage = 1100.0),
    ];
    for (field, spoil) in cases {
        let mut inverter = inverter();
        spoil(&mut inverter);

        assert_eq!(inverter.unphysical().as_deref(), Some(field));
    }
}

#[test]
fn a_start_voltage_above_the_window_is_unphysical() {
    let mut inverter = inverter();
    inverter.inputs[0].start_voltage = 951.0;

    assert_eq!(
        inverter.unphysical().as_deref(),
        Some("inputs/0/startVoltage")
    );
}

#[test]
fn a_datasheets_battery_type_is_physical() {
    assert_eq!(battery().unphysical(), None);
}

#[test]
fn an_unphysical_battery_type_names_its_first_bad_value() {
    let cases: [Spoil<BatteryType>; 6] = [
        ("maker", |t| t.maker.clear()),
        ("madeIn", |t| t.made_in = Some("CHN".into())),
        ("usableCapacity", |t| t.usable_capacity = 0.0),
        ("chargePower", |t| t.charge_power = f64::INFINITY),
        ("dischargePower", |t| t.discharge_power = -5.0),
        ("roundTripEfficiency", |t| t.round_trip_efficiency = 0.0),
    ];
    for (field, spoil) in cases {
        let mut battery = battery();
        spoil(&mut battery);

        assert_eq!(battery.unphysical().as_deref(), Some(field));
    }
}

/// A field a later schema adds is refused, not dropped: an older core must not misread a newer
/// plan (ADR 25).
#[test]
fn a_type_with_a_field_this_schema_does_not_know_is_refused() {
    let mut inverter = serde_json::to_value(inverter()).unwrap();
    inverter["inputs"][0]["batteryVoltage"] = 48.into();
    let mut battery = serde_json::to_value(battery()).unwrap();
    battery["cycles"] = 6000.into();

    assert!(serde_json::from_value::<InverterType>(inverter).is_err());
    assert!(serde_json::from_value::<BatteryType>(battery).is_err());
}

#[test]
fn a_type_reads_back_as_written_and_leaves_an_unknown_origin_out() {
    let json = serde_json::to_value(inverter()).unwrap();

    assert_eq!(json.get("madeIn"), None);
    assert_eq!(json["makerCountry"], "DE");
    assert_eq!(
        serde_json::from_value::<InverterType>(json).unwrap(),
        inverter()
    );
    let json = serde_json::to_value(battery()).unwrap();
    assert_eq!(
        serde_json::from_value::<BatteryType>(json).unwrap(),
        battery()
    );
}
