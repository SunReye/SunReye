//! The `sunreye` binary as a process: flags, refusals and signal handling.

#![allow(clippy::expect_used, reason = "helpers outside #[test] fns may panic like the tests")]

use std::io::{BufRead, BufReader};
use std::process::{Child, ChildStderr, Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};

const BIN: &str = env!("CARGO_BIN_EXE_sunreye");
const VERSION: &str = env!("CARGO_PKG_VERSION");

/// A store directory of its own, so no test writes into the working directory or shares a file.
fn fresh_data_dir() -> std::path::PathBuf {
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    let dir = std::path::Path::new(env!("CARGO_TARGET_TMPDIR"))
        .join(format!("cli-{}", NEXT.fetch_add(1, Ordering::Relaxed)));
    drop(std::fs::remove_dir_all(&dir));
    dir
}

fn spawn(args: &[&str]) -> Child {
    Command::new(BIN)
        .args(args)
        .args(["--listen", "127.0.0.1:0"])
        .arg("--data-dir")
        .arg(fresh_data_dir())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn sunreye")
}

/// Waits for the startup line, which is logged after the signal handlers exist.
/// The reader is returned: dropping it would close the pipe under the process.
fn started(child: &mut Child) -> (String, BufReader<ChildStderr>) {
    let stderr = child.stderr.take().expect("piped stderr");
    let mut reader = BufReader::new(stderr);
    let mut line = String::new();
    reader.read_line(&mut line).expect("a startup line");
    (line, reader)
}

fn signal(child: &Child, name: &str) -> ExitStatus {
    Command::new("kill").arg(format!("-{name}")).arg(child.id().to_string()).status().expect("kill")
}

#[test]
fn help_lists_exactly_the_startup_flags() {
    let out = Command::new(BIN).arg("--help").output().expect("run");
    assert!(out.status.success());
    let text = String::from_utf8(out.stdout).expect("utf8");
    let flags: Vec<&str> = text
        .lines()
        .filter_map(|l| l.split_whitespace().find(|w| w.starts_with("--")))
        .map(|w| w.trim_end_matches(','))
        .collect();
    assert_eq!(
        flags,
        ["--listen", "--data-dir", "--log-level", "--trusted-origin", "--secure-cookies", "--help"]
    );
}

#[test]
fn an_unknown_flag_exits_non_zero_naming_it() {
    let out = Command::new(BIN).arg("--bogus").output().expect("run");
    assert!(!out.status.success());
    assert!(String::from_utf8_lossy(&out.stderr).contains("--bogus"));
}

#[test]
fn a_bad_listen_address_exits_non_zero_naming_the_value() {
    let out = Command::new(BIN).args(["--listen", "not-an-address"]).output().expect("run");
    assert!(!out.status.success());
    assert!(String::from_utf8_lossy(&out.stderr).contains("not-an-address"));
}

#[test]
fn a_bad_log_level_exits_non_zero() {
    let out = Command::new(BIN).args(["--log-level", "loud"]).output().expect("run");
    assert!(!out.status.success());
    assert!(String::from_utf8_lossy(&out.stderr).contains("loud"));
}

#[test]
fn logs_its_version_and_exits_zero_on_sigterm() {
    let mut child = spawn(&[]);
    let (line, _stderr) = started(&mut child);
    assert!(line.contains(VERSION), "startup line lacks the version: {line}");
    assert!(signal(&child, "TERM").success());
    assert!(child.wait().expect("wait").success());
}

#[test]
fn logs_the_address_it_listens_on() {
    let mut child = spawn(&[]);
    let (_line, mut stderr) = started(&mut child);
    let mut line = String::new();
    stderr.read_line(&mut line).expect("a listening line");
    assert!(line.contains("sunreye listening"), "{line}");
    let bound = line.split("127.0.0.1:").nth(1).expect("an address in the line");
    assert!(
        !bound.starts_with("0 ") && !bound.starts_with('0'),
        "the bound port, not the requested one: {line}"
    );
    assert!(signal(&child, "TERM").success());
    assert!(child.wait().expect("wait").success());
}

#[test]
fn a_listen_address_already_served_exits_non_zero_and_says_so() {
    let taken = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
    let addr = taken.local_addr().expect("addr").to_string();
    let out = Command::new(BIN)
        .args(["--listen", &addr, "--data-dir"])
        .arg(fresh_data_dir())
        .output()
        .expect("run");
    assert!(!out.status.success());
    assert!(String::from_utf8_lossy(&out.stderr).contains("cannot listen"));
}

#[test]
fn exits_zero_on_sigint() {
    let mut child = spawn(&["--log-level", "info"]);
    let (_line, _stderr) = started(&mut child);
    assert!(signal(&child, "INT").success());
    assert!(child.wait().expect("wait").success());
}

#[test]
fn log_level_error_silences_the_startup_line() {
    let mut child = spawn(&["--log-level", "error"]);
    let stderr = child.stderr.take().expect("piped stderr");
    // The handlers are installed before logging; give them a moment, then stop it.
    std::thread::sleep(std::time::Duration::from_millis(300));
    assert!(signal(&child, "TERM").success());
    let status = child.wait().expect("wait");
    let mut logged = String::new();
    for line in BufReader::new(stderr).lines() {
        logged.push_str(&line.expect("readable"));
    }
    assert!(status.success());
    assert!(logged.is_empty(), "unexpected output: {logged}");
}

#[test]
fn an_unusable_data_dir_exits_non_zero_and_says_why() {
    let file = std::path::Path::new(env!("CARGO_TARGET_TMPDIR")).join("not-a-directory");
    std::fs::write(&file, b"x").expect("write");
    let out = Command::new(BIN).arg("--data-dir").arg(&file).output().expect("run");
    assert!(!out.status.success());
    assert!(String::from_utf8_lossy(&out.stderr).contains("data directory"));
}
