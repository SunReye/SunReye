//! A horizon profile the caller supplies to a run (ADR 17): a sun below it gives no beam, and it
//! trims each module's sky view.

use super::fixtures::MODULE;
use crate::sky_view::sky_view;
use crate::{
    Horizon, HorizonRefused, Input, Inverter, Layout, Location, Module, Occluder, Place, Plane,
    PvString, ShadingTable, SkyViews, Weather, clear_weather, estimate, estimate_with,
    sun_position, year, year_with,
};

const QUARTER: i64 = 900;
/// 00:00 UTC on 2026-06-21.
const JUNE_21: i64 = 1_782_000_000;

const BERLIN: Location = Location {
    latitude: 52.52,
    longitude: 13.38,
};

const SOUTH: Plane = Plane {
    tilt: 35.0,
    azimuth: 0.0,
};

/// Ten modules facing south at 35°, placed in a row, a pole south-east of them.
fn plant() -> Layout {
    let modules = (0..10)
        .map(|m| Module {
            plane: SOUTH,
            optimized: false,
            place: Some(Place {
                centre: [1.2 * f64::from(m), 0.0, 5.0],
                landscape: false,
            }),
        })
        .collect();
    Layout {
        location: BERLIN,
        inverters: vec![Inverter {
            inputs: vec![Input {
                limits: None,
                strings: vec![PvString {
                    module: MODULE,
                    modules,
                    loss: 2.0,
                }],
            }],
            ac: None,
        }],
        occluders: vec![Occluder::Cylinder {
            base: [8.0, -6.0, 0.0],
            radius: 0.15,
            height: 9.0,
        }],
    }
}

/// A clear 2026-06-21 at quarter hours.
fn clear_day() -> Vec<Weather> {
    (0..96)
        .map(|k| clear_weather(JUNE_21 + QUARTER * k, BERLIN))
        .collect()
}

fn views<'a>(layout: &Layout, horizon: Option<&'a Horizon>) -> SkyViews<'a> {
    SkyViews::new(layout, &mut ShadingTable::default(), horizon)
}

fn watts(layout: &Layout, horizon: Option<&Horizon>, weather: &Weather) -> f64 {
    horizon
        .map_or_else(
            || estimate(layout, weather),
            |h| estimate_with(layout, &views(layout, Some(h)), weather),
        )
        .inverters[0]
        .power
}

/// One pair per degree from −180 going east, each elevation from `at`.
fn profile(at: impl Fn(f64) -> f64) -> Vec<[f64; 2]> {
    (-180..180)
        .map(|azimuth| {
            let azimuth = f64::from(azimuth);
            [azimuth, at(azimuth)]
        })
        .collect()
}

#[test]
fn a_profile_is_interpolated_between_its_degrees() {
    let horizon = Horizon::new(&profile(|azimuth| {
        if (azimuth - 10.0).abs() < 0.5 {
            4.0
        } else {
            0.0
        }
    }))
    .unwrap();

    assert!((horizon.elevation(10.0) - 4.0).abs() < 1e-12);
    assert!((horizon.elevation(9.5) - 2.0).abs() < 1e-12);
    assert!((horizon.elevation(10.25) - 3.0).abs() < 1e-12);
    assert!(horizon.elevation(11.0).abs() < 1e-12);
}

#[test]
fn a_profile_wraps_from_its_last_degree_to_its_first() {
    let horizon = Horizon::new(&profile(|azimuth| {
        if (azimuth - 179.0).abs() < 0.5 {
            6.0
        } else {
            2.0
        }
    }))
    .unwrap();

    assert!((horizon.elevation(179.5) - 4.0).abs() < 1e-12);
    assert!((horizon.elevation(-180.0) - 2.0).abs() < 1e-12);
    assert!((horizon.elevation(-179.75) - 2.0).abs() < 1e-12);
    // −180 and 180 are both north.
    assert!((horizon.elevation(180.0) - 2.0).abs() < 1e-12);
}

#[test]
fn any_other_shape_is_refused() {
    let short = &profile(|_| 0.0)[1..];
    assert_eq!(
        Horizon::new(short).unwrap_err(),
        HorizonRefused::Length(359)
    );

    let mut shifted = profile(|_| 0.0);
    shifted[90][0] = -89.5;
    assert_eq!(
        Horizon::new(&shifted).unwrap_err(),
        HorizonRefused::Azimuth(-89.5)
    );

    for elevation in [-0.1, 90.5, f64::NAN] {
        let mut wrong = profile(|_| 0.0);
        wrong[200][1] = elevation;
        let refused = Horizon::new(&wrong).unwrap_err();
        assert!(
            matches!(refused, HorizonRefused::Elevation { azimuth, .. } if (azimuth - 20.0).abs() < 1e-9),
            "{elevation}: {refused:?}"
        );
    }
}

#[test]
fn a_uniform_horizon_leaves_a_flat_module_the_square_of_its_cosine() {
    let flat = Plane {
        tilt: 0.0,
        azimuth: 0.0,
    };
    for (elevation, expected) in [(30.0, 0.75), (60.0, 0.25), (45.0, 0.5), (13.0, 0.949_397_2)] {
        let horizon = Horizon::new(&profile(|_| elevation)).unwrap();

        let view = sky_view(flat, |_, node| horizon.elevation(node.azimuth));

        assert!((view - expected).abs() < 1e-6, "at {elevation}°: {view}");
    }
}

#[test]
fn an_open_horizon_leaves_the_whole_sky() {
    let horizon = Horizon::new(&profile(|_| 0.0)).unwrap();
    for (tilt, azimuth) in [(0.0, 0.0), (35.0, 0.0), (35.0, -73.0), (90.0, 180.0)] {
        let view = sky_view(Plane { tilt, azimuth }, |_, node| {
            horizon.elevation(node.azimuth)
        });

        assert!((view - 1.0).abs() < 1e-15, "{tilt}° at {azimuth}°: {view}");
    }
}

#[test]
fn a_horizon_behind_a_module_hides_none_of_its_sky_and_one_before_it_much() {
    let south = Plane {
        tilt: 35.0,
        azimuth: 0.0,
    };
    let behind = Horizon::new(&profile(
        |azimuth| if azimuth.abs() > 120.0 { 20.0 } else { 0.0 },
    ))
    .unwrap();
    let before = Horizon::new(&profile(
        |azimuth| if azimuth.abs() < 60.0 { 20.0 } else { 0.0 },
    ))
    .unwrap();

    let view = |horizon: &Horizon| sky_view(south, |_, node| horizon.elevation(node.azimuth));
    let (behind, before) = (view(&behind), view(&before));

    // A plane tilted 35° south sees the northern sky only above 35°.
    assert!((behind - 1.0).abs() < 1e-12, "behind: {behind}");
    assert!(before < 0.9, "before: {before}");
}

#[test]
fn a_sun_below_the_profile_gives_no_beam() {
    let layout = plant();
    let morning = clear_weather(JUNE_21 + 7 * 3600, BERLIN);
    let sun = sun_position(morning.unix, BERLIN);
    assert!(sun.azimuth < -40.0 && sun.zenith < 60.0, "{sun:?}");
    // Two hills alike, mirrored about the modules' azimuth, so they hide as much of their sky:
    // only the first stands before the sun.
    let hill = |centre: f64| {
        Horizon::new(&profile(|azimuth| {
            if (azimuth - centre).abs() <= 8.0 {
                75.0
            } else {
                0.0
            }
        }))
        .unwrap()
    };
    let (before, beside) = (hill(sun.azimuth.round()), hill(-sun.azimuth.round()));

    let open = watts(&layout, None, &morning);
    let hidden = watts(&layout, Some(&before), &morning);
    let lit = watts(&layout, Some(&beside), &morning);

    assert!(lit < open && lit > 0.97 * open, "beside: {lit} of {open} W");
    assert!(
        hidden > 0.0 && hidden < 0.5 * lit,
        "hidden: {hidden} of {lit} W"
    );
}

#[test]
fn a_run_with_a_horizon_yields_less_than_without() {
    let layout = plant();
    let hills = Horizon::new(&profile(|azimuth| {
        6.0f64.mul_add((azimuth / 30.0).sin(), 12.0)
    }))
    .unwrap();

    let without = year(&layout, &clear_day(), QUARTER).inverters[0].dc.total;
    let with = year_with(
        &layout,
        &mut ShadingTable::default(),
        Some(&hills),
        &clear_day(),
        QUARTER,
    )
    .inverters[0]
        .dc
        .total;

    // A June sun stands high: hills of 6–18° hide its mornings and evenings.
    assert!(
        with < 0.995 * without && with > 0.9 * without,
        "{with} of {without} Wh"
    );
}

#[test]
fn an_open_horizon_computes_as_before() {
    let layout = plant();
    let open = Horizon::new(&profile(|_| 0.0)).unwrap();

    let with = year_with(
        &layout,
        &mut ShadingTable::default(),
        Some(&open),
        &clear_day(),
        QUARTER,
    );

    assert_eq!(with, year(&layout, &clear_day(), QUARTER));
    let (open, none) = (views(&layout, Some(&open)), views(&layout, None));
    for sample in clear_day() {
        assert_eq!(
            estimate_with(&layout, &open, &sample),
            estimate_with(&layout, &none, &sample)
        );
    }
}

#[test]
fn a_horizon_leaves_the_layout_and_its_shading_table_alone() {
    let layout = plant();
    let hills = Horizon::new(&profile(|_| 10.0)).unwrap();
    let mut table = ShadingTable::default();
    let without = year_with(&layout, &mut table, None, &clear_day(), QUARTER);

    let with = year_with(&layout, &mut table, Some(&hills), &clear_day(), QUARTER);

    assert!(!table.refresh(&layout), "a horizon retraced the table");
    assert_ne!(with, without);
    assert_eq!(
        year_with(&layout, &mut table, None, &clear_day(), QUARTER),
        without
    );
}

#[test]
fn a_horizon_never_opens_more_sky_than_none() {
    // A south plane tilted t sees the northern sky above t: a horizon just above that, behind
    // it, crosses the same node's band as the plane's own horizon.
    for tilt in 1..60 {
        let tilt = f64::from(tilt);
        let behind = Horizon::new(&profile(|azimuth| {
            if azimuth.abs() > 150.0 {
                tilt + 0.4
            } else {
                0.0
            }
        }))
        .unwrap();

        let view = sky_view(Plane { tilt, azimuth: 0.0 }, |_, node| {
            behind.elevation(node.azimuth)
        });

        assert!(view <= 1.0, "{tilt}°: {view}");
    }
}

#[test]
fn under_a_sun_below_the_profile_the_scene_shades_nothing_more() {
    let morning = clear_weather(JUNE_21 + 7 * 3600, BERLIN);
    let sun = sun_position(morning.unix, BERLIN);
    let (zenith, azimuth) = (sun.zenith.to_radians(), sun.azimuth.to_radians());
    let toward_sun = [
        -azimuth.sin() * zenith.sin(),
        -azimuth.cos() * zenith.sin(),
        zenith.cos(),
    ];
    // A crown 12 m from the row's middle module, toward the sun.
    let middle = [6.0, 0.0, 5.0];
    let crown = Occluder::Sphere {
        centre: [0, 1, 2].map(|k| 12.0f64.mul_add(toward_sun[k], middle[k])),
        radius: 2.0,
    };
    let bare = Layout {
        occluders: Vec::new(),
        ..plant()
    };
    let crowned = Layout {
        occluders: vec![crown],
        ..plant()
    };
    let hill = Horizon::new(&profile(|a| {
        if (a - sun.azimuth.round()).abs() <= 8.0 {
            75.0
        } else {
            0.0
        }
    }))
    .unwrap();

    // The crown takes its share of the sky from both: only the beam's shade tells them apart.
    let power = |layout: &Layout, views: &SkyViews| {
        estimate_with(layout, views, &morning).inverters[0].power
    };
    let (open, hidden) = (views(&crowned, None), views(&crowned, Some(&hill)));
    assert!(power(&crowned, &open) < power(&bare, &open));
    assert_eq!(power(&crowned, &hidden), power(&bare, &hidden));
}
