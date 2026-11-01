//! Modbus TCP framing and decode against the recorded wire exchanges of the oracle corpus: the client
//! must send exactly the recorded request bytes and decode the recorded reply to the recorded values.

#![allow(clippy::expect_used, reason = "helpers outside #[test] fns may panic like the tests")]

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::{Value, json};
use sunreye::modbus::{Client, Error, Transport};
use sunreye::poll::DevicePoller;
use sunreye::profile::Profile;
use sunreye_sim::{Exchange, TransportCase, replay, rtu_cases, transport_cases};

fn oracle() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/oracle")
}

/// The recorded case `name`; an `rtu-over-tcp` case is the recording re-framed as RTU.
fn case(name: &str) -> TransportCase {
    let cases = if name.starts_with("rtu-over-tcp/") {
        rtu_cases(&oracle())
    } else {
        transport_cases(&oracle(), "tcp")
    };
    cases.expect("corpus").into_iter().find(|c| c.name == name).expect("case")
}

fn transport_of(name: &str) -> Transport {
    if name.starts_with("rtu-over-tcp/") { Transport::RtuOverTcp } else { Transport::Tcp }
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
    play_exchanges(name, case(name).exchanges).await
}

async fn play_exchanges(
    name: &str,
    exchanges: Vec<Exchange>,
) -> (Result<Vec<(String, f64)>, Error>, Vec<(u16, u16)>, Result<(), String>) {
    let case = case(name);
    let profile = profile_of(&case);
    let wire = replay(exchanges).await.expect("replay");
    let timeout = Duration::from_millis(500);
    let mut client =
        Client::connect(transport_of(name), "127.0.0.1", wire.addr.port(), timeout).await.expect("connect");
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

#[tokio::test]
async fn an_rtu_read_of_unit_1_sends_the_recorded_pdu_framed_as_rtu_and_decodes_the_reply() {
    let (result, _, wire) = play("rtu-over-tcp/read-unit-1").await;
    assert_eq!(wire, Ok(()));
    assert_values(&result.expect("poll"), &expected_values("rtu-over-tcp/read-unit-1"));
}

#[tokio::test]
async fn an_rtu_read_of_unit_0_is_addressed_as_unit_0() {
    let (result, _, wire) = play("rtu-over-tcp/read-unit-0").await;
    assert_eq!(wire, Ok(()));
    assert_values(&result.expect("poll"), &expected_values("rtu-over-tcp/read-unit-0"));
}

#[tokio::test]
async fn an_rtu_reply_split_inside_its_data_is_reassembled() {
    let (result, _, wire) = play("rtu-over-tcp/fragmented-reply").await;
    assert_eq!(wire, Ok(()));
    assert_values(&result.expect("poll"), &expected_values("rtu-over-tcp/fragmented-reply"));
}

#[tokio::test]
async fn an_rtu_refused_atomic_group_is_read_split_and_stays_split() {
    let (result, plan, wire) = play("rtu-over-tcp/exception-2-split").await;
    assert_eq!(wire, Ok(()), "one spanning read, then the two plain reads");
    assert_values(&result.expect("poll"), &expected_values("rtu-over-tcp/exception-2-split"));
    assert_eq!(plan, [(500, 5), (520, 1)]);
}

/// The recorded reply of `rtu-over-tcp/read-unit-1`, changed by `damage`.
async fn damaged_reply(damage: impl FnOnce(Vec<u8>) -> Vec<u8>) -> Result<Vec<(String, f64)>, Error> {
    let name = "rtu-over-tcp/read-unit-1";
    let recorded = case(name).exchanges;
    let (request, reply) = match recorded.as_slice() {
        [request, Exchange::Send(chunks)] => (request.clone(), damage(chunks.concat())),
        other => return Err(Error::Io(format!("expected one request and one reply, got {other:?}"))),
    };
    let (result, _, _) = play_exchanges(name, vec![request, Exchange::Send(vec![reply])]).await;
    result
}

#[tokio::test]
async fn an_rtu_reply_with_a_bad_crc_is_refused_not_decoded() {
    for byte in [14, 13] {
        let result = damaged_reply(|mut reply| {
            reply[byte] ^= 0x01;
            reply
        })
        .await;
        assert_eq!(result, Err(Error::Protocol("crc mismatch")), "CRC byte {byte}");
    }
    let flipped = damaged_reply(|mut reply| {
        reply[5] ^= 0x80;
        reply
    })
    .await;
    assert_eq!(flipped, Err(Error::Protocol("crc mismatch")), "a flipped data bit");
}

#[tokio::test]
async fn an_rtu_reply_cut_short_ends_the_poll_at_every_cut_point() {
    damaged_reply(|reply| reply).await.expect("the undamaged reply decodes");
    for kept in [1, 2, 3, 8, 12, 14] {
        let result = damaged_reply(|reply| reply[..kept].to_vec()).await;
        assert!(matches!(result, Err(Error::Io(_))), "{kept} bytes kept: {result:?}");
    }
}

#[tokio::test]
async fn bytes_before_an_rtu_reply_are_a_protocol_error_not_a_misread() {
    let result = damaged_reply(|reply| [&[0xde, 0xad, 0xbe], reply.as_slice()].concat()).await;
    assert!(matches!(result, Err(Error::Protocol(_))), "{result:?}");
}
