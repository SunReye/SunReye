//! Scene geometry: what shades which substrings, checked against the pvlib cases in
//! `fixtures/input.csv`, and a form-entered string against its per-module twin.

use super::fixtures::{MODULE, Row, assert_peak, rows};
use crate::{
    Estimate, Input, Inverter, Layout, Location, Module, Occluder, Place, Plane, Point, PvString,
    Sky, Sun, Weather, estimate, input_output,
};

const SOUTH: Plane = Plane {
    tilt: 35.0,
    azimuth: 0.0,
};
const CENTRE: Point = [0.0, 0.0, 5.0];

fn case(name: &str) -> Row {
    rows(include_str!("../../fixtures/input.csv"))
        .into_iter()
        .find(|row| row.get::<String>("case") == name)
        .unwrap()
}

/// The fixtures' bright sky, the sun in the south-east.
fn bright() -> Sky {
    Sky {
        sun: Sun {
            zenith: 40.0,
            azimuth: -50.0,
        },
        day_of_year: 172,
        ghi: 850.0,
        dni: 750.0,
        dhi: 150.0,
        temperature: 22.0,
        wind: Some(2.0),
    }
}

fn toward_sun() -> Point {
    let sun = bright().sun;
    let (zenith, azimuth) = (sun.zenith.to_radians(), sun.azimuth.to_radians());
    [
        -azimuth.sin() * zenith.sin(),
        -azimuth.cos() * zenith.sin(),
        zenith.cos(),
    ]
}

/// The point `across` metres across the slope and `up` metres up it from the first module's
/// centre, moved `lift` metres toward the sun.
fn on_roof(across: f64, up: f64, lift: f64) -> Point {
    let (tilt, azimuth) = (SOUTH.tilt.to_radians(), SOUTH.azimuth.to_radians());
    let across_slope = [azimuth.cos(), -azimuth.sin(), 0.0];
    let up_slope = [
        azimuth.sin() * tilt.cos(),
        azimuth.cos() * tilt.cos(),
        tilt.sin(),
    ];
    let ray = toward_sun();
    let mut point = CENTRE;
    for ((p, (a, u)), r) in point
        .iter_mut()
        .zip(across_slope.iter().zip(up_slope))
        .zip(ray)
    {
        *p += lift.mul_add(r, up.mul_add(u, across * a));
    }
    point
}

/// A rectangle on the roof's plane, lifted 1 m toward the sun, as two triangles.
fn rectangle(across: [f64; 2], up: [f64; 2]) -> [Occluder; 2] {
    lifted(across, up, 1.0)
}

fn lifted(across: [f64; 2], up: [f64; 2], lift: f64) -> [Occluder; 2] {
    let corner = |a, u| on_roof(a, u, lift);
    [
        Occluder::Triangle([
            corner(across[0], up[0]),
            corner(across[1], up[0]),
            corner(across[1], up[1]),
        ]),
        Occluder::Triangle([
            corner(across[0], up[0]),
            corner(across[1], up[1]),
            corner(across[0], up[1]),
        ]),
    ]
}

/// 16 modules on the south face, 3 m apart; the first at `CENTRE`.
fn string(landscape: bool) -> Input {
    let modules = (0..16u8)
        .map(|m| Module {
            plane: SOUTH,
            optimized: false,
            place: Some(Place {
                centre: [3.0 * f64::from(m), 0.0, 5.0],
                landscape,
            }),
        })
        .collect();
    Input {
        limits: None,
        strings: vec![PvString {
            module: MODULE,
            modules,
            loss: 2.0,
        }],
    }
}

fn power(input: &Input, occluders: &[Occluder]) -> f64 {
    input_output(input, &bright(), occluders).power
}

#[test]
fn a_roof_over_one_substrings_strip_shades_that_substring() {
    // Portrait: the first substring is the strip across the slope from -w/2 to -w/6.
    let strip = rectangle([-MODULE.width / 2.0, -MODULE.width / 6.0], [-1.0, 1.0]);

    assert_peak(
        power(&string(false), &strip),
        case("one module with one substring shaded").get("power"),
        "one substring",
    );
}

#[test]
fn a_band_along_the_eaves_shades_every_portrait_substring_but_one_landscape_substring() {
    // The bottom 20 cm of the first module, across its whole width.
    let portrait_eaves = rectangle(
        [-1.0, 1.0],
        [-MODULE.height / 2.0, 0.2 - MODULE.height / 2.0],
    );
    let landscape_eaves = rectangle([-1.0, 1.0], [-MODULE.width / 2.0, 0.2 - MODULE.width / 2.0]);

    assert_peak(
        power(&string(false), &portrait_eaves),
        case("one module fully shaded").get("power"),
        "portrait",
    );
    assert_peak(
        power(&string(true), &landscape_eaves),
        case("one module with one substring shaded").get("power"),
        "landscape",
    );
}

#[test]
fn a_pole_between_the_sun_and_a_substring_shades_it() {
    let [x, y, z] = on_roof(0.0, 0.0, 2.0);
    let pole = Occluder::Cylinder {
        base: [x, y, z - 0.05],
        radius: 0.05,
        height: 0.1,
    };

    assert_peak(
        power(&string(false), &[pole]),
        case("one module with one substring shaded").get("power"),
        "pole",
    );
}

#[test]
fn nothing_behind_a_module_shades_it() {
    let [below, _] = lifted([-1.0, 1.0], [-1.0, 1.0], -3.0);
    let behind = [
        Occluder::Sphere {
            centre: on_roof(0.0, 0.0, -2.0),
            radius: 0.5,
        },
        below,
    ];

    assert_peak(
        power(&string(false), &behind),
        power(&string(false), &[]),
        "behind",
    );
}

fn layout(strings: Vec<PvString>) -> Layout {
    Layout {
        location: Location {
            latitude: 52.52,
            longitude: 13.38,
        },
        inverters: vec![Inverter {
            ac_rating: None,
            inputs: vec![Input {
                limits: None,
                strings,
            }],
        }],
        occluders: Vec::new(),
    }
}

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

#[test]
fn a_form_entered_string_matches_its_per_module_layout() {
    let form = PvString::on_one_plane(MODULE, SOUTH, 16, 4, 2.0);
    let modules = (0..16u8)
        .map(|m| Module {
            plane: SOUTH,
            optimized: m < 4,
            place: Some(Place {
                centre: [1.2 * f64::from(m), 0.0, 5.0],
                landscape: false,
            }),
        })
        .collect();
    let placed = PvString {
        module: MODULE,
        modules,
        loss: 2.0,
    };

    let [form, placed]: [Estimate; 2] = [form, placed].map(|s| estimate(&layout(vec![s]), &noon()));

    assert_eq!(form, placed);
    assert!(form.inverters[0].power > 0.0);
}
