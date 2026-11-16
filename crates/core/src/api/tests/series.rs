//! The series catalog (ADR 22, ADR 9): every device with stored history and its series.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::http::StatusCode;
use serde_json::{Value, json};
use sunreye_profile::{RoleKind, Unit};

use super::devices::{delete, gateway};
use super::{Core, get, json, with_cookie};
use crate::bus::{DeviceId, Reading};
use crate::storage::{Backfill, Held, Issue, Policy};
use crate::{plant, weather};

/// 2026-08-26 12:00 UTC, on an hour.
const T0: u64 = 1_787_745_600;

fn at(seconds: u64) -> SystemTime {
    UNIX_EPOCH + Duration::from_secs(T0 + seconds)
}

/// `seconds` from `T0` as the API writes an instant.
fn instant(seconds: u64) -> String {
    jiff::Timestamp::try_from(at(seconds)).unwrap().to_string()
}

fn watts() -> Policy {
    Policy::new(
        RoleKind::Measurement,
        Some(Unit::Watt),
        1.0,
        Duration::from_secs(5),
    )
}

impl Core {
    /// Stores `series` of `device` read at each of `seconds` from `T0`, flushed a day later.
    async fn stored(&self, device: DeviceId, series: (&str, Option<u32>), seconds: &[u64]) {
        let series = self.bus.intern(series.0, series.1);
        self.storage.declare(device, series, watts()).await.unwrap();
        for (i, &s) in seconds.iter().enumerate() {
            let reading = Reading {
                device,
                series,
                value: 100.0 + f64::from(u32::try_from(i).unwrap()),
                unit: None,
                time: at(s),
                cadence: crate::endpoint::CADENCE,
            };
            self.storage.record(reading).await.unwrap();
        }
        let last = seconds.last().copied().unwrap_or(0);
        self.storage.tick(at(last + 86_400)).await.unwrap();
    }

    async fn catalog(&self, set_cookie: &str) -> Value {
        let response = self
            .send(with_cookie(set_cookie, get("/api/v1/series")))
            .await;
        assert_eq!(response.status(), StatusCode::OK);
        json(response).await
    }
}

#[tokio::test]
async fn a_registered_devices_stored_series_are_listed_with_their_bounds() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let connection = core.connection(&set_cookie, &gateway()).await;
    let device = core.deye(&set_cookie, &connection, 0).await;
    let id = DeviceId(u32::try_from(device.as_u64().unwrap()).unwrap());
    core.stored(id, ("pv.mppt.power", Some(2)), &[0, 10, 20])
        .await;

    let body = core.catalog(&set_cookie).await;

    // The last value holds three readings' cadence, then a gap is stored where history stops.
    assert_eq!(
        body,
        json!({
            "devices": [{
                "id": device,
                "name": "Deye",
                "removed": false,
                "series": [{
                    "series": "pv.mppt.power[2]",
                    "kind": "measurement",
                    "unit": "W",
                    "first": instant(0),
                    "last": instant(25),
                }],
            }],
        })
    );
}

#[tokio::test]
async fn a_removed_device_keeps_its_name_and_its_series_their_units() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let connection = core.connection(&set_cookie, &gateway()).await;
    let device = core.deye(&set_cookie, &connection, 0).await;
    let id = DeviceId(u32::try_from(device.as_u64().unwrap()).unwrap());
    core.stored(id, ("pv.mppt.power", Some(2)), &[0]).await;

    let (status, _) = core
        .ask(&set_cookie, delete(&format!("/api/v1/devices/{device}")))
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let body = core.catalog(&set_cookie).await;

    // Nothing declares the series any more: its unit is the one stored.
    assert_eq!(body["devices"][0]["id"], device);
    assert_eq!(body["devices"][0]["name"], "Deye");
    assert_eq!(body["devices"][0]["removed"], true);
    assert_eq!(body["devices"][0]["series"][0]["unit"], "W");
}

#[tokio::test]
async fn a_device_without_stored_history_is_not_listed() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let connection = core.connection(&set_cookie, &gateway()).await;
    let quiet = core.deye(&set_cookie, &connection, 0).await;
    let quiet = DeviceId(u32::try_from(quiet.as_u64().unwrap()).unwrap());
    // Declared, but never read.
    core.stored(quiet, ("pv.mppt.power", Some(1)), &[]).await;
    // Forecasts are not history (ADR 3).
    let forecast = core.bus.intern("pv.forecast.power", None);
    let issue = Issue {
        issued: at(0),
        step: 1.0,
        values: vec![(at(3600), 500.0)],
    };
    core.storage
        .forecast(weather::DEVICE, forecast, issue)
        .await
        .unwrap();

    let body = core.catalog(&set_cookie).await;

    assert_eq!(body, json!({ "devices": [] }));
}

#[tokio::test]
async fn a_series_is_bounded_by_its_imported_days_before_its_readings() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let series = core.bus.intern("grid.power", None);
    let backfill = Backfill {
        days: vec![(at(0) - Duration::from_hours(36), 300.0)],
        raw: vec![Held {
            time: at(0),
            value: 500.0,
            hold: Some(Duration::from_secs(60)),
        }],
        ..Backfill::default()
    };
    core.storage
        .import(plant::DEVICE, series, watts(), backfill)
        .await
        .unwrap();

    let body = core.catalog(&set_cookie).await;

    // The imported day is 2026-08-25 in UTC, the plant's zone here; the reading holds a minute.
    assert_eq!(
        body,
        json!({
            "devices": [{
                "id": plant::DEVICE.0,
                "name": null,
                "removed": false,
                "series": [{
                    "series": "grid.power",
                    "kind": "measurement",
                    "unit": "W",
                    "first": "2026-08-25T00:00:00Z",
                    "last": instant(60),
                }],
            }],
        })
    );
}
