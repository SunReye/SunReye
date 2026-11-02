//! `sunreye-sim` as a process: the replay a harness polls without linking the library.

#![allow(clippy::expect_used, reason = "helpers outside #[test] fns may panic like the tests")]

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::path::Path;
use std::process::{Child, Command, Stdio};

const BIN: &str = env!("CARGO_BIN_EXE_sunreye-sim");

fn oracle() -> String {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/oracle").display().to_string()
}

fn spawn(args: &[&str]) -> Child {
    Command::new(BIN).args(args).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().expect("spawn")
}

#[test]
fn it_serves_the_registers_of_the_named_case_and_names_each_request() {
    let mut sim = spawn(&[&oracle(), "deye-sg05lp3", "ramp"]);
    let mut lines = BufReader::new(sim.stdout.take().expect("piped stdout")).lines();
    let first = lines.next().expect("a line").expect("utf8");
    let addr = first.strip_prefix("listening ").expect("the address comes first");

    let mut stream = TcpStream::connect(addr).expect("connect");
    // Unit 1, function 3, register 98, one word: the ramp case holds 699 (0x02bb) there.
    stream.write_all(&[0, 7, 0, 0, 0, 6, 1, 3, 0, 98, 0, 1]).expect("write");
    let mut reply = [0_u8; 11];
    stream.read_exact(&mut reply).expect("reply");
    assert_eq!(reply, [0, 7, 0, 0, 0, 5, 1, 3, 2, 0x02, 0xbb]);

    stream.write_all(&[0, 8, 0, 0, 0, 6, 1, 3, 0, 100, 0, 2]).expect("write");
    stream.read_exact(&mut [0_u8; 9]).expect("an exception reply: register 100 is not in the case");

    // One line per request, in arrival order, whatever the harness's read interval.
    assert_eq!(lines.next().expect("a line").expect("utf8"), "request 98 1");
    assert_eq!(lines.next().expect("a line").expect("utf8"), "request 100 2");
    sim.kill().expect("kill");
    sim.wait().expect("wait");
}

#[test]
fn an_unknown_case_exits_non_zero_naming_it() {
    let out = Command::new(BIN).args([&oracle(), "deye-sg05lp3", "no-such-case"]).output().expect("run");
    assert!(!out.status.success());
    assert!(String::from_utf8_lossy(&out.stderr).contains("no-such-case"));
}

#[test]
fn missing_arguments_exit_non_zero_with_the_usage() {
    let out = Command::new(BIN).output().expect("run");
    assert!(!out.status.success());
    assert!(String::from_utf8_lossy(&out.stderr).contains("usage: sunreye-sim"));
}
