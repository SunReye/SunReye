//! History imported from v3 (ADR 18) through the storage interface.

use std::time::Duration;

use sunreye_profile::RoleKind;

use super::rollups::{counted, measured, rollups};
use super::{DEVICE, Plant, at, epoch, policy};
use crate::storage::{Backfill, Backfilled, Held, Policy, Storage, Tier};

/// 5 W, the default deadband of a power role (ADR 4).
fn watts() -> Policy {
    Policy {
        deadband: 5.0,
        ..policy()
    }
}

/// Raw rows as seconds from `T0`, value and hold in seconds.
fn raw(rows: &[(f64, f64, Option<f64>)]) -> Backfill {
    Backfill {
        raw: rows
            .iter()
            .map(|&(seconds, value, hold)| Held {
                time: at(seconds),
                value,
                hold: hold.map(Duration::from_secs_f64),
            })
            .collect(),
        ..Backfill::default()
    }
}

#[tokio::test]
async fn raw_rows_become_change_points_through_the_deadband() {
    let dir = tempfile::tempdir().unwrap();
    let plant = Plant::new();
    let storage = Storage::open(&dir.path().join("i.sqlite"), epoch(), "UTC", &plant.bus).unwrap();
    let rows = raw(&[
        (0.0, 100.0, Some(60.0)),
        // Within the deadband of the stored 100 W.
        (60.0, 104.0, Some(60.0)),
        // A hold that ends 30 s later, then a silence.
        (120.0, 110.0, Some(30.0)),
        (600.0, 0.0, Some(60.0)),
    ]);
    storage
        .import(DEVICE, plant.power, watts(), rows)
        .await
        .unwrap();

    assert_eq!(
        plant.history(&storage, 0.0, 3600.0).await,
        [
            (0.0, Some(100.0)),
            (120.0, Some(110.0)),
            (150.0, None),
            (600.0, Some(0.0)),
            (660.0, None)
        ]
    );
}

/// `count` rows a minute apart from `from` seconds, each held a minute.
fn minutes(from: f64, count: u32, value: f64) -> Vec<(f64, f64, Option<f64>)> {
    (0..count)
        .map(|i| (f64::from(i).mul_add(60.0, from), value, Some(60.0)))
        .collect()
}

#[tokio::test]
async fn only_rows_before_the_first_stored_change_point_are_imported() {
    let dir = tempfile::tempdir().unwrap();
    let plant = Plant::new();
    let storage = plant.open(&dir.path().join("i.sqlite"), epoch()).await;
    let live: Vec<_> = (0..30)
        .map(|i| (f64::from(i).mul_add(5.0, 3600.0), 2000.0))
        .collect();
    plant.record(&storage, &live).await;
    storage.tick(at(3720.0)).await.unwrap();

    let written = storage
        .import(DEVICE, plant.power, watts(), raw(&minutes(0.0, 70, 1000.0)))
        .await
        .unwrap();

    assert_eq!(written.points, 1);
    assert_eq!(
        plant.history(&storage, 0.0, 3700.0).await,
        [(0.0, Some(1000.0)), (3600.0, Some(2000.0))]
    );
    assert_eq!(
        measured(&rollups(&storage, plant.power, Tier::Hour, 0.0, 3600.0).await),
        [(0.0, 1.0, 1000.0, 1000.0, 1000.0, 1000.0)]
    );
}

#[tokio::test]
async fn a_second_import_writes_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let plant = Plant::new();
    let storage = Storage::open(&dir.path().join("i.sqlite"), epoch(), "UTC", &plant.bus).unwrap();
    let rows = Backfill {
        hours: vec![(at(-3600.0), 500.0)],
        ..raw(&minutes(0.0, 120, 1000.0))
    };
    let first = storage
        .import(DEVICE, plant.power, watts(), rows.clone())
        .await
        .unwrap();
    let again = storage
        .import(DEVICE, plant.power, watts(), rows)
        .await
        .unwrap();

    assert_eq!(
        (first.points, first.hours, again),
        (2, 1, Backfilled::default())
    );
    assert_eq!(
        plant.history(&storage, 0.0, 7300.0).await,
        [(0.0, Some(1000.0)), (7200.0, None)]
    );
}

/// 2026-08-26 00:00 UTC, in seconds from `T0`.
const MIDNIGHT: f64 = -12.0 * 3600.0;
const DAY: f64 = 86_400.0;

#[tokio::test]
async fn hours_and_days_become_rollups_where_no_raw_row_falls() {
    let dir = tempfile::tempdir().unwrap();
    let plant = Plant::new();
    let storage = Storage::open(&dir.path().join("i.sqlite"), epoch(), "UTC", &plant.bus).unwrap();
    let hour = |h: f64| at(h.mul_add(3600.0, MIDNIGHT - DAY));
    let backfill = Backfill {
        days: vec![(at(2.0f64.mul_add(-DAY, MIDNIGHT)), 400.0)],
        // The last hour holds raw rows: they win.
        hours: vec![(hour(10.0), 800.0), (hour(11.0), 1200.0), (at(0.0), 9999.0)],
        ..raw(&minutes(0.0, 10, 1000.0))
    };
    let written = storage
        .import(DEVICE, plant.power, watts(), backfill)
        .await
        .unwrap();

    assert_eq!((written.hours, written.days), (2, 2));
    assert_eq!(
        measured(&rollups(&storage, plant.power, Tier::Hour, -3.0 * DAY, DAY).await),
        [
            (-26.0, 1.0, 800.0, 800.0, 800.0, 800.0),
            (-25.0, 1.0, 1200.0, 1200.0, 1200.0, 1200.0),
            (0.0, 0.167, 1000.0, 1000.0, 1000.0, 166.667),
        ]
    );
    assert_eq!(
        measured(&rollups(&storage, plant.power, Tier::Day, -3.0 * DAY, DAY).await),
        [
            (-60.0, 24.0, 400.0, 400.0, 400.0, 9600.0),
            // Summed from its hours: a UTC day is whole hours.
            (-36.0, 2.0, 1000.0, 800.0, 1200.0, 2000.0),
            (-12.0, 0.167, 1000.0, 1000.0, 1000.0, 166.667),
        ]
    );
}

#[tokio::test]
async fn a_counter_bucket_rises_from_the_one_before() {
    let dir = tempfile::tempdir().unwrap();
    let plant = Plant::new();
    let storage = Storage::open(&dir.path().join("i.sqlite"), epoch(), "UTC", &plant.bus).unwrap();
    let counter = Policy {
        kind: RoleKind::Counter,
        ..policy()
    };
    let hour = |h: f64| at(h.mul_add(3600.0, MIDNIGHT));
    let backfill = Backfill {
        hours: vec![
            (hour(0.0), 4990.0),
            (hour(1.0), 4991.5),
            (hour(3.0), 4993.0),
        ],
        ..Backfill::default()
    };
    storage
        .import(DEVICE, plant.power, counter, backfill)
        .await
        .unwrap();

    assert_eq!(
        counted(&rollups(&storage, plant.power, Tier::Hour, -DAY, DAY).await),
        [
            (-12.0, 4990.0, 4990.0, 0.0),
            (-11.0, 4990.0, 4991.5, 1.5),
            // Across a missing hour: nothing is known of it.
            (-9.0, 4993.0, 4993.0, 0.0),
        ]
    );
    assert_eq!(
        counted(&rollups(&storage, plant.power, Tier::Day, -DAY, DAY).await),
        [(-12.0, 4990.0, 4993.0, 1.5)]
    );
}
