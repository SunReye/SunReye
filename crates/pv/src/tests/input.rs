//! Shade, optimizers and MPPT limits on one input against pvlib 0.16.1 (`fixtures/input.csv`).

use super::fixtures::{MODULE, Row, assert_peak, rows};
use crate::{
    Input, Module, MpptLimits, Occluder, Place, Plane, Point, PvString, Sky, Sun, input_output,
};

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

fn toward(sun: Sun) -> Point {
    let (zenith, azimuth) = (sun.zenith.to_radians(), sun.azimuth.to_radians());
    [
        -azimuth.sin() * zenith.sin(),
        -azimuth.cos() * zenith.sin(),
        zenith.cos(),
    ]
}

/// The centre of a portrait module's substring: substrings sit side by side across the slope.
fn substring_centre(centre: Point, plane: Plane, part: u8) -> Point {
    let azimuth = plane.azimuth.to_radians();
    let across = [azimuth.cos(), -azimuth.sin()];
    let parts = f64::from(MODULE.bypass_diodes);
    let by = MODULE.width * ((f64::from(part) + 0.5) / parts - 0.5);
    [
        by.mul_add(across[0], centre[0]),
        by.mul_add(across[1], centre[1]),
        centre[2],
    ]
}

fn limits(row: &Row) -> Option<MpptLimits> {
    let limits: String = row.get("limits");
    let limits: Vec<f64> = limits.split(' ').filter_map(|v| v.parse().ok()).collect();
    match limits[..] {
        [max_current, min_voltage, max_voltage, start_voltage] => Some(MpptLimits {
            max_current,
            min_voltage,
            max_voltage,
            start_voltage,
        }),
        _ => None,
    }
}

/// The row's strings, each module 3 m from the next, and a small ball on the sun's ray through
/// each substring the row shades.
fn input(row: &Row, sun: Sun) -> (Input, Vec<Occluder>) {
    let limits = limits(row);
    let mut occluders = Vec::new();
    let mut strings = Vec::new();
    let spec: String = row.get("strings");
    for (s, modules) in spec.split('|').enumerate() {
        let mut built = Vec::new();
        for (m, token) in modules.split(' ').enumerate() {
            let [tilt, azimuth, optimizer, shaded] = token.split(':').collect::<Vec<_>>()[..]
            else {
                panic!("module {token}");
            };
            let plane = Plane {
                tilt: tilt.parse().unwrap(),
                azimuth: azimuth.parse().unwrap(),
            };
            #[expect(clippy::cast_precision_loss, reason = "a few dozen modules")]
            let centre = [3.0 * m as f64, 50.0 * s as f64, 5.0];
            for part in 0..shaded.parse::<u8>().unwrap() {
                let ray = toward(sun);
                let at = substring_centre(centre, plane, part);
                occluders.push(Occluder::Sphere {
                    centre: [
                        2.0f64.mul_add(ray[0], at[0]),
                        2.0f64.mul_add(ray[1], at[1]),
                        2.0f64.mul_add(ray[2], at[2]),
                    ],
                    radius: 0.05,
                });
            }
            built.push(Module {
                plane,
                optimized: optimizer == "o",
                place: Some(Place {
                    centre,
                    landscape: false,
                }),
            });
        }
        strings.push(PvString {
            module: MODULE,
            modules: built,
            loss: 2.0,
        });
    }
    (Input { limits, strings }, occluders)
}

#[test]
fn shade_optimizers_and_limits_match_pvlib() {
    for row in &rows(include_str!("../../fixtures/input.csv")) {
        let case: String = row.get("case");
        let sky = sky(row);
        let (input, occluders) = input(row, sky.sun);

        let output = input_output(&input, &sky, &occluders);

        assert_peak(output.power, row.get("power"), &format!("{case}: power"));
        assert_peak(
            output.voltage,
            row.get("voltage"),
            &format!("{case}: voltage"),
        );
        assert_peak(
            output.current,
            row.get("current"),
            &format!("{case}: current"),
        );
        let shares: String = row.get("shares");
        for (k, share) in shares.split(' ').enumerate() {
            assert_peak(
                output.strings[k],
                share.parse().unwrap(),
                &format!("{case}: string {k}"),
            );
        }
    }
}
