//! Shading as a table (ADR 17): a year's run looks up which substrings a scene shades by the sun's
//! position. `estimate_with` traces every instant's beam shade, under the same sky views, and is
//! the oracle.

use super::fixtures::MODULE;
use crate::perez::cos_incidence;
use crate::shade::Casters;
use crate::{
    Energy, Estimate, Input, Inverter, Layout, Location, Module, MpptLimits, Occluder, Place,
    Plane, PvString, ShadingTable, SkyViews, Sun, Weather, clear_weather, estimate_with,
    sun_position, year, year_with,
};

const QUARTER: i64 = 900;
/// 00:00 UTC on 2026-01-21.
const JANUARY_21: i64 = 1_768_953_600;
const DAY: i64 = 86_400;
const JUNE_21: i64 = JANUARY_21 + 151 * DAY;
const DECEMBER_21: i64 = JANUARY_21 + 334 * DAY;

const BERLIN: Location = Location {
    latitude: 52.52,
    longitude: 13.38,
};

/// Its noon sun stands in the north, where azimuths wrap from 180 to −180.
const SYDNEY: Location = Location {
    latitude: -33.87,
    longitude: 151.21,
};

/// What looking shade up instead of tracing it may cost a string, of its energy: in one clear day,
/// where a shade's edge moved by half a node weighs most, and over the run. Since a step traces
/// a module whose substrings the nodes around the sun disagree on (#890) this scene reads under
/// 0.0001 % in both; at the nearest node alone it read 3.1 % in a day and 0.44 % over the run.
const DAY_TOLERANCE: f64 = 0.001;
const RUN_TOLERANCE: f64 = 0.001;

/// A row of `count` portrait modules 1.2 m apart at 5 m, facing `azimuth` at 35°.
fn row(azimuth: f64, count: u8) -> PvString {
    let modules = (0..count)
        .map(|m| Module {
            plane: Plane {
                tilt: 35.0,
                azimuth,
            },
            optimized: false,
            place: Some(Place {
                centre: [1.2 * f64::from(m), 0.0, 5.0],
                landscape: false,
            }),
        })
        .collect();
    PvString {
        module: MODULE,
        modules,
        loss: 2.0,
    }
}

/// Two rows in parallel, one turned 30° west, beside a wall to the east and under a pole and a
/// crown on the side the sun stands at noon: `toward` is +1 north of the rows, −1 south.
fn shaded(location: Location, azimuth: f64, toward: f64) -> Layout {
    let wall = |a: [f64; 2], b: [f64; 2]| {
        [
            Occluder::Triangle([[a[0], a[1], 0.0], [b[0], b[1], 0.0], [b[0], b[1], 10.0]]),
            Occluder::Triangle([[a[0], a[1], 0.0], [b[0], b[1], 10.0], [a[0], a[1], 10.0]]),
        ]
    };
    let mut occluders = vec![
        Occluder::Cylinder {
            base: [3.0, 6.0 * toward, 0.0],
            radius: 0.15,
            height: 9.0,
        },
        Occluder::Sphere {
            centre: [-6.0, 9.0 * toward, 8.0],
            radius: 2.5,
        },
    ];
    occluders.extend(wall([14.0, -8.0], [14.0, 8.0]));
    Layout {
        location,
        inverters: vec![Inverter {
            inputs: vec![Input {
                limits: None,
                strings: vec![row(azimuth, 8), row(azimuth + 30.0, 8)],
            }],
            ac: None,
        }],
        occluders,
    }
}

/// The 21st of every month, every quarter hour: each month's energy below is that day's.
fn clear_days(location: Location) -> Vec<Weather> {
    (0..12)
        .flat_map(|month| {
            let day = JANUARY_21 + month * 30 * DAY + month / 2 * DAY;
            (0..96).map(move |q| clear_weather(day + q * QUARTER, location))
        })
        .collect()
}

/// The estimate with its beam shade traced, under the sky views the table gives.
fn traced(layout: &Layout, weather: &Weather) -> Estimate {
    estimate_with(
        layout,
        &SkyViews::new(layout, &mut ShadingTable::default(), None),
        weather,
    )
}

/// Each string's energy by month, every instant traced.
fn traced_months(layout: &Layout, weather: &[Weather]) -> Vec<[f64; 12]> {
    let views = SkyViews::new(layout, &mut ShadingTable::default(), None);
    let mut strings = vec![[0.0; 12]; 2];
    for sample in weather {
        let month = crate::estimate::month(sample.unix.div_euclid(DAY));
        let at = estimate_with(layout, &views, sample);
        for (string, watts) in strings.iter_mut().zip(&at.inverters[0].inputs[0].strings) {
            string[month] += watts / 4.0;
        }
    }
    strings
}

fn assert_within(strings: &[Energy], traced: &[[f64; 12]]) {
    for (s, (string, traced)) in strings.iter().zip(traced).enumerate() {
        for (m, (&looked, &traced)) in string.months.iter().zip(traced).enumerate() {
            assert!(
                (looked - traced).abs() <= DAY_TOLERANCE * traced,
                "string {s} in month {m}: {looked} Wh looked up, {traced} Wh traced"
            );
        }
        let total: f64 = traced.iter().sum();
        assert!(
            (string.total - total).abs() <= RUN_TOLERANCE * total,
            "string {s}: {} Wh looked up, {total} Wh traced",
            string.total
        );
    }
}

/// Each string's energy by month, traced, once the scene is shown to shade the first row every
/// month.
fn traced_in_shade(layout: &Layout, weather: &[Weather]) -> Vec<[f64; 12]> {
    let traced = traced_months(layout, weather);
    let open = Layout {
        occluders: Vec::new(),
        ..layout.clone()
    };
    let unshaded = traced_months(&open, weather);
    assert!(
        (0..12).all(|m| traced[0][m] < 0.98 * unshaded[0][m]),
        "the scene shades the first row every month: {traced:?} against {unshaded:?}"
    );
    traced
}

#[test]
fn a_years_run_through_the_table_matches_the_traced_one_month_by_month() {
    let layout = shaded(BERLIN, 0.0, -1.0);
    let weather = clear_days(BERLIN);

    let run = year(&layout, &weather, QUARTER);

    let traced = traced_in_shade(&layout, &weather);
    assert_within(&run.inverters[0].inputs[0].strings, &traced);
}

#[test]
fn the_table_holds_where_azimuths_wrap() {
    let layout = shaded(SYDNEY, 180.0, 1.0);
    let weather = clear_days(SYDNEY);
    let mut table = ShadingTable::default();

    let run = year_with(&layout, &mut table, None, &weather, QUARTER);

    let traced = traced_in_shade(&layout, &weather);
    assert_within(&run.inverters[0].inputs[0].strings, &traced);
}

/// Each substring in layout order, shaded or not, traced under `sun`.
fn traced_at(layout: &Layout, sun: Sun) -> Vec<bool> {
    let casters = Casters::under(sun, &layout.occluders);
    let strings = layout.inverters[0].inputs[0].strings.iter();
    strings
        .flat_map(|string| {
            string.modules.iter().flat_map(|module| {
                let mut shaded = vec![false; usize::from(string.module.bypass_diodes)];
                if cos_incidence(module.plane, sun) > 0.0 {
                    let place = module.place.unwrap();
                    casters.mark(&string.module, module.plane, place, &mut shaded);
                }
                shaded
            })
        })
        .collect()
}

/// Whether each substring of a table's row loses its beam.
fn beams(row: &[u8]) -> Vec<bool> {
    row.iter().map(|&covered| covered > 0).collect()
}

fn sun(elevation: f64, azimuth: f64) -> Sun {
    Sun {
        zenith: 90.0 - elevation,
        azimuth,
    }
}

#[test]
fn a_sun_reads_the_nearest_node_on_either_side_of_north() {
    let layout = shaded(SYDNEY, 180.0, 1.0);
    let mut table = ShadingTable::default();
    table.refresh(&layout);
    // The sun, and the node 2° apart it reads.
    let cases = [
        (sun(20.6, 179.4), sun(20.0, 180.0)),
        (sun(20.6, -179.4), sun(20.0, -180.0)),
        (sun(31.4, 179.4), sun(32.0, 180.0)),
        (sun(33.4, 179.4), sun(34.0, 180.0)),
        (sun(35.4, 179.4), sun(36.0, 180.0)),
        (sun(19.4, 178.6), sun(20.0, 178.0)),
        (sun(19.4, -178.6), sun(20.0, -178.0)),
        (sun(9.2, -90.8), sun(10.0, -90.0)),
        (sun(89.6, 37.0), sun(90.0, 36.0)),
    ];
    assert!(
        cases
            .iter()
            .any(|(_, node)| traced_at(&layout, *node).contains(&true)),
        "the scene shades a substring at some node"
    );

    for (at, node) in cases {
        let row = beams(table.row(at).unwrap());

        assert_eq!(row, traced_at(&layout, node), "the sun at {at:?}");
    }
    assert_eq!(table.row(sun(-0.1, 180.0)), None, "the sun down");
}

/// A minute of `day` where the node nearest the sun and the sun itself disagree on a substring's
/// beam, the sun's azimuth within `azimuths`.
fn minute_off_its_node(
    layout: &Layout,
    table: &ShadingTable,
    day: i64,
    azimuths: fn(f64) -> bool,
) -> Weather {
    (0..1440)
        .map(|m| clear_weather(day + 60 * m, layout.location))
        .find(|w| {
            let sun = sun_position(w.unix, layout.location);
            sun.zenith < 85.0
                && azimuths(sun.azimuth)
                && table
                    .row(sun)
                    .is_some_and(|row| beams(row) != traced_at(layout, sun))
        })
        .unwrap()
}

/// One minute's energy, its shade looked up, against the same minute traced.
fn looked_up_and_traced(layout: &Layout, table: &mut ShadingTable, minute: &Weather) -> (f64, f64) {
    let run = year_with(layout, table, None, std::slice::from_ref(minute), 60);
    let traced = traced(layout, minute).inverters[0].power / 60.0;
    (run.inverters[0].dc.total, traced)
}

/// A layout, a day, and the azimuths to find a minute at.
type Case = (Layout, i64, fn(f64) -> bool);

#[test]
fn where_the_nodes_around_the_sun_disagree_a_step_traces_its_beam() {
    let cases: [Case; 2] = [
        (shaded(BERLIN, 0.0, -1.0), DECEMBER_21, |azimuth| {
            azimuth.abs() < 60.0
        }),
        // In the cells either side of north, where azimuths wrap.
        (shaded(SYDNEY, 180.0, 1.0), JUNE_21, |azimuth| {
            azimuth.abs() > 178.0
        }),
    ];
    for (layout, day, azimuths) in cases {
        let mut table = ShadingTable::default();
        table.refresh(&layout);
        let minute = minute_off_its_node(&layout, &table, day, azimuths);

        let (looked_up, traced) = looked_up_and_traced(&layout, &mut table, &minute);

        assert!(
            (looked_up - traced).abs() <= 1e-9 * traced,
            "{looked_up} Wh looked up, {traced} Wh traced at {}",
            minute.unix
        );
    }
}

/// A ball 200 m from a module, along the sun's ray: its shadow, 0.5 m across, misses the module
/// under the suns at the nodes around.
#[test]
fn a_step_reads_a_shade_no_node_around_it_sees_from_the_table() {
    let mut layout = shaded(BERLIN, 0.0, -1.0);
    layout.inverters[0].inputs[0].strings = vec![row(0.0, 1)];
    // A sun near the middle of its cell, in both elevation and azimuth.
    let middle = |degrees: f64| (degrees.rem_euclid(2.0) - 1.0).abs() < 0.3;
    let minute = (0..1440)
        .map(|m| clear_weather(DECEMBER_21 + 60 * m, BERLIN))
        .find(|w| {
            let sun = sun_position(w.unix, BERLIN);
            sun.azimuth.abs() < 30.0 && middle(90.0 - sun.zenith) && middle(sun.azimuth)
        })
        .unwrap();
    let sun = sun_position(minute.unix, BERLIN);
    let (zenith, azimuth) = (sun.zenith.to_radians(), sun.azimuth.to_radians());
    let toward = [
        -azimuth.sin() * zenith.sin(),
        -azimuth.cos() * zenith.sin(),
        zenith.cos(),
    ];
    let module = [0.0, 0.0, 5.0];
    layout.occluders = vec![Occluder::Sphere {
        centre: std::array::from_fn(|k| 200.0f64.mul_add(toward[k], module[k])),
        radius: 0.25,
    }];
    let mut table = ShadingTable::default();
    table.refresh(&layout);
    assert!(
        traced_at(&layout, sun).contains(&true),
        "the ball shades the module"
    );
    assert!(
        !beams(table.row(sun).unwrap()).contains(&true),
        "the nearest node sees no shade"
    );

    let (looked_up, traced) = looked_up_and_traced(&layout, &mut table, &minute);

    assert!(
        looked_up > traced * (1.0 + 1e-6),
        "{looked_up} Wh looked up, {traced} Wh traced"
    );
}

#[test]
fn the_table_is_traced_again_when_the_scene_or_the_layout_changes_and_not_otherwise() {
    let layout = shaded(BERLIN, 0.0, -1.0);
    let mut table = ShadingTable::default();
    let june = clear_weather(JUNE_21 + 11 * 3600, BERLIN);
    let _ = year_with(&layout, &mut table, None, &[june], QUARTER);
    let december = clear_weather(DECEMBER_21 + 11 * 3600, BERLIN);
    let _ = year_with(&layout, &mut table, None, &[december], QUARTER);
    assert!(!table.refresh(&layout), "a year's run traced it, once");

    let changed = |change: &dyn Fn(&mut Layout)| {
        let mut changed = layout.clone();
        change(&mut changed);
        let mut table = ShadingTable::default();
        table.refresh(&layout);
        table.refresh(&changed)
    };
    let scene_and_layout: [Change; 6] = [
        ("a caster removed", &|l| l.occluders.truncate(2)),
        ("a module moved", &|l| {
            first(l).modules[0].place.as_mut().unwrap().centre[0] += 0.1;
        }),
        ("a module turned", &|l| {
            first(l).modules[0].plane.tilt += 1.0;
        }),
        ("a module removed", &|l| _ = first(l).modules.pop()),
        ("a module type with other bypass diodes", &|l| {
            first(l).module.bypass_diodes = 2;
        }),
        ("strings rewired", &|l| {
            l.inverters[0].inputs[0].strings.reverse();
        }),
    ];
    for (what, change) in scene_and_layout {
        assert!(changed(change), "{what}");
    }
    let otherwise: [Change; 5] = [
        ("the location", &|l| l.location = SYDNEY),
        ("a string's loss", &|l| first(l).loss = 5.0),
        ("a datasheet's electrics", &|l| first(l).module.vmp += 1.0),
        ("an optimizer", &|l| first(l).modules[0].optimized = true),
        ("an input's limits", &|l| {
            l.inverters[0].inputs[0].limits = Some(MpptLimits {
                max_current: 20.0,
                min_voltage: 150.0,
                max_voltage: 850.0,
                start_voltage: 180.0,
            });
        }),
    ];
    for (what, change) in otherwise {
        assert!(!changed(change), "{what}");
    }
}

/// What changed, and the change.
type Change<'a> = (&'a str, &'a dyn Fn(&mut Layout));

fn first(layout: &mut Layout) -> &mut PvString {
    &mut layout.inverters[0].inputs[0].strings[0]
}
