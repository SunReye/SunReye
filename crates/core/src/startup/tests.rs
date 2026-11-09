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
        ingress: None,
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
fn only_the_add_on_image_names_the_supervisor_whose_ingress_is_trusted() {
    let supervisor = Ok(Some("172.30.32.2".parse().unwrap()));
    let ingress = |args: &[&str], env: &[(&str, &str)]| parse(args, env).map(|o| o.ingress);

    assert_eq!(ingress(&["--data-dir", "/data"], &[]), Ok(None));
    assert_eq!(
        ingress(&["--data-dir", "/data", "--ingress", "172.30.32.2"], &[]),
        supervisor
    );
    assert_eq!(
        ingress(
            &["--data-dir", "/data"],
            &[("SUNREYE_INGRESS", "172.30.32.2")]
        ),
        supervisor
    );
    assert_eq!(
        parse(&["--data-dir", "/data", "--ingress", "supervisor"], &[]),
        Err("--ingress: `supervisor` is not an IP address".to_owned())
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
    let core = tokio::spawn(serve(listener, dir.path().to_owned(), None, build, async {
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

#[tokio::test]
async fn the_core_trusts_ingress_from_the_address_it_was_given() {
    let dir = tempfile::tempdir().unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let ingress = Some(address.ip());
    let (stop, stopped) = oneshot::channel::<()>();
    let core = tokio::spawn(serve(
        listener,
        dir.path().to_owned(),
        ingress,
        SystemTime::UNIX_EPOCH,
        async {
            stopped.await.ok();
        },
    ));

    let header = "X-Ingress-Path: /api/hassio_ingress/abc123\r\n";
    let (status, _) = request(address, "GET", "/api/v1/session", header, "").await;
    assert_eq!(status, 204);

    stop.send(()).unwrap();
    core.await.unwrap().unwrap();
}

/// Starts the core on a free port; returns its address and the sender that stops it.
fn start(
    data_dir: &std::path::Path,
) -> (
    SocketAddr,
    oneshot::Sender<()>,
    tokio::task::JoinHandle<Result<(), super::Error>>,
) {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let address = listener.local_addr().unwrap();
    let listener = TcpListener::from_std(listener).unwrap();
    let (stop, stopped) = oneshot::channel::<()>();
    let core = tokio::spawn(serve(
        listener,
        data_dir.to_owned(),
        None,
        SystemTime::UNIX_EPOCH,
        async {
            stopped.await.ok();
        },
    ));
    (address, stop, core)
}

#[tokio::test]
async fn configured_devices_are_polled_from_boot_and_strings_wire_to_their_inverters() {
    let dir = tempfile::tempdir().unwrap();
    let mut device = crate::transport::fake::serve().await;
    let (address, stop, core) = start(dir.path());
    let json = "Content-Type: application/json\r\n";
    let password = r#"{"password":"correct horse"}"#;
    request(address, "POST", "/api/v1/setup", json, password).await;
    let (_, response) = request(address, "POST", "/api/v1/login", json, password).await;
    let headers = format!("Cookie: {}\r\n{json}", session_cookie(&response));
    let port = device.address.port();
    let connection = format!(
        r#"{{"name":"gateway","transport":"modbus-tcp","host":"127.0.0.1","port":{port}}}"#
    );
    let (status, _) = request(
        address,
        "POST",
        "/api/v1/connections",
        &headers,
        &connection,
    )
    .await;
    assert_eq!(status, 201);
    let deye = r#"{"name":"Deye","connection":1,"profile":"deye-sg05lp3","unit":0}"#;
    let (status, _) = request(address, "POST", "/api/v1/devices", &headers, deye).await;
    assert_eq!(status, 201);
    let module = r#"{"name":"M","pmax":400,"vmp":34,"imp":11.76,"voc":41,"isc":12.5,
        "powerCoefficient":-0.35,"voltageCoefficient":-0.27,"currentCoefficient":0.05,
        "width":1.1,"height":1.7,"bypassDiodes":3}"#;
    let (status, _) = request(address, "POST", "/api/v1/module-types", &headers, module).await;
    assert_eq!(status, 201);
    let layout = r#"{"appliesFrom":"2026-11-01T00:00:00Z","strings":[{"name":"south",
        "moduleType":1,"device":1,"input":2,"modules":16,"optimized":0,"tilt":35,"azimuth":0,
        "loss":2}]}"#;
    let (status, response) = request(address, "PUT", "/api/v1/layout", &headers, layout).await;
    assert_eq!(status, 200, "{response}");
    stop.send(()).unwrap();
    core.await.unwrap().unwrap();
    while device.reads.try_recv().is_ok() {}

    let (_, stop, core) = start(dir.path());
    let read = tokio::time::timeout(Duration::from_secs(10), device.reads.recv()).await;

    let read = read.unwrap().unwrap();
    // A fresh connection: the first core's was the device's first.
    assert_eq!((read.connection, read.unit), (1, 0));
    stop.send(()).unwrap();
    core.await.unwrap().unwrap();
}
