//! Forecasts by device, series and range (ADR 9, 15), over the forecast store in SQLite.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::http::StatusCode;
use serde_json::{Value, json};

use super::{Core, get, json, problem, with_cookie};
use crate::bus::DeviceId;
use crate::storage::Issue;

/// 2026-11-09 11:00 UTC, on an hour.
const T0: u64 = 1_794_222_000;
const DEVICE: DeviceId = DeviceId(1);

fn at(seconds: u64) -> SystemTime {
    UNIX_EPOCH + Duration::from_secs(T0 + seconds)
}

fn instant(seconds: u64) -> String {
    jiff::Timestamp::try_from(at(seconds)).unwrap().to_string()
}

impl Core {
    /// Stores one issue of `pv.power` forecasts at `issued` seconds from `T0`.
    async fn issue(&self, issued: u64, values: &[(u64, f64)]) {
        let series = self.bus.intern("pv.power", None);
        let issue = Issue {
            issued: at(issued),
            step: 1.0,
            values: values.iter().map(|&(t, v)| (at(t), v)).collect(),
        };
        self.storage.forecast(DEVICE, series, issue).await.unwrap();
    }

    async fn forecasts(&self, set_cookie: &str, query: &str) -> (StatusCode, Value) {
        let uri = format!("/api/v1/devices/1/forecasts?series=pv.power&{query}");
        let response = self.send(with_cookie(set_cookie, get(&uri))).await;
        (response.status(), json(response).await)
    }
}

fn range(from: u64, to: u64) -> String {
    format!("from={}&to={}", instant(from), instant(to))
}

#[tokio::test]
async fn forecasts_come_from_the_latest_issue_of_each_target() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    core.issue(0, &[(900, 100.0), (1800, 200.0)]).await;
    core.issue(600, &[(900, 150.0)]).await;

    let (status, body) = core.forecasts(&set_cookie, &range(0, 3600)).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body,
        json!({ "points": [
            { "target": instant(900), "issued": instant(600), "value": 150.0 },
            { "target": instant(1800), "issued": instant(0), "value": 200.0 },
        ]})
    );
}

#[tokio::test]
async fn an_earlier_issue_is_selected_by_issued_before() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    core.issue(0, &[(900, 100.0)]).await;
    core.issue(600, &[(900, 150.0)]).await;

    let query = format!("{}&issuedBefore={}", range(0, 3600), instant(600));
    let (status, body) = core.forecasts(&set_cookie, &query).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body,
        json!({ "points": [{ "target": instant(900), "issued": instant(0), "value": 100.0 }] })
    );
}

#[tokio::test]
async fn an_empty_range_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;

    let uri = format!(
        "/api/v1/devices/1/forecasts?series=pv.power&{}",
        range(900, 900)
    );
    let response = core.send(with_cookie(&set_cookie, get(&uri))).await;

    assert_eq!(
        problem(response).await,
        (
            StatusCode::UNPROCESSABLE_ENTITY,
            "forecast.range".to_owned()
        )
    );
}

#[tokio::test]
async fn more_than_1500_points_are_refused() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let values: Vec<(u64, f64)> = (0..1501).map(|i| (60 * i, 1.0)).collect();
    core.issue(0, &values).await;

    let uri = format!(
        "/api/v1/devices/1/forecasts?series=pv.power&{}",
        range(0, 100_000)
    );
    let response = core.send(with_cookie(&set_cookie, get(&uri))).await;

    assert_eq!(
        problem(response).await,
        (
            StatusCode::UNPROCESSABLE_ENTITY,
            "forecast.range".to_owned()
        )
    );
}

#[tokio::test]
async fn exactly_1500_points_are_served() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let values: Vec<(u64, f64)> = (0..1500).map(|i| (60 * i, 1.0)).collect();
    core.issue(0, &values).await;

    let (status, body) = core.forecasts(&set_cookie, &range(0, 100_000)).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["points"].as_array().map(Vec::len), Some(1500));
}
