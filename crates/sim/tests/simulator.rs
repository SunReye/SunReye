//! The simulator against the recorded wire bytes of the transport corpus, with no core client involved.

#![allow(clippy::expect_used, clippy::panic, reason = "helpers outside #[test] fns may panic like the tests")]

use std::path::{Path, PathBuf};
use std::time::Duration;

use sunreye_sim::{Exchange, Framing, Registers, Simulator, rtu_cases, transport_cases};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

fn oracle() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/oracle")
}

async fn exchange(addr: std::net::SocketAddr, parts: &[&[u8]], reply_len: usize) -> Vec<u8> {
    let mut stream = TcpStream::connect(addr).await.expect("connect");
    stream.set_nodelay(true).expect("nodelay");
    for part in parts {
        stream.write_all(part).await.expect("write");
    }
    let mut reply = vec![0_u8; reply_len];
    tokio::time::timeout(Duration::from_secs(5), stream.read_exact(&mut reply))
        .await
        .expect("reply in time")
        .expect("read");
    reply
}

#[tokio::test]
async fn a_recorded_read_gets_the_recorded_reply_bytes() {
    let cases = transport_cases(&oracle(), "tcp").expect("corpus");
    for name in ["tcp/read-unit-1", "tcp/read-unit-0"] {
        let case = cases.iter().find(|c| c.name == name).expect("case");
        let [Exchange::Expect(request), Exchange::Send(chunks)] = case.exchanges.as_slice() else {
            panic!("{name}: one request, one reply");
        };
        let registers = Registers::from_runs([(500, vec![2305, 64536, 4660, 1, 149])]);
        let sim = Simulator::start(registers, &[case.unit_id]).await.expect("sim");
        let reply = exchange(sim.addr, &[request], chunks[0].len()).await;
        assert_eq!(reply, chunks[0], "{name}");
    }
}

#[tokio::test]
async fn an_unmapped_register_is_exception_2() {
    let sim = Simulator::start(Registers::from_runs([(1, vec![7])]), &[1]).await.expect("sim");
    let reply = exchange(sim.addr, &[&[0, 1, 0, 0, 0, 6, 1, 3, 0, 1, 0, 2]], 9).await;
    assert_eq!(reply, [0, 1, 0, 0, 0, 3, 1, 0x83, 2]);
}

#[tokio::test]
async fn a_write_is_refused_with_exception_1_and_recorded() {
    let sim = Simulator::start(Registers::from_runs([(1, vec![7])]), &[1]).await.expect("sim");
    let write = [0, 2, 0, 0, 0, 9, 1, 16, 0, 1, 0, 1, 2, 0, 5];
    let reply = exchange(sim.addr, &[&write], 9).await;
    assert_eq!(reply, [0, 2, 0, 0, 0, 3, 1, 0x90, 1]);
    let seen = sim.requests();
    assert_eq!((seen.len(), seen[0].function), (1, 16));
}

#[tokio::test]
async fn a_stopped_simulator_closes_its_connections_and_answers_no_new_one() {
    let sim = Simulator::start(Registers::from_runs([(1, vec![7])]), &[1]).await.expect("sim");
    let read = [0, 1, 0, 0, 0, 6, 1, 3, 0, 1, 0, 1];
    let mut open = TcpStream::connect(sim.addr).await.expect("connect");
    open.write_all(&read).await.expect("write");
    let mut reply = [0_u8; 11];
    open.read_exact(&mut reply).await.expect("an open connection answers");

    sim.stop();
    let ended = |mut stream: TcpStream| async move {
        let mut rest = Vec::new();
        tokio::time::timeout(Duration::from_secs(5), stream.read_to_end(&mut rest))
            .await
            .map(|read| (read.ok(), rest))
    };
    assert!(matches!(ended(open).await, Ok((None | Some(0), _))), "the open connection ends unanswered");
    let mut late = TcpStream::connect(sim.addr).await.expect("the port is still bound");
    late.write_all(&read).await.ok();
    assert!(matches!(ended(late).await, Ok((None | Some(0), _))), "a new connection ends unanswered");
    assert_eq!(sim.requests().len(), 1);
}

async fn rtu_sim(registers: Registers, units: &[u8]) -> Simulator {
    Simulator::start_with(Framing::RtuOverTcp, registers, units).await.expect("sim")
}

fn hex(text: &str) -> Vec<u8> {
    (0..text.len()).step_by(2).map(|i| u8::from_str_radix(&text[i..i + 2], 16).expect("hex")).collect()
}

#[tokio::test]
async fn an_rtu_read_gets_the_rtu_reply_with_its_crc() {
    let sim = rtu_sim(Registers::from_runs([(500, vec![2305, 64536, 4660, 1, 149])]), &[1]).await;
    let reply = exchange(sim.addr, &[&hex("010301f40005c5c7")], 15).await;
    assert_eq!(reply, hex("01030a0901fc181234000100954d00"));
}

#[tokio::test]
async fn an_rtu_reply_for_unit_0_and_for_each_recorded_case_is_the_reframed_recording() {
    let cases = rtu_cases(&oracle()).expect("corpus");
    for name in ["rtu-over-tcp/read-unit-1", "rtu-over-tcp/read-unit-0"] {
        let case = cases.iter().find(|c| c.name == name).expect("case");
        let [Exchange::Expect(request), Exchange::Send(chunks)] = case.exchanges.as_slice() else {
            panic!("{name}: one request, one reply");
        };
        let registers = Registers::from_runs([(500, vec![2305, 64536, 4660, 1, 149])]);
        let sim = rtu_sim(registers, &[case.unit_id]).await;
        let reply = exchange(sim.addr, &[request], chunks[0].len()).await;
        assert_eq!(reply, chunks[0], "{name}");
    }
}

#[test]
fn the_recorded_mbap_frames_are_reframed_as_rtu_with_the_unit_first_and_the_crc_last() {
    let cases = rtu_cases(&oracle()).expect("corpus");
    let case = cases.iter().find(|c| c.name == "rtu-over-tcp/read-unit-1").expect("case");
    assert_eq!(
        case.exchanges,
        [
            Exchange::Expect(hex("010301f40005c5c7")),
            Exchange::Send(vec![hex("01030a0901fc181234000100954d00")]),
        ]
    );
    let case = cases.iter().find(|c| c.name == "rtu-over-tcp/read-unit-0").expect("case");
    assert_eq!(case.exchanges[0], Exchange::Expect(hex("000301f40005c416")));
}

#[test]
fn a_reply_the_recording_split_stays_split_and_leading_junk_stays_in_front_of_the_reframed_reply() {
    let cases = rtu_cases(&oracle()).expect("corpus");
    let fragmented = cases.iter().find(|c| c.name == "rtu-over-tcp/fragmented-reply").expect("case");
    let Exchange::Send(chunks) = &fragmented.exchanges[1] else { panic!("a reply") };
    assert_eq!(chunks.len(), 2);
    assert_eq!(chunks.concat(), hex("01030a0901fc181234000100954d00"));
    let junk = cases.iter().find(|c| c.name == "rtu-over-tcp/leading-junk").expect("case");
    assert_eq!(junk.exchanges[1], Exchange::Send(vec![hex("deadbe01030a0901fc181234000100954d00")]));
}

#[tokio::test]
async fn an_rtu_unmapped_register_is_exception_2() {
    let sim = rtu_sim(Registers::from_runs([(1, vec![7])]), &[1]).await;
    let reply = exchange(sim.addr, &[&hex("01030001000295cb")], 5).await;
    assert_eq!(reply, hex("018302c0f1"));
}

#[tokio::test]
async fn an_rtu_write_is_refused_with_exception_1_and_recorded() {
    let sim = rtu_sim(Registers::from_runs([(1, vec![7])]), &[1]).await;
    let reply = exchange(sim.addr, &[&hex("0110000100010200056782")], 5).await;
    assert_eq!(reply, hex("0190018dc0"));
    let seen = sim.requests();
    assert_eq!((seen.len(), seen[0].function), (1, 16));
}

#[tokio::test]
async fn an_rtu_frame_with_a_bad_crc_is_dropped_and_the_next_one_answered() {
    let sim = rtu_sim(Registers::from_runs([(500, vec![2305, 64536, 4660, 1, 149])]), &[1]).await;
    let reply = exchange(sim.addr, &[&hex("010301f40005c5c8"), &hex("010301f40005c5c7")], 15).await;
    assert_eq!(reply, hex("01030a0901fc181234000100954d00"));
    assert_eq!(sim.requests().len(), 1, "only the frame with a good CRC is a request");
}

#[tokio::test]
async fn an_rtu_unit_that_does_not_answer_stays_silent() {
    let sim = rtu_sim(Registers::from_runs([(500, vec![2305, 64536, 4660, 1, 149])]), &[1]).await;
    // Replies come back in order: the first bytes read are the answered request's, so none went to unit 0.
    let (unit_0, unit_1) = (hex("000301f40001c5d5"), hex("010301f40005c5c7"));
    let reply = exchange(sim.addr, &[&unit_0, &unit_1], 15).await;
    assert_eq!(reply, hex("01030a0901fc181234000100954d00"));
    assert_eq!(sim.requests().len(), 1, "only unit 1 was asked");
}

const STICK: u32 = 3_168_930_341;

async fn solarman_sim(registers: Registers, units: &[u8]) -> Simulator {
    Simulator::start_with(Framing::SolarmanV5(STICK), registers, units).await.expect("sim")
}

/// The recorded `solarman-v5` exchange of `name`: every request the client sent and the reply to each.
fn recorded(name: &str) -> Vec<(Vec<u8>, Vec<u8>)> {
    let cases = transport_cases(&oracle(), "solarman-v5").expect("corpus");
    let case = cases.iter().find(|c| c.name == name).expect("case");
    case.exchanges
        .chunks(2)
        .map(|pair| match pair {
            [Exchange::Expect(request), Exchange::Send(chunks)] => (request.clone(), chunks.concat()),
            other => panic!("{name}: a request and its reply, got {other:?}"),
        })
        .collect()
}

#[test]
fn the_solarman_cases_carry_the_serials_the_recording_used() {
    let cases = transport_cases(&oracle(), "solarman-v5").expect("corpus");
    let serials = |name: &str| {
        let case = cases.iter().find(|c| c.name == name).expect("case");
        (case.logger_serial, case.configured_serial)
    };
    assert_eq!(serials("solarman-v5/read-unit-1"), (Some(STICK), None));
    assert_eq!(serials("solarman-v5/logger-serial-discovery"), (Some(STICK), Some(0x1122_3344)));
    let tcp = transport_cases(&oracle(), "tcp").expect("corpus");
    assert_eq!((tcp[0].logger_serial, tcp[0].configured_serial), (None, None));
}

#[tokio::test]
async fn a_request_naming_serial_0_is_rejected_with_status_06_and_the_sticks_serial() {
    let sim = solarman_sim(Registers::from_runs([(500, vec![1])]), &[1]).await;
    let [(probe, rejected), _] = recorded("solarman-v5/read-unit-1").try_into().expect("probe and read");
    let reply = exchange(sim.addr, &[&probe], rejected.len()).await;
    assert_eq!(reply, rejected);
    assert_eq!(sim.requests(), [], "a rejected frame is not a request");
}

#[tokio::test]
async fn a_solarman_read_gets_the_recorded_reply_bytes_for_unit_1_and_unit_0() {
    for (name, unit) in [("solarman-v5/read-unit-1", 1), ("solarman-v5/read-unit-0", 0)] {
        let sim = solarman_sim(Registers::from_runs([(500, vec![2305, 64536, 4660, 1, 149])]), &[unit]).await;
        let [_, (request, reply)] = recorded(name).try_into().expect("probe and read");
        assert_eq!(exchange(sim.addr, &[&request], reply.len()).await, reply, "{name}");
        assert_eq!(
            sim.requests(),
            [sunreye_sim::Request { unit, function: 3, start: 500, count: 5 }],
            "{name}"
        );
    }
}

#[tokio::test]
async fn a_solarman_reply_echoes_the_request_sequence_in_its_low_byte() {
    let sim = solarman_sim(Registers::from_runs([(500, vec![2305, 64536, 4660, 1, 149])]), &[1]).await;
    let [_, (request, reply)] = recorded("solarman-v5/read-unit-1").try_into().expect("probe and read");
    let mut later = request.clone();
    later[5] = 0x2a;
    let last = later.len() - 2;
    later[last] = later[1..last].iter().fold(0_u8, |sum, byte| sum.wrapping_add(*byte));
    let echoed = exchange(sim.addr, &[&later], reply.len()).await;
    assert_eq!(echoed[5..7], [0x2a, 0x0d]);
}

#[tokio::test]
async fn a_solarman_unmapped_register_is_the_recorded_exception_2_reply() {
    let sim = solarman_sim(Registers::from_runs([(500, vec![2305, 64536, 4660, 1, 149])]), &[1]).await;
    let pairs = recorded("solarman-v5/exception-2-split");
    let (request, reply) = &pairs[1];
    assert_eq!(exchange(sim.addr, &[request], reply.len()).await, *reply);
}

#[tokio::test]
async fn a_solarman_write_is_refused_with_exception_1_and_recorded() {
    let sim = solarman_sim(Registers::from_runs([(504, vec![7])]), &[1]).await;
    let [_, (write, _)] = recorded("solarman-v5/write-register").try_into().expect("probe and write");
    let reply = exchange(sim.addr, &[&write], 11 + 14 + 5 + 2).await;
    assert_eq!(reply[25..30], hex("0190018dc0"), "the RTU exception 1 reply of unit 1, as for RTU over TCP");
    let seen = sim.requests();
    assert_eq!((seen.len(), seen[0].function), (1, 16));
}

#[tokio::test]
async fn a_solarman_frame_with_a_bad_checksum_is_dropped_and_the_next_one_answered() {
    let sim = solarman_sim(Registers::from_runs([(500, vec![2305, 64536, 4660, 1, 149])]), &[1]).await;
    let [_, (request, reply)] = recorded("solarman-v5/read-unit-1").try_into().expect("probe and read");
    let mut corrupt = request.clone();
    let checksum = corrupt.len() - 2;
    corrupt[checksum] = corrupt[checksum].wrapping_add(1);
    assert_eq!(exchange(sim.addr, &[&corrupt, &request], reply.len()).await, reply);
    assert_eq!(sim.requests().len(), 1, "only the frame with a good checksum is a request");
}

#[tokio::test]
async fn a_solarman_unit_that_does_not_answer_stays_silent() {
    let sim = solarman_sim(Registers::from_runs([(500, vec![2305, 64536, 4660, 1, 149])]), &[1]).await;
    let [_, (unit_0, _)] = recorded("solarman-v5/read-unit-0").try_into().expect("probe and read");
    let [_, (unit_1, reply)] = recorded("solarman-v5/read-unit-1").try_into().expect("probe and read");
    // Replies come back in order: the first bytes read are the answered request's, so none went to unit 0.
    assert_eq!(exchange(sim.addr, &[&unit_0, &unit_1], reply.len()).await, reply);
    assert_eq!(sim.requests().len(), 1, "only unit 1 was asked");
}

#[tokio::test]
async fn a_replay_fails_when_the_client_sends_past_the_recording_and_not_when_it_hangs_up() {
    let steps = || vec![Exchange::Expect(vec![1, 2, 3]), Exchange::Send(vec![vec![9]])];
    let clean = sunreye_sim::replay(steps()).await.expect("replay");
    let mut stream = TcpStream::connect(clean.addr).await.expect("connect");
    stream.write_all(&[1, 2, 3]).await.expect("write");
    let mut reply = [0_u8; 1];
    stream.read_exact(&mut reply).await.expect("reply");
    drop(stream);
    assert_eq!(clean.finish().await, Ok(()));

    let extra = sunreye_sim::replay(steps()).await.expect("replay");
    let mut stream = TcpStream::connect(extra.addr).await.expect("connect");
    stream.write_all(&[1, 2, 3]).await.expect("write");
    stream.read_exact(&mut reply).await.expect("reply");
    stream.write_all(&[4]).await.expect("write");
    let error = extra.finish().await.expect_err("a request past the recording");
    assert!(error.contains("after the recording"), "{error}");
}
