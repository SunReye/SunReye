//! The simulator against the recorded wire bytes of the transport corpus, with no core client involved.

#![allow(clippy::expect_used, reason = "helpers outside #[test] fns may panic like the tests")]

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
        tokio::time::sleep(Duration::from_millis(20)).await;
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
    let sim = rtu_sim(Registers::from_runs([(500, vec![1])]), &[1]).await;
    let mut stream = TcpStream::connect(sim.addr).await.expect("connect");
    stream.write_all(&hex("000301f40001c5d5")).await.ok();
    let mut byte = [0_u8; 1];
    let read = tokio::time::timeout(Duration::from_millis(150), stream.read(&mut byte)).await;
    assert!(read.is_err(), "no reply");
    assert_eq!(sim.requests(), []);
}
