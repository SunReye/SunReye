//! The weather backfill (ADR 23) through a fake archive: weather history stored before the
//! upgrade, from 2026-01-01 to before 2026-03-10, gains the new quantities.

use std::time::{Duration, SystemTime};

use jiff::civil::{Date, date};
use sunreye_profile::RoleKind;
use tokio::sync::watch;
use tokio::time::Instant;

use super::{BERLIN, DEVICE};
use crate::bus::Bus;
use crate::storage::{ChangePoint, Policy, Storage};
use crate::weather::fake::FakeArchive;
use crate::weather::{Detail, Past, Slot};

const HOUR: Duration = Duration::from_hours(1);

fn midnight(day: Date) -> SystemTime {
    day.to_zoned(jiff::tz::TimeZone::UTC)
        .unwrap()
        .timestamp()
        .into()
}

/// What the archive has for every hour of 2026-01-01 to 2026-03-10.
fn settled() -> Vec<Slot> {
    let from = midnight(date(2026, 1, 1));
    (0..69 * 24)
        .map(|hour| Slot {
            target: from + HOUR * hour,
            ghi: 100.0,
            dni: 100.0,
            dhi: 100.0,
            temperature: 1.0,
            wind: Some(1.0),
            detail: Detail {
                code: Some(3.0),
                humidity: Some(80.0),
                ..Detail::default()
            },
        })
        .collect()
}

struct Plant {
    dir: tempfile::TempDir,
    bus: Bus,
    storage: Storage,
}

impl Plant {
    fn open(dir: tempfile::TempDir) -> Self {
        let bus = Bus::default();
        let storage = Storage::open(
            &dir.path().join("history.sqlite"),
            SystemTime::UNIX_EPOCH,
            "UTC",
            &bus,
        )
        .unwrap();
        Self { dir, bus, storage }
    }

    /// Weather history as stored before the upgrade: irradiance only, from 2026-01-01 to before
    /// 2026-03-10; then the learner's first day after it, 2026-03-10, with the new quantities.
    async fn upgraded() -> Self {
        let plant = Self::irradiance_only().await;
        let to = midnight(date(2026, 3, 10));
        let learner = Slot {
            target: to,
            ghi: 60.0,
            detail: Detail {
                code: Some(61.0),
                ..Detail::default()
            },
            ..settled()[0]
        };
        let day = date(2026, 3, 10);
        Past::new(FakeArchive::new(vec![learner]).0, DEVICE, &plant.bus)
            .fetch(&plant.storage, BERLIN, day, day)
            .await
            .unwrap();
        plant
    }

    /// Weather history as stored before the upgrade, with no day fetched since.
    async fn irradiance_only() -> Self {
        let plant = Self::open(tempfile::tempdir().unwrap());
        let (from, to) = (midnight(date(2026, 1, 1)), midnight(date(2026, 3, 10)));
        let ghi = plant.bus.intern("weather.ghi", None);
        let policy = Policy::new(RoleKind::Measurement, None, 0.1, HOUR);
        plant.storage.declare(DEVICE, ghi, policy).await.unwrap();
        let mut points: Vec<_> = std::iter::successors(Some(from), |t| Some(*t + HOUR))
            .take_while(|t| *t < to)
            .map(|time| ChangePoint {
                time,
                value: Some(50.0),
            })
            .collect();
        points.push(ChangePoint {
            time: to,
            value: None,
        });
        plant
            .storage
            .replace(DEVICE, ghi, from..to + HOUR, points)
            .await
            .unwrap();
        plant
    }

    /// The same file after a restart.
    async fn restarted(self) -> Self {
        self.storage.shutdown().await.unwrap();
        Self::open(self.dir)
    }

    /// The stored value of `role` at `time`.
    async fn at(&self, role: &str, time: SystemTime) -> Option<f64> {
        let points = self
            .storage
            .history(DEVICE, self.bus.intern(role, None), time, time + HOUR)
            .await
            .unwrap();
        points.iter().rev().find(|p| p.time <= time)?.value
    }
}

#[tokio::test]
async fn it_fetches_the_span_weather_history_covers_in_30_day_chunks_newest_first_and_only_once() {
    let plant = Plant::upgraded().await;
    let (archive, mut calls) = FakeArchive::new(settled());
    let past = Past::new(archive, DEVICE, &plant.bus);
    let (_location, berlin) = watch::channel(Some(BERLIN));

    past.backfill(&plant.storage, berlin.clone()).await;
    past.backfill(&plant.storage, berlin).await;

    let mut asked = Vec::new();
    while let Ok((_, at, from, to)) = calls.try_recv() {
        assert_eq!(at, BERLIN.rounded());
        asked.push((from, to));
    }
    assert_eq!(
        asked,
        [
            (date(2026, 2, 8), date(2026, 3, 9)),
            (date(2026, 1, 9), date(2026, 2, 7)),
            (date(2026, 1, 1), date(2026, 1, 8)),
        ]
    );
    let start = midnight(date(2026, 1, 1));
    let boundary = midnight(date(2026, 2, 8));
    let upgrade = midnight(date(2026, 3, 10));
    assert_eq!(plant.at("weather.code", start).await, Some(3.0));
    assert_eq!(
        plant.at("weather.humidity", boundary - HOUR).await,
        Some(80.0)
    );
    assert_eq!(plant.at("weather.humidity", boundary).await, Some(80.0));
    assert_eq!(plant.at("weather.code", upgrade - HOUR).await, Some(3.0));
    // What was stored stays: irradiance, and the learner's first hour after the span.
    assert_eq!(plant.at("weather.ghi", boundary).await, Some(50.0));
    assert_eq!(plant.at("weather.ghi", upgrade - HOUR).await, Some(50.0));
    assert_eq!(plant.at("weather.code", upgrade).await, Some(61.0));
    assert_eq!(plant.at("weather.ghi", upgrade).await, Some(60.0));
}

#[tokio::test]
async fn with_no_day_fetched_since_the_upgrade_the_new_quantities_end_where_weather_history_does()
{
    let plant = Plant::irradiance_only().await;
    let (archive, _calls) = FakeArchive::new(settled());
    let (_location, berlin) = watch::channel(Some(BERLIN));

    Past::new(archive, DEVICE, &plant.bus)
        .backfill(&plant.storage, berlin)
        .await;

    let end = midnight(date(2026, 3, 10));
    assert_eq!(plant.at("weather.code", end - HOUR).await, Some(3.0));
    assert_eq!(plant.at("weather.humidity", end - HOUR).await, Some(80.0));
    assert_eq!(plant.at("weather.code", end).await, None);
    assert_eq!(plant.at("weather.humidity", end + 24 * HOUR).await, None);
}

#[tokio::test]
async fn a_restart_part_way_resumes_without_fetching_a_stored_chunk_again() {
    let plant = Plant::upgraded().await;
    let (archive, mut calls) = FakeArchive::new(settled());
    let past = Past::new(archive.failing(&[false, true]), DEVICE, &plant.bus);
    let (_location, berlin) = watch::channel(Some(BERLIN));
    tokio::select! {
        () = past.backfill(&plant.storage, berlin.clone()) => panic!("the backfill finished"),
        _ = async { calls.recv().await; calls.recv().await } => {}
    }
    drop(past);

    let plant = plant.restarted().await;
    let (archive, mut calls) = FakeArchive::new(settled());
    Past::new(archive, DEVICE, &plant.bus)
        .backfill(&plant.storage, berlin)
        .await;

    let mut asked = Vec::new();
    while let Ok((_, _, from, to)) = calls.try_recv() {
        asked.push((from, to));
    }
    assert_eq!(
        asked,
        [
            (date(2026, 1, 9), date(2026, 2, 7)),
            (date(2026, 1, 1), date(2026, 1, 8)),
        ]
    );
    assert_eq!(
        plant.at("weather.code", midnight(date(2026, 3, 9))).await,
        Some(3.0)
    );
}

#[tokio::test(start_paused = true)]
async fn a_refused_request_is_retried_after_a_wait_that_doubles() {
    let plant = Plant::upgraded().await;
    let (archive, mut calls) = FakeArchive::new(settled());
    let past = Past::new(archive.failing(&[true, true, false]), DEVICE, &plant.bus);
    let (_location, berlin) = watch::channel(Some(BERLIN));
    let start = Instant::now();

    past.backfill(&plant.storage, berlin).await;

    let mut asked = Vec::new();
    while let Ok((when, _, from, _)) = calls.try_recv() {
        asked.push((when - start, from));
    }
    let (first, second) = (date(2026, 2, 8), date(2026, 1, 9));
    assert_eq!(
        asked,
        [
            (Duration::ZERO, first),
            (Duration::from_mins(1), first),
            (Duration::from_mins(3), first),
            (Duration::from_mins(3), second),
            (Duration::from_mins(3), date(2026, 1, 1)),
        ]
    );
}

#[tokio::test]
async fn without_weather_history_nothing_is_fetched() {
    let plant = Plant::open(tempfile::tempdir().unwrap());
    let (archive, mut calls) = FakeArchive::new(settled());
    let (_location, berlin) = watch::channel(Some(BERLIN));

    Past::new(archive, DEVICE, &plant.bus)
        .backfill(&plant.storage, berlin)
        .await;

    assert!(calls.try_recv().is_err());
}
