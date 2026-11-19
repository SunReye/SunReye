//! A plant like the owner's under a saved scene: a guard on its shaded output, and the model's
//! cost by stage (`docs/pv-model.md`), printed by
//! `cargo test -p sunreye-pv --release cost_by_stage -- --ignored --nocapture`.

use std::hint::black_box;
use std::time::Instant;

use serde_json::json;

use super::fixtures::MODULE;
use crate::diode::fit;
use crate::estimate::{SECONDS_PER_DAY, day_of_year};
use crate::perez::cos_incidence;
use crate::shade::Casters;
use crate::string::Curve;
use crate::{
    GridModule, Input, Inverter, Layout, Location, Module, ModuleGrid, MpptLimits, Occluder, Place,
    Plane, Point, PvString, Scene, Size, Sky, Spot, Sun, Weather, clear_weather, estimate,
    input_output, plane_irradiance, sun_position,
};

const BERLIN: Location = Location {
    latitude: 52.52,
    longitude: 13.38,
};
/// 00:00 UTC on 2026-06-21, 2026-03-21 and 2026-12-21.
const JUNE: i64 = 1_782_000_000;
const MARCH: i64 = 1_774_051_200;
const DECEMBER: i64 = 1_797_811_200;
const QUARTER: i64 = 900;
const HOUR: i64 = 3600;

fn grid(face: usize, cells: [u32; 2], string: impl Fn(u32) -> u32) -> ModuleGrid {
    let [rows, columns] = cells;
    let modules = (0..rows * columns).map(|cell| GridModule {
        spot: Spot::Cell {
            row: cell / columns,
            column: cell % columns,
        },
        string: Some(string(cell)),
        optimized: false,
        order: None,
    });
    ModuleGrid {
        block: 0,
        face,
        module_type: 1,
        landscape: false,
        setback: 0.3,
        modules: modules.collect(),
    }
}

/// An 18 m × 10 m gable house at 35° with a chimney on its south face, a neighbour and a
/// broadleaf to the south, a conifer to the north-west and a pole. South: strings 0 (16 modules)
/// and 2 (14); north: string 1 (16).
fn scene() -> Scene {
    let mut scene: Scene = serde_json::from_value(json!({
        "north": 0.0,
        "blocks": [{
            "x": 0.0, "z": 0.0, "width": 18.0, "depth": 10.0, "eave": 3.0, "rotation": 0.0,
            "roof": { "kind": "gable", "pitch": 35.0 },
        }],
        "obstacles": [
            { "kind": "box", "x": -6.0, "z": 14.0, "width": 5.0, "depth": 4.0, "height": 7.0,
              "rotation": 0.0 },
            { "kind": "tree", "x": 20.0, "z": 14.0, "radius": 2.5, "height": 9.0 },
            { "kind": "tree", "x": -3.0, "z": -3.0, "radius": 2.0, "height": 10.0,
              "crown": "conifer" },
            { "kind": "cylinder", "x": 9.0, "z": 16.0, "radius": 0.1, "height": 8.0 },
        ],
        "chimneys": [{
            "block": 0, "face": 1, "across": 14.0, "up": 3.0, "width": 0.6, "depth": 0.6,
            "height": 1.2,
        }],
    }))
    .unwrap();
    scene.grids = vec![
        grid(1, [3, 10], |cell| if cell < 16 { 0 } else { 2 }),
        grid(0, [2, 8], |_| 1),
    ];
    scene
}

/// Input 1: strings 0 and 1 in parallel; input 2: string 2. No optimizers, and a maximum input
/// current the strings never reach.
fn layout() -> Layout {
    plant(|_| false, 26.0)
}

/// The plant with an optimizer on each module `optimized` picks by its place along its string,
/// and each input's maximum current.
fn plant(optimized: impl Fn(usize) -> bool, max_current: f64) -> Layout {
    let scene = scene();
    let size = Size {
        width: MODULE.width,
        height: MODULE.height,
    };
    let placed = scene.modules(|_| Some(size)).unwrap();
    let string = |id| PvString {
        module: MODULE,
        modules: placed
            .iter()
            .filter(|p| p.string == Some(id))
            .enumerate()
            .map(|(along, p)| Module {
                optimized: optimized(along),
                ..p.module
            })
            .collect(),
        loss: 2.0,
    };
    let limits = Some(MpptLimits {
        max_current,
        min_voltage: 150.0,
        max_voltage: 850.0,
        start_voltage: 180.0,
    });
    Layout {
        location: BERLIN,
        inverters: vec![Inverter {
            inputs: vec![
                Input {
                    limits,
                    strings: vec![string(0), string(1)],
                },
                Input {
                    limits,
                    strings: vec![string(2)],
                },
            ],
        }],
        occluders: scene.occluders(),
    }
}

fn strings(layout: &Layout) -> impl Iterator<Item = &PvString> {
    let inputs = layout.inverters.iter().flat_map(|i| &i.inputs);
    inputs.flat_map(|i| &i.strings)
}

fn sky(layout: &Layout, weather: &Weather) -> Sky {
    Sky {
        sun: sun_position(weather.unix, layout.location),
        day_of_year: day_of_year(weather.unix.div_euclid(SECONDS_PER_DAY)),
        ghi: weather.ghi,
        dni: weather.dni,
        dhi: weather.dhi,
        temperature: weather.temperature,
        wind: weather.wind,
    }
}

/// Each string's shaded substrings, among its modules that face the sun.
fn shaded(layout: &Layout, weather: &Weather) -> Vec<u32> {
    let sun = sky(layout, weather).sun;
    let casters = Casters::under(sun, &layout.occluders);
    strings(layout)
        .map(|string| {
            let facing = string
                .modules
                .iter()
                .filter(|m| cos_incidence(m.plane, sun) > 0.0);
            let places = facing.filter_map(|m| Some((m.plane, m.place?)));
            places
                .map(|(plane, place)| {
                    let shaded = casters.shaded_substrings(&string.module, plane, place);
                    u32::from(shaded)
                })
                .sum()
        })
        .collect()
}

/// Within a millionth of the model's own output before its speed-up (commit 4beb7db4), which
/// the pins below hold: they guard the scene's path through the model, which the pvlib fixtures
/// (no scene) do not reach.
fn assert_pinned(actual: f64, pinned: f64, what: &str) {
    assert!(
        (actual - pinned).abs() <= 1e-6 * pinned.abs().max(1.0),
        "{what}: {actual} != {pinned}, the model's output when it was pinned"
    );
}

/// When, each string's shaded substrings, and each input's watts.
type Pinned = (i64, [u32; 3], [f64; 2]);

#[rustfmt::skip]
const PINNED: [Pinned; 9] = [
    (JUNE + 4 * HOUR, [0, 0, 0], [1_183.773_162_591_9, 113.916_610_076_6]),
    (JUNE + 6 * HOUR, [0, 0, 5], [3_807.766_098_771_0, 1_269.550_456_240_3]),
    (JUNE + 11 * HOUR, [0, 0, 0], [8_514.290_208_260_7, 5_061.729_607_186_8]),
    (JUNE + 18 * HOUR, [0, 10, 0], [1_153.316_926_618_6, 141.812_659_574_9]),
    (MARCH + 7 * HOUR, [30, 0, 14], [754.256_804_452_1, 1_085.603_631_824_1]),
    (MARCH + 14 * HOUR, [11, 0, 0], [3_258.789_215_938_4, 3_410.190_270_132_4]),
    (DECEMBER + 9 * HOUR, [6, 0, 3], [1_857.144_134_374_1, 1_596.864_559_373_8]),
    (DECEMBER + 11 * HOUR, [1, 0, 2], [3_279.426_922_977_4, 2_609.278_981_338_2]),
    (DECEMBER + 13 * HOUR, [20, 0, 9], [1_307.059_727_166_0, 1_452.311_075_245_3]),
];

#[test]
fn a_scenes_shade_reaches_each_input_through_the_day() {
    let layout = layout();

    for (unix, substrings, powers) in PINNED {
        let weather = clear_weather(unix, BERLIN);

        let estimate = estimate(&layout, &weather);

        assert_eq!(shaded(&layout, &weather), substrings, "at {unix}");
        for (input, power) in estimate.inverters[0].inputs.iter().zip(powers) {
            assert_pinned(input.power, power, &format!("power at {unix}"));
        }
    }
}

/// When, and each input's watts, volts and amperes, with an optimizer on every fourth module
/// and inputs that take 9 A.
type Capped = (i64, [[f64; 3]; 2]);

#[rustfmt::skip]
const CAPPED: [Capped; 3] = [
    // Both inputs at their 9 A.
    (JUNE + 11 * HOUR, [[6_021.901_678_933_0, 669.100_186_548_1, 9.0], [4_498.445_151_981_4, 499.827_239_109_0, 9.0]]),
    // Shade on optimized and plain modules alike, under the cap.
    (MARCH + 7 * HOUR, [[823.896_388_676_8, 203.606_634_836_0, 4.046_510_514_5], [1_113.981_031_321_9, 310.934_039_102_3, 3.582_692_440_3]]),
    (DECEMBER + 13 * HOUR, [[1_340.473_972_394_2, 309.254_954_713_4, 4.334_527_068_9], [1_482.041_968_159_9, 367.977_692_971_1, 4.027_532_093_6]]),
];

#[test]
fn optimizers_and_a_binding_current_limit_hold_under_a_scenes_shade() {
    let layout = plant(|along| along % 4 == 1, 9.0);

    for (unix, inputs) in CAPPED {
        let estimate = estimate(&layout, &clear_weather(unix, BERLIN));

        for (input, [power, voltage, current]) in estimate.inverters[0].inputs.iter().zip(inputs) {
            assert_pinned(input.power, power, &format!("power at {unix}"));
            assert_pinned(input.voltage, voltage, &format!("voltage at {unix}"));
            assert_pinned(input.current, current, &format!("current at {unix}"));
        }
    }
}

/// The point `lift` metres out of the front of a module's centre.
fn over(on: Plane, at: Place, lift: f64) -> Point {
    let (tilt, azimuth) = (on.tilt.to_radians(), on.azimuth.to_radians());
    let normal = [
        -azimuth.sin() * tilt.sin(),
        -azimuth.cos() * tilt.sin(),
        tilt.cos(),
    ];
    let [east, north, up] = at.centre;
    [
        lift.mul_add(normal[0], east),
        lift.mul_add(normal[1], north),
        lift.mul_add(normal[2], up),
    ]
}

/// Things lying on modules, a few centimetres over their planes: a pebble, a ball half sunk
/// into the roof and a leaf.
fn litter(placed: &[(Plane, Place)]) -> Vec<Occluder> {
    let [(pebbled, pebble), (sunk, ball), (leafy, leaf)] = [placed[0], placed[2], placed[4]];
    let [east, north, up] = over(leafy, leaf, 0.02);
    vec![
        Occluder::Sphere {
            centre: over(pebbled, pebble, 0.01),
            radius: 0.02,
        },
        Occluder::Sphere {
            centre: over(sunk, ball, -0.01),
            radius: 0.05,
        },
        Occluder::Triangle([
            [east, north, up],
            [east + 0.1, north, up],
            [east, north + 0.1, up],
        ]),
    ]
}

#[test]
fn ruling_casters_out_never_changes_what_is_shaded() {
    let layout = layout();
    let modules: Vec<_> = strings(&layout).flat_map(|s| &s.modules).collect();
    // Every third module, as laid and turned, and one hung on the south wall.
    let roof = modules
        .iter()
        .step_by(3)
        .filter_map(|m| Some((m.plane, m.place?)));
    let wall = Plane {
        tilt: 90.0,
        azimuth: 0.0,
    };
    let hung = Place {
        centre: [9.0, -10.05, 1.5],
        landscape: false,
    };
    let placed: Vec<(Plane, Place)> = roof
        .flat_map(|(plane, place)| {
            let turned = Place {
                landscape: true,
                ..place
            };
            [(plane, place), (plane, turned)]
        })
        .chain([(wall, hung)])
        .collect();
    let occluders = [layout.occluders.clone(), litter(&placed)].concat();
    let mut shaded = 0;
    let mut lit = 0;

    // Down to a sun grazing the horizon, all around the compass.
    for zenith in [10.0, 35.0, 60.0, 75.0, 85.0, 89.0, 89.9, 89.999] {
        for step in 0..24 {
            let sun = Sun {
                zenith,
                azimuth: 15.0f64.mul_add(f64::from(step), -180.0),
            };
            let casters = Casters::under(sun, &occluders);
            for &(plane, place) in &placed {
                let ruled_out = casters.shaded_substrings(&MODULE, plane, place);

                let exhaustive = casters.shaded_exhaustively(&MODULE, plane, place);

                assert_eq!(ruled_out, exhaustive, "{sun:?} on {place:?}");
                shaded += u32::from(exhaustive > 0);
                lit += u32::from(exhaustive == 0);
            }
        }
    }
    // Both happen often, so the sweep compares shade with shade.
    assert!(shaded > 500 && lit > 500, "{shaded} shaded, {lit} lit");
}

/// The best of five runs, in milliseconds.
fn time(run: impl Fn()) -> f64 {
    let once = || {
        let start = Instant::now();
        run();
        start.elapsed().as_secs_f64() * 1e3
    };
    (0..5).map(|_| once()).fold(f64::MAX, f64::min)
}

/// Milliseconds each stage takes over a day's `weather`.
fn stages(layout: &Layout, weather: &[Weather]) -> [(&'static str, f64); 7] {
    let skies: Vec<Sky> = weather.iter().map(|w| sky(layout, w)).collect();
    let each = |run: &dyn Fn(&Sky)| time(|| skies.iter().for_each(run));
    let sun = time(|| {
        for w in weather {
            black_box(sun_position(w.unix, layout.location));
        }
    });
    let transposition = each(&|sky| {
        for module in strings(layout).flat_map(|s| &s.modules) {
            black_box(plane_irradiance(module.plane, sky));
        }
    });
    let shade = time(|| {
        for w in weather.iter().filter(|w| w.dni > 0.0) {
            black_box(shaded(layout, w));
        }
    });
    let fitting = each(&|_| {
        for string in strings(layout) {
            black_box(fit(&string.module));
        }
    });
    let curves = each(&|sky| {
        let casters = Casters::under(sky.sun, &layout.occluders);
        for string in strings(layout) {
            black_box(Curve::new(string, sky, &casters).top);
        }
    });
    let operating = each(&|sky| {
        for input in layout.inverters.iter().flat_map(|i| &i.inputs) {
            black_box(input_output(input, sky, &layout.occluders));
        }
    });
    let whole = time(|| {
        for w in weather {
            black_box(estimate(layout, w));
        }
    });
    [
        ("sun position", sun),
        ("transposition", transposition),
        ("shade", shade),
        ("datasheet fit", fitting),
        (
            "rest of the curves",
            curves - transposition - shade - fitting,
        ),
        ("operating point", operating - curves),
        ("estimate", whole),
    ]
}

#[test]
#[ignore = "a profile, read by a person"]
#[expect(clippy::print_stdout, reason = "a profile, read by a person")]
fn cost_by_stage() {
    let layout = layout();
    for (day, start) in [("June", JUNE), ("March", MARCH), ("December", DECEMBER)] {
        let weather: Vec<Weather> = (0..96)
            .map(|k| clear_weather(start + QUARTER * k, BERLIN))
            .collect();
        let lit = weather.iter().filter(|w| w.ghi > 0.0).count();

        println!("{day}: {lit} of 96 instants lit; ms per instant");
        for (stage, milliseconds) in stages(&layout, &weather) {
            println!("  {stage:<18} {:.4}", milliseconds / 96.0);
        }
    }
}
