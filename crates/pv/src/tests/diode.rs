//! De Soto's fit against pvlib 0.16.1 `ivtools.sdm.fit_desoto` (`fixtures/desoto.csv`).

use super::fixtures::{Row, rows};
use crate::ModuleType;
use crate::diode::fit;

fn module(row: &Row) -> ModuleType {
    ModuleType {
        vmp: row.get("vmp"),
        imp: row.get("imp"),
        voc: row.get("voc"),
        isc: row.get("isc"),
        voltage_coefficient: row.get("voltage_coefficient"),
        current_coefficient: row.get("current_coefficient"),
        width: 1.134,
        height: 1.722,
        bypass_diodes: 3,
    }
}

/// scipy's root finder stops near 1e-8 relative.
fn assert_fitted(actual: f64, expected: f64, what: &str) {
    assert!(
        (actual - expected).abs() <= 1e-7 * expected.abs(),
        "{what}: {actual} != pvlib {expected}"
    );
}

#[test]
fn the_datasheet_fit_matches_pvlib() {
    for (i, row) in rows(include_str!("../../fixtures/desoto.csv"))
        .iter()
        .enumerate()
    {
        let diode = fit(&module(row)).unwrap();

        assert_fitted(
            diode.photocurrent,
            row.get("photocurrent"),
            &format!("row {i} IL"),
        );
        assert_fitted(
            diode.saturation_current,
            row.get("saturation_current"),
            &format!("row {i} I0"),
        );
        assert_fitted(
            diode.series_resistance,
            row.get("series_resistance"),
            &format!("row {i} Rs"),
        );
        assert_fitted(
            diode.shunt_resistance,
            row.get("shunt_resistance"),
            &format!("row {i} Rsh"),
        );
        assert_fitted(diode.ideality, row.get("ideality"), &format!("row {i} a"));
    }
}

#[test]
fn a_datasheet_without_a_maximum_power_point_has_no_fit() {
    let row = &rows(include_str!("../../fixtures/desoto.csv"))[0];
    let impossible = ModuleType {
        vmp: 45.0,
        ..module(row)
    };

    assert!(fit(&impossible).is_none());
}
