//! Secrets (ADR 7): a recipe unlocks with a secret its connection names; the value reaches the
//! device and nothing else: no response, no change log, no write log, no log line.

use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, UNIX_EPOCH};

use axum::http::StatusCode;
use serde_json::{Value, json};
use tracing_subscriber::util::SubscriberInitExt as _;

use super::devices::send;
use super::{Core, get};
use crate::profiles::fake::{Signer, entry};
use crate::transport::fake::{self, Fake, Write, Writes};

const INDEX: &str = "https://example.org/index.json";
/// The unlock code: distinctive, so a search for it finds only a leak.
const CODE: &str = "52817";

/// An official profile whose one setting unlocks with the secret `unlock` at register 200 and
/// relocks by writing 0 there.
fn locked() -> Vec<u8> {
    json!({
        "schema": 1, "id": "locked", "name": "locked", "manufacturer": "test",
        "version": "1.0.0", "requires": ["modbus", "u16", "write", "unlock"], "quantities": [],
        "settings": [{
            "key": "current", "type": "u16", "range": { "min": 0, "max": 350 },
            "minInterval": 60, "readBack": { "register": 108 }, "verified": true,
            "recipe": [
                { "unlock": { "register": 200, "type": "u16", "secret": "unlock",
                    "finally": [{ "register": 200, "words": [0] }] } },
                { "write": { "register": 108 } },
            ],
        }],
    })
    .to_string()
    .into_bytes()
}

/// Every response body the test saw.
struct Plant {
    core: Core,
    set_cookie: String,
    device: Fake,
    id: Value,
    connection: Value,
    bodies: Vec<Value>,
    _dir: tempfile::TempDir,
}

impl Plant {
    /// The locked device behind a connection holding `secrets`, its writes on.
    async fn new(writes: Writes, secrets: &Value) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let signer = Signer::default();
        let core = Core::trusting(&dir.path().join("core.sqlite"), None, Some(signer.keys())).await;
        let setup = core
            .send(super::post("/api/v1/setup", "correct horse"))
            .await;
        assert_eq!(setup.status(), StatusCode::NO_CONTENT);
        let set_cookie = core
            .sign_in(super::post("/api/v1/login", "correct horse"))
            .await;
        core.set_clock(UNIX_EPOCH + Duration::from_hours(498_384));
        let profile = locked();
        core.host
            .serve("https://example.org/locked.json", profile.clone());
        let index = json!({ "profiles": [entry(&profile, "locked.json", Some(&signer.active))] });
        core.host.serve(INDEX, index.to_string());
        let mut plant = Self {
            core,
            set_cookie,
            device: fake::serve_with(writes).await,
            id: Value::Null,
            connection: Value::Null,
            bodies: Vec::new(),
            _dir: dir,
        };
        plant
            .ask("POST", "/api/v1/profile-indexes", &json!({ "url": INDEX }))
            .await;
        let gateway = json!({ "name": "gateway", "transport": "modbus-tcp", "host": "127.0.0.1",
            "port": plant.device.address.port(), "secrets": secrets });
        let (status, body) = plant.ask("POST", "/api/v1/connections", &gateway).await;
        assert_eq!(status, StatusCode::CREATED, "{body}");
        plant.connection = body["id"].clone();
        let device = json!({ "name": "locked", "connection": plant.connection,
            "profile": "locked", "unit": 1, "writes": true });
        let (status, body) = plant.ask("POST", "/api/v1/devices", &device).await;
        assert_eq!(status, StatusCode::CREATED, "{body}");
        plant.id = body["id"].clone();
        plant
    }

    async fn ask(&mut self, method: &str, uri: &str, body: &Value) -> (StatusCode, Value) {
        let request = if method == "GET" {
            get(uri)
        } else {
            send(method, uri, body)
        };
        let (status, body) = self.core.ask(&self.set_cookie, request).await;
        self.bodies.push(body.clone());
        (status, body)
    }

    async fn write(&mut self, value: u16) -> (StatusCode, Value) {
        let uri = format!("/api/v1/devices/{}/settings/current", self.id);
        self.ask("PUT", &uri, &json!({ "value": value })).await
    }

    fn received(&mut self) -> Vec<Write> {
        let mut received = Vec::new();
        while let Ok(write) = self.device.writes.try_recv() {
            received.push(write);
        }
        received
    }
}

fn write(start: u16, word: u16) -> Write {
    Write {
        unit: 1,
        start,
        words: vec![word],
    }
}

/// Every log line, at every level, written while it lives.
#[derive(Clone, Default)]
pub(super) struct Lines(pub(super) Arc<Mutex<Vec<u8>>>);

impl std::io::Write for Lines {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .extend_from_slice(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

#[tokio::test]
async fn a_secret_reaches_the_device_and_never_a_response_the_logs_or_a_log_line() {
    let lines = Lines::default();
    let writer = lines.clone();
    let subscriber = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::TRACE)
        .with_writer(move || writer.clone())
        .finish();
    let _logging = subscriber.set_default();
    tracing::trace!("capturing");
    let mut plant = Plant::new(Writes::Store, &json!({ "unlock": CODE })).await;

    let (status, written) = plant.write(50).await;

    assert_eq!(
        (status, &written["outcome"]),
        (StatusCode::OK, &json!("verified"))
    );
    let code = CODE.parse().unwrap();
    assert_eq!(
        plant.received(),
        [write(200, code), write(108, 50), write(200, 0)]
    );
    let uri = format!("/api/v1/connections/{}", plant.connection);
    let change = json!({ "name": "gateway", "transport": "modbus-tcp", "host": "127.0.0.1",
        "port": plant.device.address.port() });
    plant.ask("PUT", &uri, &change).await;
    for uri in [
        "/api/v1/connections",
        "/api/v1/devices",
        "/api/v1/writes",
        "/api/v1/changes",
        "/api/v1/capabilities",
    ] {
        plant.ask("GET", uri, &Value::Null).await;
    }
    // The API reports only that the secret is set.
    let connections = &plant.bodies[plant.bodies.len() - 5];
    assert_eq!(connections["connections"][0]["secrets"], json!(["unlock"]));
    let bodies = serde_json::to_string(&plant.bodies).unwrap();
    assert!(!bodies.contains(CODE), "{bodies}");
    let logged = String::from_utf8(lines.0.lock().unwrap().clone()).unwrap();
    assert!(logged.contains("capturing"), "the capture is live");
    assert!(!logged.contains(CODE), "{logged}");
}

#[tokio::test]
async fn a_write_whose_secret_is_not_set_is_refused_before_the_device() {
    let mut plant = Plant::new(Writes::Store, &json!({})).await;

    let refused = plant.write(50).await;

    assert_eq!(
        refused,
        (
            StatusCode::CONFLICT,
            json!({ "status": 409, "code": "secret.missing" })
        )
    );
    assert_eq!(plant.received(), []);
    let (_, log) = plant.ask("GET", "/api/v1/writes", &Value::Null).await;
    assert_eq!(log["writes"][0]["refusal"], "secret.missing");
}

#[tokio::test]
async fn a_secret_that_is_no_code_of_its_type_is_refused_before_the_device() {
    for secret in ["hunter2", "65536"] {
        let mut plant = Plant::new(Writes::Store, &json!({ "unlock": secret })).await;

        let refused = plant.write(50).await;

        assert_eq!(
            refused,
            (
                StatusCode::UNPROCESSABLE_ENTITY,
                json!({ "status": 422, "code": "secret.value" })
            ),
            "{secret}"
        );
        assert_eq!(plant.received(), []);
    }
}

#[tokio::test]
async fn an_unlock_that_times_out_is_never_retried_and_still_relocks() {
    let mut plant = Plant::new(Writes::Silent, &json!({ "unlock": CODE })).await;

    let (_, written) = plant.write(50).await;

    assert_eq!(
        (&written["outcome"], &written["failedStep"]),
        (&json!("unknown"), &json!(1))
    );
    let code = CODE.parse().unwrap();
    assert_eq!(plant.received(), [write(200, code), write(200, 0)]);
}

#[test]
fn a_connection_as_entered_never_shows_its_secrets() {
    let draft: crate::devices::ConnectionDraft = serde_json::from_value(json!({
        "name": "gateway", "transport": "modbus-tcp", "host": "127.0.0.1", "port": 502,
        "secrets": { "unlock": CODE },
    }))
    .unwrap();

    let shown = format!("{draft:?}");

    assert!(shown.contains("unlock"), "{shown}");
    assert!(!shown.contains(CODE), "{shown}");
}
