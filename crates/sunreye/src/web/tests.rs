use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use axum::Router;
use axum::body::{Body, to_bytes};
use axum::http::{Method, Request, StatusCode, header};
use serde_json::{Value, json};
use sunreye_sim::{FC_READ_HOLDING, Simulator, profile_case};
use tower::ServiceExt;

use super::*;
use crate::store::Store;

const PROFILE: &str = "deye-sg05lp3";

fn dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("sunreye-web-{name}-{}", std::process::id()));
    drop(std::fs::remove_dir_all(&dir));
    dir
}

async fn open(dir: &Path) -> (Arc<Core>, Router) {
    let core = Core::open(dir).await.expect("core");
    let app = router(Arc::clone(&core));
    (core, app)
}

struct Answer {
    status: StatusCode,
    content_type: String,
    body: Vec<u8>,
}

impl Answer {
    fn json(&self) -> Value {
        serde_json::from_slice(&self.body).unwrap_or_else(|e| panic!("json body: {e}: {:?}", self.body))
    }
}

async fn send(app: &Router, method: Method, path: &str, body: Option<&str>) -> Answer {
    let request = Request::builder()
        .method(method)
        .uri(path)
        .header(header::CONTENT_TYPE, "application/json")
        .body(body.map_or_else(Body::empty, |text| Body::from(text.to_owned())))
        .expect("request");
    let response = app.clone().oneshot(request).await.expect("response");
    let content_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_owned();
    let status = response.status();
    let body = to_bytes(response.into_body(), usize::MAX).await.expect("body").to_vec();
    Answer { status, content_type, body }
}

async fn get(app: &Router, path: &str) -> Answer {
    send(app, Method::GET, path, None).await
}

async fn put(app: &Router, path: &str, body: &Value) -> Answer {
    send(app, Method::PUT, path, Some(&body.to_string())).await
}

async fn post(app: &Router, path: &str, body: &Value) -> Answer {
    send(app, Method::POST, path, Some(&body.to_string())).await
}

fn connection(port: u16) -> Value {
    json!({
        "host": "127.0.0.1", "port": port, "transport": "tcp", "unitId": 1,
        "timeoutMs": 500, "pollIntervalMs": 1000, "simulate": false
    })
}

async fn simulator() -> (Simulator, sunreye_sim::ProfileCase) {
    let oracle = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/oracle");
    let case = profile_case(&oracle, PROFILE, "ramp").expect("case");
    let sim = Simulator::start(case.registers.clone(), &[1]).await.expect("sim");
    (sim, case)
}

async fn wait_until_polled(sim: &Simulator) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while sim.requests().is_empty() {
        assert!(Instant::now() < deadline, "the simulator was never polled");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

async fn unused_port() -> u16 {
    let free = tokio::net::TcpListener::bind("127.0.0.1:0").await.expect("bind");
    free.local_addr().expect("addr").port()
}

#[tokio::test]
async fn a_fresh_core_needs_a_profile_and_no_account() {
    let (core, app) = open(&dir("fresh")).await;
    assert_eq!(get(&app, "/api/setup-status").await.json(), json!({"needsSetup": false}));
    assert_eq!(
        get(&app, "/api/profile-status").await.json(),
        json!({"needsProfile": true, "activeProfileId": null})
    );
    drop(app);
    core.stop().await;
}

#[tokio::test]
async fn capabilities_report_every_unserved_area_absent() {
    let (core, app) = open(&dir("capabilities")).await;
    let answer = get(&app, "/api/capabilities").await;
    assert_eq!(answer.status, StatusCode::OK);
    assert_eq!(
        answer.json(),
        json!({
            "history": false, "statistics": false, "controls": false, "automations": false,
            "restart": false, "profileSources": false
        })
    );
    drop(app);
    core.stop().await;
}

#[tokio::test]
async fn every_bundled_profile_is_listed_and_the_chosen_one_is_active() {
    let (core, app) = open(&dir("profiles")).await;
    let before = get(&app, "/api/profiles").await.json();
    let listed = before.as_array().expect("array");
    assert_eq!(listed.len(), core.bundle.profiles.len());
    assert!(listed.iter().all(|p| p["active"] == false && p["builtin"] == true && p["installed"] == false));

    let chosen = put(&app, "/api/settings/active-profile", &json!({"id": PROFILE})).await;
    assert_eq!(chosen.status, StatusCode::OK);
    assert_eq!(chosen.json(), json!({"id": PROFILE, "restartRequired": false}));

    let after = get(&app, "/api/profiles").await.json();
    let active: Vec<_> = after.as_array().expect("array").iter().filter(|p| p["active"] == true).collect();
    assert_eq!(active.len(), 1);
    assert_eq!(active[0]["id"], PROFILE);
    assert_eq!(
        get(&app, "/api/profile-status").await.json(),
        json!({"needsProfile": false, "activeProfileId": PROFILE})
    );
    drop(app);
    core.stop().await;
}

#[tokio::test]
async fn an_unknown_profile_or_a_malformed_body_is_a_400_with_the_error_shape() {
    let (core, app) = open(&dir("refused-profile")).await;
    let unknown = put(&app, "/api/settings/active-profile", &json!({"id": "no-such"})).await;
    assert_eq!(unknown.status, StatusCode::BAD_REQUEST);
    assert_eq!(unknown.json(), json!({"error": "Unknown profile \"no-such\""}));
    for body in ["{}", "not json", r#"{"id": 5}"#] {
        let answer = send(&app, Method::PUT, "/api/settings/active-profile", Some(body)).await;
        assert_eq!(answer.status, StatusCode::BAD_REQUEST, "{body}");
        assert!(answer.json()["error"].as_str().is_some_and(|e| !e.is_empty()), "{body}");
    }
    assert_eq!(get(&app, "/api/profile-status").await.json()["needsProfile"], true);
    drop(app);
    core.stop().await;
}

#[tokio::test]
async fn an_unconfigured_connection_reads_as_the_defaults() {
    let (core, app) = open(&dir("defaults")).await;
    let answer = get(&app, "/api/settings/inverter").await;
    assert_eq!(answer.status, StatusCode::OK);
    assert_eq!(
        answer.json(),
        json!({
            "host": null, "port": 502, "transport": "tcp", "unitId": 0,
            "timeoutMs": 3000, "pollIntervalMs": 5000, "simulate": false
        })
    );
    drop(app);
    core.stop().await;
}

#[tokio::test]
async fn a_connection_outside_the_accepted_ranges_is_refused_and_nothing_is_saved() {
    let (core, app) = open(&dir("refused-save")).await;
    let cases = [
        (json!({"port": 0}), "Port must be 1–65535"),
        (json!({"unitId": 256}), "Unit id must be 0–255"),
        (json!({"timeoutMs": 50}), "Timeout must be 100–60000 ms"),
        (json!({"pollIntervalMs": 500}), "Poll interval must be 1000–3600000 ms"),
        (json!({"host": ""}), "Host is required"),
        (json!({"simulate": true}), "Simulation is not available in this core"),
        (json!({"transport": "solarman-v5"}), "Only the tcp transport is supported"),
    ];
    for (change, message) in cases {
        let mut body = connection(502);
        body.as_object_mut().expect("object").extend(change.as_object().expect("object").clone());
        let answer = put(&app, "/api/settings/inverter", &body).await;
        assert_eq!(answer.status, StatusCode::BAD_REQUEST, "{message}");
        assert_eq!(answer.json(), json!({"error": message}));
    }
    let missing = put(&app, "/api/settings/inverter", &json!({"host": "h"})).await;
    assert_eq!(missing.status, StatusCode::BAD_REQUEST, "a body without the other fields");
    assert_eq!(get(&app, "/api/settings/inverter").await.json()["host"], Value::Null);
    drop(app);
    core.stop().await;
}

#[tokio::test]
async fn a_saved_connection_and_profile_survive_a_restart_and_are_polled_again() {
    let (sim, case) = simulator().await;
    let dir = dir("restart");
    let (core, app) = open(&dir).await;
    let saved = put(&app, "/api/settings/inverter", &connection(sim.addr.port())).await;
    assert_eq!(saved.status, StatusCode::OK);
    assert_eq!(saved.json(), connection(sim.addr.port()));
    put(&app, "/api/settings/active-profile", &json!({"id": PROFILE})).await;
    wait_until_polled(&sim).await;
    drop(app);
    core.stop().await;

    let (core, app) = open(&dir).await;
    assert_eq!(get(&app, "/api/settings/inverter").await.json(), connection(sim.addr.port()));
    assert_eq!(get(&app, "/api/profile-status").await.json()["activeProfileId"], PROFILE);
    drop(app);
    core.stop().await;

    let store = Store::open(&dir).await.expect("store");
    let devices = store.devices().await.expect("devices");
    assert_eq!(devices.len(), 1);
    let stored = store.readings(devices[0].id, 0, i64::MAX).await.expect("readings");
    store.close().await;
    assert!(!stored.is_empty(), "the stop stored the minute in progress");
    let want: Vec<(String, f64)> = case.readings.into_iter().collect();
    for sample in stored {
        let mut got = sample.values;
        got.sort_by(|a, b| a.0.cmp(&b.0));
        assert_eq!(got, want);
    }
    assert!(sim.requests().iter().all(|r| r.function == FC_READ_HOLDING), "onboarding only reads");
    drop(std::fs::remove_dir_all(&dir));
}

#[tokio::test]
async fn saving_the_last_of_connection_and_profile_starts_polling() {
    let (sim, _) = simulator().await;
    let (core, app) = open(&dir("starts")).await;
    put(&app, "/api/settings/inverter", &connection(sim.addr.port())).await;
    tokio::time::sleep(Duration::from_millis(150)).await;
    assert_eq!(sim.requests().len(), 0, "a connection without a profile polls nothing");

    put(&app, "/api/settings/active-profile", &json!({"id": PROFILE})).await;
    wait_until_polled(&sim).await;
    drop(app);
    core.stop().await;
}

#[tokio::test]
async fn the_connection_test_reads_the_simulator_with_the_chosen_profile() {
    let (sim, case) = simulator().await;
    let (core, app) = open(&dir("test-ok")).await;
    let mut body = connection(sim.addr.port());
    body["profileId"] = json!(PROFILE);
    let answer = post(&app, "/api/settings/inverter/test", &body).await;
    assert_eq!(answer.status, StatusCode::OK);
    let result = answer.json();
    assert_eq!(result["ok"], true);
    assert_eq!(result["metricCount"], case.readings.len());
    assert_eq!(result["metrics"].as_array().expect("metrics").len(), case.readings.len());
    assert!(result["durationMs"].is_u64());
    assert_eq!(get(&app, "/api/settings/inverter").await.json()["host"], Value::Null, "a test saves nothing");
    drop(app);
    core.stop().await;
}

#[tokio::test]
async fn the_connection_test_uses_the_active_profile_when_none_is_named() {
    let (sim, _) = simulator().await;
    let (core, app) = open(&dir("test-active")).await;
    let body = connection(sim.addr.port());
    let without = post(&app, "/api/settings/inverter/test", &body).await.json();
    assert_eq!(without, json!({"ok": false, "error": "No profile selected"}));
    put(&app, "/api/settings/active-profile", &json!({"id": PROFILE})).await;
    assert_eq!(post(&app, "/api/settings/inverter/test", &body).await.json()["ok"], true);
    drop(app);
    core.stop().await;
}

#[tokio::test]
async fn the_connection_test_fails_for_an_unreachable_device_and_an_unknown_profile() {
    let (core, app) = open(&dir("test-fail")).await;
    let mut body = connection(unused_port().await);
    body["profileId"] = json!(PROFILE);
    let down = post(&app, "/api/settings/inverter/test", &body).await;
    assert_eq!(down.status, StatusCode::OK, "an unreachable device is a result, not a bad request");
    let result = down.json();
    assert_eq!(result["ok"], false);
    assert!(result["error"].as_str().is_some_and(|e| !e.is_empty()));
    assert!(result.get("metrics").is_none());

    body["profileId"] = json!("no-such");
    let unknown = post(&app, "/api/settings/inverter/test", &body).await.json();
    assert_eq!(unknown, json!({"ok": false, "error": "Unknown profile \"no-such\""}));

    body["port"] = json!(0);
    let invalid = post(&app, "/api/settings/inverter/test", &body).await;
    assert_eq!(invalid.status, StatusCode::BAD_REQUEST);
    assert_eq!(invalid.json(), json!({"error": "Port must be 1–65535"}));
    drop(app);
    core.stop().await;
}

#[tokio::test]
async fn the_spa_shell_is_served_at_the_root_and_for_its_own_routes() {
    let (core, app) = open(&dir("spa")).await;
    for path in ["/", "/setup", "/settings/devices"] {
        let answer = get(&app, path).await;
        assert_eq!(answer.status, StatusCode::OK, "{path}");
        assert!(answer.content_type.starts_with("text/html"), "{path}: {}", answer.content_type);
    }
    drop(app);
    core.stop().await;
}

#[tokio::test]
async fn unknown_api_paths_and_missing_files_are_404_and_other_methods_on_the_shell_are_405() {
    let (core, app) = open(&dir("spa-404")).await;
    for path in ["/api/nothing", "/openapi/missing", "/_app/gone.js"] {
        assert_eq!(get(&app, path).await.status, StatusCode::NOT_FOUND, "{path}");
    }
    assert_eq!(post(&app, "/", &json!({})).await.status, StatusCode::METHOD_NOT_ALLOWED);
    drop(app);
    core.stop().await;
}

const SERVED: [(&str, &str); 8] = [
    ("get", "/api/capabilities"),
    ("get", "/api/profile-status"),
    ("get", "/api/profiles"),
    ("get", "/api/settings/inverter"),
    ("get", "/api/setup-status"),
    ("post", "/api/settings/inverter/test"),
    ("put", "/api/settings/active-profile"),
    ("put", "/api/settings/inverter"),
];

fn operations(document: &Value) -> Vec<(String, String)> {
    let mut found = Vec::new();
    for (path, item) in document["paths"].as_object().expect("paths") {
        for method in item.as_object().expect("path item").keys() {
            found.push((method.clone(), path.clone()));
        }
    }
    found.sort_by(|a, b| a.1.cmp(&b.1).then_with(|| a.0.cmp(&b.0)));
    found
}

#[tokio::test]
async fn the_openapi_document_lists_every_route_served_and_each_answers() {
    let (core, app) = open(&dir("openapi")).await;
    let served = get(&app, "/openapi/json").await;
    assert_eq!(served.status, StatusCode::OK);
    let document = served.json();
    assert_eq!(document, serde_json::to_value(openapi()).expect("document"));

    let mut want: Vec<(String, String)> =
        SERVED.iter().map(|(method, path)| ((*method).to_owned(), (*path).to_owned())).collect();
    want.sort_by(|a, b| a.1.cmp(&b.1).then_with(|| a.0.cmp(&b.0)));
    assert_eq!(operations(&document), want);

    for (method, path) in &want {
        let method = Method::from_bytes(method.to_uppercase().as_bytes()).expect("method");
        let answer = send(&app, method, path, Some("{}")).await;
        assert!(
            answer.status != StatusCode::NOT_FOUND && answer.status != StatusCode::METHOD_NOT_ALLOWED,
            "{path}"
        );
    }
    drop(app);
    core.stop().await;
}

#[test]
fn the_committed_openapi_json_is_the_document_the_core_serves() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("openapi_snapshot.json");
    let current = serde_json::to_string_pretty(&openapi()).expect("document") + "\n";
    if std::env::var_os("UPDATE_OPENAPI").is_some() {
        std::fs::write(&path, &current).expect("write openapi_snapshot.json");
    }
    let committed = std::fs::read_to_string(&path).expect("crates/sunreye/openapi_snapshot.json");
    assert!(
        committed == current,
        "openapi_snapshot.json is stale: UPDATE_OPENAPI=1 cargo test -p sunreye openapi, then bun run --cwd apps/web gen:core-api"
    );
}
