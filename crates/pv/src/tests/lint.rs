//! Layout lints.

use crate::{ModuleType, Plane, PvString, module_counts_differ};

fn string(modules: u16) -> PvString {
    PvString {
        module: ModuleType {
            pmax: 400.0,
            vmp: 34.0,
            power_coefficient: -0.35,
            voltage_coefficient: -0.27,
        },
        modules,
        plane: Plane {
            tilt: 30.0,
            azimuth: 0.0,
        },
        loss: 0.0,
    }
}

#[test]
fn parallel_strings_of_different_module_counts_warn() {
    assert!(module_counts_differ(&[string(16), string(14)]));
}

#[test]
fn parallel_strings_of_equal_module_counts_pass() {
    assert!(!module_counts_differ(&[string(16), string(16)]));
}

#[test]
fn a_single_string_passes() {
    assert!(!module_counts_differ(&[string(14)]));
    assert!(!module_counts_differ(&[]));
}
