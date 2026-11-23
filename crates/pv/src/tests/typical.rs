//! A typical year and the cautious yield (ADR 17): a site's typical year from twenty or more past
//! years, a layout's irradiation, and P50 and P90 by scaling the simulated year.

use std::f64::consts::TAU;

use crate::{Location, TypicalRefused, Weather, typical_year};

const QUARTER: i64 = 900;
const DAY: i64 = 86_400;

#[test]
fn a_site_is_its_location_to_a_hundredth_of_a_degree() {
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
