//! The setup scan (ADR 6): it finds Modbus and Solarman endpoints on a private subnet and proposes
//! a profile and unit id for each device that answers its identify probe. Devices are fakes on
//! 127.0.0.x, scanned on the ports the fakes took.

use std::time::Duration;

use axum::http::StatusCode;
use serde_json::{Value, json};
use sunreye_profile::Framing;

use super::Core;
use super::devices::send;
use crate::scan::{Limits, Scanner};
use crate::transport::fake;

pub(super) const LIMITS: Limits = Limits {
    connect: Duration::from_millis(200),
    probe: Duration::from_millis(200),
    connects: 32,
    identifies: 8,
};

async fn scan(core: &Core, set_cookie: &str, body: &Value) -> (StatusCode, Value) {
    core.ask(set_cookie, send("POST", "/api/v1/scan", body))
        .await
}

fn deye(unit: u8) -> Value {
    json!([{ "profile": "deye-sg05lp3", "unit": unit }])
}

/// The owner's plant: the gateway answers unit 0, the Solarman stick unit 1, the same inverter.
#[tokio::test]
async fn a_scan_proposes_the_deye_at_the_unit_each_endpoint_answers() {
    let gateway = fake::serve_unit("127.0.0.2", Framing::Tcp, 0).await;
    let stick = fake::serve_unit("127.0.0.3", Framing::SolarmanV5, 1).await;
    let (gateway_port, stick_port) = (gateway.address.port(), stick.address.port());
    let ports = vec![
        (gateway_port, Framing::Tcp),
        (stick_port, Framing::SolarmanV5),
    ];
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::scanning(
        &dir.path().join("core.sqlite"),
        Scanner::new(ports, LIMITS, || None),
    )
    .await;

    let (status, body) = scan(&core, &set_cookie, &json!({ "subnet": "127.0.0.0/29" })).await;

    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        body,
        json!({
            "subnet": "127.0.0.0/29",
            "endpoints": [
                { "transport": "modbus-tcp", "host": "127.0.0.2", "port": gateway_port, "devices": deye(0) },
                { "transport": "solarman-v5", "host": "127.0.0.3", "port": stick_port, "devices": deye(1) },
            ],
        })
    );
}

async fn scanning(
    ports: Vec<(u16, Framing)>,
    home: fn() -> Option<std::net::Ipv4Addr>,
) -> (Core, String, tempfile::TempDir) {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::scanning(
        &dir.path().join("core.sqlite"),
        Scanner::new(ports, LIMITS, home),
    )
    .await;
    (core, set_cookie, dir)
}

/// Manual entry is the fallback: an endpoint whose device answers no probe is listed bare. Every
/// request the scan sent was a read of holding registers.
#[tokio::test]
async fn an_endpoint_that_answers_no_probe_is_listed_without_devices_and_only_read() {
    let mut silent = fake::serve_unit("127.0.0.4", Framing::Tcp, 9).await;
    let port = silent.address.port();
    let (core, set_cookie, _dir) = scanning(vec![(port, Framing::Tcp)], || None).await;

    let (status, body) = scan(&core, &set_cookie, &json!({ "subnet": "127.0.0.4/32" })).await;

    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        body["endpoints"],
        json!([{ "transport": "modbus-tcp", "host": "127.0.0.4", "port": port, "devices": [] }])
    );
    let mut probed = Vec::new();
    while let Ok(read) = silent.reads.try_recv() {
        assert_eq!(read.function, 3);
        probed.push(read.unit);
    }
    assert_eq!(probed, [1, 0, 2, 3, 4, 5]);
    assert!(silent.writes.try_recv().is_err(), "the scan wrote");
}

/// The scan stays on a private network of at most 256 addresses.
#[tokio::test]
async fn a_subnet_wider_than_a_24_public_or_malformed_is_refused() {
    let (core, set_cookie, _dir) = scanning(Vec::new(), || None).await;
    for subnet in [
        "10.20.0.0/23",
        "8.8.8.0/24",
        "10.20.0.0",
        "10.20.0.0/33",
        "host/24",
    ] {
        let (status, body) = scan(&core, &set_cookie, &json!({ "subnet": subnet })).await;
        assert_eq!(
            (status, body["code"].as_str()),
            (StatusCode::UNPROCESSABLE_ENTITY, Some("scan.subnet")),
            "{subnet}"
        );
    }
}

#[tokio::test]
async fn a_scan_without_a_subnet_covers_the_24_of_the_cores_address() {
    let gateway = fake::serve_unit("127.0.0.5", Framing::Tcp, 1).await;
    let port = gateway.address.port();
    let (core, set_cookie, _dir) =
        scanning(vec![(port, Framing::Tcp)], || Some([127, 0, 0, 9].into())).await;

    let (status, body) = scan(&core, &set_cookie, &json!({})).await;

    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["subnet"], "127.0.0.0/24");
    assert_eq!(body["endpoints"][0]["host"], "127.0.0.5");
    assert_eq!(body["endpoints"][0]["devices"], deye(1));
}

#[tokio::test]
async fn without_a_subnet_or_an_address_of_its_own_the_core_refuses_to_guess() {
    let (core, set_cookie, _dir) = scanning(Vec::new(), || None).await;

    let (status, body) = scan(&core, &set_cookie, &json!({})).await;

    assert_eq!(
        (status, body["code"].as_str()),
        (StatusCode::UNPROCESSABLE_ENTITY, Some("scan.subnet"))
    );
}

/// A configured endpoint belongs to its task (ADR 6): the scan does not touch it.
#[tokio::test]
async fn an_endpoint_already_configured_is_not_touched() {
    let mut gateway = fake::serve_unit("127.0.0.6", Framing::Tcp, 1).await;
    let port = gateway.address.port();
    let (core, set_cookie, _dir) = scanning(vec![(port, Framing::Tcp)], || None).await;
    let connection = json!({
        "name": "gateway", "transport": "modbus-tcp", "host": "127.0.0.6", "port": port,
    });
    core.connection(&set_cookie, &connection).await;

    let (status, body) = scan(&core, &set_cookie, &json!({ "subnet": "127.0.0.6/32" })).await;

    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["endpoints"], json!([]));
    assert!(gateway.reads.try_recv().is_err(), "the scan probed it");
}

#[tokio::test]
async fn one_scan_runs_at_a_time() {
    let silent = fake::serve_unit("127.0.0.7", Framing::Tcp, 9).await;
    let (core, set_cookie, _dir) =
        scanning(vec![(silent.address.port(), Framing::Tcp)], || None).await;
    let body = json!({ "subnet": "127.0.0.7/32" });

    let (first, second) = tokio::join!(
        scan(&core, &set_cookie, &body),
        scan(&core, &set_cookie, &body)
    );

    let mut statuses = [first.0, second.0];
    statuses.sort();
    assert_eq!(statuses, [StatusCode::OK, StatusCode::CONFLICT]);
}
