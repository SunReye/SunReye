//! Reads the pvlib golden fixtures written by `fixtures/generate.py`.

use std::collections::HashMap;
use std::fmt::Debug;
use std::str::FromStr;

use crate::ModuleType;

pub struct Row(HashMap<String, String>);

impl Row {
    pub fn get<T: FromStr<Err: Debug>>(&self, column: &str) -> T {
        self.0[column].parse().unwrap()
    }
}

pub fn rows(csv: &str) -> Vec<Row> {
    let mut lines = csv.lines();
    let header: Vec<String> = lines.next().unwrap().split(',').map(String::from).collect();
    lines
        .map(|line| {
            Row(header
                .iter()
                .cloned()
                .zip(line.split(',').map(String::from))
                .collect())
        })
        .collect()
}

pub fn assert_close(actual: f64, expected: f64, what: &str) {
    let tolerance = 1e-9 * expected.abs().max(1.0);
    assert!(
        (actual - expected).abs() <= tolerance,
        "{what}: {actual} != pvlib {expected}"
    );
}

/// The module `fixtures/generate.py` models.
pub const MODULE: ModuleType = ModuleType {
    vmp: 34.0,
    imp: 11.76,
    voc: 41.0,
    isc: 12.5,
    voltage_coefficient: -0.27,
    current_coefficient: 0.05,
    width: 1.134,
    height: 1.722,
    bypass_diodes: 3,
};

/// Within a millionth of pvlib, or a microwatt: both sides refine their peak to the last digits.
pub fn assert_peak(actual: f64, expected: f64, what: &str) {
    assert!(
        (actual - expected).abs() <= 1e-6 * expected.abs().max(1.0),
        "{what}: {actual} != pvlib {expected}"
    );
}
