use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use axum::Router;
use axum::body::{Body, to_bytes};
use axum::http::{Method, Request, StatusCode, header};
use serde_json::{Value, json};
use sunreye_sim::{FC_READ_HOLDING, Simulator, profile_case};
use tower::ServiceExt;

use super::*;
use crate::store::{NewAccount, Store};

#[path = "../../tests/support/mod.rs"]
mod support;
use support::{Ca, Site, official_files, serve_site, site};

const PROFILE: &str = "deye-sg05lp3";

fn dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("sunreye-web-{name}-{}", std::process::id()));
    drop(std::fs::remove_dir_all(&dir));
    dir
}

const ADMIN_EMAIL: &str = "admin@example.org";
const ADMIN_PASSWORD: &str = "correct horse battery";
const HOST: &str = "sunreye.lan";
const SAME_ORIGIN: &str = "http://sunreye.lan";

/// The router as one browser sees it: the session cookie it holds, sent with the page's own Origin.
#[derive(Clone)]
struct Api {
    router: Router,
    cookie: Option<String>,
}

impl Api {
    fn anonymous(&self) -> Self {
        Self { router: self.router.clone(), cookie: None }
    }

    fn with_cookie(&self, cookie: &str) -> Self {
        Self { router: self.router.clone(), cookie: Some(cookie.to_owned()) }
    }
}

/// A core whose admin is signed in: created on a fresh store, logged in on a reopened one.
async fn open(dir: &Path) -> (Arc<Core>, Api) {
    open_with(dir, &Config::default()).await
}

async fn open_with(dir: &Path, config: &Config) -> (Arc<Core>, Api) {
    signed_in(Core::open(dir).await.expect("core"), config).await
}

/// A core that also trusts `ca`, as its profile sources are served by a local HTTPS server.
async fn open_trusting(dir: &Path, ca: &Ca) -> (Arc<Core>, Api) {
    let core = Core::open_trusting(dir, vec![ca.root()]).await.expect("core");
    signed_in(core, &Config::default()).await
}

async fn signed_in(core: Arc<Core>, config: &Config) -> (Arc<Core>, Api) {
    let api = Api { router: router(Arc::clone(&core), config), cookie: None };
    let mut answer = sign_up(&api, ADMIN_EMAIL, ADMIN_PASSWORD).await;
    if answer.status == StatusCode::FORBIDDEN {
        answer = login(&api, ADMIN_EMAIL, ADMIN_PASSWORD, false).await;
    }
    assert_eq!(answer.status, StatusCode::OK, "admin session");
    let cookie = answer.session_cookie();
    (core, api.with_cookie(&cookie))
}

async fn sign_up(api: &Api, email: &str, password: &str) -> Answer {
    post(api, "/api/auth/sign-up", &json!({"email": email, "name": "Admin", "password": password})).await
}

async fn login(api: &Api, email: &str, password: &str, remember_me: bool) -> Answer {
    let body = json!({"email": email, "password": password, "rememberMe": remember_me});
    post(api, "/api/auth/login", &body).await
}

struct Answer {
    status: StatusCode,
    content_type: String,
    set_cookie: Option<String>,
    body: Vec<u8>,
}

impl Answer {
    fn json(&self) -> Value {
        serde_json::from_slice(&self.body).unwrap_or_else(|e| panic!("json body: {e}: {:?}", self.body))
    }

    /// `name=value` of the cookie this answer set.
    fn session_cookie(&self) -> String {
        let header = self.set_cookie.as_deref().expect("a set-cookie header");
        header.split(';').next().expect("name=value").to_owned()
    }
}

async fn send(api: &Api, method: Method, path: &str, body: Option<&str>) -> Answer {
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .header(header::HOST, HOST)
        .header(header::ORIGIN, SAME_ORIGIN)
        .header(header::CONTENT_TYPE, "application/json");
    if let Some(cookie) = &api.cookie {
        request = request.header(header::COOKIE, cookie);
    }
    let request =
        request.body(body.map_or_else(Body::empty, |text| Body::from(text.to_owned()))).expect("request");
    answer(api.router.clone().oneshot(request).await.expect("response")).await
}

async fn answer(response: Response) -> Answer {
    let header_text =
        |name| response.headers().get(name).and_then(|value| value.to_str().ok()).map(str::to_owned);
    let content_type = header_text(header::CONTENT_TYPE).unwrap_or_default();
    let set_cookie = header_text(header::SET_COOKIE);
    let status = response.status();
    let body = to_bytes(response.into_body(), usize::MAX).await.expect("body").to_vec();
    Answer { status, content_type, set_cookie, body }
}

async fn get(api: &Api, path: &str) -> Answer {
    send(api, Method::GET, path, None).await
}

async fn put(api: &Api, path: &str, body: &Value) -> Answer {
    send(api, Method::PUT, path, Some(&body.to_string())).await
}

async fn post(api: &Api, path: &str, body: &Value) -> Answer {
    send(api, Method::POST, path, Some(&body.to_string())).await
}

async fn delete(api: &Api, path: &str) -> Answer {
    send(api, Method::DELETE, path, None).await
}

fn connection(port: u16) -> Value {
    json!({
        "host": "127.0.0.1", "port": port, "transport": "tcp", "unitId": 1,
        "timeoutMs": 500, "pollIntervalMs": 1000, "simulate": false,
        "loggerSerial": null
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
async fn a_fresh_core_needs_a_profile() {
    let (core, app) = open(&dir("fresh")).await;
    assert_eq!(
        get(&app, "/api/profile-status").await.json(),
        json!({"needsProfile": true, "activeProfileId": null})
    );
    drop(app);
    core.stop().await;
}

#[tokio::test]
async fn capabilities_report_only_profile_sources_served() {
    let (core, app) = open(&dir("capabilities")).await;
    let answer = get(&app, "/api/capabilities").await;
    assert_eq!(answer.status, StatusCode::OK);
    assert_eq!(
        answer.json(),
        json!({
            "history": false, "statistics": false, "controls": false, "automations": false,
            "restart": false, "profileSources": true
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
            "timeoutMs": 3000, "pollIntervalMs": 5000, "simulate": false,
            "loggerSerial": null
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
        (json!({"transport": "solarman-v5", "loggerSerial": 0}), "Logger serial must be 1–4294967295"),
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
async fn each_transport_is_saved_with_its_logger_serial_and_read_back() {
    let (core, app) = open(&dir("transports")).await;
    for change in [
        json!({"transport": "solarman-v5", "port": 8899, "loggerSerial": 3_168_930_341_u32}),
        json!({"transport": "solarman-v5", "port": 8899}),
        json!({"transport": "rtu-over-tcp"}),
        json!({"transport": "tcp"}),
    ] {
        let mut body = connection(502);
        body.as_object_mut().expect("object").extend(change.as_object().expect("object").clone());
        let saved = put(&app, "/api/settings/inverter", &body).await;
        assert_eq!(saved.status, StatusCode::OK, "{change}");
        assert_eq!(saved.json(), body, "{change}");
        assert_eq!(get(&app, "/api/settings/inverter").await.json(), body, "{change}");
    }
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

const SERVED: [(&str, &str); 28] = [
    ("get", "/api/admin/api-keys"),
    ("post", "/api/admin/api-keys"),
    ("post", "/api/admin/api-keys/revoke"),
    ("get", "/api/admin/users"),
    ("post", "/api/admin/users"),
    ("delete", "/api/admin/users/{id}"),
    ("put", "/api/admin/users/{id}/role"),
    ("delete", "/api/auth/session"),
    ("delete", "/api/settings/profile-sources"),
    ("delete", "/api/settings/profiles/{id}"),
    ("get", "/api/auth/session"),
    ("post", "/api/auth/login"),
    ("post", "/api/auth/sign-up"),
    ("get", "/api/capabilities"),
    ("get", "/api/history/recent"),
    ("get", "/api/history/rollup"),
    ("get", "/api/profile"),
    ("get", "/api/profile-status"),
    ("get", "/api/profiles"),
    ("get", "/api/settings/inverter"),
    ("get", "/api/settings/profile-sources"),
    ("get", "/api/setup-status"),
    ("get", "/api/v1/entities"),
    ("post", "/api/settings/inverter/test"),
    ("post", "/api/settings/profile-sources"),
    ("post", "/api/settings/profiles/import"),
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

const ADMIN_ROUTES: [(&str, &str); 17] = [
    ("DELETE", "/api/settings/profiles/acme"),
    ("DELETE", "/api/settings/profile-sources"),
    ("POST", "/api/settings/profiles/import"),
    ("GET", "/api/settings/profile-sources"),
    ("POST", "/api/settings/profile-sources"),
    ("GET", "/api/profiles"),
    ("PUT", "/api/settings/active-profile"),
    ("GET", "/api/settings/inverter"),
    ("PUT", "/api/settings/inverter"),
    ("POST", "/api/settings/inverter/test"),
    ("GET", "/api/admin/users"),
    ("POST", "/api/admin/users"),
    ("PUT", "/api/admin/users/1/role"),
    ("DELETE", "/api/admin/users/1"),
    ("GET", "/api/admin/api-keys"),
    ("POST", "/api/admin/api-keys"),
    ("POST", "/api/admin/api-keys/revoke"),
];

const SESSION_ROUTES: [(&str, &str); 6] = [
    ("GET", "/api/capabilities"),
    ("GET", "/api/profile"),
    ("GET", "/api/history/recent"),
    ("GET", "/api/history/rollup"),
    ("GET", "/api/auth/session"),
    ("DELETE", "/api/auth/session"),
];

async fn call(api: &Api, route: (&str, &str)) -> StatusCode {
    call_for_answer(api, route).await.status
}

async fn call_for_answer(api: &Api, (method, path): (&str, &str)) -> Answer {
    let method = Method::from_bytes(method.as_bytes()).expect("method");
    send(api, method, path, Some(&connection(502).to_string())).await
}

#[tokio::test]
async fn the_first_sign_up_creates_the_admin_signs_it_in_and_closes_sign_up() {
    let core = Core::open(&dir("sign-up")).await.expect("core");
    let api = Api { router: router(Arc::clone(&core), &Config::default()), cookie: None };
    assert_eq!(get(&api, "/api/setup-status").await.json(), json!({"needsSetup": true}));

    let created = sign_up(&api, ADMIN_EMAIL, ADMIN_PASSWORD).await;
    assert_eq!(created.status, StatusCode::OK);
    let account = created.json();
    assert_eq!(
        (&account["email"], &account["name"], &account["admin"]),
        (&json!(ADMIN_EMAIL), &json!("Admin"), &json!(true))
    );
    let header = created.set_cookie.clone().expect("a session cookie");
    assert!(header.contains("HttpOnly") && header.contains("SameSite=Lax"), "{header}");
    assert!(!header.contains("Secure"), "Secure only when configured: {header}");
    let admin = api.with_cookie(&created.session_cookie());
    assert_eq!(get(&admin, "/api/auth/session").await.json(), account);
    assert_eq!(get(&api, "/api/setup-status").await.json(), json!({"needsSetup": false}));

    let second = sign_up(&api, "eve@example.org", "another long password").await;
    assert_eq!(second.status, StatusCode::FORBIDDEN);
    assert_eq!(second.set_cookie, None);
    assert_eq!(
        login(&api, "eve@example.org", "another long password", false).await.status,
        StatusCode::UNAUTHORIZED
    );
    let stored = core.store.account_by_email(ADMIN_EMAIL).await.expect("store").expect("account");
    assert!(stored.password_hash.starts_with("$2b$12$"), "bcrypt, never the password");
    drop((api, admin));
    core.stop().await;
}

#[tokio::test]
async fn a_sign_up_without_an_email_or_a_name_is_a_400() {
    let core = Core::open(&dir("sign-up-invalid")).await.expect("core");
    let api = Api { router: router(Arc::clone(&core), &Config::default()), cookie: None };
    for body in [
        json!({"email": "", "name": "A", "password": ADMIN_PASSWORD}),
        json!({"email": "no-at-sign", "name": "A", "password": ADMIN_PASSWORD}),
        json!({"email": ADMIN_EMAIL, "name": " ", "password": ADMIN_PASSWORD}),
        json!({"email": ADMIN_EMAIL}),
    ] {
        let answer = post(&api, "/api/auth/sign-up", &body).await;
        assert_eq!(answer.status, StatusCode::BAD_REQUEST, "{body}");
        assert!(answer.json()["error"].as_str().is_some_and(|e| !e.is_empty()), "{body}");
    }
    assert_eq!(get(&api, "/api/setup-status").await.json(), json!({"needsSetup": true}));
    drop(api);
    core.stop().await;
}

/// The minimum counts characters; the maximum counts UTF-8 bytes, all bcrypt reads.
#[tokio::test]
async fn a_password_of_8_characters_to_72_bytes_signs_up_and_one_outside_is_a_400() {
    let short = Some("Password must be at least 8 characters");
    let long = Some("Password must be at most 72 bytes");
    let nul = Some("Password must not contain a NUL character");
    let cases = [
        ("7", "x".repeat(7), short),
        ("8", "x".repeat(8), None),
        ("4 two-byte", "é".repeat(4), short),
        ("72", "x".repeat(72), None),
        ("36 two-byte", "é".repeat(36), None),
        ("73", "x".repeat(73), long),
        ("37 two-byte", "é".repeat(37), long),
        ("NUL inside", "abcdefgh\0abcdefgh".to_owned(), nul),
        ("72 ending in NUL", format!("{}\0", "x".repeat(71)), nul),
    ];
    for (name, password, refusal) in cases {
        let core = Core::open(&dir(&format!("password-length-{name}"))).await.expect("core");
        let api = Api { router: router(Arc::clone(&core), &Config::default()), cookie: None };
        let answer = sign_up(&api, ADMIN_EMAIL, &password).await;
        if let Some(message) = refusal {
            assert_eq!(
                (answer.status, answer.json()),
                (StatusCode::BAD_REQUEST, json!({"error": message})),
                "{name}"
            );
        } else {
            assert_eq!(answer.status, StatusCode::OK, "{name}");
            assert_eq!(login(&api, ADMIN_EMAIL, &password, false).await.status, StatusCode::OK, "{name}");
        }
        drop(api);
        core.stop().await;
    }
}

#[tokio::test]
async fn a_wrong_password_or_an_unknown_email_is_refused_without_a_session() {
    let (core, admin) = open(&dir("wrong-password")).await;
    let api = admin.anonymous();
    for (email, password) in
        [(ADMIN_EMAIL, "wrong horse battery"), ("nobody@example.org", ADMIN_PASSWORD), (ADMIN_EMAIL, "")]
    {
        let answer = login(&api, email, password, false).await;
        assert_eq!(answer.status, StatusCode::UNAUTHORIZED, "{email}");
        assert_eq!(answer.json(), json!({"error": "Invalid email or password"}));
        assert_eq!(answer.set_cookie, None, "{email}");
    }
    let differently_cased = login(&api, "ADMIN@example.org", ADMIN_PASSWORD, false).await;
    assert_eq!(differently_cased.status, StatusCode::OK, "emails compare without case");
    drop((api, admin));
    core.stop().await;
}

#[tokio::test]
async fn remember_me_keeps_the_session_for_a_year_and_otherwise_it_ends_with_the_browser() {
    let (core, admin) = open(&dir("remember")).await;
    let api = admin.anonymous();
    let remembered = login(&api, ADMIN_EMAIL, ADMIN_PASSWORD, true).await;
    let header = remembered.set_cookie.clone().expect("cookie");
    assert!(header.contains("Max-Age=31536000"), "{header}");
    let browser_session = login(&api, ADMIN_EMAIL, ADMIN_PASSWORD, false).await;
    let header = browser_session.set_cookie.clone().expect("cookie");
    assert!(!header.contains("Max-Age") && !header.contains("Expires"), "{header}");
    assert_eq!(
        get(&api.with_cookie(&remembered.session_cookie()), "/api/auth/session").await.status,
        StatusCode::OK
    );
    drop((api, admin));
    core.stop().await;
}

#[tokio::test]
async fn logging_in_again_rotates_the_session_id_and_the_old_one_stops_working() {
    let (core, admin) = open(&dir("rotate")).await;
    let old = admin.cookie.clone().expect("cookie");
    let again = login(&admin, ADMIN_EMAIL, ADMIN_PASSWORD, false).await;
    assert_eq!(again.status, StatusCode::OK);
    let new = again.session_cookie();
    assert_ne!(new, old);
    assert_eq!(get(&admin, "/api/auth/session").await.status, StatusCode::UNAUTHORIZED, "the old id");
    assert_eq!(get(&admin.with_cookie(&new), "/api/auth/session").await.status, StatusCode::OK);
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn logging_out_ends_the_session() {
    let (core, admin) = open(&dir("logout")).await;
    let out = delete(&admin, "/api/auth/session").await;
    assert_eq!(out.status, StatusCode::NO_CONTENT);
    assert_eq!(get(&admin, "/api/auth/session").await.status, StatusCode::UNAUTHORIZED);
    assert_eq!(get(&admin, "/api/profiles").await.status, StatusCode::UNAUTHORIZED);
    assert_eq!(delete(&admin.anonymous(), "/api/auth/session").await.status, StatusCode::UNAUTHORIZED);
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn an_expired_session_is_refused() {
    use tower_sessions::SessionStore;
    use tower_sessions::cookie::time::{Duration as Span, OffsetDateTime};
    use tower_sessions::session::Id;

    let (core, admin) = open(&dir("expired")).await;
    let cookie = admin.cookie.clone().expect("cookie");
    let id: Id = cookie.split_once('=').expect("name=value").1.parse().expect("session id");
    let sessions = core.store.sessions();
    let mut record = sessions.load(&id).await.expect("load").expect("a stored session");
    record.expiry_date = OffsetDateTime::now_utc() - Span::seconds(1);
    sessions.save(&record).await.expect("save");

    assert_eq!(get(&admin, "/api/auth/session").await.status, StatusCode::UNAUTHORIZED);
    assert_eq!(get(&admin, "/api/profiles").await.status, StatusCode::UNAUTHORIZED);
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn without_a_session_every_gated_route_is_refused() {
    let (core, admin) = open(&dir("anonymous")).await;
    let api = admin.anonymous();
    for route in ADMIN_ROUTES.into_iter().chain(SESSION_ROUTES) {
        let answer = call_for_answer(&api, route).await;
        assert_eq!(answer.status, StatusCode::UNAUTHORIZED, "{route:?}");
        assert_eq!(answer.json(), json!({"error": "Not signed in"}), "{route:?}");
    }
    for path in ["/api/setup-status", "/api/profile-status"] {
        assert_eq!(get(&api, path).await.status, StatusCode::OK, "{path} is public");
    }
    drop((api, admin));
    core.stop().await;
}

#[tokio::test]
async fn a_plain_user_reaches_the_session_routes_and_is_refused_on_admin_routes() {
    let (core, admin) = open(&dir("plain-user")).await;
    let account = NewAccount {
        email: "user@example.org".into(),
        name: "User".into(),
        password_hash: password::Passwords::new().hash(ADMIN_PASSWORD.into()).await.expect("hash"),
    };
    core.store.add_account(&account, false).await.expect("plain account");
    let signed_in = login(&admin.anonymous(), "user@example.org", ADMIN_PASSWORD, false).await;
    assert_eq!(signed_in.json()["admin"], false);
    let user = admin.with_cookie(&signed_in.session_cookie());
    for route in ADMIN_ROUTES {
        let answer = call_for_answer(&user, route).await;
        assert_eq!(answer.status, StatusCode::FORBIDDEN, "{route:?}");
        assert_eq!(answer.json(), json!({"error": "Admin only"}), "{route:?}");
    }
    assert_eq!(get(&user, "/api/capabilities").await.status, StatusCode::OK);
    assert_eq!(get(&user, "/api/auth/session").await.json()["email"], "user@example.org");
    for route in ADMIN_ROUTES {
        assert_ne!(call(&admin, route).await, StatusCode::FORBIDDEN, "the admin passes {route:?}");
    }
    drop((user, admin));
    core.stop().await;
}

async fn from_origin(
    api: &Api,
    origin: Option<&str>,
    method: Method,
    path: &str,
    body: &Value,
) -> StatusCode {
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .header(header::HOST, HOST)
        .header(header::CONTENT_TYPE, "application/json");
    if let Some(origin) = origin {
        request = request.header(header::ORIGIN, origin);
    }
    if let Some(cookie) = &api.cookie {
        request = request.header(header::COOKIE, cookie);
    }
    let request = request.body(Body::from(body.to_string())).expect("request");
    api.router.clone().oneshot(request).await.expect("response").status()
}

#[tokio::test]
async fn a_state_changing_request_from_an_untrusted_origin_is_refused() {
    let config = Config { trusted_origins: vec!["https://ha.example".into()], secure_cookies: false };
    let (core, admin) = open_with(&dir("origin"), &config).await;
    let choose = json!({"id": PROFILE});
    let write = |origin| from_origin(&admin, origin, Method::PUT, "/api/settings/active-profile", &choose);
    assert_eq!(write(Some("https://evil.example")).await, StatusCode::FORBIDDEN);
    assert_eq!(write(Some("null")).await, StatusCode::FORBIDDEN);
    assert_eq!(write(Some("http://sunreye.lan.evil.example")).await, StatusCode::FORBIDDEN);
    assert_eq!(write(None).await, StatusCode::FORBIDDEN, "a cookie without an Origin");
    assert_eq!(get(&admin, "/api/profile-status").await.json()["needsProfile"], true, "nothing was chosen");
    assert_eq!(write(Some(SAME_ORIGIN)).await, StatusCode::OK);
    assert_eq!(write(Some("https://ha.example")).await, StatusCode::OK, "a configured origin");

    let anonymous = admin.anonymous();
    let credentials = json!({"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD});
    let login_from = |origin| from_origin(&anonymous, origin, Method::POST, "/api/auth/login", &credentials);
    assert_eq!(login_from(Some("https://evil.example")).await, StatusCode::FORBIDDEN);
    assert_eq!(login_from(None).await, StatusCode::OK, "no cookie, no Origin: not a browser");
    let read =
        from_origin(&admin, Some("https://evil.example"), Method::GET, "/api/profiles", &json!({})).await;
    assert_eq!(read, StatusCode::OK, "a read changes nothing");
    drop((anonymous, admin));
    core.stop().await;
}

#[tokio::test]
async fn the_session_cookie_is_secure_when_configured() {
    let config = Config { trusted_origins: Vec::new(), secure_cookies: true };
    let core = Core::open(&dir("secure")).await.expect("core");
    let api = Api { router: router(Arc::clone(&core), &config), cookie: None };
    let header = sign_up(&api, ADMIN_EMAIL, ADMIN_PASSWORD).await.set_cookie.expect("cookie");
    assert!(header.contains("Secure"), "{header}");
    drop(api);
    core.stop().await;
}

/// An official profile under another id, as a third-party source would publish it.
fn third_party(id: &str, official: &str) -> (String, Value) {
    let mut profile = official_files().into_iter().find(|(name, _)| name == official).expect("official").1;
    profile["id"] = json!(id);
    profile["name"] = json!("Acme Hybrid");
    (id.to_owned(), profile)
}

fn source_body(port: u16) -> Value {
    json!({"baseUrl": format!("https://localhost:{port}/repo/"), "indexPath": "index.json"})
}

async fn serve_repo(ca: &Ca, files: &[(String, Value)]) -> u16 {
    serve_site(ca, site(files)).await
}

#[tokio::test]
async fn a_profile_source_is_added_listed_and_its_profiles_appear_beside_the_compiled_in_set() {
    let ca = Ca::new("test root");
    let port = serve_repo(&ca, &[third_party("acme-hybrid", PROFILE)]).await;
    let (core, app) = open_trusting(&dir("source-add"), &ca).await;
    assert_eq!(get(&app, "/api/settings/profile-sources").await.json(), json!([]));

    let added = post(&app, "/api/settings/profile-sources", &source_body(port)).await;
    assert_eq!(added.status, StatusCode::OK, "{:?}", added.json());
    let source = source_body(port);
    let report = json!({
        "baseUrl": source["baseUrl"], "indexPath": "index.json", "profileIds": ["acme-hybrid"], "skipped": []
    });
    assert_eq!(added.json(), report);
    let listed = get(&app, "/api/settings/profile-sources").await.json();
    assert_eq!(
        listed,
        json!([{"baseUrl": source["baseUrl"], "indexPath": "index.json", "profileIds": ["acme-hybrid"]}])
    );

    let profiles = get(&app, "/api/profiles").await.json();
    let profiles = profiles.as_array().expect("array");
    assert_eq!(profiles.len(), core.bundle.profiles.len() + 1);
    let fetched = profiles.iter().find(|p| p["id"] == "acme-hybrid").expect("listed");
    assert_eq!(
        fetched,
        &json!({
            "id": "acme-hybrid", "name": "Acme Hybrid", "manufacturer": "Deye", "active": false,
            "installed": true, "builtin": false
        })
    );
    assert_eq!(profiles.iter().filter(|p| p["builtin"] == true).count(), core.bundle.profiles.len());
    drop(app);
    core.stop().await;
}

#[tokio::test]
async fn added_sources_and_their_profiles_survive_a_restart_and_adding_again_replaces() {
    let ca = Ca::new("test root");
    let port = serve_repo(&ca, &[third_party("acme-hybrid", PROFILE)]).await;
    let dir = dir("source-restart");
    let (core, app) = open_trusting(&dir, &ca).await;
    for _ in 0..2 {
        assert_eq!(
            post(&app, "/api/settings/profile-sources", &source_body(port)).await.status,
            StatusCode::OK
        );
    }
    drop(app);
    core.stop().await;

    let (core, app) = open_trusting(&dir, &ca).await;
    let listed = get(&app, "/api/settings/profile-sources").await.json();
    assert_eq!(listed.as_array().map(Vec::len), Some(1), "one source, fetched twice");
    let chosen = put(&app, "/api/settings/active-profile", &json!({"id": "acme-hybrid"})).await;
    assert_eq!(chosen.status, StatusCode::OK, "a profile from a source can be chosen");
    drop(app);
    core.stop().await;
    drop(std::fs::remove_dir_all(&dir));
}

#[tokio::test]
async fn a_device_is_polled_with_a_profile_from_a_source() {
    let (sim, case) = simulator().await;
    let ca = Ca::new("test root");
    let port = serve_repo(&ca, &[third_party("acme-hybrid", PROFILE)]).await;
    let (core, app) = open_trusting(&dir("source-polls"), &ca).await;
    post(&app, "/api/settings/profile-sources", &source_body(port)).await;
    let mut body = connection(sim.addr.port());
    body["profileId"] = json!("acme-hybrid");
    let tested = post(&app, "/api/settings/inverter/test", &body).await.json();
    assert_eq!(
        (tested["ok"].clone(), tested["metricCount"].clone()),
        (json!(true), json!(case.readings.len()))
    );
    put(&app, "/api/settings/active-profile", &json!({"id": "acme-hybrid"})).await;
    put(&app, "/api/settings/inverter", &connection(sim.addr.port())).await;
    wait_until_polled(&sim).await;
    assert!(sim.requests().iter().all(|r| r.function == FC_READ_HOLDING), "a source only supplies reads");
    drop(app);
    core.stop().await;
}

/// A profile that reads nothing, so a device polled with it sends no request.
fn idle(id: &str) -> crate::sources::Installed {
    let profile =
        json!({"id": id, "name": "Idle", "manufacturer": "Acme", "version": "1.0.0", "metrics": []});
    crate::sources::Installed::validate(profile.to_string()).expect("valid")
}

/// Polls `sim` with the profile `id`, which must already be stored.
async fn poll_with(app: &Api, sim: &Simulator, id: &str) {
    put(app, "/api/settings/active-profile", &json!({"id": id})).await;
    let saved = put(app, "/api/settings/inverter", &connection(sim.addr.port())).await;
    assert_eq!(saved.status, StatusCode::OK);
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(sim.requests().is_empty(), "the stored definition reads nothing");
}

#[tokio::test]
async fn a_re_added_source_replaces_the_definition_the_running_poll_uses() {
    let (sim, _) = simulator().await;
    let ca = Ca::new("test root");
    let port = serve_repo(&ca, &[third_party("acme-hybrid", PROFILE)]).await;
    let (core, app) = open_trusting(&dir("source-replace"), &ca).await;
    let source = crate::sources::Source {
        base_url: format!("https://localhost:{port}/repo/"),
        index_path: "index.json".into(),
    };
    crate::sources::save_source(&core.store, &source, &[idle("acme-hybrid")]).await.expect("save");
    poll_with(&app, &sim, "acme-hybrid").await;

    let added = post(&app, "/api/settings/profile-sources", &source_body(port)).await;
    assert_eq!(added.status, StatusCode::OK, "{:?}", added.json());
    wait_until_polled(&sim).await;
    drop(app);
    core.stop().await;
}

#[tokio::test]
async fn a_source_profile_with_a_compiled_in_id_or_a_broken_file_is_reported_and_skipped() {
    let ca = Ca::new("test root");
    let kept = third_party("acme-hybrid", PROFILE);
    let clash = official_files().into_iter().find(|(id, _)| id == PROFILE).expect("official");
    let mut served: Site = site(&[kept.clone(), clash]);
    served.insert("/repo/profiles/acme-hybrid.json".into(), kept.1.to_string().into_bytes());
    let port = serve_site(&ca, served).await;
    let (core, app) = open_trusting(&dir("source-skips"), &ca).await;
    let added = post(&app, "/api/settings/profile-sources", &source_body(port)).await.json();
    assert_eq!(added["profileIds"], json!(["acme-hybrid"]));
    assert_eq!(
        added["skipped"],
        json!([{"path": format!("profiles/{PROFILE}.json"), "reason": "the id belongs to a compiled-in profile"}])
    );
    let profiles = get(&app, "/api/profiles").await.json();
    assert_eq!(profiles.as_array().expect("array").iter().filter(|p| p["id"] == PROFILE).count(), 1);
    drop(app);
    core.stop().await;
}

#[tokio::test]
async fn a_source_that_cannot_be_used_is_a_400_naming_why_and_stores_nothing() {
    let ca = Ca::new("test root");
    let mut served = site(&[]);
    served.remove("/repo/index.json");
    let port = serve_site(&ca, served).await;
    let (core, app) = open_trusting(&dir("source-refused"), &ca).await;
    let cases = [
        (source_body(port), "cannot fetch the index: status 404"),
        (
            json!({"baseUrl": "http://example.org/", "indexPath": "index.json"}),
            "The base URL must start with https://",
        ),
        (
            json!({"baseUrl": "https://u:p@example.org/", "indexPath": "index.json"}),
            "The base URL needs a host and no credentials, query or fragment",
        ),
        (
            json!({"baseUrl": "https://example.org/a/", "indexPath": "../index.json"}),
            "The index path must stay under the base URL",
        ),
    ];
    for (body, error) in cases {
        let answer = post(&app, "/api/settings/profile-sources", &body).await;
        assert_eq!(answer.status, StatusCode::BAD_REQUEST, "{body}");
        assert_eq!(answer.json(), json!({"error": error}), "{body}");
    }
    let malformed = send(&app, Method::POST, "/api/settings/profile-sources", Some("{}")).await;
    assert_eq!(malformed.status, StatusCode::BAD_REQUEST);
    assert_eq!(get(&app, "/api/settings/profile-sources").await.json(), json!([]));
    drop(app);
    core.stop().await;
}

async fn import(app: &Api, profile: &Value) -> Answer {
    send(app, Method::POST, "/api/settings/profiles/import", Some(&profile.to_string())).await
}

#[tokio::test]
async fn a_fetched_source_and_an_imported_file_are_both_listed_and_either_can_be_chosen() {
    let ca = Ca::new("test root");
    let port = serve_repo(&ca, &[third_party("fetched-hybrid", PROFILE)]).await;
    let (core, app) = open_trusting(&dir("source-and-import"), &ca).await;
    let added = post(&app, "/api/settings/profile-sources", &source_body(port)).await;
    assert_eq!(added.status, StatusCode::OK, "{:?}", added.json());
    let (_, profile) = third_party("imported-hybrid", PROFILE);
    assert_eq!(import(&app, &profile).await.status, StatusCode::OK);

    let listed = get(&app, "/api/profiles").await.json();
    let ids: Vec<&str> = listed.as_array().expect("array").iter().filter_map(|p| p["id"].as_str()).collect();
    assert!(ids.contains(&"fetched-hybrid") && ids.contains(&"imported-hybrid"), "{ids:?}");
    for id in ["fetched-hybrid", "imported-hybrid"] {
        let chosen = put(&app, "/api/settings/active-profile", &json!({"id": id})).await;
        assert_eq!(chosen.status, StatusCode::OK, "{id}: {:?}", chosen.json());
        assert_eq!(get(&app, "/api/profile-status").await.json()["activeProfileId"], id);
    }
    drop(app);
    core.stop().await;
}

#[tokio::test]
async fn an_imported_profile_is_listed_beside_the_compiled_in_set_and_survives_a_restart() {
    let dir = dir("import-restart");
    let (core, app) = open(&dir).await;
    let (_, profile) = third_party("acme-hybrid", PROFILE);
    let imported = import(&app, &profile).await;
    assert_eq!(imported.status, StatusCode::OK, "{:?}", imported.json());
    assert_eq!(imported.json(), json!({"id": "acme-hybrid"}));
    let builtin = core.bundle.profiles.len();
    drop(app);
    core.stop().await;

    let (core, app) = open(&dir).await;
    let profiles = get(&app, "/api/profiles").await.json();
    let profiles = profiles.as_array().expect("array");
    assert_eq!(profiles.len(), builtin + 1);
    let listed = profiles.iter().find(|p| p["id"] == "acme-hybrid").expect("listed");
    assert_eq!((listed["installed"].clone(), listed["builtin"].clone()), (json!(true), json!(false)));
    assert_eq!(get(&app, "/api/settings/profile-sources").await.json(), json!([]), "an import is no source");
    drop(app);
    core.stop().await;
    drop(std::fs::remove_dir_all(&dir));
}

#[tokio::test]
async fn importing_again_replaces_the_definition_the_running_poll_uses() {
    let (sim, _) = simulator().await;
    let (core, app) = open(&dir("import-replace")).await;
    crate::sources::import_profile(&core.store, &idle("acme-hybrid")).await.expect("import");
    poll_with(&app, &sim, "acme-hybrid").await;

    let (_, profile) = third_party("acme-hybrid", PROFILE);
    assert_eq!(import(&app, &profile).await.status, StatusCode::OK);
    wait_until_polled(&sim).await;
    assert!(sim.requests().iter().all(|r| r.function == FC_READ_HOLDING), "an import only supplies reads");
    drop(app);
    core.stop().await;
}

#[tokio::test]
async fn an_invalid_import_is_a_400_naming_the_field_and_stores_nothing() {
    let (core, app) = open(&dir("import-invalid")).await;
    let (_, mut profile) = third_party("acme-hybrid", PROFILE);
    profile["metrics"][1]["scale"] = json!("SECRET-VALUE");
    let answer = import(&app, &profile).await;
    assert_eq!(answer.status, StatusCode::BAD_REQUEST);
    let error = answer.json()["error"].as_str().expect("message").to_owned();
    assert!(error.starts_with("metrics[1].scale: "), "{error}");
    assert!(!error.contains("SECRET-VALUE"), "{error}");

    let (_, mut profile) = third_party("acme-hybrid", PROFILE);
    profile.as_object_mut().expect("object").remove("manufacturer");
    let answer = import(&app, &profile).await;
    assert_eq!(answer.status, StatusCode::BAD_REQUEST);
    assert!(answer.json()["error"].as_str().expect("message").contains("manufacturer"));

    let not_json = send(&app, Method::POST, "/api/settings/profiles/import", Some("<html>")).await;
    assert_eq!(not_json.status, StatusCode::BAD_REQUEST);
    assert!(not_json.json()["error"].as_str().expect("message").starts_with("not JSON: "));

    let profiles = get(&app, "/api/profiles").await.json();
    assert_eq!(profiles.as_array().map(Vec::len), Some(core.bundle.profiles.len()));
    drop(app);
    core.stop().await;
}

#[tokio::test]
async fn an_import_with_a_compiled_in_id_is_refused() {
    let (core, app) = open(&dir("import-clash")).await;
    let mut profile = official_files().into_iter().find(|(id, _)| id == PROFILE).expect("official").1;
    profile["name"] = json!("impostor");
    let answer = import(&app, &profile).await;
    assert_eq!(answer.status, StatusCode::BAD_REQUEST);
    assert_eq!(answer.json(), json!({"error": "the id belongs to a compiled-in profile"}));
    drop(app);
    core.stop().await;
}

#[tokio::test]
async fn an_oversized_import_is_a_413_and_stores_nothing() {
    let (core, app) = open(&dir("import-large")).await;
    let (_, mut profile) = third_party("acme-hybrid", PROFILE);
    let limit = crate::sources::REQUEST_LIMITS.max_bytes;
    profile["padding"] = json!("x".repeat(limit));
    let answer = import(&app, &profile).await;
    assert_eq!(answer.status, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(answer.json(), json!({"error": format!("a profile file is at most {limit} bytes")}));
    let profiles = get(&app, "/api/profiles").await.json();
    assert_eq!(profiles.as_array().map(Vec::len), Some(core.bundle.profiles.len()));
    drop(app);
    core.stop().await;
}

#[tokio::test]
async fn a_profile_file_of_exactly_the_limit_is_stored_and_one_byte_more_is_a_413() {
    let (core, app) = open(&dir("import-boundary")).await;
    let limit = crate::sources::REQUEST_LIMITS.max_bytes;
    let (_, mut profile) = third_party("acme-hybrid", PROFILE);
    profile["padding"] = json!("");
    let bare = profile.to_string().len();
    profile["padding"] = json!("x".repeat(limit - bare));
    let at_limit = import(&app, &profile).await;
    assert_eq!(at_limit.status, StatusCode::OK, "{:?}", at_limit.json());
    profile["padding"] = json!("x".repeat(limit - bare + 1));
    assert_eq!(profile.to_string().len(), limit + 1);
    assert_eq!(import(&app, &profile).await.status, StatusCode::PAYLOAD_TOO_LARGE);
    drop(app);
    core.stop().await;
}

#[tokio::test]
async fn a_stored_profile_with_a_compiled_in_id_is_not_listed_twice() {
    let (core, app) = open(&dir("source-clash")).await;
    let mut clash = official_files().into_iter().find(|(id, _)| id == PROFILE).expect("official").1;
    clash["name"] = json!("impostor");
    let stored = [crate::sources::Installed::validate(clash.to_string()).expect("valid")];
    let source =
        crate::sources::Source { base_url: "https://a.example/".into(), index_path: "index.json".into() };
    crate::sources::save_source(&core.store, &source, &stored).await.expect("save");
    let profiles = get(&app, "/api/profiles").await.json();
    let same: Vec<_> = profiles.as_array().expect("array").iter().filter(|p| p["id"] == PROFILE).collect();
    assert_eq!(same.len(), 1, "{same:?}");
    assert_eq!((same[0]["builtin"].clone(), same[0]["installed"].clone()), (json!(true), json!(false)));
    assert_ne!(same[0]["name"], "impostor");
    drop(app);
    core.stop().await;
}

mod api_keys;
mod reads;
mod rollup;
mod users;
mod ws;
