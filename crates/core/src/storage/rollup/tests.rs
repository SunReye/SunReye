//! Rollup arithmetic over change points, in steps and 100 ms ticks.

use sunreye_profile::RoleKind;

use super::{Sums, roll};
use crate::storage::encode::Point;

const fn at(time: i64, value: i64) -> Point {
    Point {
        time,
        value: Some(value),
    }
}

const fn gap(time: i64) -> Point {
    Point { time, value: None }
}

#[test]
fn a_measurement_is_time_weighted_and_cut_at_the_window() {
    // 10 from before the window to 30, 40 to 60, then 20 to the end at 100.
    let points = [at(-50, 10), at(30, 40), at(60, 20)];
    assert_eq!(
        roll(RoleKind::Measurement, &points, 0, 100),
        Some(Sums::Measurement {
            duration: 100,
            sum: 10 * 30 + 40 * 30 + 20 * 40,
            min: 10,
            max: 40,
        })
    );
}

#[test]
fn a_gap_adds_neither_duration_nor_energy() {
    let points = [at(0, 10), gap(30), at(80, 50)];
    assert_eq!(
        roll(RoleKind::Measurement, &points, 0, 100),
        Some(Sums::Measurement {
            duration: 50,
            sum: 10 * 30 + 50 * 20,
            min: 10,
            max: 50,
        })
    );
}

#[test]
fn a_value_that_ends_before_the_window_is_not_an_extreme() {
    let points = [at(-50, 99), at(0, 10), at(100, 1)];
    assert_eq!(
        roll(RoleKind::Measurement, &points, 0, 100),
        Some(Sums::Measurement {
            duration: 100,
            sum: 1000,
            min: 10,
            max: 10,
        })
    );
}

#[test]
fn a_window_without_a_value_has_no_rollup() {
    assert_eq!(roll(RoleKind::Measurement, &[gap(-10)], 0, 100), None);
    assert_eq!(roll(RoleKind::Measurement, &[], 0, 100), None);
    assert_eq!(roll(RoleKind::Counter, &[gap(-10)], 0, 100), None);
}

#[test]
fn a_counter_stores_first_last_and_its_delta() {
    let points = [at(-10, 1000), at(20, 1004), at(50, 1010), at(120, 1020)];
    assert_eq!(
        roll(RoleKind::Counter, &points, 0, 100),
        Some(Sums::Counter {
            first: 1000,
            last: 1010,
            delta: 10,
        })
    );
}

#[test]
fn a_counter_drop_is_a_reset_never_a_negative_delta() {
    let points = [at(-10, 1000), at(20, 1004), at(30, 2), at(50, 7)];
    assert_eq!(
        roll(RoleKind::Counter, &points, 0, 100),
        Some(Sums::Counter {
            first: 1000,
            last: 7,
            delta: 4 + 5,
        })
    );
}

#[test]
fn a_counter_gains_nothing_across_a_gap() {
    let points = [at(-10, 1000), gap(10), at(60, 1500), at(70, 1503)];
    assert_eq!(
        roll(RoleKind::Counter, &points, 0, 100),
        Some(Sums::Counter {
            first: 1000,
            last: 1503,
            delta: 3,
        })
    );
}

#[test]
fn a_counter_first_seen_inside_the_window_starts_there() {
    let points = [gap(-10), at(40, 500), at(60, 502)];
    assert_eq!(
        roll(RoleKind::Counter, &points, 0, 100),
        Some(Sums::Counter {
            first: 500,
            last: 502,
            delta: 2,
        })
    );
}

#[test]
fn a_status_is_not_rolled_up() {
    assert_eq!(roll(RoleKind::Status, &[at(0, 1)], 0, 100), None);
}

#[test]
fn points_long_before_the_window_only_set_the_value_in_force() {
    let points = [at(-90, 5), at(-50, 900), at(-10, 1000), at(20, 1004)];
    assert_eq!(
        roll(RoleKind::Counter, &points, 0, 100),
        Some(Sums::Counter {
            first: 1000,
            last: 1004,
            delta: 4,
        })
    );
    assert_eq!(
        roll(RoleKind::Measurement, &points, 0, 100),
        Some(Sums::Measurement {
            duration: 100,
            sum: 1000 * 20 + 1004 * 80,
            min: 1000,
            max: 1004,
        })
    );
}

#[test]
fn a_counter_that_climbs_back_after_a_low_reading_gains_only_past_its_value_before() {
    // 1000 → 1004 is 4; the low 0 is a misread, and 1004 → 1010 after it is 6.
    let points = [
        at(-10, 1000),
        at(20, 1004),
        at(30, 0),
        at(50, 1004),
        at(70, 1010),
    ];
    assert_eq!(
        roll(RoleKind::Counter, &points, 0, 100),
        Some(Sums::Counter {
            first: 1000,
            last: 1010,
            delta: 4 + 6,
        })
    );
}

#[test]
fn a_low_reading_before_the_window_is_known_from_the_points_before_it() {
    // The low 0 is in force at the start; climbing back to 1000 gains nothing, then 3.
    let points = [at(-20, 1000), at(-10, 0), at(20, 1000), at(40, 1003)];
    assert_eq!(
        roll(RoleKind::Counter, &points, 0, 100),
        Some(Sums::Counter {
            first: 0,
            last: 1003,
            delta: 3,
        })
    );
}
