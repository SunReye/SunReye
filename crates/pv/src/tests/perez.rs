//! Perez transposition against pvlib 0.16.1 `get_total_irradiance(model="perez")`.

use super::fixtures::{Row, assert_close, rows};
use crate::{Plane, Sky, Sun, plane_irradiance};

fn sky(row: &Row) -> Sky {
    Sky {
        sun: Sun {
            zenith: row.get("zenith"),
            azimuth: row.get("sun_azimuth"),
        },
        day_of_year: row.get("day_of_year"),
        ghi: row.get("ghi"),
        dni: row.get("dni"),
        dhi: row.get("dhi"),
        temperature: 20.0,
        wind: None,
    }
}

#[test]
fn perez_matches_pvlib() {
    for (i, row) in rows(include_str!("../../fixtures/perez.csv"))
        .iter()
        .enumerate()
    {
        let plane = Plane {
            tilt: row.get("tilt"),
            azimuth: row.get("plane_azimuth"),
        };
        let poa = plane_irradiance(plane, &sky(row));

        assert_close(poa.beam, row.get("beam"), &format!("row {i} beam"));
        assert_close(
            poa.sky_diffuse,
            row.get("sky_diffuse"),
            &format!("row {i} sky diffuse"),
        );
        assert_close(
            poa.ground_diffuse,
            row.get("ground_diffuse"),
            &format!("row {i} ground"),
        );
    }
}

#[test]
fn a_sky_without_diffuse_light_adds_no_sky_diffuse() {
    let sky = Sky {
        ghi: 0.0,
        dni: 0.0,
        dhi: 0.0,
        ..sky(&rows(include_str!("../../fixtures/perez.csv"))[1])
    };

    let poa = plane_irradiance(
        Plane {
            tilt: 30.0,
            azimuth: 0.0,
        },
        &sky,
    );

    assert_close(poa.sky_diffuse, 0.0, "sky diffuse");
}
