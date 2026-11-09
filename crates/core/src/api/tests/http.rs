//! An HTTP host connection (ADR 6, 10): its devices read through the `http` binding, and its
//! `username` and `password` secrets answer the host's Digest challenge.
//!
//! The host serves the Shelly Pro 3EM's documented `EM.GetStatus` answer,
//! <https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/EM>.

use axum::http::StatusCode;
use serde_json::{Value, json};

use super::Core;
use super::devices::{gateway, send};
use crate::http::fake::{self, Answers, Fake};

const STATUS: &str = include_str!("../../../../profile/src/tests/shelly-pro-3em-status.json");
/// Distinctive, so a search for it finds only a leak.
const PASSWORD: &str = "Tr0ub4dor&3";

async fn shelly_host() -> Fake {
    fake::serve(Answers {
        bodies: vec![("/rpc/EM.GetStatus?id=0".to_owned(), STATUS.to_owned())],
        password: Some(PASSWORD.to_owned()),
        together: 1,
    })
    .await
}

fn host(fake: &Fake) -> Value {
    json!({ "name": "meter", "transport": "http", "host": "127.0.0.1",
        "port": fake.address.port(),
        "secrets": { "username": "admin", "password": PASSWORD } })
}

fn meter(connection: &Value) -> Value {
    json!({ "name": "Meter", "connection": connection, "profile": "shelly-pro-3em", "unit": 0 })
}

#[tokio::test]
async fn a_shelly_behind_an_http_host_reads_grid_power_with_its_password() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let fake = shelly_host().await;
    let connection = core.connection(&set_cookie, &host(&fake)).await;
    let (status, device) = core
        .ask(
            &set_cookie,
            send("POST", "/api/v1/devices", &meter(&connection)),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{device}");
    let id = &device["id"];

    let power = core
        .read_role(
            &set_cookie,
            &format!("/api/v1/roles/grid.power?device={id}"),
        )
        .await;

    assert_eq!(power, json!(2484.782));
}

#[tokio::test]
async fn an_http_host_reads_only_a_profile_with_an_http_binding() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let fake = shelly_host().await;
    let http = core.connection(&set_cookie, &host(&fake)).await;
    let modbus = core.connection(&set_cookie, &gateway()).await;
    let deye = json!({ "name": "Deye", "connection": http, "profile": "deye-sg05lp3", "unit": 1 });

    for device in [deye, meter(&modbus)] {
        let (status, body) = core
            .ask(&set_cookie, send("POST", "/api/v1/devices", &device))
            .await;
        assert_eq!(
            (status, &body["code"]),
            (StatusCode::UNPROCESSABLE_ENTITY, &json!("device.transport")),
            "{device}"
        );
    }
}

#[tokio::test]
async fn an_http_host_with_devices_does_not_become_a_modbus_connection() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let fake = shelly_host().await;
    let connection = core.connection(&set_cookie, &host(&fake)).await;
    let (status, _) = core
        .ask(
            &set_cookie,
            send("POST", "/api/v1/devices", &meter(&connection)),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED);

    let uri = format!("/api/v1/connections/{connection}");
    let (status, body) = core.ask(&set_cookie, send("PUT", &uri, &gateway())).await;

    assert_eq!(
        (status, &body["code"]),
        (StatusCode::UNPROCESSABLE_ENTITY, &json!("device.transport"))
    );
}

#[tokio::test]
async fn an_http_host_takes_no_topic_root_or_publisher() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let fake = shelly_host().await;
    let mut rooted = host(&fake);
    rooted["topicRoot"] = json!("shelly");
    let mut publishing = host(&fake);
    publishing["publish"] = json!({ "discovery": false });

    for draft in [rooted, publishing] {
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
