//! One string on one plane against pvlib 0.16.1 (`fixtures/string.csv`) and its datasheet.

use super::fixtures::{MODULE, Row, assert_peak, rows};
use crate::{Input, Plane, PvString, Sky, Sun, input_output};

fn sky(row: &Row) -> Sky {
    let wind: String = row.get("wind");
    Sky {
        sun: Sun {
            zenith: row.get("zenith"),
            azimuth: row.get("sun_azimuth"),
        },
        day_of_year: row.get("day_of_year"),
        ghi: row.get("ghi"),
        dni: row.get("dni"),
        dhi: row.get("dhi"),
        temperature: row.get("temperature"),
        wind: wind.parse().ok(),
    }
}

/// 16 modules, 2 % loss, alone on an input without limits.
fn alone(plane: Plane) -> Input {
    Input {
        limits: None,
        strings: vec![PvString::on_one_plane(MODULE, plane, 16, 0, 2.0)],
    }
}

const HORIZONTAL: Plane = Plane {
    tilt: 0.0,
    azimuth: 0.0,
};

#[test]
fn a_strings_maximum_power_point_matches_pvlib() {
    for (i, row) in rows(include_str!("../../fixtures/string.csv"))
        .iter()
        .enumerate()
    {
        let plane = Plane {
            tilt: row.get("tilt"),
            azimuth: row.get("plane_azimuth"),
        };

        let output = input_output(&alone(plane), &sky(row), &[]);

        assert_peak(output.power, row.get("power"), &format!("row {i} power"));
        assert_peak(
            output.voltage,
            row.get("voltage"),
            &format!("row {i} voltage"),
        );
        assert_peak(
            output.current,
            row.get("current"),
            &format!("row {i} current"),
        );
    }
}

#[test]
fn at_standard_test_conditions_a_string_delivers_its_datasheet() {
    // The sun overhead: 1000 W/m² of beam, no diffuse; a NOCT rise of 31.25 K holds the cell at 25 °C.
    let stc = Sky {
        sun: Sun {
            zenith: 0.0,
            azimuth: 0.0,
        },
        day_of_year: 172,
        ghi: 1000.0,
        dni: 1000.0,
        dhi: 0.0,
        temperature: -6.25,
        wind: None,
    };

    let output = input_output(&alone(HORIZONTAL), &stc, &[]);

    // 16 × 34 V; 11.76 A less 2 %
    assert_peak(output.voltage, 544.0, "voltage");
    assert_peak(output.current, 11.76 * 0.98, "current");
}

#[test]
fn a_dark_string_has_no_current_or_voltage() {
    let night = Sky {
        sun: Sun {
            zenith: 110.0,
            azimuth: 180.0,
        },
        day_of_year: 172,
        ghi: 0.0,
        dni: 0.0,
        dhi: 0.0,
        temperature: 10.0,
        wind: None,
    };

    let output = input_output(&alone(HORIZONTAL), &night, &[]);

    assert_eq!(
        [
            output.power,
            output.current,
            output.voltage,
            output.strings[0]
        ],
        [0.0; 4]
    );
}
