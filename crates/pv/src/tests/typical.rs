//! A typical year and the cautious yield (ADR 17): a site's typical year from twenty or more past
//! years, a layout's irradiation, and P50 and P90 by scaling the simulated year.

use std::f64::consts::TAU;

use super::fixtures::MODULE;
use crate::estimate::day_of_year;
use crate::{
    Input, Inverter, Layout, Location, Occluder, Plane, PvString, Sky, TypicalRefused, Weather,
    cautious, clear_weather, irradiation, plane_irradiance, sun_position, typical_year,
};

const BERLIN: Location = Location {
    latitude: 52.52,
    longitude: 13.38,
};

const QUARTER: i64 = 900;
const DAY: i64 = 86_400;

#[test]
fn a_rounded_location_is_to_a_hundredth_of_a_degree() {
    let at = Location {
        latitude: 52.516_6,
        longitude: -13.374_9,
    };

    assert_eq!(
        at.rounded(),
        Location {
            latitude: 52.52,
            longitude: -13.37
        }
    );
}

/// Seconds since 1970 of a UTC date's midnight (Hinnant's days-from-civil).
fn midnight(year: i64, month: i64, day: i64) -> i64 {
    let (y, m) = if month <= 2 {
        (year - 1, month + 9)
    } else {
        (year, month - 3)
    };
    let era = y.div_euclid(400);
    let of_era = y - era * 400;
    let of_year = (153 * m + 2) / 5 + day - 1;
    (era * 146_097 + of_era * 365 + of_era / 4 - of_era / 100 + of_year - 719_468) * DAY
}

/// A whole UTC year at quarter hours, each stamped at its step's middle: a day of sun, brighter
/// in summer, whose irradiance each month is scaled by `scale(month)`, and air 10 °C times the
/// scale. A month's days differ by under a third.
fn past_year(year: i64, scale: impl Fn(i64) -> f64) -> Vec<Weather> {
    let start = midnight(year, 1, 1);
    let steps = (midnight(year + 1, 1, 1) - start) / QUARTER;
    let mut month = 1;
    (0..steps)
        .map(|q| {
            let unix = start + q * QUARTER + QUARTER / 2;
            if month < 12 && unix >= midnight(year, month + 1, 1) {
                month += 1;
            }
            let s = scale(month);
            let hour = real(unix % DAY) / 3600.0;
            let season = (real(unix - start) / real(DAY) - 172.0) / 365.0 * TAU;
            let sun =
                (((hour - 12.0) / 24.0) * TAU).cos().max(0.0) * 0.5f64.mul_add(season.cos(), 1.0);
            Weather {
                unix,
                ghi: s * 800.0 * sun,
                dni: s * 600.0 * sun,
                dhi: s * 200.0 * sun,
                temperature: 10.0 * s,
                wind: None,
            }
        })
        .collect()
}

fn real(n: i64) -> f64 {
    f64::from(i32::try_from(n).expect("seconds within a year"))
}

/// Twenty-one years, 2000 to 2020. Each month ranks the years differently: year index `i` takes
/// rank `(i + 7 × month) mod 21`, and each rank's scale is 1.5 times the last's, more than a
/// month's days differ by, so no two years' days overlap and the year of rank 10 is the middle
/// of every month.
fn twenty_one_years() -> Vec<Vec<Weather>> {
    ranked(|i, month| (i + 7 * month) % 21)
}

/// Twenty-one years, 2000 to 2020, year index `i` at rank `rank(i, month)` in each month.
fn ranked(rank: impl Fn(i64, i64) -> i64 + Copy) -> Vec<Vec<Weather>> {
    (0..21)
        .map(|i| {
            past_year(2000 + i, move |month| {
                1.5_f64.powi(i32::try_from(rank(i, month) - 10).expect("a rank"))
            })
        })
        .collect()
}

#[test]
fn each_month_comes_whole_from_the_past_year_in_the_middle_of_them() {
    let years = twenty_one_years();

    let typical = typical_year(&years, QUARTER).expect("twenty-one whole years");

    // Rank 10: (i + 7 × month) mod 21 = 10.
    let expected: Vec<i64> = (1..=12)
        .map(|month| 2000 + (10_i64 - 7 * month).rem_euclid(21))
        .collect();
    assert_eq!(typical.sources.to_vec(), expected);
    // A year without 29 February, at quarter hours, stamped in 2001 at each step's middle.
    let stamps: Vec<i64> = typical.weather.iter().map(|w| w.unix).collect();
    let quarters: Vec<i64> = (0..365 * 96)
        .map(|q| midnight(2001, 1, 1) + q * QUARTER + QUARTER / 2)
        .collect();
    assert_eq!(stamps, quarters);
    // 14 July at 10:07:30 is that of its source year.
    let july = expected[6];
    let at = |year: i64| midnight(year, 7, 14) + 40 * QUARTER + QUARTER / 2;
    let source = years.iter().flatten().find(|w| w.unix == at(july));
    let ours = typical.weather.iter().find(|w| w.unix == at(2001));
    let values = |w: &Weather| (w.ghi, w.dni, w.temperature);
    assert_eq!(ours.map(values), source.map(values));
}

#[test]
fn a_leap_year_gives_its_february_without_the_29th() {
    // 2004 is the middle of every month.
    let years = ranked(|i, _| (i + 6) % 21);

    let typical = typical_year(&years, QUARTER).expect("twenty-one whole years");

    assert_eq!(typical.sources, [2004; 12]);
    assert_eq!(typical.weather.len(), 365 * 96);
    let march = |year: i64| midnight(year, 3, 1) + QUARTER / 2;
    let ours = typical.weather.iter().find(|w| w.unix == march(2001));
    let source = years.iter().flatten().find(|w| w.unix == march(2004));
    assert_eq!(ours.map(|w| w.ghi), source.map(|w| w.ghi));
    assert_eq!(
        typical.weather.get((31 + 28) * 96).map(|w| w.unix),
        Some(march(2001))
    );
}

/// Twenty-one years alike but for their overcast days, the first `overcast(i)` of each month for
/// year index `i`, on which no direct beam arrives. Every other day is the same sunny day.
fn overcast(days: impl Fn(i64) -> i64) -> Vec<Vec<Weather>> {
    (0..21)
        .map(|i| {
            let year = 2000 + i;
            let start = midnight(year, 1, 1);
            let steps = (midnight(year + 1, 1, 1) - start) / QUARTER;
            (0..steps)
                .map(|q| {
                    let unix = start + q * QUARTER + QUARTER / 2;
                    let first = (1..=12)
                        .rev()
                        .map(|m| midnight(year, m, 1))
                        .find(|&first| first <= unix)
                        .unwrap_or(start);
                    let sun = (((real(unix % DAY) / 3600.0 - 12.0) / 24.0) * TAU)
                        .cos()
                        .max(0.0);
                    let beam = if (unix - first) / DAY < days(i) {
                        0.0
                    } else {
                        600.0
                    };
                    Weather {
                        unix,
                        ghi: 800.0 * sun,
                        dni: beam * sun,
                        dhi: 200.0 * sun,
                        temperature: 10.0,
                        wind: None,
                    }
                })
                .collect()
        })
        .collect()
}

#[test]
fn days_alike_count_as_one_value_in_each_years_distribution() {
    // Ten years without overcast days, ten with ten of them, 2020 with five: the long term has
    // five a month, as 2020 has.
    let years = overcast(|i| match i {
        0..10 => 0,
        10..20 => 10,
        _ => 5,
    });

    let typical = typical_year(&years, QUARTER).expect("twenty-one whole years");

    assert_eq!(typical.sources, [2020; 12]);
}

#[test]
fn fewer_than_twenty_years_are_refused() {
    let mut years = twenty_one_years();
    years.truncate(19);

    assert_eq!(
        typical_year(&years, QUARTER).err(),
        Some(TypicalRefused::TooFewYears(19))
    );
}

#[test]
fn a_year_missing_a_step_is_refused() {
    let mut years = twenty_one_years();
    years[3].remove(5000);

    assert_eq!(
        typical_year(&years, QUARTER).err(),
        Some(TypicalRefused::NotWhole(3))
    );
}

#[test]
fn a_step_that_does_not_divide_a_day_is_refused() {
    let years = vec![Vec::new(); 20];

    assert_eq!(
        typical_year(&years, 7 * 60).err(),
        Some(TypicalRefused::Step(420))
    );
}

fn layout(strings: Vec<PvString>, occluders: Vec<Occluder>) -> Layout {
    Layout {
        location: BERLIN,
        inverters: vec![Inverter {
            inputs: vec![Input {
                limits: None,
                strings,
            }],
            ac: None,
        }],
        occluders,
    }
}

/// Every quarter hour of 21 June, stamped at its middle, under a clear sky.
fn june_day() -> Vec<Weather> {
    (0..96)
        .map(|q| clear_weather(midnight(2026, 6, 21) + q * QUARTER + QUARTER / 2, BERLIN))
        .collect()
}

/// Perez on `plane` over `weather`, in Wh/m², each sample held a quarter hour.
fn on(plane: Plane, weather: &[Weather]) -> f64 {
    weather
        .iter()
        .map(|w| {
            let sky = Sky {
                sun: sun_position(w.unix, BERLIN),
                day_of_year: day_of_year(w.unix.div_euclid(DAY)),
                ghi: w.ghi,
                dni: w.dni,
                dhi: w.dhi,
                temperature: w.temperature,
                wind: w.wind,
            };
            let p = plane_irradiance(plane, &sky);
            (p.beam + p.sky_diffuse + p.ground_diffuse) / 4.0
        })
        .sum()
}

const SOUTH: Plane = Plane {
    tilt: 35.0,
    azimuth: 0.0,
};
const EAST: Plane = Plane {
    tilt: 20.0,
    azimuth: -90.0,
};

#[test]
fn irradiation_is_perez_on_the_planes_without_shade() {
    let weather = june_day();
    // A wall of triangles in front of the modules, which a year's run would see.
    let wall = Occluder::Triangle([[-50.0, -1.0, 0.0], [50.0, -1.0, 0.0], [0.0, -1.0, 100.0]]);
    let south = layout(
        vec![PvString::on_one_plane(MODULE, SOUTH, 10, 0, 2.0)],
        vec![wall],
    );

    let wh = irradiation(&south, &weather, QUARTER);

    let expected = on(SOUTH, &weather);
    assert!(expected > 5000.0, "a clear June day: {expected} Wh/m²");
    assert!(
        (wh - expected).abs() < 1e-9 * expected,
        "{wh} != {expected}"
    );
}

#[test]
fn each_module_weighs_by_its_datasheet_power() {
    let weather = june_day();
    let double = crate::ModuleType {
        imp: MODULE.imp * 2.0,
        ..MODULE
    };
    let mixed = layout(
        vec![
            PvString::on_one_plane(MODULE, SOUTH, 10, 0, 2.0),
            PvString::on_one_plane(double, EAST, 5, 0, 2.0),
        ],
        Vec::new(),
    );

    let wh = irradiation(&mixed, &weather, QUARTER);

    // Ten modules of power P south, five of 2P east: equal weights.
    let expected = f64::midpoint(on(SOUTH, &weather), on(EAST, &weather));
    assert!(
        (wh - expected).abs() < 1e-9 * expected,
        "{wh} != {expected}"
    );
}

#[test]
fn p50_and_p90_scale_the_simulated_year_by_each_past_years_irradiation() {
    let years = [
        (2001, 900.0),
        (2002, 1000.0),
        (2003, 1100.0),
        (2004, 1000.0),
        (2005, 1000.0),
    ];

    let figure = cautious(10_000_000.0, 1000.0, &years).expect("five years");

    // Ratios 0.9, 1, 1.1, 1, 1: mean 1, sample deviation √0.005; P90 lies 1.28155 deviations
    // below the mean, exceeded in nine years of ten.
    assert!((figure.p50 - 10_000_000.0).abs() < 1e-6, "{}", figure.p50);
    assert!(
        (figure.p90 - 9_093_806.197_563).abs() < 1e-3,
        "{}",
        figure.p90
    );
    // How it was made.
    assert_eq!(figure.basis.typical, 1000.0);
    assert_eq!(figure.basis.years, years.to_vec());
    assert!((figure.basis.mean - 1.0).abs() < 1e-12);
    assert!((figure.basis.deviation - 0.005_f64.sqrt()).abs() < 1e-12);
}

#[test]
fn a_brighter_past_lifts_p50_above_the_simulated_year() {
    let years = [(2001, 1100.0), (2002, 1100.0)];

    let figure = cautious(1000.0, 1000.0, &years).expect("two years");

    assert!((figure.p50 - 1100.0).abs() < 1e-9, "{}", figure.p50);
    assert!(
        (figure.p90 - 1100.0).abs() < 1e-9,
        "no spread: {}",
        figure.p90
    );
}

#[test]
fn one_year_or_no_typical_irradiation_gives_no_cautious_figure() {
    assert_eq!(cautious(1000.0, 1000.0, &[(2001, 1000.0)]), None);
    assert_eq!(
        cautious(1000.0, 0.0, &[(2001, 1000.0), (2002, 900.0)]),
        None
    );
}
