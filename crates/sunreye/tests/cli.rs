//! The `sunreye` binary as a process: flags, refusals and signal handling.

#![allow(clippy::expect_used, reason = "helpers outside #[test] fns may panic like the tests")]

use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, ChildStderr, Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};

const BIN: &str = env!("CARGO_BIN_EXE_sunreye");
const VERSION: &str = env!("CARGO_PKG_VERSION");

/// A store directory of its own, so no test, in this process or a parallel one, shares a file.
fn fresh_data_dir() -> std::path::PathBuf {
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    let dir = std::path::Path::new(env!("CARGO_TARGET_TMPDIR")).join(format!(
        "cli-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    drop(std::fs::remove_dir_all(&dir));
    dir
}

fn spawn(args: &[&str]) -> Running {
    Running(
        Command::new(BIN)
            .args(args)
            .args(["--listen", "127.0.0.1:0"])
            .arg("--data-dir")
            .arg(fresh_data_dir())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn sunreye"),
    )
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
    let (line, _stderr) = started(&mut child.0);
    assert!(line.contains(VERSION), "startup line lacks the version: {line}");
    assert!(signal(&child.0, "TERM").success());
    assert!(child.0.wait().expect("wait").success());
}

#[test]
fn logs_the_address_it_listens_on() {
    let mut child = spawn(&[]);
    let (_line, mut stderr) = started(&mut child.0);
    let mut line = String::new();
    stderr.read_line(&mut line).expect("a listening line");
    assert!(line.contains("sunreye listening"), "{line}");
    let bound = line.split("127.0.0.1:").nth(1).expect("an address in the line");
    assert!(
        !bound.starts_with("0 ") && !bound.starts_with('0'),
        "the bound port, not the requested one: {line}"
    );
    assert!(signal(&child.0, "TERM").success());
    assert!(child.0.wait().expect("wait").success());
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
    let (_line, _stderr) = started(&mut child.0);
    assert!(signal(&child.0, "INT").success());
    assert!(child.0.wait().expect("wait").success());
}

#[cfg(target_os = "linux")]
#[test]
fn log_level_error_silences_the_startup_line() {
    let mut child = spawn(&["--log-level", "error"]);
    let stderr = child.0.stderr.take().expect("piped stderr");
    serving(&mut child.0);
    assert!(signal(&child.0, "TERM").success());
    let status = child.0.wait().expect("wait");
    let mut logged = String::new();
    for line in BufReader::new(stderr).lines() {
        logged.push_str(&line.expect("readable"));
    }
    assert!(status.success());
    assert!(logged.is_empty(), "unexpected output: {logged}");
}

#[test]
fn an_unusable_data_dir_exits_non_zero_and_says_why() {
    let file = std::path::Path::new(env!("CARGO_TARGET_TMPDIR"))
        .join(format!("not-a-directory-{}", std::process::id()));
    std::fs::write(&file, b"x").expect("write");
    let out =
        Command::new(BIN).args(["--listen", "127.0.0.1:0", "--data-dir"]).arg(&file).output().expect("run");
    assert!(!out.status.success());
    assert!(String::from_utf8_lossy(&out.stderr).contains("data directory"));
}

/// The bound port at the end of the "sunreye listening" line.
fn port(listening: &str) -> u16 {
    let digits: String = listening.trim_end().chars().rev().take_while(char::is_ascii_digit).collect();
    digits.chars().rev().collect::<String>().parse().expect("a port")
}

/// A child killed when the test panics, so a failed run leaves no server behind.
struct Running(Child);

impl Drop for Running {
    fn drop(&mut self) {
        drop(self.0.kill());
        drop(self.0.wait());
    }
}

/// The TCP port `pid` itself listens on: no other process can answer in its place.
#[cfg(target_os = "linux")]
fn listening_port(pid: u32) -> Option<u16> {
    let sockets: Vec<String> = std::fs::read_dir(format!("/proc/{pid}/fd"))
        .ok()?
        .filter_map(|fd| std::fs::read_link(fd.ok()?.path()).ok())
        .filter_map(|link| Some(link.to_str()?.strip_prefix("socket:[")?.strip_suffix(']')?.to_owned()))
        .collect();
    let table = std::fs::read_to_string("/proc/net/tcp").ok()?;
    table.lines().skip(1).find_map(|row| {
        let cols: Vec<&str> = row.split_whitespace().collect();
        let listening =
            cols.get(3) == Some(&"0A") && cols.get(9).is_some_and(|inode| sockets.iter().any(|s| s == inode));
        listening.then(|| u16::from_str_radix(cols.get(1)?.split(':').nth(1)?, 16).ok()).flatten()
    })
}

/// Returns once `child` answers on its own port, which is after it installed its signal handlers and opened its store.
#[cfg(target_os = "linux")]
fn serving(child: &mut Child) {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
    loop {
        let answer = listening_port(child.id()).map(|port| try_request(port, "GET /api/setup-status", ""));
        if matches!(answer, Some(Ok(ref status)) if status.contains("200")) {
            return;
        }
        assert!(child.try_wait().expect("poll the child").is_none(), "exited before serving");
        assert!(std::time::Instant::now() < deadline, "not serving: {answer:?}");
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
}

/// One HTTP/1.1 request over loopback; the answer's status line.
fn request(port: u16, head: &str, body: &str) -> String {
    try_request(port, head, body).expect("an answer")
}

fn try_request(port: u16, head: &str, body: &str) -> std::io::Result<String> {
    let mut stream = std::net::TcpStream::connect(("127.0.0.1", port))?;
    let request = format!(
        "{head} HTTP/1.1\r\nhost: sunreye\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
        body.len()
    );
    stream.write_all(request.as_bytes())?;
    let mut answer = String::new();
    stream.read_to_string(&mut answer)?;
    Ok(answer.lines().next().unwrap_or_default().to_owned())
}

fn log_of_a_run(listen: &str, data_dir: &std::path::Path, then: impl FnOnce(u16, u32)) -> String {
    let mut child = Running(
        Command::new(BIN)
            .args(["--listen", listen, "--data-dir"])
            .arg(data_dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn sunreye"),
    );
    let mut reader = BufReader::new(child.0.stderr.take().expect("piped stderr"));
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
    then(port, child.0.id());
    assert!(signal(&child.0, "TERM").success());
    assert!(child.0.wait().expect("wait").success());
    reader.read_to_string(&mut log).expect("the rest of the log");
    log
}

/// The WARN lines the run itself logged: sqlx adds a `slow statement` one when the machine is loaded.
fn warnings(log: &str) -> Vec<&str> {
    log.lines().filter(|l| l.contains("WARN") && !l.contains("sqlx::query")).collect()
}

#[test]
fn warnings_leave_out_what_sqlx_logs_when_the_machine_is_loaded() {
    let log = "2026-11-05T10:00:00Z  INFO sunreye listening on 127.0.0.1:41000\n\
               2026-11-05T10:00:01Z  WARN sqlx::query: slow statement: execution time exceeded alert threshold elapsed=1.2s\n\
               2026-11-05T10:00:01Z  WARN sunreye::run: listen address is not loopback\n";
    assert_eq!(warnings(log), ["2026-11-05T10:00:01Z  WARN sunreye::run: listen address is not loopback"]);
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

/// ADR 0006: no growth, because every login reuses one check's buffer.
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
