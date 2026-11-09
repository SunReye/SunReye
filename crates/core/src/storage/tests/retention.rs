//! Change-point retention and a full disk (ADR 3) through the storage interface.

use std::time::Duration;

use super::rollups::{measured, rollups};
use super::{DEVICE, Plant, at, epoch, policy};
use crate::storage::{Backfill, Held, Problem, Storage, Tier};

const DAY: f64 = 86_400.0;

/// Keeps change points for `days`, logging nothing.
async fn retain(storage: &Storage, days: u64) {
    storage
        .retention()
        .set(Duration::from_hours(24 * days), Box::new(|_| Ok(())))
        .await
        .unwrap();
}

#[tokio::test]
async fn expired_hours_lose_their_change_points_and_keep_their_rollups() {
    let dir = tempfile::tempdir().unwrap();
    let plant = Plant::new();
    let storage = plant.open(&dir.path().join("r.sqlite"), epoch()).await;
    retain(&storage, 1).await;
    // Every 5 s, two closed hours each changing at its half; the third opens.
    let readings: Vec<_> = (0..=1440)
        .map(|i| {
            let t = f64::from(i) * 5.0;
            (t, 1.0 + (t / 1800.0).floor())
        })
        .collect();
    plant.record(&storage, &readings).await;

    // A day later the first two hours are past retention.
    storage.tick(at(DAY + 7260.0)).await.unwrap();

    assert_eq!(plant.history(&storage, 0.0, 7200.0).await, []);
    assert_eq!(
        plant.history(&storage, 7200.0, 7300.0).await,
        [(7200.0, Some(5.0)), (7205.0, None)]
    );
    let hourly = [
        (0.0, 1.0, 1.5, 1.0, 2.0, 1.5),
        (1.0, 1.0, 3.5, 3.0, 4.0, 3.5),
    ];
    let first = || rollups(&storage, plant.power, Tier::Hour, 0.0, 7200.0);
    assert_eq!(measured(&first().await), hourly);
    // A rebuild has no change points left to rebuild them from.
    storage
        .rebuild(DEVICE, plant.power, at(0.0)..at(7200.0))
        .await
        .unwrap();
    assert_eq!(measured(&first().await), hourly);
}

#[tokio::test]
async fn retention_is_five_years_until_set_and_kept_across_restarts() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("r.sqlite");
    let plant = Plant::new();
    let storage = plant.open(&path, epoch()).await;
    assert_eq!(storage.retention().get(), Duration::from_hours(24 * 1827));

    retain(&storage, 30).await;
    storage.shutdown().await.unwrap();

    let storage = plant.open(&path, epoch()).await;
    assert_eq!(storage.retention().get(), Duration::from_hours(24 * 30));
}

#[tokio::test]
async fn expiry_shrinks_the_file() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("r.sqlite");
    let plant = Plant::new();
    let storage = plant.open(&path, epoch()).await;
    // Four days of a value changing every 5 s.
    let raw = (0..69_120)
        .map(|i| Held {
            time: at(f64::from(i) * 5.0),
            value: f64::from(i % 1000),
            hold: Some(Duration::from_secs(5)),
        })
        .collect();
    let backfill = Backfill {
        raw,
        ..Backfill::default()
    };
    storage
        .import(DEVICE, plant.power, policy(), backfill)
        .await
        .unwrap();
    storage.shutdown().await.unwrap();
    let full = std::fs::metadata(&path).unwrap().len();

    let storage = plant.open(&path, epoch()).await;
    retain(&storage, 1).await;
    storage.tick(at(5.0 * DAY)).await.unwrap();
    storage.shutdown().await.unwrap();

    let pruned = std::fs::metadata(&path).unwrap().len();
    assert!(pruned * 2 < full, "{pruned} of {full} bytes");
}

#[tokio::test]
async fn a_file_made_without_incremental_vacuum_is_converted_once_at_open() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("r.sqlite");
    let mode = || -> i64 {
        let db = rusqlite::Connection::open(&path).unwrap();
        db.query_row("PRAGMA auto_vacuum", [], |row| row.get(0))
            .unwrap()
    };
    rusqlite::Connection::open(&path)
        .unwrap()
        .execute_batch("PRAGMA auto_vacuum = NONE; CREATE TABLE older (x INTEGER);")
        .unwrap();
    assert_eq!(mode(), 0);

    let plant = Plant::new();
    plant.open(&path, epoch()).await.shutdown().await.unwrap();

    // 2 is incremental.
    assert_eq!(mode(), 2);
}

/// Lets the file grow to `pages` more pages than it has, as a disk with that much room left.
async fn room(storage: &Storage, pages: i64) {
    storage
        .database()
        .run(move |db| {
            // Free pages are room too.
            db.prepare("PRAGMA incremental_vacuum")?
                .query_map([], |_| Ok(()))?
                .for_each(drop);
            let count: i64 = db.query_row("PRAGMA page_count", [], |row| row.get(0))?;
            db.pragma_update(None, "max_page_count", count + pages)
        })
        .await
        .unwrap();
}

#[tokio::test]
async fn on_a_full_disk_history_stops_and_resumes_after_a_gap() {
    let dir = tempfile::tempdir().unwrap();
    let plant = Plant::new();
    let storage = plant.open(&dir.path().join("r.sqlite"), epoch()).await;
    // Every 5 s, so no silence becomes a gap.
    let held = |from: f64, value: f64| -> Vec<(f64, f64)> {
        (0..12)
            .map(|i| (f64::from(i).mul_add(5.0, from), value))
            .collect()
    };
    plant.record(&storage, &held(0.0, 1.0)).await;
    room(&storage, 0).await;

    // A minute of changes every 100 ms, which the full file cannot take.
    let minute: Vec<_> = (0..600)
        .map(|i| (60.0 + f64::from(i) / 10.0, f64::from(i)))
        .collect();
    plant.record(&storage, &minute).await;
    plant.record(&storage, &held(120.0, 9.0)).await;

    assert_eq!(storage.problems().await.unwrap(), [Problem::StorageFull]);
    assert_eq!(Problem::StorageFull.code(), "storage.full");
    assert_eq!(
        plant.history(&storage, 0.0, 3600.0).await,
        [(0.0, Some(1.0))]
    );

    room(&storage, 1 << 20).await;
    plant.record(&storage, &[(180.0, 10.0)]).await;

    assert_eq!(storage.problems().await.unwrap(), []);
    assert_eq!(
        plant.history(&storage, 0.0, 3600.0).await,
        [(0.0, Some(1.0)), (60.0, None), (120.0, Some(9.0))]
    );
}
