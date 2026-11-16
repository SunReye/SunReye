//! Startup options, and the core served over TCP.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;

use super::{Boot, Options, serve};
use crate::location::Location;
use crate::spot::{self, BiddingZone};
use crate::weather::Slot;
use crate::weather::fake::{Fake, FakeArchive};

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

/// A core in `data_dir` whose weather provider, archive and spot-price provider answer nothing.
fn boot(
    data_dir: &std::path::Path,
    ingress: Option<std::net::IpAddr>,
    build: SystemTime,
) -> Boot<Fake, FakeArchive, spot::fake::Fake> {
    Boot {
        data_dir: data_dir.to_owned(),
        share: data_dir.join("share"),
        ingress,
        build,
        weather: Fake::new(Vec::new(), &[]).0,
        archive: FakeArchive::new(Vec::new()).0,
        spot: spot::fake::Fake::new(Vec::new(), &[]).0,
        fetch: crate::profiles::fake::Host::new(),
        keys: None,
        logs: crate::logs::Logs::default(),
    }
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
    let core = tokio::spawn(serve(listener, boot(dir.path(), None, build), async {
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
        boot(dir.path(), ingress, SystemTime::UNIX_EPOCH),
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

/// Starts the core on a free port with `weather` as its weather provider and `archive` as its
/// archive; returns its address and the sender that stops it.
fn start(
    data_dir: &std::path::Path,
    weather: Fake,
    archive: FakeArchive,
) -> (
    SocketAddr,
    oneshot::Sender<()>,
    tokio::task::JoinHandle<Result<(), super::Error>>,
) {
    start_with(Boot {
        weather,
        archive,
        ..boot(data_dir, None, SystemTime::UNIX_EPOCH)
    })
}

/// Starts the core from `boot` on a free port; returns its address and the sender that stops it.
fn start_with(
    boot: Boot<Fake, FakeArchive, spot::fake::Fake>,
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
    let core = tokio::spawn(serve(listener, boot, async {
        stopped.await.ok();
    }));
    (address, stop, core)
}

/// Sets up the admin and wires a string to a Deye, device 1, behind `device`; returns the
/// headers of a signed-in JSON request.
async fn configure(address: SocketAddr, device: SocketAddr) -> String {
    let json = "Content-Type: application/json\r\n";
    let password = r#"{"password":"correct horse"}"#;
    request(address, "POST", "/api/v1/setup", json, password).await;
    let (_, response) = request(address, "POST", "/api/v1/login", json, password).await;
    let headers = format!("Cookie: {}\r\n{json}", session_cookie(&response));
    let port = device.port();
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
    headers
}

#[tokio::test]
async fn configured_devices_are_polled_from_boot_and_strings_wire_to_their_inverters() {
    let dir = tempfile::tempdir().unwrap();
    let mut device = crate::transport::fake::serve().await;
    let (address, stop, core) = start(
        dir.path(),
        Fake::new(Vec::new(), &[]).0,
        FakeArchive::new(Vec::new()).0,
    );
    configure(address, device.address).await;
    stop.send(()).unwrap();
    core.await.unwrap().unwrap();
    while device.reads.try_recv().is_ok() {}

    let (_, stop, core) = start(
        dir.path(),
        Fake::new(Vec::new(), &[]).0,
        FakeArchive::new(Vec::new()).0,
    );
    let read = tokio::time::timeout(Duration::from_secs(10), device.reads.recv()).await;

    let read = read.unwrap().unwrap();
    // A fresh connection: the first core's was the device's first.
    assert_eq!((read.connection, read.unit), (1, 0));
    stop.send(()).unwrap();
    core.await.unwrap().unwrap();
}

/// Two quarter hours of weather from the next quarter hour on.
fn weather() -> Vec<Slot> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let first = now - now % 900 + 900;
    [first, first + 900]
        .map(|seconds| Slot {
            target: UNIX_EPOCH + Duration::from_secs(seconds),
            ghi: 500.0,
            dni: 400.0,
            dhi: 100.0,
            temperature: 10.0,
            wind: Some(2.0),
        })
        .to_vec()
}

/// The targets of device 1's `pv.power` forecast over the next day.
async fn solar_targets(address: SocketAddr, headers: &str) -> usize {
    let now = jiff::Timestamp::now();
    let path = format!(
        "/api/v1/devices/1/forecasts?series=pv.power&from={now}&to={}",
        now + jiff::SignedDuration::from_hours(24)
    );
    let (status, response) = request(address, "GET", &path, headers, "").await;
    assert_eq!(status, 200, "{response}");
    response.matches("\"target\"").count()
}

#[tokio::test]
async fn weather_the_solar_forecast_and_learning_run_from_boot_once_the_plant_has_a_location() {
    let dir = tempfile::tempdir().unwrap();
    let device = crate::transport::fake::serve().await;
    let (fake, mut calls) = Fake::new(weather(), &[]);
    let (archive, mut past) = FakeArchive::new(Vec::new());
    let (address, stop, core) = start(dir.path(), fake, archive);
    let headers = configure(address, device.address).await;
    assert!(calls.try_recv().is_err(), "fetched without a location");
    assert!(past.try_recv().is_err(), "learned without a location");

    let berlin = r#"{"latitude":52.5163,"longitude":13.3777}"#;
    let (status, _) = request(address, "PUT", "/api/v1/location", &headers, berlin).await;

    assert_eq!(status, 200);
    let rounded = Location {
        latitude: 52.52,
        longitude: 13.38,
    };
    let fetched = tokio::time::timeout(Duration::from_secs(10), calls.recv()).await;
    assert_eq!(fetched.unwrap().unwrap().1, rounded);
    let learned = tokio::time::timeout(Duration::from_secs(10), past.recv()).await;
    assert_eq!(learned.unwrap().unwrap().1, rounded);
    let solar = async {
        while solar_targets(address, &headers).await < 2 {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    };
    tokio::time::timeout(Duration::from_secs(10), solar)
        .await
        .unwrap();
    stop.send(()).unwrap();
    core.await.unwrap().unwrap();

    let (fake, mut calls) = Fake::new(weather(), &[]);
    let (_, stop, core) = start(dir.path(), fake, FakeArchive::new(Vec::new()).0);
    let fetched = tokio::time::timeout(Duration::from_secs(10), calls.recv()).await;

    assert_eq!(fetched.unwrap().unwrap().1, rounded);
    stop.send(()).unwrap();
    core.await.unwrap().unwrap();
}

/// The spot-price targets stored for the current quarter hour.
async fn spot_targets(address: SocketAddr, headers: &str) -> usize {
    let now = jiff::Timestamp::now();
    let path = format!(
        "/api/v1/devices/{}/forecasts?series=price.spot&from={}&to={}",
        spot::DEVICE.0,
        now - jiff::SignedDuration::from_mins(15),
        now + jiff::SignedDuration::from_mins(15)
    );
    let (status, response) = request(address, "GET", &path, headers, "").await;
    assert_eq!(status, 200, "{response}");
    response.matches("\"target\"").count()
}

#[tokio::test]
async fn spot_prices_are_fetched_from_boot_once_the_admin_chooses_a_bidding_zone() {
    let dir = tempfile::tempdir().unwrap();
    let device = crate::transport::fake::serve().await;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let price = spot::Slot {
        start: UNIX_EPOCH + Duration::from_secs(now - now % 900),
        price: 0.1,
    };
    let (fake, mut calls) = spot::fake::Fake::new(vec![price], &[]);
    let (address, stop, core) = start_with(Boot {
        spot: fake,
        ..boot(dir.path(), None, UNIX_EPOCH)
    });
    let headers = configure(address, device.address).await;
    assert!(calls.try_recv().is_err(), "fetched without a bidding zone");

    let de_lu = r#"{"zone":"DE-LU"}"#;
    let (status, _) = request(address, "PUT", "/api/v1/spot-prices", &headers, de_lu).await;

    assert_eq!(status, 200);
    let fetched = tokio::time::timeout(Duration::from_secs(10), calls.recv()).await;
    assert_eq!(fetched.unwrap().unwrap().1, BiddingZone::DeLu);
    let stored = async {
        while spot_targets(address, &headers).await < 1 {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    };
    tokio::time::timeout(Duration::from_secs(10), stored)
        .await
        .unwrap();
    stop.send(()).unwrap();
    core.await.unwrap().unwrap();

    let (fake, mut calls) = spot::fake::Fake::new(Vec::new(), &[]);
    let (_, stop, core) = start_with(Boot {
        spot: fake,
        ..boot(dir.path(), None, UNIX_EPOCH)
    });
    let fetched = tokio::time::timeout(Duration::from_secs(10), calls.recv()).await;

    assert_eq!(fetched.unwrap().unwrap().1, BiddingZone::DeLu);
    stop.send(()).unwrap();
    core.await.unwrap().unwrap();
}

/// The permission bits of `path`.
fn mode(path: &std::path::Path) -> u32 {
    use std::os::unix::fs::PermissionsExt as _;
    std::fs::metadata(path).unwrap().permissions().mode() & 0o777
}

#[tokio::test]
async fn the_data_directory_and_its_database_are_the_cores_alone() {
    use std::os::unix::fs::PermissionsExt as _;
    let dir = tempfile::tempdir().unwrap();
    let data = dir.path().join("data");
    // Left open by an earlier build or by hand: the core closes them.
    std::fs::create_dir(&data).unwrap();
    std::fs::set_permissions(&data, std::fs::Permissions::from_mode(0o755)).unwrap();
    let file = data.join("core.sqlite");
    std::fs::write(&file, "").unwrap();
    std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o644)).unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let (stop, stopped) = oneshot::channel::<()>();
    let core = tokio::spawn(serve(listener, boot(&data, None, UNIX_EPOCH), async {
        stopped.await.ok();
    }));
    let json = "Content-Type: application/json\r\n";
    let password = r#"{"password":"correct horse"}"#;
    let (status, _) = request(address, "POST", "/api/v1/setup", json, password).await;
    assert_eq!(status, 204);

    let wal = data.join("core.sqlite-wal");
    assert_eq!(
        (mode(&data), mode(&file), mode(&wal)),
        (0o700, 0o600, 0o600)
    );

    stop.send(()).unwrap();
    core.await.unwrap().unwrap();
}

#[tokio::test]
async fn a_second_core_on_the_same_data_directory_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let (stop, stopped) = oneshot::channel::<()>();
    let core = tokio::spawn(serve(listener, boot(dir.path(), None, UNIX_EPOCH), async {
        stopped.await.ok();
    }));
    let json = "Content-Type: application/json\r\n";
    let password = r#"{"password":"correct horse"}"#;
    let (status, _) = request(address, "POST", "/api/v1/setup", json, password).await;
    assert_eq!(status, 204);

    let second = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let refused = serve(second, boot(dir.path(), None, UNIX_EPOCH), async {}).await;

    assert!(matches!(refused, Err(super::Error::Running)), "{refused:?}");
    stop.send(()).unwrap();
    core.await.unwrap().unwrap();
}

/// Every log line, as the core writes them to stderr.
#[derive(Clone, Default)]
struct Lines(std::sync::Arc<std::sync::Mutex<Vec<u8>>>);

impl std::io::Write for Lines {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        crate::lock(&self.0).extend_from_slice(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

/// `bytes` as lowercase hex, and as base64 in the standard and the URL alphabet, unpadded.
fn spellings(bytes: &[u8]) -> [String; 3] {
    use std::fmt::Write as _;
    const STANDARD: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let hex = bytes.iter().fold(String::new(), |mut hex, b| {
        write!(hex, "{b:02x}").unwrap();
        hex
    });
    let mut base64 = String::new();
    for chunk in bytes.chunks(3) {
        let n = chunk
            .iter()
            .enumerate()
            .fold(0u32, |n, (i, &b)| n | u32::from(b) << (16 - 8 * i));
        for i in 0..=chunk.len() {
            base64.push(char::from(STANDARD[(n >> (18 - 6 * i) & 63) as usize]));
        }
    }
    let url = base64.replace('+', "-").replace('/', "_");
    [hex, base64, url]
}

/// Sets the admin up, signs in and answers every GET route the core's document lists without a
/// path parameter; returns each response.
async fn sweep(address: SocketAddr) -> Vec<(u16, String)> {
    let json = "Content-Type: application/json\r\n";
    let password = r#"{"password":"correct horse"}"#;
    let mut responses = vec![request(address, "POST", "/api/v1/setup", json, password).await];
    let login = request(address, "POST", "/api/v1/login", json, password).await;
    let cookie = format!("Cookie: {}\r\n", session_cookie(&login.1));
    let (_, document) = request(address, "GET", "/openapi.json", "", "").await;
    let document: serde_json::Value =
        serde_json::from_str(&document[document.find("\r\n\r\n").unwrap() + 4..]).unwrap();
    // The live stream never ends, and carries readings only.
    let paths = document["paths"]
        .as_object()
        .unwrap()
        .iter()
        .filter(|(path, item)| {
            item.get("get").is_some() && !path.contains('{') && *path != "/api/v1/live"
        });
    for (path, _) in paths {
        responses.push(request(address, "GET", path, &cookie, "").await);
    }
    responses.push(login);
    responses
}

#[tokio::test]
async fn the_first_run_creates_a_static_key_that_no_response_or_log_line_holds() {
    use tracing_subscriber::util::SubscriberInitExt as _;
    let lines = Lines::default();
    let writer = lines.clone();
    let _logging = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::TRACE)
        .with_writer(move || writer.clone())
        .finish()
        .set_default();
    tracing::trace!("capturing");
    let dir = tempfile::tempdir().unwrap();
    let (address, stop, core) = start(
        dir.path(),
        Fake::new(Vec::new(), &[]).0,
        FakeArchive::new(Vec::new()).0,
    );

    let responses = sweep(address).await;
    stop.send(()).unwrap();
    core.await.unwrap().unwrap();

    let db = rusqlite::Connection::open(dir.path().join("core.sqlite")).unwrap();
    let key: Vec<u8> = db
        .query_row("SELECT static_key FROM identity", [], |row| row.get(0))
        .unwrap();
    assert_eq!(key.len(), 32);
    assert!(responses.len() > 20, "{}", responses.len());
    assert!(
        responses.iter().all(|(status, _)| *status < 500),
        "{responses:?}"
    );
    let logged = lines.0.lock().unwrap().clone();
    assert!(String::from_utf8_lossy(&logged).contains("capturing"));
    let seen: Vec<&[u8]> = responses
        .iter()
        .map(|(_, response)| response.as_bytes())
        .chain([logged.as_slice()])
        .collect();
    let holds = |text: &[u8], value: &[u8]| text.windows(value.len()).any(|w| w == value);
    for spelling in spellings(&key) {
        assert!(
            seen.iter().all(|text| !holds(text, spelling.as_bytes())),
            "{spelling}"
        );
    }
    assert!(seen.iter().all(|text| !holds(text, &key)));
}
