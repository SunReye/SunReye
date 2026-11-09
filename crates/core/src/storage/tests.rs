//! The storage thread over a real SQLite file.

use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use sunreye_profile::RoleKind;

use super::{ChangePoint, Issue, Policy, Problem, Storage};
use crate::bus::{Bus, DeviceId, Reading, SeriesId};

mod import;
mod retention;
mod rollups;

/// 2026-08-26 12:00 UTC, on an hour.
const T0: u64 = 1_787_745_600;
const DEVICE: DeviceId = DeviceId(7);

fn at(seconds: f64) -> SystemTime {
    let t0 = UNIX_EPOCH + Duration::from_secs(T0);
    if seconds < 0.0 {
        t0 - Duration::from_secs_f64(-seconds)
    } else {
        t0 + Duration::from_secs_f64(seconds)
    }
}

fn policy() -> Policy {
    Policy {
        kind: RoleKind::Measurement,
        step: 0.1,
        deadband: 0.0,
        cadence: Duration::from_secs(5),
    }
}

struct Plant {
    bus: Bus,
    power: SeriesId,
}

impl Plant {
    fn new() -> Self {
        let bus = Bus::default();
        let power = bus.intern("pv.mppt.power", Some(2));
        Self { bus, power }
    }

    async fn open(&self, path: &Path, build: SystemTime) -> Storage {
        let storage = Storage::open(path, build, "UTC", &self.bus).unwrap();
        storage.declare(DEVICE, self.power, policy()).await.unwrap();
        storage
    }

    fn reading(&self, seconds: f64, value: f64) -> Reading {
        Reading {
            device: DEVICE,
            series: self.power,
            value,
            unit: None,
            time: at(seconds),
        }
    }

    /// Records one reading per entry.
    async fn record(&self, storage: &Storage, readings: &[(f64, f64)]) {
        for &(seconds, value) in readings {
            storage.record(self.reading(seconds, value)).await.unwrap();
        }
    }

    /// The stored history from `from` to `to` seconds, as seconds and values.
    async fn history(&self, storage: &Storage, from: f64, to: f64) -> Vec<(f64, Option<f64>)> {
        storage
            .history(DEVICE, self.power, at(from), at(to))
            .await
            .unwrap()
            .into_iter()
            .map(|ChangePoint { time, value }| {
                let seconds = time.duration_since(at(0.0)).unwrap().as_secs_f64();
                (seconds, value.map(|v| (v * 1e6).round() / 1e6))
            })
            .collect()
    }
}

fn epoch() -> SystemTime {
    UNIX_EPOCH
}

#[tokio::test]
async fn a_bucket_is_written_when_it_closes() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("history.sqlite");
    let plant = Plant::new();
    let storage = plant.open(&path, epoch()).await;
    plant
        .record(
            &storage,
            &[
                (0.0, 10.0),
                (10.0, 12.5),
                (20.0, 12.5),
                (30.0, 12.5),
                (40.0, 12.5),
                (55.0, 13.0),
            ],
        )
        .await;
    assert_eq!(plant.history(&storage, 0.0, 3600.0).await, []);

    plant.record(&storage, &[(60.0, 14.0)]).await;
    assert_eq!(
        plant.history(&storage, 0.0, 3600.0).await,
        [(0.0, Some(10.0)), (10.0, Some(12.5)), (55.0, Some(13.0))]
    );
}

#[tokio::test]
async fn a_crash_mid_bucket_loses_at_most_the_open_bucket() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("history.sqlite");
    let plant = Plant::new();
    let storage = plant.open(&path, epoch()).await;
    plant
        .record(
            &storage,
            &[(50.0, 1.0), (55.0, 2.0), (60.0, 3.0), (65.0, 4.0)],
        )
        .await;
    // Every reading handled, then dropped without a shutdown, as a crash.
    storage.problems().await.unwrap();
    drop(storage);

    let storage = plant.open(&path, epoch()).await;
    assert_eq!(
        plant.history(&storage, 0.0, 3600.0).await,
        [(50.0, Some(1.0)), (55.0, Some(2.0))]
    );
}

#[tokio::test]
async fn shutdown_writes_the_open_bucket() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("history.sqlite");
    let plant = Plant::new();
    let storage = plant.open(&path, epoch()).await;
    plant.record(&storage, &[(0.0, 1.0), (5.0, 2.0)]).await;
    storage.shutdown().await.unwrap();

    let storage = plant.open(&path, epoch()).await;
    assert_eq!(
        plant.history(&storage, 0.0, 3600.0).await,
        [(0.0, Some(1.0)), (5.0, Some(2.0))]
    );
}

#[tokio::test]
async fn a_restart_ends_the_held_value_one_cadence_after_the_last_flush() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("history.sqlite");
    let plant = Plant::new();
    let storage = plant.open(&path, epoch()).await;
    plant
        .record(
            &storage,
            &[(0.0, 1.0), (10.0, 1.0), (20.0, 1.0), (30.0, 1.0)],
        )
        .await;
    storage.shutdown().await.unwrap();

    let storage = plant.open(&path, epoch()).await;
    plant.record(&storage, &[(600.0, 1.0)]).await;
    storage.shutdown().await.unwrap();

    let storage = plant.open(&path, epoch()).await;
    assert_eq!(
        plant.history(&storage, 0.0, 3600.0).await,
        [(0.0, Some(1.0)), (35.0, None), (600.0, Some(1.0))]
    );
}

#[tokio::test]
async fn a_silent_series_gets_a_gap_when_the_clock_ticks() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("history.sqlite");
    let plant = Plant::new();
    let storage = plant.open(&path, epoch()).await;
    plant.record(&storage, &[(0.0, 1.0), (10.0, 1.0)]).await;
    storage.tick(at(120.0)).await.unwrap();
    assert_eq!(
        plant.history(&storage, 0.0, 3600.0).await,
        [(0.0, Some(1.0)), (15.0, None)]
    );
}

#[tokio::test]
async fn closed_hours_pack_into_one_block_per_device_and_series() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("history.sqlite");
    let plant = Plant::new();
    let storage = plant.open(&path, epoch()).await;
    // Hour 0 changes twice, hour 1 holds flat, hour 2 changes once and stays open.
    let mut readings: Vec<(f64, f64)> = (0..2160)
        .map(|i| {
            let t = f64::from(i) * 5.0;
            (t, if t < 1800.0 { 1.0 } else { 2.0 })
        })
        .collect();
    readings.push((10_800.0, 3.0));
    readings.push((10_805.0, 4.0));
    plant.record(&storage, &readings).await;
    storage.shutdown().await.unwrap();

    let db = rusqlite::Connection::open(&path).unwrap();
    let count = |sql: &str| -> i64 { db.query_row(sql, [], |row| row.get(0)).unwrap() };
    assert_eq!(count("SELECT count(*) FROM block"), 1);
    assert_eq!(count("SELECT count(*) FROM hot"), 2);
    drop(db);

    let storage = plant.open(&path, epoch()).await;
    // The flat hour carries the value forward from the block before it.
    assert_eq!(
        plant.history(&storage, 5400.0, 11_000.0).await,
        [
            (1800.0, Some(2.0)),
            (10_800.0, Some(3.0)),
            (10_805.0, Some(4.0))
        ]
    );
    assert_eq!(
        plant.history(&storage, 0.0, 1800.0).await,
        [(0.0, Some(1.0))]
    );
}

#[tokio::test]
async fn until_the_clock_passes_the_build_time_history_is_held() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("history.sqlite");
    let plant = Plant::new();
    let storage = plant.open(&path, at(3600.0)).await;
    assert_eq!(storage.problems().await.unwrap(), []);
    plant.record(&storage, &[(0.0, 1.0)]).await;
    assert_eq!(storage.problems().await.unwrap(), [Problem::ClockUnsynced]);
    assert_eq!(Problem::ClockUnsynced.code(), "clock.unsynced");

    plant.record(&storage, &[(3605.0, 2.0)]).await;
    assert_eq!(storage.problems().await.unwrap(), []);
    storage.shutdown().await.unwrap();
    let storage = plant.open(&path, epoch()).await;
    assert_eq!(
        plant.history(&storage, 0.0, 7200.0).await,
        [(3605.0, Some(2.0))]
    );
}

#[tokio::test]
async fn until_the_clock_passes_the_last_stored_instant_history_is_held() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("history.sqlite");
    let plant = Plant::new();
    let storage = plant.open(&path, epoch()).await;
    plant.record(&storage, &[(600.0, 1.0)]).await;
    storage.shutdown().await.unwrap();

    // Rebooted with the clock behind, for a new series too.
    let storage = plant.open(&path, epoch()).await;
    let soc = plant.bus.intern("battery.soc", None);
    storage.declare(DEVICE, soc, policy()).await.unwrap();
    storage
        .record(Reading {
            series: soc,
            ..plant.reading(300.0, 50.0)
        })
        .await
        .unwrap();
    storage.tick(at(310.0)).await.unwrap();
    assert_eq!(storage.problems().await.unwrap(), [Problem::ClockUnsynced]);
    storage.shutdown().await.unwrap();

    let storage = plant.open(&path, epoch()).await;
    let soc_history = storage
        .history(DEVICE, soc, at(0.0), at(3600.0))
        .await
        .unwrap();
    assert_eq!(soc_history, []);
}

#[tokio::test]
async fn a_changed_step_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let plant = Plant::new();
    let storage = plant
        .open(&dir.path().join("history.sqlite"), epoch())
        .await;
    let coarser = Policy {
        step: 1.0,
        ..policy()
    };
    assert!(storage.declare(DEVICE, plant.power, coarser).await.is_err());
}

#[tokio::test]
async fn a_changed_deadband_writes_the_pending_points_and_applies_without_a_gap() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("history.sqlite");
    let plant = Plant::new();
    let storage = plant.open(&path, epoch()).await;
    plant
        .record(
            &storage,
            &[
                (0.0, 10.0),
                (10.0, 10.0),
                (20.0, 11.0),
                (30.0, 11.0),
                (40.0, 11.0),
                (50.0, 11.0),
            ],
        )
        .await;
    let wider = Policy {
        deadband: 5.0,
        ..policy()
    };

    storage.declare(DEVICE, plant.power, wider).await.unwrap();

    assert_eq!(
        plant.history(&storage, 0.0, 3600.0).await,
        [(0.0, Some(10.0)), (20.0, Some(11.0))]
    );
    plant.record(&storage, &[(55.0, 15.0), (60.0, 16.0)]).await;
    storage.tick(at(180.0)).await.unwrap();
    assert_eq!(
        plant.history(&storage, 0.0, 3600.0).await,
        [
            (0.0, Some(10.0)),
            (20.0, Some(11.0)),
            (60.0, Some(16.0)),
            (65.0, None)
        ]
    );
}

#[tokio::test]
async fn readings_on_the_bus_reach_storage() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("history.sqlite");
    let plant = Plant::new();
    let storage = plant.open(&path, epoch()).await;
    plant.bus.publish(plant.reading(0.0, 1.0));
    plant.bus.publish(plant.reading(5.0, 2.0));
    tokio::task::yield_now().await;
    storage.shutdown().await.unwrap();

    let storage = plant.open(&path, epoch()).await;
    assert_eq!(
        plant.history(&storage, 0.0, 60.0).await,
        [(0.0, Some(1.0)), (5.0, Some(2.0))]
    );
}

#[tokio::test]
async fn a_feature_module_runs_its_sql_on_the_storage_connection() {
    let dir = tempfile::tempdir().unwrap();
    let storage = Plant::new()
        .open(&dir.path().join("history.sqlite"), epoch())
        .await;

    let journal: String = storage
        .database()
        .run(|db| db.query_row("PRAGMA journal_mode", [], |row| row.get(0)))
        .await
        .unwrap();

    assert_eq!(journal, "wal");
}

/// A forecast as seconds since `T0`: target, issue, value.
type Issued = (f64, f64, f64);

async fn forecasts(storage: &Storage, series: SeriesId) -> Vec<Issued> {
    let seconds = |time: SystemTime| time.duration_since(at(0.0)).unwrap().as_secs_f64();
    storage
        .forecasts(DEVICE, series, epoch(), at(86_400.0))
        .await
        .unwrap()
        .into_iter()
        .map(|f| {
            (
                seconds(f.target),
                seconds(f.issued),
                (f.value * 1e6).round() / 1e6,
            )
        })
        .collect()
}

async fn issue(storage: &Storage, series: SeriesId, issued: f64, values: &[(f64, f64)]) {
    let issue = Issue {
        issued: at(issued),
        step: 0.1,
        values: values.iter().map(|&(t, v)| (at(t), v)).collect(),
    };
    storage.forecast(DEVICE, series, issue).await.unwrap();
}

#[tokio::test]
async fn a_forecast_reads_back_with_its_issue_time() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("history.sqlite");
    let plant = Plant::new();
    let storage = plant.open(&path, epoch()).await;
    let ghi = plant.bus.intern("weather.ghi", None);
    issue(&storage, ghi, 60.0, &[(900.0, 412.34), (1800.0, 405.0)]).await;
    storage.shutdown().await.unwrap();

    let storage = plant.open(&path, epoch()).await;
    assert_eq!(
        forecasts(&storage, ghi).await,
        [(900.0, 60.0, 412.3), (1800.0, 60.0, 405.0)]
    );
}

#[tokio::test]
async fn an_issue_keeps_its_targets_from_the_start_of_its_hour() {
    let dir = tempfile::tempdir().unwrap();
    let plant = Plant::new();
    let storage = plant
        .open(&dir.path().join("history.sqlite"), epoch())
        .await;
    let ghi = plant.bus.intern("weather.ghi", None);
    issue(
        &storage,
        ghi,
        3720.0,
        &[(2700.0, 1.0), (3600.0, 2.0), (4500.0, 3.0)],
    )
    .await;
    assert_eq!(
        forecasts(&storage, ghi).await,
        [(3600.0, 3720.0, 2.0), (4500.0, 3720.0, 3.0)]
    );
}

#[tokio::test]
async fn a_passed_target_hour_keeps_only_its_latest_issue() {
    let dir = tempfile::tempdir().unwrap();
    let plant = Plant::new();
    let storage = plant
        .open(&dir.path().join("history.sqlite"), epoch())
        .await;
    let ghi = plant.bus.intern("weather.ghi", None);
    let hours = [(0.0, 1.0), (1800.0, 1.0), (3600.0, 1.0), (7200.0, 1.0)];
    issue(&storage, ghi, 0.0, &hours).await;
    let hours = [(0.0, 2.0), (1800.0, 2.0), (3600.0, 2.0), (7200.0, 2.0)];
    issue(&storage, ghi, 60.0, &hours).await;
    issue(&storage, ghi, 3660.0, &[(3600.0, 3.0), (7200.0, 3.0)]).await;
    issue(&storage, ghi, 7260.0, &[(7200.0, 4.0)]).await;
    assert_eq!(
        forecasts(&storage, ghi).await,
        [
            (0.0, 60.0, 2.0),
            (1800.0, 60.0, 2.0),
            (3600.0, 3660.0, 3.0),
            (7200.0, 0.0, 1.0),
            (7200.0, 60.0, 2.0),
            (7200.0, 3660.0, 3.0),
            (7200.0, 7260.0, 4.0),
        ]
    );
}

#[tokio::test]
async fn a_database_with_a_newer_schema_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("core.sqlite");
    let newer = super::SCHEMA + 1;
    rusqlite::Connection::open(&path)
        .unwrap()
        .pragma_update(None, "user_version", newer)
        .unwrap();

    let opened = Storage::open(&path, epoch(), "UTC", &Bus::default());

    assert!(
        matches!(opened, Err(super::Error::Newer(v)) if v == newer),
        "{opened:?}"
    );
}
