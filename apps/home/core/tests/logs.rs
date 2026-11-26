//! The `sunreye` binary's logs (ADR 2): stderr and the buffer the API reads, never a file.
#![cfg(test)]

use std::io::{BufRead as _, BufReader, Read as _, Write as _};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

const WAIT: Duration = Duration::from_secs(30);

/// One HTTP/1.1 request; returns the raw response.
fn request(address: SocketAddr, method: &str, path: &str, headers: &str, body: &str) -> String {
    let mut stream = TcpStream::connect(address).unwrap();
    let length = body.len();
    write!(
        stream,
        "{method} {path} HTTP/1.1\r\nHost: core\r\nConnection: close\r\n{headers}\
         Content-Length: {length}\r\n\r\n{body}"
    )
    .unwrap();
    let mut response = String::new();
    stream.read_to_string(&mut response).unwrap();
    response
}

/// A free local port: bound, then released for the core.
fn free() -> SocketAddr {
    std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
}

/// Every file under `dir`, relative to it.
fn files(dir: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let mut open = vec![dir.to_owned()];
    while let Some(next) = open.pop() {
        for entry in std::fs::read_dir(next).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                open.push(path);
            } else {
                found.push(path.strip_prefix(dir).unwrap().to_owned());
            }
        }
    }
    found.sort();
    found
}

/// Sends SIGTERM, as Docker and systemd do, and waits for the core to stop.
fn terminate(mut core: Child) -> std::process::ExitStatus {
    let sent = Command::new("kill")
        .args(["-TERM", &core.id().to_string()])
        .status()
        .unwrap();
    assert!(sent.success());
    core.wait().unwrap()
}

/// Starts the binary on `address`, its data directory `data` under `dir`; returns it and its
/// stderr's lines.
fn start(dir: &Path, address: SocketAddr) -> (Child, mpsc::Receiver<String>) {
    let mut core = Command::new(env!("CARGO_BIN_EXE_sunreye"))
        .args(["--data-dir", "data", "--listen", &address.to_string()])
        .current_dir(dir)
        .env_remove("SUNREYE_INGRESS")
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let stderr = BufReader::new(core.stderr.take().unwrap());
    let (lines, logged) = mpsc::channel();
    std::thread::spawn(move || {
        for line in stderr.lines() {
            lines.send(line.unwrap()).ok();
        }
    });
    (core, logged)
}

/// Sets up the admin; returns the session's `Cookie` header.
fn sign_in(address: SocketAddr) -> String {
    let json = "Content-Type: application/json\r\n";
    let password = r#"{"password":"correct horse"}"#;
    request(address, "POST", "/api/v1/setup", json, password);
    let response = request(address, "POST", "/api/v1/login", json, password);
    let cookie = response
        .lines()
        .find_map(|l| l.strip_prefix("set-cookie: "))
        .and_then(|c| c.split(';').next())
        .unwrap();
    format!("Cookie: {cookie}\r\n")
}

#[test]
fn the_core_logs_to_stderr_and_its_buffer_and_writes_no_log_file() {
    let dir = tempfile::tempdir().unwrap();
    let address = free();
    let (core, logged) = start(dir.path(), address);
    let serving = logged.recv_timeout(WAIT).unwrap();
    assert!(serving.contains("serving"), "{serving}");

    let response = request(address, "GET", "/api/v1/logs", &sign_in(address), "");

    assert!(response.starts_with("HTTP/1.1 200"), "{response}");
    assert!(response.contains(&serving), "{response}");
    assert!(terminate(core).success());
    let rest: Vec<String> = logged.iter().collect();
    assert!(rest.iter().any(|line| line.contains("stopped")), "{rest:?}");
    let stored = [
        "core.lock",
        "core.sqlite",
        "core.sqlite-shm",
        "core.sqlite-wal",
    ];
    for file in files(dir.path()) {
        assert!(
            file.parent() == Some(Path::new("data"))
                && stored.iter().any(|s| file.file_name() == Some(s.as_ref())),
            "the core wrote {}",
            file.display()
        );
    }
}
