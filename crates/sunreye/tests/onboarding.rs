//! A device is onboarded over HTTP against the simulator; the saved settings and the readings survive
//! a restart of the binary.

#![allow(clippy::expect_used, reason = "helpers outside #[test] fns may panic like the tests")]

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use serde_json::{Value, json};
use sunreye::store::Store;
use sunreye_sim::profile_case;

mod support;
use support::Sim;

const BIN: &str = env!("CARGO_BIN_EXE_sunreye");
const PROFILE: &str = "deye-sg01hp3";

/// The port in a "sunreye listening" log line, through the colour codes around it.
fn listening_port(line: &str) -> u16 {
    let after = line.split("127.0.0.1:").nth(1).expect("an address in the line");
    let digits: String = after.chars().take_while(char::is_ascii_digit).collect();
    digits.parse().expect("a port")
}

struct Reply {
    status: u16,
    /// `name=value` of a cookie the reply set.
    cookie: Option<String>,
    body: String,
}

/// One request with `connection: close`, sent as the SPA on the core's own origin sends it.
fn http(addr: SocketAddr, method: &str, path: &str, body: Option<&str>, cookie: &str) -> Reply {
    let mut stream = TcpStream::connect(addr).expect("connect");
    let body = body.unwrap_or_default();
    let request = format!(
        "{method} {path} HTTP/1.1\r\nhost: sunreye\r\norigin: http://sunreye\r\ncookie: {cookie}\r\nconnection: close\r\ncontent-type: application/json\r\ncontent-length: {}\r\n\r\n{body}",
        body.len()
    );
    stream.write_all(request.as_bytes()).expect("send");
    let mut reply = String::new();
    stream.read_to_string(&mut reply).expect("reply");
    let status = reply.split_whitespace().nth(1).and_then(|code| code.parse().ok()).expect("a status");
    let (head, body) = reply.split_once("\r\n\r\n").unwrap_or((&reply, ""));
    let cookie = head
        .lines()
        .find_map(|line| line.strip_prefix("set-cookie: "))
        .and_then(|value| value.split(';').next())
        .map(str::to_owned);
    Reply { status, cookie, body: body.to_owned() }
}

struct Running {
    child: Child,
    addr: SocketAddr,
}

fn start(dir: &Path) -> Running {
    let mut child = Command::new(BIN)
        .args(["--listen", "127.0.0.1:0", "--log-level", "info", "--data-dir"])
        .arg(dir)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn sunreye");
    let mut lines = BufReader::new(child.stderr.take().expect("piped stderr")).lines();
    let listening = lines
        .by_ref()
        .map(|line| line.expect("readable"))
        .find(|line| line.contains("sunreye listening"))
        .expect("a listening line");
    // The pipe stays open under the process: its reader is parked, not dropped.
    std::thread::spawn(move || lines.for_each(drop));
    let addr = SocketAddr::from(([127, 0, 0, 1], listening_port(&listening)));
    Running { child, addr }
}

fn stop(mut running: Running) {
    let pid = running.child.id().to_string();
    assert!(Command::new("kill").args(["-TERM", &pid]).status().expect("kill").success());
    assert!(running.child.wait().expect("wait").success(), "SIGTERM is a clean exit");
}

fn data_dir() -> PathBuf {
    let dir = Path::new(env!("CARGO_TARGET_TMPDIR")).join(format!("onboarding-{}", std::process::id()));
    drop(std::fs::remove_dir_all(&dir));
    dir
}

/// The request runs off the runtime thread: the simulator it talks to lives on it.
async fn call(
    addr: SocketAddr,
    cookie: &str,
    method: &'static str,
    path: &'static str,
    body: Option<&Value>,
) -> (u16, Value) {
    let reply = send(addr, cookie, method, path, body).await;
    (reply.status, serde_json::from_str(&reply.body).expect("a json body"))
}

async fn send(
    addr: SocketAddr,
    cookie: &str,
    method: &'static str,
    path: &'static str,
    body: Option<&Value>,
) -> Reply {
    let body = body.map(Value::to_string);
    let cookie = cookie.to_owned();
    tokio::task::spawn_blocking(move || http(addr, method, path, body.as_deref(), &cookie))
        .await
        .expect("request task")
}

/// Refused before the admin exists, which the first sign-up creates.
async fn sign_up_admin(addr: SocketAddr, test_body: &Value) -> String {
    let refused = send(addr, "", "POST", "/api/settings/inverter/test", Some(test_body)).await;
    assert_eq!(refused.status, 401, "onboarding needs the admin");
    let admin = json!({"email": "admin@example.org", "name": "Admin", "password": "correct horse battery"});
    let signed_up = send(addr, "", "POST", "/api/auth/sign-up", Some(&admin)).await;
    assert_eq!(signed_up.status, 200, "{}", signed_up.body);
    signed_up.cookie.expect("a session cookie")
}

#[tokio::test]
async fn an_onboarded_device_is_polled_and_everything_survives_a_restart() {
    let oracle = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/oracle");
    let case = profile_case(&oracle, PROFILE, "ramp").expect("fixture case");
    let sim = Sim::start(case.registers.clone(), &[1]).await;
    let dir = data_dir();
    let connection = json!({
        "host": "127.0.0.1", "port": sim.addr.port(), "transport": "tcp", "unitId": 1,
        "timeoutMs": 500, "pollIntervalMs": 1000, "simulate": false,
        "loggerSerial": null
    });
    let mut test_body = connection.clone();
    test_body["profileId"] = json!(PROFILE);

    let running = start(&dir);
    let addr = running.addr;
    let cookie = sign_up_admin(addr, &test_body).await;
    let cookie = cookie.as_str();
    let (status, tested) = call(addr, cookie, "POST", "/api/settings/inverter/test", Some(&test_body)).await;
    assert_eq!((status, &tested["ok"]), (200, &json!(true)), "{tested}");
    let one_read = sim.requests().len();
    assert!(one_read > 0, "the test read the simulator");
    let (status, saved) = call(addr, cookie, "PUT", "/api/settings/inverter", Some(&connection)).await;
    assert_eq!((status, &saved), (200, &connection));
    let chosen = json!({"id": PROFILE});
    let (status, _) = call(addr, cookie, "PUT", "/api/settings/active-profile", Some(&chosen)).await;
    assert_eq!(status, 200);

    let deadline = Instant::now() + Duration::from_secs(20);
    while sim.requests().len() < 2 * one_read {
        assert!(Instant::now() < deadline, "saving did not start polling");
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    stop(running);

    let second = start(&dir);
    let (_, inverter) = call(second.addr, cookie, "GET", "/api/settings/inverter", None).await;
    assert_eq!(inverter, connection, "the saved connection and the session are read back");
    let (_, profile) = call(second.addr, "", "GET", "/api/profile-status", None).await;
    assert_eq!(profile, json!({"needsProfile": false, "activeProfileId": PROFILE}));
    stop(second);

    let store = Store::open(&dir).await.expect("store");
    let device = store.devices().await.expect("devices")[0].id;
    let stored = store.readings(device, 0, i64::MAX).await.expect("readings");
    store.close().await;
    assert!(!stored.is_empty(), "the polled readings are stored");
    let want: Vec<(String, f64)> = case.readings.iter().map(|(k, v)| (k.clone(), *v)).collect();
    for sample in &stored {
        let mut got = sample.values.clone();
        got.sort_by(|a, b| a.0.cmp(&b.0));
        assert_eq!(got, want);
    }
    drop(std::fs::remove_dir_all(&dir));
}

#[tokio::test]
async fn the_running_core_advertises_history_and_profile_sources_and_serves_the_sources_the_spa_then_shows() {
    let dir = Path::new(env!("CARGO_TARGET_TMPDIR")).join(format!("capabilities-{}", std::process::id()));
    drop(std::fs::remove_dir_all(&dir));
    let running = start(&dir);
    let addr = running.addr;
    let cookie = sign_up_admin(addr, &json!({})).await;

    let (status, capabilities) = call(addr, &cookie, "GET", "/api/capabilities", None).await;
    assert_eq!(status, 200);
    assert_eq!(
        capabilities,
        json!({
            "history": true, "statistics": true, "controls": false, "automations": false,
            "restart": false, "profileSources": true, "integrations": false, "pvAndBattery": false,
            "pricesAndCosts": false, "statisticsHeatmap": false, "evccCommands": false, "customCharts": false
        })
    );
    let (status, sources) = call(addr, &cookie, "GET", "/api/settings/profile-sources", None).await;
    assert_eq!((status, &sources), (200, &json!([])), "an advertised area answers");
    stop(running);
    drop(std::fs::remove_dir_all(&dir));
}
