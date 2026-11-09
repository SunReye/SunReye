//! Hourly and daily rollups through the storage interface.

use std::path::Path;
use std::time::{Duration, SystemTime};

use sunreye_profile::RoleKind;

use super::{DEVICE, Plant, at, epoch, policy};
use crate::bus::{Reading, SeriesId};
use crate::storage::{Aggregate, Policy, Rollup, Storage, Tier};

/// A measurement rollup as hours from `T0`, hours covered, mean, min, max and integral.
type Measured = (f64, f64, f64, f64, f64, f64);

fn round(v: f64) -> f64 {
    (v * 1e3).round() / 1e3
}

fn hours(time: SystemTime) -> f64 {
    let base = at(0.0);
    match time.duration_since(base) {
        Ok(d) => round(d.as_secs_f64() / 3600.0),
        Err(e) => -round(e.duration().as_secs_f64() / 3600.0),
    }
}

fn measured(rollups: &[Rollup]) -> Vec<Measured> {
    rollups
        .iter()
        .map(|r| match r.aggregate {
            Aggregate::Measurement {
                duration,
                mean,
                min,
                max,
                integral,
            } => (
                hours(r.start),
                round(duration.as_secs_f64() / 3600.0),
                round(mean),
                round(min),
                round(max),
                round(integral),
            ),
            Aggregate::Counter { .. } => panic!("a counter rollup"),
        })
        .collect()
}

/// A counter rollup as hours from `T0`, first, last and delta.
fn counted(rollups: &[Rollup]) -> Vec<(f64, f64, f64, f64)> {
    rollups
        .iter()
        .map(|r| match r.aggregate {
            Aggregate::Counter { first, last, delta } => {
                (hours(r.start), round(first), round(last), round(delta))
            }
            Aggregate::Measurement { .. } => panic!("a measurement rollup"),
        })
        .collect()
}

async fn rollups(
    storage: &Storage,
    series: SeriesId,
    tier: Tier,
    from: f64,
    to: f64,
) -> Vec<Rollup> {
    storage
        .rollups(DEVICE, series, tier, at(from)..at(to))
        .await
        .unwrap()
}

/// `count` readings, every `every` seconds from `from`.
fn steady(from: f64, count: u32, every: f64, value: impl Fn(f64) -> f64) -> Vec<(f64, f64)> {
    (0..count)
        .map(|i| {
            let t = f64::from(i).mul_add(every, from);
            (t, value(t))
        })
        .collect()
}

#[tokio::test]
async fn hourly_rollups_are_cut_on_utc_hours() {
    let dir = tempfile::tempdir().unwrap();
    let plant = Plant::new();
    let storage = plant.open(&dir.path().join("h.sqlite"), epoch()).await;
    // 1000 W, then 2000 W from half past the first hour, into a third hour.
    let readings = steady(0.0, 1460, 5.0, |t| if t < 1800.0 { 1000.0 } else { 2000.0 });
    plant.record(&storage, &readings).await;

    assert_eq!(
        measured(&rollups(&storage, plant.power, Tier::Hour, 0.0, 86_400.0).await),
        [
            (0.0, 1.0, 1500.0, 1000.0, 2000.0, 1500.0),
            (1.0, 1.0, 2000.0, 2000.0, 2000.0, 2000.0),
        ]
    );
}

/// 2026-10-24 00:00 in Berlin (CEST, UTC+2), in seconds from `T0`.
const BERLIN_OCT_24: f64 = 1_792_792_800.0 - 1_787_745_600.0;
/// 2026-03-28 00:00 in Berlin (CET, UTC+1), in seconds from `T0`.
const BERLIN_MAR_28: f64 = 1_774_652_400.0 - 1_787_745_600.0;

async fn berlin_days(path: &Path, first: f64) -> Vec<Measured> {
    let plant = Plant::new();
    let storage = Storage::open(path, epoch(), "Europe/Berlin", &plant.bus).unwrap();
    // Hourly readings keep the test fast; the gap threshold is three cadences.
    let hourly = Policy {
        cadence: Duration::from_secs(3600),
        ..policy()
    };
    storage.declare(DEVICE, plant.power, hourly).await.unwrap();
    // A steady 1 kW over three local days and a bit.
    let readings = steady(first, 74, 3600.0, |_| 1000.0);
    plant.record(&storage, &readings).await;
    let to = 2.5f64.mul_add(86_400.0, first);
    measured(&rollups(&storage, plant.power, Tier::Day, first, to).await)
}

#[tokio::test]
async fn a_25_hour_day_rolls_up_25_hours() {
    let dir = tempfile::tempdir().unwrap();
    let start = BERLIN_OCT_24;
    let h = start / 3600.0;
    assert_eq!(
        berlin_days(&dir.path().join("d.sqlite"), start).await,
        [
            (h, 24.0, 1000.0, 1000.0, 1000.0, 24_000.0),
            (h + 24.0, 25.0, 1000.0, 1000.0, 1000.0, 25_000.0),
            (h + 49.0, 24.0, 1000.0, 1000.0, 1000.0, 24_000.0),
        ]
    );
}

#[tokio::test]
async fn a_23_hour_day_rolls_up_23_hours() {
    let dir = tempfile::tempdir().unwrap();
    let start = BERLIN_MAR_28;
    let h = start / 3600.0;
    assert_eq!(
        berlin_days(&dir.path().join("d.sqlite"), start).await,
        [
            (h, 24.0, 1000.0, 1000.0, 1000.0, 24_000.0),
            (h + 24.0, 23.0, 1000.0, 1000.0, 1000.0, 23_000.0),
            (h + 47.0, 24.0, 1000.0, 1000.0, 1000.0, 24_000.0),
        ]
    );
}

#[tokio::test]
async fn a_late_gap_recomputes_the_hour_it_falls_in() {
    let dir = tempfile::tempdir().unwrap();
    let plant = Plant::new();
    let storage = Storage::open(&dir.path().join("l.sqlite"), epoch(), "UTC", &plant.bus).unwrap();
    let minutely = Policy {
        cadence: Duration::from_secs(60),
        ..policy()
    };
    storage
        .declare(DEVICE, plant.power, minutely)
        .await
        .unwrap();
    plant
        .record(&storage, &steady(0.0, 59, 60.0, |_| 1000.0))
        .await;
    // The hour closes before the silence is long enough to be a gap.
    storage.tick(at(3600.0)).await.unwrap();
    storage.tick(at(3780.0)).await.unwrap();
    storage.tick(at(7200.0)).await.unwrap();

    assert_eq!(
        measured(&rollups(&storage, plant.power, Tier::Hour, 0.0, 7200.0).await),
        [(0.0, 0.983, 1000.0, 1000.0, 1000.0, 983.333)]
    );
}

#[tokio::test]
async fn a_restart_gap_invents_no_energy() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("r.sqlite");
    let plant = Plant::new();
    let storage = plant.open(&path, epoch()).await;
    plant
        .record(&storage, &steady(0.0, 240, 5.0, |_| 1000.0))
        .await;
    // A crash once every reading is handled: the open bucket is lost, and the value is held to
    // one cadence past the last flush.
    storage.problems().await.unwrap();
    drop(storage);

    let storage = plant.open(&path, epoch()).await;
    plant
        .record(&storage, &steady(2400.0, 260, 5.0, |_| 1000.0))
        .await;
    let rolled = measured(&rollups(&storage, plant.power, Tier::Hour, 0.0, 3600.0).await);
    // Flushed up to 1135 s and held one cadence past it, then 2400 s to 3600 s.
    assert_eq!(rolled, [(0.0, 0.65, 1000.0, 1000.0, 1000.0, 650.0)]);
}

#[tokio::test]
async fn a_counter_rolls_up_its_delta_and_a_reset_is_never_negative() {
    let dir = tempfile::tempdir().unwrap();
    let plant = Plant::new();
    let storage = Storage::open(&dir.path().join("c.sqlite"), epoch(), "UTC", &plant.bus).unwrap();
    let total = plant.bus.intern("pv.energy.total", None);
    let counter = Policy {
        kind: RoleKind::Counter,
        step: 0.1,
        deadband: 0.0,
        cadence: Duration::from_secs(60),
    };
    storage.declare(DEVICE, total, counter).await.unwrap();
    // Rising 0.1 kWh a minute from 1000 kWh, reset to zero at 90 min, then rising again.
    let readings = steady(0.0, 121, 60.0, |t| {
        let minute = (t / 60.0).round();
        if t < 5400.0 {
            minute.mul_add(0.1, 1000.0)
        } else {
            (minute - 90.0) * 0.1
        }
    });
    for (seconds, value) in readings {
        storage
            .record(Reading {
                series: total,
                ..plant.reading(seconds, value)
            })
            .await
            .unwrap();
    }

    assert_eq!(
        counted(&rollups(&storage, total, Tier::Hour, 0.0, 7200.0).await),
        [(0.0, 1000.0, 1005.9, 5.9), (1.0, 1005.9, 2.9, 5.9)]
    );
}

#[tokio::test]
async fn a_dropped_rollup_rebuilds_to_the_same_values() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("b.sqlite");
    let plant = Plant::new();
    let storage = plant.open(&path, epoch()).await;
    let readings = steady(0.0, 2200, 5.0, |t| {
        (t / 600.0).floor().mul_add(100.0, 1000.0)
    });
    plant.record(&storage, &readings).await;
    let hourly = rollups(&storage, plant.power, Tier::Hour, 0.0, 86_400.0).await;
    let daily = rollups(&storage, plant.power, Tier::Day, -86_400.0, 86_400.0).await;
    assert_eq!(hourly.len(), 3);
    assert_eq!(daily.len(), 1);
    storage.shutdown().await.unwrap();

    let db = rusqlite::Connection::open(&path).unwrap();
    db.execute_batch("DELETE FROM rollup_hour; DELETE FROM rollup_day;")
        .unwrap();
    drop(db);

    let storage = plant.open(&path, epoch()).await;
    storage
        .rebuild(DEVICE, plant.power, at(0.0)..at(86_400.0))
        .await
        .unwrap();
    assert_eq!(
        rollups(&storage, plant.power, Tier::Hour, 0.0, 86_400.0).await,
        hourly
    );
    assert_eq!(
        rollups(&storage, plant.power, Tier::Day, -86_400.0, 86_400.0).await,
        daily
    );
}
