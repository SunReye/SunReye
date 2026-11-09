//! A broker connection (ADR 10): one client per connection, its status in the connection list,
//! its credentials secrets that reach the broker and nothing else.

use std::time::Duration;

use axum::http::StatusCode;
use serde_json::{Value, json};
use tracing_subscriber::util::SubscriberInitExt as _;

use super::devices::{delete, gateway, send};
use super::secrets::Lines;
use super::{Core, get};
use crate::mqtt::fake::{self, Fake};

/// Distinctive, so a search for it finds only a leak.
const PASSWORD: &str = "Tr0ub4dor&3";

fn broker(fake: &Fake) -> Value {
    json!({ "name": "broker", "transport": "mqtt", "host": "127.0.0.1",
        "port": fake.address.port(), "topicRoot": "evcc",
        "secrets": { "username": "sunreye", "password": PASSWORD } })
}

impl Core {
    /// The listed connections once `holds` holds for the first, within a second.
    async fn until(&self, set_cookie: &str, holds: impl Fn(&Value) -> bool) -> Value {
        for _ in 0..100 {
            let (_, listed) = self.ask(set_cookie, get("/api/v1/connections")).await;
            if holds(&listed["connections"][0]) {
                return listed;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("never held");
    }
}

#[tokio::test]
async fn a_broker_connection_connects_with_its_credentials_and_reports_its_status() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let mut fake = fake::serve(0).await;
    let id = core.connection(&set_cookie, &broker(&fake)).await;

    let listed = core
        .until(&set_cookie, |c| c["status"]["connected"] == json!(true))
        .await;

    let connection = &listed["connections"][0];
    assert_eq!(connection["id"], id);
    assert_eq!(connection["transport"], "mqtt");
    assert_eq!(connection["topicRoot"], "evcc");
    assert_eq!(connection["secrets"], json!(["password", "username"]));
    assert_eq!(connection["status"]["lastError"], Value::Null);
    let at: jiff::Timestamp = connection["status"]["lastConnectedAt"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    assert!(at.as_second() > 0);
    let connect = fake.connects.recv().await.unwrap();
    assert_eq!(connect.username.as_deref(), Some("sunreye"));
    assert_eq!(connect.password.as_deref(), Some(PASSWORD));
}

#[tokio::test]
async fn a_refused_broker_reports_its_error_and_never_a_response_or_log_line_its_password() {
    let lines = Lines::default();
    let writer = lines.clone();
    let subscriber = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::TRACE)
        .with_writer(move || writer.clone())
        .finish();
    let _logging = subscriber.set_default();
    tracing::trace!("capturing");
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let fake = fake::serve(5).await;
    core.connection(&set_cookie, &broker(&fake)).await;

    let listed = core
        .until(&set_cookie, |c| c["status"]["lastError"].is_string())
        .await;

    let status = &listed["connections"][0]["status"];
    assert_eq!(status["connected"], json!(false));
    assert_eq!(status["lastConnectedAt"], Value::Null);
    assert!(
        status["lastError"]
            .as_str()
            .unwrap()
            .contains("NotAuthorized")
    );
    let (_, changes) = core.ask(&set_cookie, get("/api/v1/changes")).await;
    for body in [listed.to_string(), changes.to_string()] {
        assert!(!body.contains(PASSWORD), "{body}");
    }
    let logged = String::from_utf8(lines.0.lock().unwrap().clone()).unwrap();
    assert!(logged.contains("capturing"), "the capture is live");
    assert!(!logged.contains(PASSWORD), "{logged}");
}

#[tokio::test]
async fn a_changed_broker_connection_reconnects_at_once_and_a_removed_one_disconnects() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let mut first = fake::serve(0).await;
    let mut second = fake::serve(0).await;
    let id = core.connection(&set_cookie, &broker(&first)).await;
    first.connects.recv().await.unwrap();

    let uri = format!("/api/v1/connections/{id}");
    let (status, _) = core
        .ask(&set_cookie, send("PUT", &uri, &broker(&second)))
        .await;
    assert_eq!(status, StatusCode::OK);
    first.hung_up.recv().await.unwrap();
    second.connects.recv().await.unwrap();
    let (status, _) = core.ask(&set_cookie, delete(&uri)).await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    second.hung_up.recv().await.unwrap();
}

#[tokio::test]
async fn a_device_is_not_read_through_a_broker_connection() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let fake = fake::serve(0).await;
    let connection = core.connection(&set_cookie, &broker(&fake)).await;
    let device = json!({ "name": "Deye", "connection": connection,
        "profile": "deye-sg05lp3", "unit": 1 });

    let (status, body) = core
        .ask(&set_cookie, send("POST", "/api/v1/devices", &device))
        .await;

    assert_eq!(
        (status, &body["code"]),
        (StatusCode::UNPROCESSABLE_ENTITY, &json!("device.transport"))
    );
}

#[tokio::test]
async fn a_connection_with_devices_does_not_become_a_broker() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let connection = core.connection(&set_cookie, &gateway()).await;
    core.deye(&set_cookie, &connection, 1).await;
    let fake = fake::serve(0).await;

    let uri = format!("/api/v1/connections/{connection}");
    let (status, body) = core
        .ask(&set_cookie, send("PUT", &uri, &broker(&fake)))
        .await;

    assert_eq!(
        (status, &body["code"]),
        (StatusCode::UNPROCESSABLE_ENTITY, &json!("device.transport"))
    );
}

#[tokio::test]
async fn a_broker_needs_a_topic_root_without_wildcards_and_a_modbus_connection_takes_none() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let fake = fake::serve(0).await;
    let mut drafts = Vec::new();
    for root in [
        Value::Null,
        json!(""),
        json!("evcc/#"),
        json!("a/+/b"),
        json!("/evcc"),
        json!("evcc/"),
    ] {
        let mut draft = broker(&fake);
        draft["topicRoot"] = root;
        drafts.push(draft);
    }
    let mut modbus = gateway();
    modbus["topicRoot"] = json!("evcc");
    drafts.push(modbus);

    for draft in drafts {
        let (status, body) = core
            .ask(&set_cookie, send("POST", "/api/v1/connections", &draft))
            .await;
        assert_eq!(
            (status, &body["code"]),
            (StatusCode::UNPROCESSABLE_ENTITY, &json!("connection.value")),
            "{draft}"
        );
    }
}
