//! History by device, series and range (ADR 9), over change points and rollups in SQLite.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::http::StatusCode;
use serde_json::{Value, json};
use sunreye_profile::RoleKind;
use tempfile::TempDir;

use super::{Core, get, json, problem, with_cookie};
use crate::bus::{DeviceId, Reading};
use crate::storage::Policy;

/// 2026-08-26 12:00 UTC, on an hour.
const T0: u64 = 1_787_745_600;
const DEVICE: DeviceId = DeviceId(7);
const POWER: (&str, Option<u32>) = ("pv.mppt.power", Some(2));

fn at(seconds: u64) -> SystemTime {
    UNIX_EPOCH + Duration::from_secs(T0 + seconds)
}

/// `seconds` from `T0` as the API writes an instant.
fn instant(seconds: u64) -> String {
    jiff::Timestamp::try_from(at(seconds)).unwrap().to_string()
}

/// A signed-in core storing `pv.mppt.power[2]` of device 7, polled every `cadence` seconds.
async fn core(kind: RoleKind, cadence: u64) -> (TempDir, Core, String) {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let policy = Policy {
        kind,
        step: 0.1,
        deadband: 0.0,
        cadence: Duration::from_secs(cadence),
    };
    let series = core.bus.intern(POWER.0, POWER.1);
    core.storage.declare(DEVICE, series, policy).await.unwrap();
    (dir, core, set_cookie)
}

impl Core {
    /// Stores the readings, as seconds from `T0` and values, and flushes them a day later.
    async fn store(&self, readings: impl IntoIterator<Item = (u64, f64)>) {
        let last = self.record(readings).await;
        self.storage.tick(at(last + 86_400)).await.unwrap();
    }

    /// Stores the readings and sets the clock to `now` seconds from `T0`.
    async fn store_until(&self, readings: impl IntoIterator<Item = (u64, f64)>, now: u64) {
        self.record(readings).await;
        self.storage.tick(at(now)).await.unwrap();
        self.set_clock(at(now));
    }

    /// Records the readings; returns the last one's seconds from `T0`.
    async fn record(&self, readings: impl IntoIterator<Item = (u64, f64)>) -> u64 {
        let series = self.bus.intern(POWER.0, POWER.1);
        let mut last = 0;
        for (seconds, value) in readings {
            let reading = Reading {
                device: DEVICE,
                series,
                value,
                unit: None,
                time: at(seconds),
                cadence: crate::endpoint::CADENCE,
            };
            self.storage.record(reading).await.unwrap();
            last = seconds;
        }
        last
    }

    /// The history of `pv.mppt.power[2]` from `from` to `to` seconds after `T0`.
    async fn history(&self, set_cookie: &str, from: u64, to: u64) -> (StatusCode, Value) {
        let uri = format!(
            "/api/v1/devices/7/history?series=pv.mppt.power%5B2%5D&from={}&to={}",
            instant(from),
            instant(to)
        );
        let response = self.send(with_cookie(set_cookie, get(&uri))).await;
        (response.status(), json(response).await)
    }
}

#[tokio::test]
async fn a_short_range_returns_raw_intervals_without_gaps() {
    let (_dir, core, set_cookie) = core(RoleKind::Measurement, 5).await;
    core.store([(0, 100.0), (10, 150.0), (20, 120.0)]).await;

    let (status, body) = core.history(&set_cookie, 5, 3600).await;

    assert_eq!(status, StatusCode::OK);
    // The last value holds one cadence, then the series is a gap.
    assert_eq!(
        body,
        json!({
            "tier": "raw",
            "points": [
                { "start": instant(5), "end": instant(10), "mean": 100.0 },
                { "start": instant(10), "end": instant(20), "mean": 150.0 },
                { "start": instant(20), "end": instant(25), "mean": 120.0 },
            ],
        })
    );
}

/// One reading every `every` seconds from `from` to before `to`.
fn steady(from: u64, to: u64, every: u64, value: impl Fn(u64) -> f64) -> Vec<(u64, f64)> {
    (from..to)
        .step_by(every.try_into().unwrap())
        .map(|t| (t, value(t)))
        .collect()
}

#[tokio::test]
async fn a_range_over_a_day_returns_hourly_time_weighted_means() {
    let (_dir, core, set_cookie) = core(RoleKind::Measurement, 60).await;
    // 1 kW, then 2 kW from half past the first hour, for three hours.
    core.store(steady(0, 10_800, 60, |t| {
        if t < 1800 { 1000.0 } else { 2000.0 }
    }))
    .await;

    let (status, body) = core.history(&set_cookie, 1800, 2 * 86_400).await;

    assert_eq!(status, StatusCode::OK);
    // The hour the range starts in is whole.
    assert_eq!(
        body,
        json!({
            "tier": "hour",
            "points": [
                { "start": instant(0), "end": instant(3600), "mean": 1500.0 },
                { "start": instant(3600), "end": instant(7200), "mean": 2000.0 },
                { "start": instant(7200), "end": instant(10_800), "mean": 2000.0 },
            ],
        })
    );
}

#[tokio::test]
async fn a_short_range_over_1500_intervals_returns_minute_means() {
    let (_dir, core, set_cookie) = core(RoleKind::Measurement, 5).await;
    // Alternating 1 kW and 2 kW, 4 kW for half a minute before a gap, and again after it.
    let value = |t| match t {
        5400.. => 4000.0,
        _ if t % 10 == 0 => 1000.0,
        _ => 2000.0,
    };
    let after = steady(
        6000,
        10_800,
        5,
        |t| if t % 10 == 0 { 1000.0 } else { 2000.0 },
    );
    core.store(steady(0, 5430, 5, value).into_iter().chain(after))
        .await;

    let (status, body) = core.history(&set_cookie, 30, 10_800).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        (&body["tier"], &body["width"]),
        (&json!("bucket"), &json!(60))
    );
    let points = body["points"].as_array().unwrap();
    // 90 minutes, the one cut by the gap, then 80 after it.
    assert_eq!(points.len(), 171);
    assert_eq!(
        points[0],
        json!({ "start": instant(0), "end": instant(60), "mean": 1500.0 })
    );
    // The gap is not part of the mean.
    assert_eq!(
        points[90],
        json!({ "start": instant(5400), "end": instant(5460), "mean": 4000.0 })
    );
    assert_eq!(
        points[91],
        json!({ "start": instant(6000), "end": instant(6060), "mean": 1500.0 })
    );
}

#[tokio::test]
async fn a_counter_bucket_is_the_time_weighted_mean_of_its_readings() {
    let (_dir, core, set_cookie) = core(RoleKind::Counter, 5).await;
    core.store(steady(0, 7600, 5, |t| {
        f64::from(1000 + u32::try_from(t).unwrap())
    }))
    .await;

    let (_, body) = core.history(&set_cookie, 0, 7600).await;

    assert_eq!(body["tier"], "bucket");
    assert_eq!(
        body["points"][0],
        json!({ "start": instant(0), "end": instant(60), "mean": 1027.5 })
    );
}

#[tokio::test]
async fn the_hour_in_progress_is_read_from_change_points() {
    let (_dir, core, set_cookie) = core(RoleKind::Measurement, 60).await;
    // 1 kW for three hours, then 3 kW for the first half of the fourth, still being read.
    let readings = steady(0, 12_600, 60, |t| if t < 10_800 { 1000.0 } else { 3000.0 });
    core.store_until(readings, 12_660).await;

    let (_, body) = core.history(&set_cookie, 0, 2 * 86_400).await;

    assert_eq!(
        body,
        json!({
            "tier": "hour",
            "points": [
                { "start": instant(0), "end": instant(3600), "mean": 1000.0 },
                { "start": instant(3600), "end": instant(7200), "mean": 1000.0 },
                { "start": instant(7200), "end": instant(10_800), "mean": 1000.0 },
                { "start": instant(10_800), "end": instant(14_400), "mean": 3000.0 },
            ],
        })
    );
}

#[tokio::test]
async fn a_series_never_exceeds_1500_points() {
    let (_dir, core, set_cookie) = core(RoleKind::Measurement, 3600).await;
    core.store(steady(0, 1502 * 3600, 3600, |_| 1000.0)).await;
    let longest_in_hours = 1499 * 3600;

    let (_, hours) = core
        .history(&set_cookie, 1800, 1800 + longest_in_hours)
        .await;
    let (_, days) = core
        .history(&set_cookie, 1800, 1800 + longest_in_hours + 1)
        .await;

    assert_eq!(hours["tier"], "hour");
    assert_eq!(hours["points"].as_array().unwrap().len(), 1500);
    assert_eq!(days["tier"], "day");
    // UTC days from 2026-08-26 to 2026-10-27.
    let days = days["points"].as_array().unwrap();
    assert_eq!(days.len(), 63);
    assert_eq!(
        days[0],
        json!({ "start": "2026-08-26T00:00:00Z", "end": "2026-08-27T00:00:00Z", "mean": 1000.0 })
    );
}

fn refused(code: &str) -> (StatusCode, String) {
    let status = if code == "history.range" {
        StatusCode::UNPROCESSABLE_ENTITY
    } else {
        StatusCode::BAD_REQUEST
    };
    (status, code.to_owned())
}

#[tokio::test]
async fn an_empty_or_over_long_range_is_refused() {
    let (_dir, core, set_cookie) = core(RoleKind::Measurement, 5).await;
    // Days of 23 hours keep 1,498 of them and the two the range cuts within 1,500 points.
    let longest = 1498 * 23 * 3600;
    let uri = |from: u64, to: u64| {
        format!(
            "/api/v1/devices/7/history?series=pv.mppt.power%5B2%5D&from={}&to={}",
            instant(from),
            instant(to)
        )
    };
    let send = |uri: String| core.send(with_cookie(&set_cookie, get(&uri)));

    assert_eq!(send(uri(0, longest)).await.status(), StatusCode::OK);
    for (from, to) in [(0, longest + 1), (10, 10), (10, 5)] {
        let response = send(uri(from, to)).await;
        assert_eq!(problem(response).await, refused("history.range"));
    }
}

#[tokio::test]
async fn a_malformed_query_or_device_is_refused() {
    let (_dir, core, set_cookie) = core(RoleKind::Measurement, 5).await;
    let (from, to) = (instant(0), instant(60));
    let cases = [
        (
            format!("/api/v1/devices/7/history?series=pv.mppt.power%5Bx%5D&from={from}&to={to}"),
            "request.query",
        ),
        (
            format!("/api/v1/devices/7/history?series=pv.mppt.power&from=noon&to={to}"),
            "request.query",
        ),
        (
            format!("/api/v1/devices/7/history?series=pv.mppt.power&from={from}"),
            "request.query",
        ),
        (
            format!("/api/v1/devices/seven/history?series=pv.mppt.power&from={from}&to={to}"),
            "request.path",
        ),
    ];

    for (uri, code) in cases {
        let response = core.send(with_cookie(&set_cookie, get(&uri))).await;
        assert_eq!(problem(response).await, refused(code), "{uri}");
    }
}

#[tokio::test]
async fn a_counter_has_no_mean_past_raw_intervals() {
    let (_dir, core, set_cookie) = core(RoleKind::Counter, 60).await;
    core.store(steady(0, 7200, 60, |t| {
        f64::from(1000 + u32::try_from(t).unwrap())
    }))
    .await;

    let (status, body) = core.history(&set_cookie, 0, 2 * 86_400).await;

    assert_eq!(
        (status, &body["code"]),
        (StatusCode::UNPROCESSABLE_ENTITY, &json!("history.counter"))
    );
}

#[tokio::test]
async fn history_needs_a_session() {
    let (_dir, core, _) = core(RoleKind::Measurement, 5).await;
    let uri = format!(
        "/api/v1/devices/7/history?series=pv.mppt.power&from={}&to={}",
        instant(0),
        instant(60)
    );

    let response = core.send(get(&uri)).await;

    assert_eq!(
        problem(response).await,
        (StatusCode::UNAUTHORIZED, "auth.required".to_owned())
    );
}
