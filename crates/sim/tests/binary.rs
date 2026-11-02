//! The `sunreye-sim` binary: a simulator process for browser journeys, answering from one oracle case.

#![allow(clippy::expect_used, reason = "helpers outside #[test] fns may panic like the tests")]

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};

use sunreye_sim::profile_case;

const BIN: &str = env!("CARGO_BIN_EXE_sunreye-sim");

fn oracle() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/oracle")
}

fn spawn(profile: &str, case: &str) -> Child {
    Command::new(BIN)
        .arg("--fixtures")
        .arg(oracle())
        .args(["--profile", profile, "--case", case])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn sunreye-sim")
}

/// The address in the line the binary prints once it listens.
fn listening(child: &mut Child) -> String {
    let mut line = String::new();
    BufReader::new(child.stdout.as_mut().expect("piped stdout")).read_line(&mut line).expect("a line");
    line.trim().strip_prefix("sunreye-sim listening ").expect("the listening line").to_owned()
}

#[test]
fn it_answers_modbus_reads_from_the_named_oracle_case() {
    let case = profile_case(&oracle(), "deye-sg01hp3", "ramp").expect("fixture case");
    let mut child = spawn("deye-sg01hp3", "ramp");
    let addr = listening(&mut child);

    let mut stream = TcpStream::connect(&addr).expect("connect");
    // Unit 1, function 3, register 108, two words.
    stream.write_all(&[0, 1, 0, 0, 0, 6, 1, 3, 0, 108, 0, 2]).expect("send");
    let mut reply = [0_u8; 13];
    stream.read_exact(&mut reply).expect("reply");
    child.kill().expect("kill");
    child.wait().expect("wait");

    let words = case.registers.read(108, 2).expect("mapped");
    let mut want = vec![0, 1, 0, 0, 0, 7, 1, 3, 4];
    want.extend(words.iter().flat_map(|w| w.to_be_bytes()));
    assert_eq!(reply.to_vec(), want);
}

#[test]
fn an_unknown_case_is_refused_at_start() {
    let mut child = spawn("deye-sg01hp3", "no-such-case");
    let mut stderr = String::new();
    child.stderr.as_mut().expect("piped stderr").read_to_string(&mut stderr).expect("stderr");
    let status = child.wait().expect("wait");
    assert!(!status.success());
    assert!(stderr.contains("no fixture for deye-sg01hp3/no-such-case"), "{stderr}");
}

#[test]
fn a_missing_flag_is_refused_with_the_usage() {
    let output = Command::new(BIN).output().expect("run");
    assert!(!output.status.success());
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("usage: sunreye-sim --fixtures <dir> --profile <id> --case <name>"), "{stderr}");
}
