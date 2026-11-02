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
    } else if name.starts_with("solarman-v5/") {
        transport_cases(&oracle(), "solarman-v5")
    } else {
        transport_cases(&oracle(), "tcp")
    };
    cases.expect("corpus").into_iter().find(|c| c.name == name).expect("case")
}

fn transport_of(name: &str) -> Transport {
    match name.split_once('/') {
        Some(("rtu-over-tcp", _)) => Transport::RtuOverTcp,
        Some(("solarman-v5", _)) => Transport::SolarmanV5,
        _ => Transport::Tcp,
    }
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
        Client::connect(transport_of(name), "127.0.0.1", wire.addr.port(), case.configured_serial, timeout)
            .await
            .expect("connect");
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

/// The first exchange of the recorded `exception-2-split` case, its reply rewritten by `rewrite`.
async fn refused_with(
    name: &str,
    rewrite: impl FnOnce(Vec<u8>) -> Vec<u8>,
) -> (Result<Vec<(String, f64)>, Error>, Vec<(u16, u16)>, Result<(), String>) {
    let (request, reply) = match case(name).exchanges.as_slice() {
        [request, Exchange::Send(chunks), ..] => (request.clone(), rewrite(chunks.concat())),
        other => {
            let missing = format!("expected a request and a reply, got {other:?}");
            return (Err(Error::Io(missing.clone())), vec![], Err(missing));
        }
    };
    play_exchanges(name, vec![request, Exchange::Send(vec![reply])]).await
}

#[tokio::test]
async fn an_exception_other_than_2_ends_a_tcp_poll_with_no_split_and_no_second_read() {
    let (result, plan, wire) = refused_with("tcp/exception-2-split", |mut reply| {
        *reply.last_mut().expect("reply") = 4;
        reply
    })
    .await;
    assert_eq!(wire, Ok(()), "the spanning read only");
    assert_eq!(result, Err(Error::Exception(4)));
    assert_eq!(plan, [(500, 21)], "not split");
}

fn crc16(bytes: &[u8]) -> u16 {
    bytes.iter().fold(0xFFFF, |crc, byte| {
        (0..8)
            .fold(crc ^ u16::from(*byte), |crc, _| if crc & 1 == 1 { (crc >> 1) ^ 0xA001 } else { crc >> 1 })
    })
}

#[tokio::test]
async fn an_exception_other_than_2_ends_an_rtu_poll_with_no_split_and_no_second_read() {
    let (result, plan, wire) = refused_with("rtu-over-tcp/exception-2-split", |mut reply| {
        reply.truncate(2);
        reply.push(10);
        reply.extend_from_slice(&crc16(&reply).to_le_bytes());
        reply
    })
    .await;
    assert_eq!(wire, Ok(()), "the spanning read only");
    assert_eq!(result, Err(Error::Exception(10)));
    assert_eq!(plan, [(500, 21)], "not split");
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
async fn bytes_before_an_rtu_reply_are_skipped_as_2x_resynchronised() {
    let (result, _, wire) = play("rtu-over-tcp/leading-junk").await;
    assert_eq!(wire, Ok(()));
    assert_values(&result.expect("poll"), &expected_values("rtu-over-tcp/leading-junk"));
}

/// One read of `500 x5` from unit 1 against the recording `name`, with whether the client sent
/// exactly the recorded bytes and nothing after them.
async fn read_once(name: &str) -> (Result<Vec<u16>, Error>, Result<(), String>) {
    let case = case(name);
    let wire = replay(case.exchanges.clone()).await.expect("replay");
    // Shorter than the replay's wait for a request past the recording, after which it hangs up: a
    // silent stick is observed as a timeout, not as a closed connection.
    let timeout = Duration::from_millis(100);
    let mut client =
        Client::connect(transport_of(name), "127.0.0.1", wire.addr.port(), case.configured_serial, timeout)
            .await
            .expect("connect");
    let result = client.read_holding(case.unit_id, 500, 5).await;
    drop(client);
    (result, wire.finish().await)
}

#[tokio::test]
async fn a_solarman_read_discovers_the_serial_sends_the_recorded_bytes_and_decodes_the_reply() {
    let (result, _, wire) = play("solarman-v5/read-unit-1").await;
    assert_eq!(wire, Ok(()), "the probe with serial 0, then the read with the stick's serial");
    assert_values(&result.expect("poll"), &expected_values("solarman-v5/read-unit-1"));
}

#[tokio::test]
async fn a_solarman_read_of_unit_0_is_addressed_as_unit_0() {
    let (result, _, wire) = play("solarman-v5/read-unit-0").await;
    assert_eq!(wire, Ok(()));
    assert_values(&result.expect("poll"), &expected_values("solarman-v5/read-unit-0"));
}

#[tokio::test]
async fn a_solarman_reply_split_inside_its_header_is_reassembled() {
    let (result, _, wire) = play("solarman-v5/fragmented-reply").await;
    assert_eq!(wire, Ok(()));
    assert_values(&result.expect("poll"), &expected_values("solarman-v5/fragmented-reply"));
}

#[tokio::test]
async fn stray_bytes_before_a_solarman_reply_drop_the_read_as_2x_did() {
    let name = "solarman-v5/leading-junk";
    let (result, wire) = read_once(name).await;
    assert_eq!(wire, Ok(()));
    assert_eq!(result, Err(Error::Timeout), "the buffer is dropped as desynchronised, there is no resync");
    assert_eq!(case(name).result["error"]["name"], "TransactionTimedOutError", "2.x failed the read too");
}

#[tokio::test]
async fn a_solarman_refused_atomic_group_is_read_split_and_stays_split() {
    let (result, plan, wire) = play("solarman-v5/exception-2-split").await;
    assert_eq!(wire, Ok(()), "one spanning read, then the two plain reads");
    assert_values(&result.expect("poll"), &expected_values("solarman-v5/exception-2-split"));
    assert_eq!(plan, [(500, 5), (520, 1)]);
}

#[tokio::test]
async fn a_wrong_configured_serial_is_replaced_by_the_one_the_sticks_reject_names() {
    let name = "solarman-v5/logger-serial-discovery";
    assert_eq!(case(name).configured_serial, Some(0x1122_3344));
    let (result, _, wire) = play(name).await;
    assert_eq!(wire, Ok(()), "the read carries the stick's serial, not the configured one");
    assert_values(&result.expect("poll"), &expected_values(name));
}

#[tokio::test]
async fn a_transient_status_05_is_asked_again_once_with_the_same_rtu_frame_and_a_fresh_sequence() {
    let name = "solarman-v5/transient-05-retried";
    let (result, wire) = read_once(name).await;
    assert_eq!(wire, Ok(()), "the retry is the recorded second request, byte for byte");
    assert_eq!(result, Ok(vec![0x0901, 0xfc18, 0x1234, 0x0001, 0x0095]));
    assert!(case(name).result.get("values").is_some(), "2.x served the data too");
}

#[tokio::test]
async fn a_status_05_twice_is_exception_2_and_there_is_no_third_request() {
    let name = "solarman-v5/persistent-05-is-exception-2";
    let (result, wire) = read_once(name).await;
    assert_eq!(wire, Ok(()), "two requests, nothing after them");
    assert_eq!(result, Err(Error::Exception(2)));
    assert_eq!(case(name).result["error"]["modbusCode"], 2);
}

#[tokio::test]
async fn a_status_06_is_an_addressing_failure_that_ends_the_poll_not_a_refused_register() {
    let name = "solarman-v5/wrong-serial-06";
    let (result, plan, wire) = play(name).await;
    assert_eq!(wire, Ok(()));
    assert_eq!(result, Err(Error::Exception(10)), "not exception 2: no register is amputated");
    assert_eq!(plan, [(500, 5)]);
    assert_eq!(case(name).result["error"]["modbusCode"], 10);
}

#[tokio::test]
async fn a_heartbeat_a_reply_to_another_sequence_and_a_bad_checksum_do_not_answer_the_read() {
    let name = "solarman-v5/heartbeat-and-stray-frames";
    let (result, _, wire) = play(name).await;
    assert_eq!(wire, Ok(()));
    assert_values(&result.expect("poll"), &expected_values(name));
    assert_eq!(case(name).result, case("solarman-v5/read-unit-1").result);
}
