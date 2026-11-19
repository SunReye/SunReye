//! MPPT window warnings (ADR 20).

use std::collections::BTreeMap;

use super::fixtures::MODULE;
use crate::{MpptLimits, Sizing, Wired, longest_string, window_warnings};

/// Two inputs, each tracking 160–650 V from 160 V at up to 36 A.
fn inverter() -> BTreeMap<u32, Vec<MpptLimits>> {
    let input = MpptLimits {
        max_current: 36.0,
        min_voltage: 160.0,
        max_voltage: 650.0,
        start_voltage: 160.0,
    };
    BTreeMap::from([(1, vec![input, input])])
}

fn string(input: u32, modules: u16) -> Wired {
    Wired {
        device: 1,
        input,
        module: MODULE,
        modules,
    }
}

fn warnings(strings: &[Wired]) -> Vec<Sizing> {
    window_warnings(strings, &inverter())
}

#[test]
fn a_string_inside_its_inputs_window_passes() {
    assert_eq!(warnings(&[string(1, 10), string(2, 10)]), vec![]);
}

#[test]
fn a_string_too_short_to_start_in_the_cold_never_starts_and_runs_low_too() {
    // 3 × 41 V × (1 + 0.27 % × 35 K) = 134.6 V under the 160 V start; each limit left is told.
    let [
        Sizing::Start {
            string: 0,
            volts,
            limit,
        },
        Sizing::Low {
            string: 0,
            volts: hot,
            ..
        },
    ] = warnings(&[string(1, 3)])[..]
    else {
        panic!("{:?}", warnings(&[string(1, 3)]));
    };
    assert!((volts - 134.6235).abs() < 1e-9);
    assert!((limit - 160.0).abs() < 1e-9);
    // 3 × 34 V × (1 − 0.27 % × 45 K) = 89.6 V under the window's 160 V.
    assert!((hot - 89.607).abs() < 1e-9);
}

#[test]
fn a_string_whose_hot_peak_lies_under_the_window_is_held_off_it() {
    // 5 × 34 V × (1 − 0.27 % × 45 K) = 149.3 V under the window's 160 V; it starts at 224 V.
    let [
        Sizing::Low {
            string: 0,
            volts,
            limit,
        },
    ] = warnings(&[string(1, 5)])[..]
    else {
        panic!("{:?}", warnings(&[string(1, 5)]));
    };
    assert!((volts - 149.345).abs() < 1e-9);
    assert!((limit - 160.0).abs() < 1e-9);
}

#[test]
fn a_string_whose_cold_peak_lies_over_the_window_is_clipped() {
    // 18 × 34 V × 1.0945 = 669.8 V over the window's 650 V.
    let [
        Sizing::High {
            string: 0,
            volts,
            limit,
        },
    ] = warnings(&[string(1, 18)])[..]
    else {
        panic!("{:?}", warnings(&[string(1, 18)]));
    };
    assert!((volts - 669.834).abs() < 1e-9);
    assert!((limit - 650.0).abs() < 1e-9);
}

#[test]
fn parallel_strings_over_the_inputs_current_warn() {
    // 3 × 12.5 A = 37.5 A over 36 A.
    let found = warnings(&[string(2, 10), string(2, 10), string(2, 10)]);
    assert_eq!(
        found,
        vec![Sizing::Current {
            device: 1,
            input: 2,
            amperes: 37.5,
            limit: 36.0
        }]
    );
}

#[test]
fn parallel_strings_of_different_lengths_warn() {
    assert_eq!(
        warnings(&[string(1, 10), string(1, 12), string(2, 10)]),
        vec![Sizing::Uneven {
            device: 1,
            input: 1
        }]
    );
}

#[test]
fn a_string_on_an_input_the_inverter_lacks_warns() {
    assert_eq!(
        warnings(&[string(3, 10)]),
        vec![Sizing::NoInput { string: 0 }]
    );
    // Inputs count from 1.
    assert_eq!(
        warnings(&[string(0, 10)]),
        vec![Sizing::NoInput { string: 0 }]
    );
}

#[test]
fn an_unwired_string_and_an_inverter_without_limits_warn_nothing() {
    assert_eq!(warnings(&[string(1, 0)]), vec![]);
    let unknown = Wired {
        device: 9,
        ..string(5, 3)
    };
    assert_eq!(warnings(&[unknown]), vec![]);
}

#[test]
fn the_longest_string_keeps_its_cold_voltages_under_the_inverters_and_the_windows() {
    let window = inverter()[&1][0];
    // 17 × 44.87 V = 762.9 V open under 800 V; 17 × 37.21 V = 632.6 V at its peak under 650 V.
    assert_eq!(
        longest_string(&MODULE, Some(800.0), Some(&window)),
        Some(17)
    );
    // 13 × 44.87 V = 583.4 V under a 600 V inverter.
    assert_eq!(
        longest_string(&MODULE, Some(600.0), Some(&window)),
        Some(13)
    );
    assert_eq!(longest_string(&MODULE, Some(600.0), None), Some(13));
    // 15 × 37.21 V = 558.2 V under a 560 V window.
    let narrow = MpptLimits {
        max_voltage: 560.0,
        ..window
    };
    assert_eq!(longest_string(&MODULE, None, Some(&narrow)), Some(15));
    assert_eq!(longest_string(&MODULE, None, None), None);
}
