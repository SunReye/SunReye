//! One string against pvlib 0.16.1 (`fixtures/string.csv`) and worked examples.

use super::fixtures::{Row, assert_close, rows};
use crate::{ModuleType, Plane, PvString, Sky, Sun, string_output};

/// The string `fixtures/generate.py` models.
fn string(plane: Plane) -> PvString {
    PvString {
        module: ModuleType {
            pmax: 400.0,
            vmp: 34.0,
            power_coefficient: -0.35,
            voltage_coefficient: -0.27,
        },
        modules: 16,
        plane,
        loss: 2.0,
    }
}

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

/// Horizontal, the sun overhead, 800 W/m² on the plane, 20 °C air, no wind: the cell runs at 45 °C.
fn noon() -> Sky {
    Sky {
        sun: Sun {
            zenith: 0.0,
            azimuth: 0.0,
        },
        day_of_year: 172,
        ghi: 800.0,
        dni: 600.0,
        dhi: 200.0,
        temperature: 20.0,
        wind: None,
    }
}

const HORIZONTAL: Plane = Plane {
    tilt: 0.0,
    azimuth: 0.0,
};

#[test]
fn string_power_matches_pvlib() {
    for (i, row) in rows(include_str!("../../fixtures/string.csv"))
        .iter()
        .enumerate()
    {
        let plane = Plane {
            tilt: row.get("tilt"),
            azimuth: row.get("plane_azimuth"),
        };

        let output = string_output(&string(plane), &sky(row));

        assert_close(output.power, row.get("power"), &format!("row {i} power"));
    }
}

#[test]
fn voltage_is_the_datasheet_vmp_at_cell_temperature_times_the_module_count() {
    // 16 × 34 V × (1 − 0.27 % × (45 − 25) K)
    assert_close(
        string_output(&string(HORIZONTAL), &noon()).voltage,
        514.624,
        "voltage",
    );
}

#[test]
fn current_carries_the_power_at_that_voltage() {
    // (600 beam + 0.95 × 200 diffuse) / 1000 × 6400 W × (1 − 0.35 % × 20 K) × (1 − 2 %) = 4608.0384 W
    assert_close(
        string_output(&string(HORIZONTAL), &noon()).current,
        4608.0384 / 514.624,
        "current",
    );
}

#[test]
fn a_dark_string_has_no_current_or_voltage() {
    let night = Sky {
        sun: Sun {
            zenith: 110.0,
            azimuth: 180.0,
        },
        ghi: 0.0,
        dni: 0.0,
        dhi: 0.0,
        ..noon()
    };

    let output = string_output(&string(HORIZONTAL), &night);

    assert_close(output.power, 0.0, "power");
    assert_close(output.current, 0.0, "current");
    assert_close(output.voltage, 0.0, "voltage");
}
