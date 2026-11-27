//! Statistics by hour, and by plant-local day, week and month (ADR 3, 9), from the rollups.

use std::time::{Duration, SystemTime};

use axum::http::StatusCode;
use serde_json::{Value, json};
use sunreye_profile::RoleKind;
use tempfile::TempDir;

use super::devices::send;
use super::{Core, get};
use crate::bus::{DeviceId, Reading};
use crate::storage::{Backfill, Held, Policy};

const DEVICE: DeviceId = DeviceId(7);

fn at(text: &str) -> SystemTime {
    text.parse::<jiff::Timestamp>().unwrap().into()
}

/// A signed-in core on Berlin time storing `role` of device 7, read hourly.
async fn berlin(role: &str, kind: RoleKind) -> (TempDir, Core, String) {
    berlin_every(role, kind, Duration::from_hours(1)).await
}

/// As [`berlin`], read every `cadence`.
async fn berlin_every(role: &str, kind: RoleKind, cadence: Duration) -> (TempDir, Core, String) {
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
        unit: None,
        step: 0.5,
        deadband: 0.0,
        cadence,
    };
    let series = core.bus.intern(role, None);
    core.storage.declare(DEVICE, series, policy).await.unwrap();
    (dir, core, set_cookie)
}

impl Core {
    /// Stores `role` of device 7 every hour from `from` to `to` inclusive, the `n`th reading
    /// `value(n)`, and closes every day.
    async fn hourly_until(
        &self,
        role: &str,
        kind: RoleKind,
        (from, to): (&str, &str),
        value: impl Fn(u32) -> f64,
    ) {
        let series = self.bus.intern(role, None);
        let policy = Policy {
            kind,
            unit: None,
            step: 0.5,
            deadband: 0.0,
            cadence: Duration::from_hours(1),
        };
        let (mut time, end, mut n) = (at(from), at(to), 0);
        let mut raw = Vec::new();
        while time <= end {
            raw.push(Held {
                time,
                value: value(n),
                hold: Some(Duration::from_hours(1)),
            });
            time += Duration::from_hours(1);
            n += 1;
        }
        self.storage
            .import(
                DEVICE,
                series,
                policy,
                Backfill {
                    raw,
                    ..Backfill::default()
                },
            )
            .await
            .unwrap();
        let later = end + Duration::from_hours(72);
        self.storage.tick(later).await.unwrap();
        self.set_clock(later);
    }

    /// As [`Core::hourly_until`] for the series `berlin` declared, through the live path: each
    /// reading recorded as a poll would be, and every hour rolled up as it closes.
    async fn recorded_hourly_until(
        &self,
        role: &str,
        (from, to): (&str, &str),
        value: impl Fn(u32) -> f64,
    ) {
        let series = self.bus.intern(role, None);
        let (mut time, end, mut n) = (at(from), at(to), 0);
        while time <= end {
            let reading = Reading {
                device: DEVICE,
                series,
                value: value(n),
                unit: None,
                time,
                cadence: crate::endpoint::CADENCE,
            };
            self.storage.record(reading).await.unwrap();
            time += Duration::from_hours(1);
            n += 1;
        }
        let later = end + Duration::from_hours(72);
        self.storage.tick(later).await.unwrap();
        self.set_clock(later);
    }

    /// The statistics of the one series `query` names, without its name, or the refusal.
    async fn statistics(&self, set_cookie: &str, query: &str) -> (StatusCode, Value) {
        let (status, mut body) = self.statistics_of(set_cookie, query).await;
        if status != StatusCode::OK {
            return (status, body);
        }
        let mut list = body["series"].take();
        assert_eq!(list.as_array().map(Vec::len), Some(1), "{list}");
        let mut one = list[0].take();
        one.as_object_mut().unwrap().remove("series");
        (status, one)
    }

    async fn statistics_of(&self, set_cookie: &str, query: &str) -> (StatusCode, Value) {
        let uri = format!("/api/v1/devices/7/statistics?{query}");
        self.ask(set_cookie, get(&uri)).await
    }
}

#[tokio::test]
async fn one_request_reads_several_series_each_by_name() {
    let (_dir, core, set_cookie) = berlin("pv.power", RoleKind::Measurement).await;
    core.hourly_until(
        "pv.power",
        RoleKind::Measurement,
        ("2026-10-24T22:00:00Z", "2026-10-25T22:00:00Z"),
        |_| 100.0,
    )
    .await;
    let range = "period=day&from=2026-10-24T22:00:00Z&to=2026-10-25T23:00:00Z";

    let (status, body) = core
        .statistics_of(
            &set_cookie,
            &format!("series=load.power&series=pv.power&{range}"),
        )
        .await;

    assert_eq!(status, StatusCode::OK, "{body}");
    let list = body["series"].as_array().unwrap();
    assert_eq!(list.len(), 2);
    assert_eq!(
        list[0],
        json!({ "series": "load.power", "period": "day", "points": [] })
    );
    assert_eq!(list[1]["series"], "pv.power");
    assert_eq!(list[1]["points"][0]["integral"], json!(2500.0));
}

#[tokio::test]
async fn seventeen_series_or_one_malformed_refuse_the_request() {
    let (_dir, core, set_cookie) = berlin("pv.power", RoleKind::Measurement).await;
    let range = "period=day&from=2026-10-24T22:00:00Z&to=2026-10-25T23:00:00Z";
    let many = (1..=17)
        .map(|i| format!("series=pv.string.power%5B{i}%5D&"))
        .collect::<Vec<_>>()
        .concat();

    let (over, seventeen) = core
        .statistics_of(&set_cookie, &format!("{many}{range}"))
        .await;
    let (bad, malformed) = core
        .statistics_of(
            &set_cookie,
            &format!("series=pv.power&series=pv.power%5Bx%5D&{range}"),
        )
        .await;

    assert_eq!(
        (over, &seventeen["code"]),
        (StatusCode::BAD_REQUEST, &json!("request.query"))
    );
    assert_eq!(
        (bad, malformed),
        (
            StatusCode::BAD_REQUEST,
            json!({ "status": 400, "code": "request.query", "series": "pv.power[x]" })
        )
    );
}

#[tokio::test]
async fn a_week_sums_its_plant_local_days_across_the_end_of_summer_time() {
    let (_dir, core, set_cookie) = berlin("pv.energy.total", RoleKind::Counter).await;
    // 1 kWh more each hour, from the hour before Monday 19 October 00:00 CEST to the last hour
    // before Monday 26 October 00:00 CET.
    // Recorded live, so the hourly rollups and the days are those `roll` writes.
    core.recorded_hourly_until(
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
        RoleKind::Measurement,
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
                "hours": 745.0,
            }],
        })
    );
}

#[tokio::test]
async fn only_periods_starting_in_the_range_are_read() {
    let (_dir, core, set_cookie) = berlin("pv.energy.total", RoleKind::Counter).await;
    core.hourly_until(
        "pv.energy.total",
        RoleKind::Counter,
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
async fn an_hour_of_an_hourly_series_is_read_from_its_change_points() {
    let (_dir, core, set_cookie) = berlin("pv.power", RoleKind::Measurement).await;
    // 1 kW, then 2 kW, then 3 kW, each held an hour.
    core.hourly_until(
        "pv.power",
        RoleKind::Measurement,
        ("2026-10-24T10:00:00Z", "2026-10-24T12:00:00Z"),
        |n| f64::from(n + 1) * 1000.0,
    )
    .await;

    let (status, body) = core
        .statistics(
            &set_cookie,
            "series=pv.power&period=hour&from=2026-10-24T11:00:00Z&to=2026-10-24T13:00:00Z",
        )
        .await;

    assert_eq!(status, StatusCode::OK, "{body}");
    let hour = |start: &str, end: &str, watts: f64| {
        json!({
            "date": "2026-10-24", "start": start, "end": end,
            "mean": watts, "min": watts, "max": watts, "integral": watts, "hours": 1.0,
        })
    };
    assert_eq!(
        body,
        json!({
            "period": "hour",
            "points": [
                hour("2026-10-24T11:00:00Z", "2026-10-24T12:00:00Z", 2000.0),
                hour("2026-10-24T12:00:00Z", "2026-10-24T13:00:00Z", 3000.0),
            ],
        })
    );
}

#[tokio::test]
async fn an_hour_past_change_point_retention_is_read_from_its_hourly_rollup() {
    let five_minutes = Duration::from_mins(5);
    let (_dir, core, set_cookie) =
        berlin_every("pv.power", RoleKind::Measurement, five_minutes).await;
    core.storage
        .retention()
        .set(Duration::from_hours(24), Box::new(|_| Ok(())))
        .await
        .unwrap();
    // 1 kW, then 2 kW, then 3 kW, each read every five minutes for an hour.
    let series = core.bus.intern("pv.power", None);
    let mut time = at("2026-10-24T10:00:00Z");
    for watts in [1000.0, 2000.0, 3000.0] {
        for _ in 0..12 {
            let reading = Reading {
                device: DEVICE,
                series,
                value: watts,
                unit: None,
                time,
                cadence: five_minutes,
            };
            core.storage.record(reading).await.unwrap();
            time += five_minutes;
        }
    }
    // Three days on, the hours have no change points left.
    let later = at("2026-10-27T13:00:00Z");
    core.storage.tick(later).await.unwrap();
    core.set_clock(later);

    let (status, body) = core
        .statistics(
            &set_cookie,
            "series=pv.power&period=hour&from=2026-10-24T11:00:00Z&to=2026-10-24T13:00:00Z",
        )
        .await;

    assert_eq!(status, StatusCode::OK, "{body}");
    let hour = |start: &str, end: &str, watts: f64| {
        json!({
            "date": "2026-10-24", "start": start, "end": end,
            "mean": watts, "min": watts, "max": watts, "integral": watts, "hours": 1.0,
        })
    };
    assert_eq!(
        body,
        json!({
            "period": "hour",
            "points": [
                hour("2026-10-24T11:00:00Z", "2026-10-24T12:00:00Z", 2000.0),
                hour("2026-10-24T12:00:00Z", "2026-10-24T13:00:00Z", 3000.0),
            ],
        })
    );
}

#[tokio::test]
async fn hours_are_read_as_far_as_the_hourly_history_tier() {
    let (_dir, core, set_cookie) = berlin("pv.power", RoleKind::Measurement).await;

    // 1,500 hours from 1 September.
    let (status, body) = core
        .statistics(
            &set_cookie,
            "series=pv.power&period=hour&from=2026-09-01T00:00:00Z&to=2026-11-02T12:00:00Z",
        )
        .await;

    assert_eq!(
        (status, &body["code"]),
        (StatusCode::UNPROCESSABLE_ENTITY, &json!("history.range"))
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

#[tokio::test]
async fn the_battery_capacity_has_no_estimate_before_a_discharge() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;

    let (status, capacity) = core.ask(&set_cookie, get("/api/v1/battery/capacity")).await;

    assert_eq!(
        (status, capacity),
        (
            StatusCode::OK,
            json!({
                "measurements": [], "now": null, "first": null, "perYear": null,
                "nameplate": null, "discharged": 0.0, "cycles": null, "since": null,
            })
        )
    );
}
