//! Layout lints.

use super::fixtures::MODULE;
use crate::{Plane, PvString, module_counts_differ};

fn string(modules: u16) -> PvString {
    let plane = Plane {
        tilt: 30.0,
        azimuth: 0.0,
    };
    PvString::on_one_plane(MODULE, plane, modules, 0, 0.0)
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
