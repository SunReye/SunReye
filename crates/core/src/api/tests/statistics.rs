//! Statistics by plant-local day, week and month (ADR 3, 9), folded from daily rollups.

use std::time::{Duration, SystemTime};

use axum::http::StatusCode;
use serde_json::{Value, json};
use sunreye_profile::RoleKind;
use tempfile::TempDir;

use super::devices::send;
use super::{Core, get};
use crate::bus::{DeviceId, Reading};
use crate::storage::Policy;

const DEVICE: DeviceId = DeviceId(7);

fn at(text: &str) -> SystemTime {
    text.parse::<jiff::Timestamp>().unwrap().into()
}

/// A signed-in core on Berlin time storing `role` of device 7, read hourly.
async fn berlin(role: &str, kind: RoleKind) -> (TempDir, Core, String) {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    core.set_clock(at("2026-09-01T00:00:00Z"));
    let zone = json!({ "name": "Europe/Berlin" });
    let (status, _) = core
        .ask(&set_cookie, send("PUT", "/api/v1/timezone", &zone))
        .await;
    assert_eq!(status, StatusCode::OK);
    let policy = Policy {
        kind,
        step: 0.5,
        deadband: 0.0,
        cadence: Duration::from_hours(1),
    };
    let series = core.bus.intern(role, None);
    core.storage.declare(DEVICE, series, policy).await.unwrap();
    (dir, core, set_cookie)
}

impl Core {
    /// Stores `role` of device 7 every hour from `from` to `to` inclusive, the `n`th reading
    /// `value(n)`, and closes every day.
    async fn hourly_until(&self, role: &str, (from, to): (&str, &str), value: impl Fn(u32) -> f64) {
        let series = self.bus.intern(role, None);
        let (mut time, end, mut n) = (at(from), at(to), 0);
        while time <= end {
            let reading = Reading {
                device: DEVICE,
                series,
                value: value(n),
                unit: None,
                time,
            };
            self.storage.record(reading).await.unwrap();
            time += Duration::from_hours(1);
            n += 1;
        }
        let later = end + Duration::from_hours(72);
        self.storage.tick(later).await.unwrap();
        self.set_clock(later);
    }

    async fn statistics(&self, set_cookie: &str, query: &str) -> (StatusCode, Value) {
        let uri = format!("/api/v1/devices/7/statistics?{query}");
        self.ask(set_cookie, get(&uri)).await
    }
}

#[tokio::test]
async fn a_week_sums_its_plant_local_days_across_the_end_of_summer_time() {
    let (_dir, core, set_cookie) = berlin("pv.energy.total", RoleKind::Counter).await;
    // 1 kWh more each hour, from the hour before Monday 19 October 00:00 CEST to the last hour
    // before Monday 26 October 00:00 CET.
    core.hourly_until(
        "pv.energy.total",
        ("2026-10-18T21:00:00Z", "2026-10-25T22:00:00Z"),
        f64::from,
    )
    .await;

    let (status, body) = core
        .statistics(
            &set_cookie,
            "series=pv.energy.total&period=week&from=2026-10-18T22:00:00Z&to=2026-10-25T23:00:00Z",
        )
        .await;

    assert_eq!(status, StatusCode::OK, "{body}");
    // A rise each hour: six days of 24 hours and Sunday of 25, 169 kWh.
    assert_eq!(
        body,
        json!({
            "period": "week",
            "points": [{
                "date": "2026-10-19",
                "start": "2026-10-18T22:00:00Z",
                "end": "2026-10-25T23:00:00Z",
                "delta": 169.0,
            }],
        })
    );
}

#[tokio::test]
async fn a_month_is_time_weighted_over_its_plant_local_days() {
    let (_dir, core, set_cookie) = berlin("pv.power", RoleKind::Measurement).await;
    // October in Berlin, 745 hours: 1,745 W on the 1st, else 1 kW; the last reading holds an hour.
    core.hourly_until(
        "pv.power",
        ("2026-09-30T22:00:00Z", "2026-10-31T22:00:00Z"),
        |n| if n < 24 { 1745.0 } else { 1000.0 },
    )
    .await;

    let (status, body) = core
        .statistics(
            &set_cookie,
            "series=pv.power&period=month&from=2026-09-30T22:00:00Z&to=2026-10-31T23:00:00Z",
        )
        .await;

    assert_eq!(status, StatusCode::OK, "{body}");
    // 24 h · 1,745 W + 721 h · 1,000 W = 762,880 Wh, over 745 h a mean of 1,024 W.
    assert_eq!(
        body,
        json!({
            "period": "month",
            "points": [{
                "date": "2026-10-01",
                "start": "2026-09-30T22:00:00Z",
                "end": "2026-10-31T23:00:00Z",
                "mean": 1024.0,
                "min": 1000.0,
                "max": 1745.0,
                "integral": 762_880.0,
            }],
        })
    );
}

#[tokio::test]
async fn only_periods_starting_in_the_range_are_read() {
    let (_dir, core, set_cookie) = berlin("pv.energy.total", RoleKind::Counter).await;
    core.hourly_until(
        "pv.energy.total",
        ("2026-10-18T21:00:00Z", "2026-10-25T22:00:00Z"),
        f64::from,
    )
    .await;

    // From Saturday noon: Saturday started before it.
    let (status, body) = core
        .statistics(
            &set_cookie,
            "series=pv.energy.total&period=day&from=2026-10-24T10:00:00Z&to=2026-10-25T23:00:00Z",
        )
        .await;

    assert_eq!(status, StatusCode::OK, "{body}");
    // Sunday, the 25 hours summer time ends on.
    assert_eq!(
        body,
        json!({
            "period": "day",
            "points": [{
                "date": "2026-10-25",
                "start": "2026-10-24T22:00:00Z",
                "end": "2026-10-25T23:00:00Z",
                "delta": 25.0,
            }],
        })
    );
}

#[tokio::test]
async fn an_empty_range_or_an_unknown_period_is_refused() {
    let (_dir, core, set_cookie) = berlin("pv.power", RoleKind::Measurement).await;

    let (empty, body) = core
        .statistics(
            &set_cookie,
            "series=pv.power&period=day&from=2026-10-25T00:00:00Z&to=2026-10-25T00:00:00Z",
        )
        .await;
    assert_eq!(
        (empty, &body["code"]),
        (StatusCode::UNPROCESSABLE_ENTITY, &json!("history.range"))
    );

    let (unknown, body) = core
        .statistics(
            &set_cookie,
            "series=pv.power&period=year&from=2026-10-01T00:00:00Z&to=2026-10-25T00:00:00Z",
        )
        .await;
    assert_eq!(
        (unknown, &body["code"]),
        (StatusCode::BAD_REQUEST, &json!("request.query"))
    );
}
