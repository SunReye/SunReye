//! EVCC settings (ADR 7, 10): mode, limit SOC and battery boost are admin writes through the one
//! funnel, published to EVCC's set topics and read back from the retained state it republishes.
//!
//! EVCC's MQTT API, <https://docs.evcc.io/en/integrations/mqtt-api>: a loadpoint's state is
//! retained under `<root>/loadpoints/<n>/<key>` with camelCase keys, and written through
//! `<root>/loadpoints/<n>/<key>/set`. A mode change clears battery boost, and boost is refused
//! unless the mode is `pv` or `minpv` (<https://docs.evcc.io/en/features/battery>).

use std::sync::Arc;
use std::time::Duration;

use axum::http::StatusCode;
use serde_json::{Value, json};
use tokio::sync::mpsc;

use super::devices::send;
use super::{Core, get};
use crate::mqtt::fake::{self, Fake, Published};

const MODE: &str = "evcc/loadpoints/1/mode";
const LIMIT: &str = "evcc/loadpoints/1/limitSoc";
const BOOST: &str = "evcc/loadpoints/1/batteryBoost";

/// How EVCC answers a write: the keys it applies and republishes as retained state.
#[derive(Clone, Copy)]
enum Evcc {
    Applies,
    /// Ignores a write to `limitSoc`, as a vehicle without a limit does.
    IgnoresLimit,
}

/// A core signed in, a broker holding EVCC's retained state for loadpoint 1, and the loadpoint
/// with its writes on and every setting enabled.
struct Loadpoint {
    core: Core,
    set_cookie: String,
    id: Value,
    published: mpsc::UnboundedReceiver<Published>,
    _broker: Arc<Fake>,
    _dir: tempfile::TempDir,
}

impl Loadpoint {
    async fn new(mode: &str, evcc: Evcc) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
        let mut broker = fake::serve(0).await;
        for (topic, payload) in [(MODE, mode), (LIMIT, "80"), (BOOST, "false")] {
            broker.retain(topic, payload);
        }
        let (relay, published) = mpsc::unbounded_channel();
        let requests = std::mem::replace(&mut broker.published, mpsc::unbounded_channel().1);
        let broker = Arc::new(broker);
        tokio::spawn(answer(Arc::clone(&broker), requests, relay, evcc));
        let connection = json!({ "name": "broker", "transport": "mqtt", "host": "127.0.0.1",
            "port": broker.address.port(), "topicRoot": "evcc" });
        let connection = core.connection(&set_cookie, &connection).await;
        let device = json!({ "name": "Carport", "connection": connection, "profile": "evcc",
            "unit": 1, "writes": true });
        let (status, body) = core
            .ask(&set_cookie, send("POST", "/api/v1/devices", &device))
            .await;
        assert_eq!(status, StatusCode::CREATED, "{body}");
        let loadpoint = Self {
            core,
            set_cookie,
            id: body["id"].clone(),
            published,
            _broker: broker,
            _dir: dir,
        };
        for key in ["mode", "limitSoc", "batteryBoost"] {
            let uri = format!("/api/v1/devices/{}/settings/{key}/enabled", loadpoint.id);
            let (status, _) = loadpoint.ask(send("PUT", &uri, &json!({}))).await;
            assert_eq!(status, StatusCode::NO_CONTENT);
        }
        loadpoint.until_read().await;
        loadpoint
    }

    async fn ask(&self, request: axum::http::Request<axum::body::Body>) -> (StatusCode, Value) {
        self.core.ask(&self.set_cookie, request).await
    }

    /// Waits until the retained state reached the loadpoint, within two seconds.
    async fn until_read(&self) {
        let uri = format!("/api/v1/roles/ev.battery.boost?device={}", self.id);
        for _ in 0..200 {
            if self.ask(get(&uri)).await.0 == StatusCode::OK {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("the retained state never arrived");
    }

    async fn write(&self, key: &str, value: f64) -> (StatusCode, Value) {
        let uri = format!("/api/v1/devices/{}/settings/{key}", self.id);
        self.ask(send("PUT", &uri, &json!({ "value": value })))
            .await
    }

    /// The messages the core published so far.
    fn published(&mut self) -> Vec<(String, String, bool)> {
        let mut published = Vec::new();
        while let Ok(p) = self.published.try_recv() {
            published.push((p.topic, p.payload, p.retain));
        }
        published
    }

    async fn log(&self) -> Value {
        self.ask(get("/api/v1/writes")).await.1["writes"].clone()
    }
}

/// Answers each write on a set topic as EVCC does, and passes it on.
async fn answer(
    broker: Arc<Fake>,
    mut requests: mpsc::UnboundedReceiver<Published>,
    relay: mpsc::UnboundedSender<Published>,
    evcc: Evcc,
) {
    let mut mode = String::new();
    while let Some(request) = requests.recv().await {
        let state = request.topic.strip_suffix("/set").unwrap_or_default();
        let applies = match state {
            MODE => {
                mode.clone_from(&request.payload);
                broker.retain(BOOST, "false");
                true
            }
            LIMIT => matches!(evcc, Evcc::Applies),
            BOOST => ["pv", "minpv"].contains(&mode.as_str()),
            _ => false,
        };
        if applies {
            broker.retain(state, &request.payload);
        }
        relay.send(request).ok();
    }
}

fn published(topic: &str, payload: &str) -> (String, String, bool) {
    (format!("{topic}/set"), payload.to_owned(), false)
}

fn attempt(entry: &Value) -> (&Value, &Value, &Value, &Value, &Value, &Value) {
    (
        &entry["setting"],
        &entry["before"],
        &entry["requested"],
        &entry["after"],
        &entry["outcome"],
        &entry["actor"],
    )
}

#[tokio::test]
async fn mode_limit_and_boost_publish_to_their_set_topics_and_verify_the_republished_state() {
    let mut loadpoint = Loadpoint::new("now", Evcc::Applies).await;

    let mode = loadpoint.write("mode", 3.0).await;
    let limit = loadpoint.write("limitSoc", 90.0).await;
    let boost = loadpoint.write("batteryBoost", 1.0).await;

    for (status, entry) in [&mode, &limit, &boost] {
        assert_eq!(*status, StatusCode::OK, "{entry}");
        assert_eq!(entry["outcome"], "verified", "{entry}");
    }
    assert_eq!(
        loadpoint.published(),
        [
            published(MODE, "pv"),
            published(LIMIT, "90"),
            published(BOOST, "true"),
        ]
    );
    let log = loadpoint.log().await;
    let attempts: Vec<_> = log.as_array().unwrap().iter().map(attempt).collect();
    assert_eq!(
        attempts,
        [
            (
                &json!("mode"),
                &json!(1.0),
                &json!(3.0),
                &json!(3.0),
                &json!("verified"),
                &json!("admin")
            ),
            (
                &json!("limitSoc"),
                &json!(80.0),
                &json!(90.0),
                &json!(90.0),
                &json!("verified"),
                &json!("admin")
            ),
            (
                &json!("batteryBoost"),
                &json!(0.0),
                &json!(1.0),
                &json!(1.0),
                &json!("verified"),
                &json!("admin")
            ),
        ]
    );
}

#[tokio::test]
async fn boost_is_refused_unless_the_mode_is_pv_or_minpv_and_nothing_is_published() {
    let mut loadpoint = Loadpoint::new("now", Evcc::Applies).await;

    let (status, body) = loadpoint.write("batteryBoost", 1.0).await;

    assert_eq!(
        (status, &body["code"]),
        (StatusCode::CONFLICT, &json!("setting.precondition"))
    );
    assert_eq!(loadpoint.published(), []);
    assert_eq!(loadpoint.log().await, json!([]));
}

#[tokio::test]
async fn a_value_evcc_already_holds_is_unchanged_and_publishes_nothing() {
    let mut loadpoint = Loadpoint::new("pv", Evcc::Applies).await;

    let (status, entry) = loadpoint.write("mode", 3.0).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(entry["outcome"], "unchanged");
    assert_eq!(loadpoint.published(), []);
}

#[tokio::test]
async fn a_write_evcc_does_not_republish_is_a_mismatch() {
    let mut loadpoint = Loadpoint::new("pv", Evcc::IgnoresLimit).await;

    let (status, entry) = loadpoint.write("limitSoc", 90.0).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        (&entry["outcome"], &entry["before"], &entry["after"]),
        (&json!("mismatch"), &json!(80.0), &json!(80.0))
    );
    assert_eq!(loadpoint.published(), [published(LIMIT, "90")]);
}
