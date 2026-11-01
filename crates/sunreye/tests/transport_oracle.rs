//! Modbus TCP framing and decode against the recorded wire exchanges of the oracle corpus: the client
//! must send exactly the recorded request bytes and decode the recorded reply to the recorded values.

#![allow(clippy::expect_used, reason = "helpers outside #[test] fns may panic like the tests")]

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::{Value, json};
use sunreye::modbus::{Client, Error};
use sunreye::poll::DevicePoller;
use sunreye::profile::Profile;
use sunreye_sim::{TransportCase, replay, transport_cases};

fn oracle() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/oracle")
}

fn case(name: &str) -> TransportCase {
    transport_cases(&oracle(), "tcp").expect("corpus").into_iter().find(|c| c.name == name).expect("case")
}

fn profile_of(case: &TransportCase) -> Profile {
    let metrics: Vec<Value> = case
        .metrics
        .iter()
        .map(|m| match &m.compute_sum {
            Some(keys) => json!({"key": m.key, "scale": m.scale, "binding": {"via": "compute", "expr": {"sum": keys}}}),
            None => json!({"key": m.key, "scale": m.scale, "binding": {"via": "modbus", "addr": m.addr, "type": m.kind}}),
        })
        .collect();
    serde_json::from_value(
        json!({"id": "x", "name": "x", "manufacturer": "x", "version": "0", "metrics": metrics}),
    )
    .expect("profile")
}

/// Plays `name` against the client; returns the poll result, the plan afterwards, and whether the client
/// sent every recorded request byte for byte.
async fn play(name: &str) -> (Result<Vec<(String, f64)>, Error>, Vec<(u16, u16)>, Result<(), String>) {
    let case = case(name);
    let profile = profile_of(&case);
    let wire = replay(case.exchanges.clone()).await.expect("replay");
    let mut client =
        Client::connect("127.0.0.1", wire.addr.port(), Duration::from_millis(500)).await.expect("connect");
    let mut poller = DevicePoller::new(profile.into(), case.unit_id);
    let result = poller.poll(&mut client).await;
    let plan = poller.plan().iter().map(|b| (b.start, b.count)).collect();
    (result, plan, wire.finish().await)
}

fn expected_values(name: &str) -> Vec<(String, f64)> {
    case(name).result["values"]
        .as_object()
        .expect("values")
        .iter()
        .map(|(k, v)| (k.clone(), v.as_f64().expect("number")))
        .collect()
}

fn assert_values(got: &[(String, f64)], want: &[(String, f64)]) {
    for (key, value) in want {
        let found = got.iter().find(|(k, _)| k == key).map(|(_, v)| *v);
        assert_eq!(found, Some(*value), "{key}");
    }
}

#[tokio::test]
async fn a_read_of_unit_1_sends_the_recorded_bytes_and_decodes_the_reply() {
    let (result, _, wire) = play("tcp/read-unit-1").await;
    assert_eq!(wire, Ok(()));
    assert_values(&result.expect("poll"), &expected_values("tcp/read-unit-1"));
}

#[tokio::test]
async fn unit_0_is_addressed_as_unit_0() {
    let (result, _, wire) = play("tcp/read-unit-0").await;
    assert_eq!(wire, Ok(()));
    assert_values(&result.expect("poll"), &expected_values("tcp/read-unit-0"));
}

#[tokio::test]
async fn a_reply_split_inside_its_header_is_reassembled() {
    let (result, _, wire) = play("tcp/fragmented-reply").await;
    assert_eq!(wire, Ok(()));
    assert_values(&result.expect("poll"), &expected_values("tcp/fragmented-reply"));
}

#[tokio::test]
async fn bytes_before_a_reply_are_a_protocol_error_not_a_misread() {
    let (result, _, wire) = play("tcp/leading-junk").await;
    assert_eq!(wire, Ok(()));
    assert!(matches!(result, Err(Error::Protocol(_))), "{result:?}");
    assert_eq!(
        case("tcp/leading-junk").result["error"]["name"],
        "TransactionTimedOutError",
        "2.x failed the read too"
    );
}

#[tokio::test]
async fn a_refused_atomic_group_is_read_split_and_stays_split() {
    let (result, plan, wire) = play("tcp/exception-2-split").await;
    assert_eq!(wire, Ok(()), "one spanning read, then the two plain reads");
    assert_values(&result.expect("poll"), &expected_values("tcp/exception-2-split"));
    assert_eq!(plan, [(500, 5), (520, 1)]);
    assert_eq!(case("tcp/exception-2-split").result["degraded"], true);
}
