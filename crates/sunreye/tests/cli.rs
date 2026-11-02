//! The `sunreye` binary as a process: flags, refusals and signal handling.

#![allow(clippy::expect_used, reason = "helpers outside #[test] fns may panic like the tests")]

use std::io::{BufRead, BufReader, Read, Write};
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

/// The bound port at the end of the "sunreye listening" line.
fn port(listening: &str) -> u16 {
    let digits: String = listening.trim_end().chars().rev().take_while(char::is_ascii_digit).collect();
    digits.chars().rev().collect::<String>().parse().expect("a port")
}

/// One HTTP/1.1 request over loopback; the answer's status line.
fn request(port: u16, head: &str, body: &str) -> String {
    let mut stream = std::net::TcpStream::connect(("127.0.0.1", port)).expect("connect");
    let request = format!(
        "{head} HTTP/1.1\r\nhost: sunreye\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
        body.len()
    );
    stream.write_all(request.as_bytes()).expect("send");
    let mut answer = String::new();
    stream.read_to_string(&mut answer).expect("answer");
    answer.lines().next().unwrap_or_default().to_owned()
}

/// Everything logged by a run on `listen` and `data_dir` that served one request, then `then` on its port
/// and process id.
fn log_of_a_run(listen: &str, data_dir: &std::path::Path, then: impl FnOnce(u16, u32)) -> String {
    let mut child = Command::new(BIN)
        .args(["--listen", listen, "--data-dir"])
        .arg(data_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn sunreye");
    let mut reader = BufReader::new(child.stderr.take().expect("piped stderr"));
    let mut log = String::new();
    let listening = loop {
        let mut line = String::new();
        assert!(reader.read_line(&mut line).expect("a startup line") > 0, "exited early: {log}");
        log.push_str(&line);
        if line.contains("sunreye listening") {
            break line;
        }
    };
    let port = port(&listening);
    // Answered only once the store is open, so every startup warning is logged by then.
    assert!(request(port, "GET /api/setup-status", "").contains("200"));
    then(port, child.id());
    assert!(signal(&child, "TERM").success());
    assert!(child.wait().expect("wait").success());
    reader.read_to_string(&mut log).expect("the rest of the log");
    log
}

fn warnings(log: &str) -> Vec<&str> {
    log.lines().filter(|l| l.contains("WARN")).collect()
}

#[test]
fn a_non_loopback_listen_address_warns_while_sign_up_is_open() {
    let log = log_of_a_run("0.0.0.0:0", &fresh_data_dir(), |_, _| {});
    let warnings = warnings(&log);
    assert_eq!(warnings.len(), 1, "{log}");
    assert!(warnings[0].contains("0.0.0.0:"), "{log}");
    assert!(warnings[0].contains("sign-up"), "{log}");
    assert!(warnings[0].contains("--listen 127.0.0.1"), "names the fix: {log}");
}

#[test]
fn a_loopback_listen_address_logs_no_warning() {
    let log = log_of_a_run("127.0.0.1:0", &fresh_data_dir(), |_, _| {});
    assert_eq!(warnings(&log), Vec::<&str>::new(), "{log}");
}

#[test]
fn a_non_loopback_listen_address_logs_no_warning_once_the_admin_exists() {
    let dir = fresh_data_dir();
    log_of_a_run("127.0.0.1:0", &dir, |port, _| {
        let body = r#"{"email":"admin@example.org","name":"Admin","password":"correct horse battery"}"#;
        assert!(request(port, "POST /api/auth/sign-up", body).contains("200"));
    });
    let log = log_of_a_run("0.0.0.0:0", &dir, |_, _| {});
    assert_eq!(warnings(&log), Vec::<&str>::new(), "{log}");
}

/// `VmRSS` of process `pid`, in KiB.
#[cfg(target_os = "linux")]
fn resident_kib(pid: u32) -> u64 {
    let status = std::fs::read_to_string(format!("/proc/{pid}/status")).expect("proc status");
    let line = status.lines().find(|l| l.starts_with("VmRSS:")).expect("a VmRSS line");
    line.split_whitespace().nth(1).and_then(|kib| kib.parse().ok()).expect("a KiB count")
}

/// ADR 0006: no growth. Each check needs Argon2's 19 MiB; freed per login, the allocator keeps it resident.
#[cfg(target_os = "linux")]
#[test]
fn sequential_logins_hold_resident_memory_level() {
    log_of_a_run("127.0.0.1:0", &fresh_data_dir(), |port, pid| {
        let account = r#""email":"admin@example.org","password":"correct horse battery""#;
        let sign_up = format!(r#"{{{account},"name":"Admin"}}"#);
        assert!(request(port, "POST /api/auth/sign-up", &sign_up).contains("200"));
        let login = |n: usize| {
            for _ in 0..n {
                assert!(request(port, "POST /api/auth/login", &format!("{{{account}}}")).contains("200"));
            }
        };
        login(2);
        let settled = resident_kib(pid);
        login(20);
        let grown = resident_kib(pid).saturating_sub(settled);
        assert!(grown < 4 * 1024, "resident memory grew {grown} KiB over 20 logins");
    });
}
