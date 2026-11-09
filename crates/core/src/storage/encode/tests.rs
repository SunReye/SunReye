//! v4's change-encoder cases, adapted to change points.

use std::time::Duration;

use sunreye_profile::{RoleKind, Unit};

use super::{Point, Track};
use crate::storage::Policy;

/// 100 ms ticks per second.
const S: i64 = 10;
const T0: i64 = 1_787_745_600 * S;

fn policy(deadband: f64) -> Policy {
    Policy {
        kind: RoleKind::Measurement,
        step: 0.1,
        deadband,
        cadence: Duration::from_secs(5),
    }
}

/// Feeds `[seconds, value]` readings from `T0`; returns every point stored, values in units.
fn feed(track: &mut Track, readings: &[(f64, f64)]) -> Vec<(f64, Option<f64>)> {
    let mut out = Vec::new();
    for &(at, value) in readings {
        #[expect(clippy::cast_possible_truncation, reason = "test instants are small")]
        track.reading(T0 + (at * 10.0) as i64, value, &mut out);
    }
    points(&out)
}

fn points(out: &[Point]) -> Vec<(f64, Option<f64>)> {
    #[expect(clippy::cast_precision_loss, reason = "test values are small")]
    out.iter()
        .map(|p| {
            (
                (p.time - T0) as f64 / 10.0,
                p.value.map(|v| (v as f64 * 0.1 * 1e6).round() / 1e6),
            )
        })
        .collect()
}

/// The largest error against the true readings when the stored series is carried forward.
fn worst_error(readings: &[(f64, f64)], stored: &[(f64, Option<f64>)]) -> f64 {
    readings
        .iter()
        .filter_map(|&(at, truth)| {
            let held = stored.iter().rev().find(|(t, _)| *t <= at)?.1?;
            Some((truth - held).abs())
        })
        .fold(0.0, f64::max)
}

fn series(count: u32, step: f64, f: impl Fn(f64) -> f64) -> Vec<(f64, f64)> {
    (0..count)
        .map(|i| {
            let i = f64::from(i);
            (i * step, f(i))
        })
        .collect()
}

#[test]
fn a_flat_signal_stores_one_change_point() {
    let mut track = Track::new(&policy(0.0));
    let stored = feed(&mut track, &series(100, 3.0, |_| 42.0));
    assert_eq!(stored, [(0.0, Some(42.0))]);
}

#[test]
fn a_change_is_stored_at_the_instant_it_began() {
    let mut track = Track::new(&policy(0.0));
    let stored = feed(&mut track, &[(0.0, 10.0), (3.0, 10.0), (6.0, 20.0)]);
    assert_eq!(stored, [(0.0, Some(10.0)), (6.0, Some(20.0))]);
}

#[test]
fn a_ramp_in_steps_below_the_deadband_is_stored_once_the_drift_reaches_it() {
    // A comparison against the last reading would store nothing at all.
    let readings = series(20, 1.0, |i| 0.4f64.mul_add(i, 100.0));
    let mut track = Track::new(&policy(1.0));
    let stored = feed(&mut track, &readings);
    assert!(stored.len() > 1);
    assert!(worst_error(&readings, &stored) <= 1.0 + 1e-9);
}

#[test]
fn a_drifting_signal_is_never_wrong_by_more_than_the_deadband() {
    let readings = series(240, 1.0, |i| {
        0.9f64.mul_add((i / 3.0).sin(), 2.6f64.mul_add((i / 17.0).sin(), 230.0))
    });
    let mut track = Track::new(&policy(1.0));
    let stored = feed(&mut track, &readings);
    assert!(worst_error(&readings, &stored) <= 1.0 + 1e-9);
    assert!(stored.len() > 1 && stored.len() < readings.len() / 3);
}

#[test]
fn the_deadband_compares_against_the_last_stored_value() {
    let mut track = Track::new(&policy(1.0));
    let stored = feed(
        &mut track,
        &[(0.0, 100.0), (1.0, 101.5), (2.0, 102.4), (3.0, 102.6)],
    );
    let values: Vec<_> = stored.iter().map(|p| p.1).collect();
    assert_eq!(values, [Some(100.0), Some(101.5), Some(102.6)]);
}

#[test]
fn a_sawtooth_just_under_the_deadband_stores_nothing_more() {
    let mut track = Track::new(&policy(1.0));
    let stored = feed(
        &mut track,
        &series(120, 1.0, |i| if i % 2.0 == 0.0 { 50.0 } else { 50.9 }),
    );
    assert_eq!(stored, [(0.0, Some(50.0))]);
}

#[test]
fn a_change_equal_to_the_deadband_is_stored() {
    let mut track = Track::new(&policy(1.0));
    let stored = feed(&mut track, &[(0.0, 10.0), (1.0, 11.0)]);
    assert_eq!(stored, [(0.0, Some(10.0)), (1.0, Some(11.0))]);
}

#[test]
fn counters_and_enums_get_no_deadband() {
    let cadence = Duration::from_secs(5);
    let counter = Policy::new(RoleKind::Counter, Some(Unit::KilowattHour), 0.1, cadence);
    let status = Policy::new(RoleKind::Status, None, 1.0, cadence);
    let power = Policy::new(RoleKind::Measurement, Some(Unit::Watt), 1.0, cadence);
    let deadbands = [counter.deadband, status.deadband, power.deadband];
    assert_eq!(
        deadbands.map(f64::to_bits),
        [0.0, 0.0, 5.0].map(f64::to_bits)
    );

    // A counter restart is a change like any other.
    let mut track = Track::new(&counter);
    let stored = feed(&mut track, &[(0.0, 11_000.0), (1.0, 11_000.0), (2.0, 0.0)]);
    assert_eq!(stored, [(0.0, Some(11_000.0)), (2.0, Some(0.0))]);
}

#[test]
fn zero_and_negative_values_are_stored() {
    let mut track = Track::new(&policy(0.0));
    let stored = feed(&mut track, &[(0.0, 5.0), (1.0, 0.0), (2.0, -5.0)]);
    let values: Vec<_> = stored.iter().map(|p| p.1).collect();
    assert_eq!(values, [Some(5.0), Some(0.0), Some(-5.0)]);
}

#[test]
fn a_value_is_quantised_to_its_step() {
    let mut track = Track::new(&policy(0.0));
    let stored = feed(&mut track, &[(0.0, 230.04), (1.0, 230.06)]);
    assert_eq!(stored, [(0.0, Some(230.0)), (1.0, Some(230.1))]);
}

#[test]
fn a_non_finite_reading_is_never_stored() {
    let mut track = Track::new(&policy(0.0));
    let stored = feed(
        &mut track,
        &[(0.0, f64::NAN), (1.0, f64::INFINITY), (2.0, 7.0)],
    );
    assert_eq!(stored, [(2.0, Some(7.0))]);
}

#[test]
fn a_silence_over_three_cadences_is_a_gap() {
    // Cadence 5 s, so the threshold is 15 s; the value held for one cadence after its last reading.
    let mut track = Track::new(&policy(0.0));
    let stored = feed(&mut track, &[(0.0, 42.0), (10.0, 42.0), (25.1, 42.0)]);
    assert_eq!(
        stored,
        [(0.0, Some(42.0)), (15.0, None), (25.1, Some(42.0))]
    );
}

#[test]
fn a_silence_of_exactly_the_threshold_is_not_a_gap() {
    let mut track = Track::new(&policy(0.0));
    let stored = feed(&mut track, &[(0.0, 42.0), (15.0, 42.0)]);
    assert_eq!(stored, [(0.0, Some(42.0))]);
}

#[test]
fn the_gap_threshold_is_at_least_fifteen_seconds() {
    let fast = Policy {
        cadence: Duration::from_secs(1),
        ..policy(0.0)
    };
    let mut track = Track::new(&fast);
    let stored = feed(&mut track, &[(0.0, 1.0), (14.0, 1.0), (29.5, 1.0)]);
    assert_eq!(stored, [(0.0, Some(1.0)), (15.0, None), (29.5, Some(1.0))]);
}

#[test]
fn a_silent_series_is_closed_by_a_gap_without_another_reading() {
    let mut track = Track::new(&policy(0.0));
    let mut out = Vec::new();
    track.reading(T0, 42.0, &mut out);
    track.silence(T0 + 15 * S, &mut out);
    assert_eq!(points(&out), [(0.0, Some(42.0))]);
    track.silence(T0 + 16 * S, &mut out);
    track.silence(T0 + 30 * S, &mut out);
    assert_eq!(points(&out), [(0.0, Some(42.0)), (5.0, None)]);
    // The next reading after a gap is stored even when the value is unchanged.
    track.reading(T0 + 60 * S, 42.0, &mut out);
    assert_eq!(
        points(&out),
        [(0.0, Some(42.0)), (5.0, None), (60.0, Some(42.0))]
    );
}

#[test]
fn a_backwards_clock_step_is_a_gap_and_writing_continues() {
    let mut track = Track::new(&policy(0.0));
    // The clock steps back 40 s; nothing is written at or before the last instant, 10 s.
    let stored = feed(
        &mut track,
        &[
            (0.0, 1.0),
            (10.0, 2.0),
            (-30.0, 3.0),
            (10.0, 4.0),
            (14.0, 5.0),
            (16.0, 6.0),
        ],
    );
    assert_eq!(
        stored,
        [
            (0.0, Some(1.0)),
            (10.0, Some(2.0)),
            (15.0, None),
            (16.0, Some(6.0))
        ]
    );
}

#[test]
fn a_resumed_track_holds_its_value_until_the_last_flush() {
    // Restarted 10 s after the last flush at 60 s: one value since 0 s, continuous.
    let mut track = Track::resume(
        &policy(1.0),
        Some(Point {
            time: T0,
            value: Some(420),
        }),
        T0 + 60 * S,
    );
    let stored = feed(&mut track, &[(70.0, 42.5), (71.0, 43.0)]);
    assert_eq!(stored, [(71.0, Some(43.0))]);

    // Restarted long after: the value ends one cadence after the last flush.
    let mut track = Track::resume(
        &policy(1.0),
        Some(Point {
            time: T0,
            value: Some(420),
        }),
        T0 + 60 * S,
    );
    let stored = feed(&mut track, &[(3600.0, 42.0)]);
    assert_eq!(stored, [(65.0, None), (3600.0, Some(42.0))]);
}
