//! The capacity estimate over hourly rollups worked by hand: a 10 kWh battery loses 1 % of its
//! state of charge per 100 Wh discharged.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use super::{Estimate, estimate, measurements};
use crate::storage::{Aggregate, Rollup};

const HOUR: Duration = Duration::from_hours(1);
const YEAR_HOURS: u64 = 365 * 24;

fn hour(n: u64) -> SystemTime {
    UNIX_EPOCH + HOUR * u32::try_from(n).unwrap()
}

fn measured(n: u64, min: f64, max: f64, integral: f64) -> Rollup {
    Rollup {
        start: hour(n),
        end: hour(n + 1),
        aggregate: Aggregate::Measurement {
            duration: HOUR,
            mean: f64::midpoint(min, max),
            min,
            max,
            integral,
        },
    }
}

/// Hour `n` of a battery going from `from` % to `to` %, moving `wh` (negative: discharging) at
/// a steady rate.
fn hour_of(n: u64, from: f64, to: f64, wh: f64) -> (Rollup, Rollup) {
    (
        measured(n, from.min(to), from.max(to), f64::midpoint(from, to)),
        measured(n, wh, wh, wh),
    )
}

/// Hours from `first` discharging by `drops` % each, 100 Wh per % of a `kwh` battery.
fn discharge(first: u64, start: f64, drops: &[f64], kwh: f64) -> Vec<(Rollup, Rollup)> {
    let mut soc = start;
    drops
        .iter()
        .zip(first..)
        .map(|(drop, n)| {
            let next = soc - drop;
            let hour = hour_of(n, soc, next, -drop * kwh * 10.0);
            soc = next;
            hour
        })
        .collect()
}

fn split(hours: Vec<(Rollup, Rollup)>) -> (Vec<Rollup>, Vec<Rollup>) {
    hours.into_iter().unzip()
}

#[test]
fn an_unbroken_discharge_measures_energy_out_over_the_charge_it_used() {
    let (soc, power) = split(discharge(10, 90.0, &[10.0, 20.0, 20.0], 10.0));

    let found = measurements(&soc, &power);

    assert_eq!(found.len(), 1);
    assert_eq!(found[0].end, hour(13));
    assert!((found[0].kwh - 10.0).abs() < 1e-9, "{}", found[0].kwh);
}

#[test]
fn a_discharge_of_less_than_twenty_points_measures_nothing() {
    let (soc, power) = split(discharge(10, 90.0, &[9.0, 10.0], 10.0));

    assert_eq!(measurements(&soc, &power), []);
}

#[test]
fn a_charging_hour_splits_the_discharge() {
    let mut hours = discharge(0, 90.0, &[15.0], 10.0);
    // Charges 5 % inside the hour, discharges after: no clean discharge.
    let (s, mut p) = hour_of(1, 75.0, 70.0, -500.0);
    if let Aggregate::Measurement { max, .. } = &mut p.aggregate {
        *max = 2000.0;
    }
    hours.push((s, p));
    hours.extend(discharge(2, 70.0, &[15.0], 10.0));

    let (soc, power) = split(hours);

    assert_eq!(measurements(&soc, &power), []);
}

#[test]
fn a_missing_hour_breaks_the_discharge() {
    let mut hours = discharge(0, 90.0, &[15.0], 10.0);
    hours.extend(discharge(2, 70.0, &[15.0], 10.0));
    let (soc, power) = split(hours);

    assert_eq!(measurements(&soc, &power), []);
}

#[test]
fn an_hour_with_a_gap_breaks_the_discharge() {
    let mut hours = discharge(0, 90.0, &[15.0, 15.0], 10.0);
    if let Aggregate::Measurement { duration, .. } = &mut hours[1].1.aggregate {
        *duration = Duration::from_mins(40);
    }
    let (soc, power) = split(hours);

    assert_eq!(measurements(&soc, &power), []);
}

#[test]
fn the_estimate_is_the_median_of_the_latest_five_and_the_reference_the_first_five() {
    // Twelve discharges a month apart, the battery losing capacity, with one wild reading.
    let mut hours = Vec::new();
    let sizes = [
        10.0, 10.2, 9.8, 30.0, 10.0, 9.9, 9.6, 9.5, 9.7, 9.4, 9.5, 9.6,
    ];
    for (i, kwh) in (0..).zip(sizes) {
        hours.extend(discharge(i * 730, 90.0, &[25.0, 25.0], kwh));
    }
    let (soc, power) = split(hours);

    let Estimate {
        measurements,
        now,
        first,
        ..
    } = estimate(&soc, &power, None);

    assert_eq!(measurements.len(), 12);
    assert_eq!(now, Some(9.5));
    assert_eq!(first, Some(10.0));
}

#[test]
fn a_change_per_year_needs_half_a_year_of_measurements() {
    let mut hours = Vec::new();
    for i in 0..6 {
        hours.extend(discharge(i * 24, 90.0, &[25.0, 25.0], 10.0));
    }
    let (soc, power) = split(hours);
    assert_eq!(estimate(&soc, &power, None).per_year, None);

    let mut hours = Vec::new();
    for (i, kwh) in (0..).zip([10.0, 10.0, 10.0, 9.0, 9.0, 9.0]) {
        hours.extend(discharge(i * YEAR_HOURS / 5, 90.0, &[25.0, 25.0], kwh));
    }
    let (soc, power) = split(hours);
    let per_year = estimate(&soc, &power, None).per_year.unwrap();
    // 10 % lost between the first and last measurement, one year apart.
    assert!((per_year + 0.1).abs() < 1e-3, "{per_year}");
}

#[test]
fn cycles_count_the_energy_discharged_against_the_nameplate_or_else_the_estimate() {
    // 5 kWh out of a 10 kWh battery twice: one full cycle; one charging hour adds nothing.
    let mut hours = discharge(0, 90.0, &[25.0, 25.0], 10.0);
    hours.push(hour_of(2, 40.0, 90.0, 5000.0));
    hours.extend(discharge(3, 90.0, &[25.0, 25.0], 10.0));
    let (soc, power) = split(hours);

    let measured = estimate(&soc, &power, None);
    assert!((measured.discharged - 10.0).abs() < 1e-9);
    assert_eq!(measured.cycles, Some(1.0));
    assert_eq!(measured.since, Some(hour(0)));

    let rated = estimate(&soc, &power, Some(20.0));
    assert_eq!(rated.cycles, Some(0.5));
}

#[test]
fn no_battery_history_estimates_nothing() {
    let none = estimate(&[], &[], None);

    assert_eq!(none.measurements, []);
    assert_eq!((none.now, none.cycles, none.since), (None, None, None));
}
