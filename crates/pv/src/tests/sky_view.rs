//! Diffuse shading by the scene (ADR 17): each substring's sky view closes the nodes of the
//! shading table's grid its beam would be shaded at, and the circumsolar part of diffuse light
//! follows the beam's shade.

use super::fixtures::{MODULE, rows};
use crate::string::VIEW_STEP;
use crate::{
    Horizon, Input, Inverter, Layout, Location, Module, ModuleType, Occluder, Place, Plane, Point,
    PvString, ShadingTable, SkyViews, Weather, estimate, estimate_with, sun_position,
};

const BERLIN: Location = Location {
    latitude: 52.52,
    longitude: 13.38,
};
/// 11:00 UTC on 2026-06-21: the sun high in the south.
const JUNE_NOON: i64 = 1_782_000_000 + 11 * 3600;

const FLAT: Plane = Plane {
    tilt: 0.0,
    azimuth: 0.0,
};

/// One substring a module, so a module has one sky view.
const WHOLE: ModuleType = ModuleType {
    bypass_diodes: 1,
    ..MODULE
};

/// Overcast so dim that Perez gives no circumsolar part, and a flat module no horizon band nor
/// ground light: its sky diffuse is the sky view times the diffuse irradiance.
fn overcast(dhi: f64) -> Weather {
    Weather {
        unix: JUNE_NOON,
        ghi: dhi,
        dni: 0.0,
        dhi,
        temperature: 15.0,
        wind: None,
    }
}

/// A rectangle standing on the ground from `from` to `to`, `height` tall.
fn wall(from: Point, to: Point, height: f64) -> [Occluder; 2] {
    let up = |[x, y, z]: Point| [x, y, z + height];
    [
        Occluder::Triangle([from, to, up(to)]),
        Occluder::Triangle([from, up(to), up(from)]),
    ]
}

/// Each module its own string on one input, placed at `centres` on `plane`.
fn layout(module: ModuleType, plane: Plane, centres: &[Point], occluders: Vec<Occluder>) -> Layout {
    let string = |&centre| PvString {
        module,
        modules: vec![Module {
            plane,
            optimized: false,
            place: Some(Place {
                centre,
                landscape: false,
            }),
        }],
        loss: 0.0,
    };
    Layout {
        location: BERLIN,
        inverters: vec![Inverter {
            inputs: vec![Input {
                limits: None,
                strings: centres.iter().map(string).collect(),
            }],
            ac: None,
        }],
        occluders,
    }
}

fn views(layout: &Layout) -> SkyViews<'static> {
    SkyViews::new(layout, &mut ShadingTable::default(), None)
}

fn watts(layout: &Layout, weather: &Weather) -> f64 {
    estimate_with(layout, &views(layout), weather).inverters[0].power
}

#[test]
fn a_substring_beside_a_tall_wall_receives_less_diffuse_light_by_its_sky_view() {
    // A 4 m wall a metre east of the module, 400 m long.
    let beside = layout(
        WHOLE,
        FLAT,
        &[[0.0, 0.0, 0.0]],
        wall([1.0, -200.0, 0.0], [1.0, 200.0, 0.0], 4.0).into(),
    );
    let open = layout(WHOLE, FLAT, &[[0.0, 0.0, 0.0]], Vec::new());
    let view = views(&beside).of(0)[0];
    // The share the wall closes, to the step it reaches the circuit at.
    let circuit = ((1.0 - view) / VIEW_STEP).round().mul_add(-VIEW_STEP, 1.0);

    let shaded = watts(&beside, &overcast(60.0));
    let scaled = watts(&open, &overcast(60.0 * circuit));

    assert!(view < 0.8, "view {view}");
    // Its cells still warm by the open sky's light, so it yields a little less, never more.
    assert!(
        shaded <= scaled && shaded > 0.995 * scaled,
        "{shaded} W beside the wall, {scaled} W in the open under the diffuse it sees"
    );
}

#[test]
fn the_substring_nearest_a_wall_sees_the_least_sky() {
    // Portrait on a flat face: the three substrings lie side by side from west to east.
    let beside = layout(
        MODULE,
        FLAT,
        &[[0.0, 0.0, 0.0]],
        wall([1.0, -200.0, 0.0], [1.0, 200.0, 0.0], 4.0).into(),
    );

    let views = views(&beside);
    let [west, middle, east] = views.of(0) else {
        panic!("{:?}", views.of(0));
    };

    assert!(
        east < middle && middle < west && *west < 1.0,
        "{west} {middle} {east}"
    );
}

#[test]
fn the_circumsolar_part_is_lost_where_the_beam_is_shaded() {
    let sun = sun_position(JUNE_NOON, BERLIN);
    let (zenith, azimuth) = (sun.zenith.to_radians(), sun.azimuth.to_radians());
    let toward_sun = [
        -azimuth.sin() * zenith.sin(),
        -azimuth.cos() * zenith.sin(),
        zenith.cos(),
    ];
    // A crown on the sun's ray, wide enough to shade the whole module.
    let crown = Occluder::Sphere {
        centre: toward_sun.map(|k| 8.0 * k),
        radius: 2.0,
    };
    let open = layout(WHOLE, FLAT, &[[0.0, 0.0, 0.0]], Vec::new());
    let shaded = layout(WHOLE, FLAT, &[[0.0, 0.0, 0.0]], vec![crown]);
    // `estimate` shades no diffuse light by the scene: only the circumsolar part can go.
    let watts = |layout: &Layout, dhi| estimate(layout, &overcast(dhi)).inverters[0].power;

    // Bright overcast has a circumsolar part, which the crown takes though there is no beam.
    assert!(watts(&shaded, 300.0) < 0.97 * watts(&open, 300.0));
    // Dim overcast has none, so the crown takes nothing.
    assert_eq!(watts(&shaded, 60.0), watts(&open, 60.0));
}

/// Three rows of five modules at 30° facing south, `pitch` apart, each row a string and a
/// shade caster: the front row stands south, at y = 0.
fn rack_field(pitch: f64) -> Layout {
    let tilt = 30.0_f64;
    let plane = Plane { tilt, azimuth: 0.0 };
    let (rise, run) = (tilt.to_radians().sin(), tilt.to_radians().cos());
    let slant = MODULE.height;
    let row = |r: u8| {
        let foot = pitch * f64::from(r);
        let modules = (0..5)
            .map(|m| Module {
                plane,
                optimized: false,
                place: Some(Place {
                    centre: [
                        1.2 * f64::from(m),
                        (slant / 2.0).mul_add(run, foot),
                        slant / 2.0 * rise,
                    ],
                    landscape: false,
                }),
            })
            .collect();
        PvString {
            module: MODULE,
            modules,
            loss: 0.0,
        }
    };
    let caster = |r: u8| {
        let foot = pitch * f64::from(r);
        let (west, east) = (-0.6, 5.4);
        let top = |x| [x, slant.mul_add(run, foot), slant * rise];
        [
            Occluder::Triangle([[west, foot, 0.0], [east, foot, 0.0], top(east)]),
            Occluder::Triangle([[west, foot, 0.0], top(east), top(west)]),
        ]
    };
    Layout {
        location: BERLIN,
        inverters: vec![Inverter {
            inputs: vec![Input {
                limits: None,
                strings: (0..3).map(row).collect(),
            }],
            ac: None,
        }],
        occluders: (0..3).flat_map(caster).collect(),
    }
}

#[test]
fn rows_of_a_rack_field_take_each_others_diffuse_light() {
    let field = rack_field(3.5);
    let views = views(&field);
    let least = |string| views.of(string).iter().copied().fold(1.0, f64::min);
    let most = |string| views.of(string).iter().copied().fold(0.0, f64::max);

    let strings = estimate_with(&field, &views, &overcast(150.0)).inverters[0].inputs[0]
        .strings
        .clone();

    // Nothing stands before the front row; each row behind it sees less of the southern sky.
    assert!(least(0) > 0.99, "front: {:?}", views.of(0));
    assert!(
        most(1) < 0.97 && most(2) < 0.97,
        "{:?} {:?}",
        views.of(1),
        views.of(2)
    );
    assert!(
        strings[1] < strings[0] && strings[2] < strings[0],
        "{strings:?}"
    );
}

/// A module so small its sample points stand where its centre does.
const POINT: ModuleType = ModuleType {
    width: 0.01,
    height: 0.01,
    bypass_diodes: 1,
    ..MODULE
};

/// Half the length of a wall or row that stands for an endless one, in metres.
const ENDLESS: f64 = 300.0;

/// The golden view's geometry around a point at the origin.
fn golden(case: &str, tilt: f64, size: f64, distance: f64) -> Layout {
    let along = |x: f64| wall([x, -ENDLESS, 0.0], [x, ENDLESS, 0.0], size);
    let (plane, occluders): (Plane, Vec<Occluder>) = match case {
        "wall" => (FLAT, along(distance).into()),
        "street" => (FLAT, [along(distance), along(-distance)].concat()),
        "rows" => {
            // The row in front, to the south, its foot `distance` from the point's.
            let (rise, run) = (tilt.to_radians().sin(), tilt.to_radians().cos());
            let foot = |x| [x, -distance, 0.0];
            let top = |x| [x, size.mul_add(run, -distance), size * rise];
            let row = [
                Occluder::Triangle([foot(-ENDLESS), foot(ENDLESS), top(ENDLESS)]),
                Occluder::Triangle([foot(-ENDLESS), top(ENDLESS), top(-ENDLESS)]),
            ];
            (Plane { tilt, azimuth: 0.0 }, row.into())
        }
        _ => panic!("unknown case {case}"),
    };
    layout(POINT, plane, &[[0.0, 0.0, 0.0]], occluders)
}

/// Golden values from closed forms and pvlib (`fixtures/generate.py`): a point beside a long wall,
/// between two, and at the foot of a row in a field of rows. The 2° grid keeps within 0.001.
#[test]
fn simple_geometries_match_their_golden_sky_views() {
    for row in rows(include_str!("../../fixtures/skyview.csv")) {
        let case: String = row.get("case");
        let (tilt, size, distance) = (row.get("tilt"), row.get("size"), row.get("distance"));
        let expected: f64 = row.get("view");

        let view = views(&golden(&case, tilt, size, distance)).of(0)[0];

        assert!(
            (view - expected).abs() <= 0.002,
            "{case} {tilt}° {size} m at {distance} m: {view} != golden {expected}"
        );
    }
}

#[test]
fn a_horizon_alone_reaches_the_circuit_unrounded() {
    // 13° all round leaves a flat module cos² 13° of the sky, between two steps.
    let profile: Vec<[f64; 2]> = (-180..180).map(|a| [f64::from(a), 13.0]).collect();
    let horizon = Horizon::new(&profile).unwrap();
    let open = layout(WHOLE, FLAT, &[[0.0, 0.0, 0.0]], Vec::new());
    let views = SkyViews::new(&open, &mut ShadingTable::default(), Some(&horizon));
    let view = views.of(0)[0];

    let under = estimate_with(&open, &views, &overcast(60.0)).inverters[0].power;
    let scaled = watts(&open, &overcast(60.0 * view));

    assert!(
        (view / VIEW_STEP).round().mul_add(VIEW_STEP, -view).abs() > 0.002,
        "{view}"
    );
    assert!(
        (under - scaled).abs() <= 1e-9 * scaled,
        "{under} W under the horizon, {scaled} W under the diffuse it sees"
    );
}
