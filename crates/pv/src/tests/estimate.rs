//! The whole chain for the owner's layout against pvlib 0.16.1 (`fixtures/estimate.csv`), and
//! the MPPT and inverter limits on top of it.

use super::fixtures::{MODULE, Row, rows};
use crate::{
    Estimate, Input, Inverter, Layout, Location, MpptLimits, Plane, PvString, Weather, estimate,
};

fn string(azimuth: f64, modules: u16) -> PvString {
    let plane = Plane {
        tilt: 35.0,
        azimuth,
    };
    PvString::on_one_plane(MODULE, plane, modules, 0, 2.0)
}

/// Input 1: 16 south and 16 north in parallel; input 2: 14 south.
fn owner(limits: [Option<MpptLimits>; 2], ac_rating: Option<f64>) -> Layout {
    Layout {
        location: Location {
            latitude: 52.52,
            longitude: 13.38,
        },
        inverters: vec![Inverter {
            ac_rating,
            inputs: vec![
                Input {
                    limits: limits[0],
                    strings: vec![string(0.0, 16), string(180.0, 16)],
                },
                Input {
                    limits: limits[1],
                    strings: vec![string(0.0, 14)],
                },
            ],
        }],
        occluders: Vec::new(),
    }
}

fn weather(row: &Row) -> Weather {
    let wind: String = row.get("wind");
    Weather {
        unix: row.get("unix"),
        ghi: row.get("ghi"),
        dni: row.get("dni"),
        dhi: row.get("dhi"),
        temperature: row.get("temperature"),
        wind: wind.parse().ok(),
    }
}

/// 2026-06-21 11:00 UTC, the fixture's brightest row.
fn noon() -> Weather {
    Weather {
        unix: 1_782_039_600,
        ghi: 880.0,
        dni: 800.0,
        dhi: 150.0,
        temperature: 25.0,
        wind: Some(3.0),
    }
}

/// The sun position is SPA's within 0.02°, so a string's power is within 0.1 %, or half a watt
/// where a low sun magnifies the error.
fn assert_near(actual: f64, expected: f64, what: &str) {
    assert!(
        (actual - expected).abs() <= 1e-3f64.mul_add(expected.abs(), 0.5),
        "{what}: {actual} != pvlib {expected}"
    );
}

fn strings(estimate: &Estimate) -> Vec<f64> {
    estimate.inverters[0]
        .inputs
        .iter()
        .flat_map(|input| input.strings.iter().copied())
        .collect()
}

#[test]
fn inputs_and_strings_match_pvlib_through_the_day() {
    let layout = owner([None, None], None);
    for (i, row) in rows(include_str!("../../fixtures/estimate.csv"))
        .iter()
        .enumerate()
    {
        let estimate = estimate(&layout, &weather(row));

        let [first, second] = [
            &estimate.inverters[0].inputs[0],
            &estimate.inverters[0].inputs[1],
        ];
        assert_near(first.power, row.get("input1"), &format!("row {i} input 1"));
        assert_near(
            first.strings[0],
            row.get("south"),
            &format!("row {i} south"),
        );
        assert_near(
            first.strings[1],
            row.get("north"),
            &format!("row {i} north"),
        );
        assert_near(second.power, row.get("input2"), &format!("row {i} input 2"));
        assert_near(
            second.strings[0],
            row.get("input2"),
            &format!("row {i} alone"),
        );
    }
}

#[test]
fn inputs_and_the_inverter_sum_their_strings_without_limits() {
    let estimate = estimate(&owner([None, None], None), &noon());

    let inverter = &estimate.inverters[0];
    let [first, second] = [&inverter.inputs[0], &inverter.inputs[1]];
    assert_near(first.power, first.strings[0] + first.strings[1], "input 1");
    assert_near(second.power, second.strings[0], "input 2");
    assert_near(inverter.power, first.power + second.power, "inverter");
}

#[test]
fn parallel_strings_share_a_capped_input_by_their_modelled_current() {
    // Twins but for their loss, so one voltage: current, and so the share, follows power.
    let lossy = PvString {
        loss: 12.0,
        ..string(0.0, 16)
    };
    // Below the parallel strings' 2 × 9.9 A at their peak.
    let limits = MpptLimits {
        max_current: 10.0,
        min_voltage: 150.0,
        max_voltage: 850.0,
        start_voltage: 180.0,
    };
    let mut layout = owner([Some(limits), None], None);
    layout.inverters[0].inputs[0].strings = vec![string(0.0, 16), lossy];

    let estimate = estimate(&layout, &noon());

    let input = &estimate.inverters[0].inputs[0];
    assert_near(input.current, 10.0, "capped current");
    assert_near(
        input.strings[0] + input.strings[1],
        input.power,
        "the shares sum",
    );
    assert_near(
        input.strings[1] / input.strings[0],
        88.0 / 98.0,
        "the share",
    );
}

#[test]
fn the_inverter_is_capped_at_its_ac_rating() {
    let estimate = estimate(&owner([None, None], Some(5000.0)), &noon());

    assert_near(estimate.inverters[0].power, 5000.0, "inverter");
}

#[test]
fn at_night_nothing_is_produced() {
    let night = Weather {
        unix: 1_782_079_200,
        ghi: 0.0,
        dni: 0.0,
        dhi: 0.0,
        ..noon()
    };

    let estimate = estimate(&owner([None, None], None), &night);

    assert_eq!(strings(&estimate), [0.0, 0.0, 0.0]);
    assert!(estimate.inverters[0].power.abs() < f64::EPSILON);
}
