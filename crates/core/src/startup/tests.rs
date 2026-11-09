//! Startup options, and the core served over TCP.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::time::{Duration, SystemTime};

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;

use super::{Options, serve};

fn parse(args: &[&str], env: &[(&str, &str)]) -> Result<Options, String> {
    let args = args.iter().map(|&a| a.to_owned());
    let env = |name: &str| {
        env.iter()
            .find(|(key, _)| *key == name)
            .map(|(_, value)| (*value).to_owned())
    };
    Options::parse(args, env).map_err(|e| e.to_string())
}

fn options(data_dir: &str, listen: &str) -> Result<Options, String> {
    let listen = listen.parse().map_err(|_| listen.to_owned())?;
    Ok(Options {
        data_dir: PathBuf::from(data_dir),
        listen,
    })
}

#[test]
fn the_core_listens_on_port_8099_by_default() {
    assert_eq!(
        parse(&["--data-dir", "/data"], &[]),
        options("/data", "0.0.0.0:8099")
    );
}

#[test]
fn a_flag_takes_its_value_after_a_space_or_an_equals_sign() {
    assert_eq!(
        parse(&["--data-dir=/data", "--listen", "127.0.0.1:9000"], &[]),
        options("/data", "127.0.0.1:9000")
    );
}

#[test]
fn each_flag_falls_back_to_its_environment_variable() {
    let env = [
        ("SUNREYE_DATA_DIR", "/env"),
        ("SUNREYE_LISTEN", "127.0.0.1:9000"),
    ];

    assert_eq!(parse(&[], &env), options("/env", "127.0.0.1:9000"));
    assert_eq!(
        parse(&["--data-dir", "/flag"], &env),
        options("/flag", "127.0.0.1:9000")
    );
}

#[test]
fn startup_refuses_a_missing_data_dir_a_bad_address_and_unknown_arguments() {
    assert_eq!(
        parse(&[], &[]),
        Err("--data-dir or SUNREYE_DATA_DIR is required".to_owned())
    );
    assert_eq!(
        parse(&["--data-dir", "/data", "--listen", "8099"], &[]),
        Err("--listen: `8099` is not an address and port".to_owned())
    );
    assert_eq!(
        parse(&["--data-dir", "/data", "--verbose"], &[]),
        Err("unknown argument `--verbose`".to_owned())
    );
    assert_eq!(
        parse(&["--data-dir"], &[]),
        Err("--data-dir needs a value".to_owned())
    );
}

/// One HTTP/1.1 request with `headers`, each ending in CRLF; returns the status and the raw
/// response.
async fn request(
    address: SocketAddr,
    method: &str,
    path: &str,
    headers: &str,
    body: &str,
) -> (u16, String) {
    let mut stream = TcpStream::connect(address).await.unwrap();
    let length = body.len();
    let request = format!(
        "{method} {path} HTTP/1.1\r\nHost: core\r\nConnection: close\r\n{headers}\
         Content-Length: {length}\r\n\r\n{body}"
    );
    stream.write_all(request.as_bytes()).await.unwrap();
    let mut response = String::new();
    stream.read_to_string(&mut response).await.unwrap();
    let status = response[9..12].parse().unwrap();
    (status, response)
}

/// The `name=value` of the response's session cookie.
fn session_cookie(response: &str) -> String {
    let line = response
        .lines()
        .find_map(|l| l.strip_prefix("set-cookie: "))
        .unwrap();
    line.split(';').next().unwrap().to_owned()
}

#[tokio::test]
async fn the_core_serves_until_shut_down_and_reports_a_clock_behind_its_build() {
    let dir = tempfile::tempdir().unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let build = SystemTime::now() + Duration::from_hours(24);
    let (stop, stopped) = oneshot::channel::<()>();
    let core = tokio::spawn(serve(listener, dir.path().to_owned(), build, async {
        stopped.await.ok();
    }));

    let json = "Content-Type: application/json\r\n";
    let password = r#"{"password":"correct horse"}"#;
    let (status, _) = request(address, "POST", "/api/v1/setup", json, password).await;
    assert_eq!(status, 204);
    let (status, response) = request(address, "POST", "/api/v1/login", json, password).await;
    assert_eq!(status, 204);
    let cookie = format!("Cookie: {}\r\n", session_cookie(&response));
    let (status, response) = request(address, "GET", "/api/v1/problems", &cookie, "").await;
    assert_eq!(status, 200);
    assert!(response.ends_with(r#"{"problems":[{"code":"clock.unsynced"}]}"#));

    stop.send(()).unwrap();
    core.await.unwrap().unwrap();
    assert!(dir.path().join("core.sqlite").exists());
}
