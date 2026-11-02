//! The simulator against the recorded wire bytes of the transport corpus, with no core client involved.

#![allow(clippy::expect_used, reason = "helpers outside #[test] fns may panic like the tests")]

use std::path::{Path, PathBuf};
use std::time::Duration;

use sunreye_sim::{Exchange, Registers, Simulator, transport_cases};
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
