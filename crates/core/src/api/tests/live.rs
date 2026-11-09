//! The live stream over SSE (ADR 9).

use std::time::{Duration, SystemTime};

use axum::body::BodyDataStream;
use axum::http::{StatusCode, header};
use futures_util::StreamExt;
use serde_json::{Value, json};
use tempfile::TempDir;

use super::{Core, get, with_cookie};
use crate::bus::{DeviceId, Reading};

const SECOND: Duration = Duration::from_secs(1);

/// A signed-in core with paused time.
async fn core() -> (TempDir, Core, String) {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    tokio::time::pause();
    (dir, core, set_cookie)
}

impl Core {
    fn publish(&self, device: u32, role: &str, index: Option<u32>, value: f64) {
        self.bus.publish(Reading {
            device: DeviceId(device),
            series: self.bus.intern(role, index),
            value,
            unit: None,
            time: SystemTime::now(),
        });
    }

    async fn live(&self, set_cookie: &str) -> Events {
        let response = self
            .send(with_cookie(set_cookie, get("/api/v1/live")))
            .await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers()[header::CONTENT_TYPE],
            "text/event-stream"
        );
        Events {
            body: response.into_body().into_data_stream(),
            buffer: String::new(),
        }
    }
}

struct Events {
    body: BodyDataStream,
    buffer: String,
}

impl Events {
    /// The next event's name and data; comments are skipped.
    async fn next(&mut self) -> (String, Value) {
        loop {
            if let Some(event) = self.buffered() {
                return event;
            }
            let chunk = self.body.next().await.unwrap().unwrap();
            self.buffer.push_str(std::str::from_utf8(&chunk).unwrap());
        }
    }

    /// The first complete event in the buffer, dropping comments before it.
    fn buffered(&mut self) -> Option<(String, Value)> {
        while let Some(end) = self.buffer.find("\n\n") {
            let event: String = self.buffer.drain(..end + 2).collect();
            if let Some(event) = parse(&event) {
                return Some(event);
            }
        }
        None
    }

    /// Whether no event arrives within `wait`.
    async fn silent_for(&mut self, wait: Duration) -> bool {
        tokio::time::timeout(wait, self.next()).await.is_err()
    }
}

/// An event's name and data; `None` for a comment.
fn parse(event: &str) -> Option<(String, Value)> {
    let name = event.lines().find_map(|l| l.strip_prefix("event: "))?;
    let data = event.lines().find_map(|l| l.strip_prefix("data: "))?;
    Some((name.to_owned(), serde_json::from_str(data).unwrap()))
}

#[tokio::test]
async fn a_client_gets_a_full_snapshot_on_connect() {
    let (_dir, core, set_cookie) = core().await;
    core.publish(7, "battery.power", None, -1000.0);
    core.publish(7, "pv.mppt.power", Some(1), 1234.0);
    core.publish(8, "grid.power", None, 50.0);
    tokio::time::sleep(SECOND).await;

    let mut events = core.live(&set_cookie).await;

    assert_eq!(
        events.next().await,
        (
            "snapshot".to_owned(),
            json!({ "devices": {
                "7": { "battery.power": -1000.0, "pv.mppt.power[1]": 1234.0 },
                "8": { "grid.power": 50.0 },
            }})
        )
    );
}

#[tokio::test]
async fn a_tick_sends_only_the_last_value_of_each_series_changed_in_it() {
    let (_dir, core, set_cookie) = core().await;
    core.publish(7, "battery.power", None, -1000.0);
    core.publish(7, "grid.power", None, 10.0);
    tokio::time::sleep(SECOND).await;
    let mut events = core.live(&set_cookie).await;
    events.next().await;

    core.publish(7, "battery.power", None, -900.0);
    core.publish(7, "battery.power", None, -800.0);
    core.publish(7, "grid.power", None, 10.0);

    assert_eq!(
        events.next().await,
        (
            "delta".to_owned(),
            json!({ "devices": { "7": { "battery.power": -800.0 } } })
        )
    );
}

#[tokio::test]
async fn a_tick_without_a_change_sends_nothing() {
    let (_dir, core, set_cookie) = core().await;
    core.publish(7, "battery.power", None, -1000.0);
    tokio::time::sleep(SECOND).await;
    let mut events = core.live(&set_cookie).await;
    events.next().await;

    core.publish(7, "battery.power", None, -1000.0);

    assert!(events.silent_for(SECOND * 5).await);
}

#[tokio::test]
async fn a_change_arrives_within_one_tick() {
    let (_dir, core, set_cookie) = core().await;
    let mut events = core.live(&set_cookie).await;
    assert_eq!(
        events.next().await,
        ("snapshot".to_owned(), json!({ "devices": {} }))
    );

    core.publish(7, "battery.power", None, -1000.0);

    let delta = tokio::time::timeout(SECOND, events.next()).await.unwrap();
    assert_eq!(
        delta,
        (
            "delta".to_owned(),
            json!({ "devices": { "7": { "battery.power": -1000.0 } } })
        )
    );
}

#[tokio::test]
async fn live_needs_a_session() {
    let (_dir, core, _) = core().await;

    let response = core.send(get("/api/v1/live")).await;

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}
