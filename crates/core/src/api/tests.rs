//! The API over HTTP, against a real SQLite file.

use std::net::{IpAddr, SocketAddr};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use axum::Router;
use axum::body::Body;
use axum::extract::{ConnectInfo, MatchedPath, Request as Incoming};
use axum::http::{Method, Request, Response, StatusCode, header};
use axum::middleware::{self, Next};
use axum::routing::get as route_get;
use tokio::sync::watch;
use tower::ServiceExt;

use super::{Api, router};
use crate::auth::Auth;
use crate::bus::Bus;
use crate::cars::CarBodies;
use crate::changes::Changes;
use crate::devices::Devices;
use crate::layout::{Inverters, Layouts};
use crate::live::Live;
use crate::location::PlantLocation;
use crate::profiles::fake::Host;
use crate::profiles::{Keys, Profiles};
use crate::scan::Scanner;
use crate::storage::{Problem, Storage};
use crate::tariff::Tariffs;
use crate::topology::Topologies;

mod access;
mod balance;
mod cars;
mod devices;
mod evcc;
mod forecasts;
mod history;
mod ingress;
mod layout;
mod live;
mod location;
mod mqtt;
mod profiles;
mod roles;
mod scan;
mod screen;
mod secrets;
mod settings;
mod tariff;
mod tokens;
mod topology;
mod viewers;
mod zone;

/// The owner's Deye as device 1.
fn deye() -> Inverters {
    let profile = include_str!("../../../../profiles/deye-sg05lp3.json");
    let profile = sunreye_profile::Profile::load(profile).unwrap();
    std::iter::once((crate::bus::DeviceId(1), Arc::new(profile))).collect()
}

const HOME: &str = "192.0.2.1:50000";

struct Core {
    storage: Storage,
    /// Where the core's profile indexes are served from.
    host: Arc<Host>,
    bus: Bus,
    problems: watch::Sender<Vec<Problem>>,
    /// The API's clock when set, else the wall clock.
    clock: Arc<Mutex<Option<SystemTime>>>,
    router: Router,
}

impl Core {
    async fn open(path: &Path) -> Self {
        Self::trusting(path, None, None).await
    }

    /// A core that trusts Home Assistant ingress from `ingress`, and profiles signed by `keys`.
    async fn trusting(path: &Path, ingress: Option<IpAddr>, keys: Option<Keys>) -> Self {
        Self::build(path, ingress, keys, quiet()).await
    }

    /// A signed-in core whose setup scan is `scanner`; returns it and the session's `Set-Cookie`.
    async fn scanning(path: &Path, scanner: Scanner) -> (Self, String) {
        let core = Self::build(path, None, None, scanner).await;
        let setup = core.send(post("/api/v1/setup", "correct horse")).await;
        assert_eq!(setup.status(), StatusCode::NO_CONTENT);
        let set_cookie = core.sign_in(post("/api/v1/login", "correct horse")).await;
        (core, set_cookie)
    }

    async fn build(
        path: &Path,
        ingress: Option<IpAddr>,
        keys: Option<Keys>,
        scanner: Scanner,
    ) -> Self {
        let bus = Bus::default();
        let storage = Storage::open(path, UNIX_EPOCH, "UTC", &bus).unwrap();
        let auth = Auth::open(storage.database(), ingress).await.unwrap();
        let (problems, watched) = watch::channel(Vec::new());
        let clock = Arc::new(Mutex::new(None));
        let set = Arc::clone(&clock);
        let host = Host::new();
        let profiles = Profiles::open(storage.database(), Arc::<Host>::clone(&host), keys)
            .await
            .unwrap();
        let api = Api {
            auth,
            live: Live::spawn(&bus),
            problems: watched,
            history: storage.reader(),
            layouts: Layouts::new(storage.database(), deye()),
            // Its own inverters: the layout tests wire to the Deye above as device 1.
            devices: Devices::start(
                storage.database(),
                storage.declarer(),
                profiles.catalogue(),
                bus.clone(),
                Inverters::default(),
            )
            .await
            .unwrap()
            .scanning(scanner),
            changes: Changes::new(storage.database()),
            location: PlantLocation::open(storage.database()).await.unwrap(),
            profiles,
            topologies: Topologies::new(storage.database()),
            tariffs: Tariffs::new(&storage, &bus, storage.zones().watch()),
            cars: CarBodies::new(path.with_file_name("cars")),
            zones: storage.zones(),
            clock: Arc::new(move || set.lock().unwrap().unwrap_or_else(SystemTime::now)),
        };
        Self {
            router: contract(router(api)).await,
            host,
            bus,
            problems,
            clock,
            storage,
        }
    }

    fn set_clock(&self, now: SystemTime) {
        *self.clock.lock().unwrap() = Some(now);
    }

    async fn send(&self, request: Request<Body>) -> Response<Body> {
        self.router.clone().oneshot(request).await.unwrap()
    }
}

/// The contract test (ADR 9): every route a test's request reaches must be described, with its
/// method, by the served OpenAPI document.
async fn contract(router: Router) -> Router {
    let response = router.clone().oneshot(get("/openapi.json")).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let document = json(response).await;
    router.layer(middleware::from_fn(move |request: Incoming, next: Next| {
        let document = document.clone();
        async move {
            let path = request.extensions().get::<MatchedPath>().cloned();
            let method = request.method().as_str().to_ascii_lowercase();
            let response = next.run(request).await;
            // A method the route lacks reached no route.
            if let Some(path) = path
                && response.status() != StatusCode::METHOD_NOT_ALLOWED
            {
                let path = path.as_str();
                assert!(
                    path == "/openapi.json" || !document["paths"][path][&method].is_null(),
                    "{method} {path} is missing from the OpenAPI document"
                );
            }
            response
        }
    }))
}

async fn json(response: Response<Body>) -> serde_json::Value {
    let body = axum::body::to_bytes(response.into_body(), 1 << 20)
        .await
        .unwrap();
    serde_json::from_slice(&body).unwrap()
}

#[tokio::test]
#[should_panic(expected = "get /api/v1/undocumented is missing from the OpenAPI document")]
async fn a_route_missing_from_the_openapi_document_fails_the_contract_test() {
    let dir = tempfile::tempdir().unwrap();
    let storage = Storage::open(
        &dir.path().join("core.sqlite"),
        UNIX_EPOCH,
        "UTC",
        &Bus::default(),
    )
    .unwrap();
    let auth = Auth::open(storage.database(), None).await.unwrap();
    let profiles = Profiles::open(storage.database(), Host::new(), None)
        .await
        .unwrap();
    let api = Api {
        auth,
        live: Live::spawn(&Bus::default()),
        problems: watch::channel(Vec::new()).1,
        history: storage.reader(),
        layouts: Layouts::new(storage.database(), Inverters::default()),
        devices: Devices::start(
            storage.database(),
            storage.declarer(),
            profiles.catalogue(),
            Bus::default(),
            Inverters::default(),
        )
        .await
        .unwrap(),
        changes: Changes::new(storage.database()),
        location: PlantLocation::open(storage.database()).await.unwrap(),
        profiles,
        topologies: Topologies::new(storage.database()),
        tariffs: Tariffs::new(&storage, &Bus::default(), storage.zones().watch()),
        cars: CarBodies::new(dir.path().join("cars")),
        zones: storage.zones(),
        clock: Arc::new(SystemTime::now),
    };
    let undocumented = router(api).route("/api/v1/undocumented", route_get(|| async {}));

    contract(undocumented)
        .await
        .oneshot(get("/api/v1/undocumented"))
        .await
        .unwrap();
}

#[tokio::test]
async fn an_unknown_route_is_a_problem() {
    let dir = tempfile::tempdir().unwrap();
    let core = Core::open(&dir.path().join("core.sqlite")).await;

    let response = core.send(get("/api/v1/nowhere")).await;

    assert_eq!(
        problem(response).await,
        (StatusCode::NOT_FOUND, "request.route".to_owned())
    );
}

#[tokio::test]
async fn a_method_a_route_lacks_is_a_problem() {
    let dir = tempfile::tempdir().unwrap();
    let core = Core::open(&dir.path().join("core.sqlite")).await;
    let request = from(
        HOME,
        Request::builder()
            .method(Method::DELETE)
            .uri("/api/v1/login")
            .body(Body::empty())
            .unwrap(),
    );

    let response = core.send(request).await;

    assert_eq!(
        problem(response).await,
        (StatusCode::METHOD_NOT_ALLOWED, "request.method".to_owned())
    );
}

fn get(uri: &str) -> Request<Body> {
    from(HOME, Request::get(uri).body(Body::empty()).unwrap())
}

fn from(address: &str, mut request: Request<Body>) -> Request<Body> {
    let address: SocketAddr = address.parse().unwrap();
    request.extensions_mut().insert(ConnectInfo(address));
    request
}

/// The status and the problem code of a refusal.
async fn problem(response: Response<Body>) -> (StatusCode, String) {
    let status = response.status();
    assert_eq!(
        response.headers()[header::CONTENT_TYPE],
        "application/problem+json"
    );
    let body = json(response).await;
    assert_eq!(body["status"], status.as_u16());
    (status, body["code"].as_str().unwrap().to_owned())
}

#[tokio::test]
async fn before_the_first_run_a_request_asks_for_setup() {
    let dir = tempfile::tempdir().unwrap();
    let core = Core::open(&dir.path().join("core.sqlite")).await;

    let response = core.send(get("/api/v1/session")).await;

    assert_eq!(
        problem(response).await,
        (StatusCode::UNAUTHORIZED, "auth.setup".to_owned())
    );
}

fn post(uri: &str, password: &str) -> Request<Body> {
    let body = serde_json::json!({ "password": password }).to_string();
    let request = Request::post(uri)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body))
        .unwrap();
    from(HOME, request)
}

#[tokio::test]
async fn after_the_first_run_a_request_without_a_session_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let core = Core::open(&dir.path().join("core.sqlite")).await;
    let setup = core.send(post("/api/v1/setup", "correct horse")).await;
    assert_eq!(setup.status(), StatusCode::NO_CONTENT);

    let response = core.send(get("/api/v1/session")).await;

    assert_eq!(
        problem(response).await,
        (StatusCode::UNAUTHORIZED, "auth.required".to_owned())
    );
}

impl Core {
    /// A core whose admin password is `correct horse`.
    async fn set_up(path: &Path) -> Self {
        let core = Self::open(path).await;
        let setup = core.send(post("/api/v1/setup", "correct horse")).await;
        assert_eq!(setup.status(), StatusCode::NO_CONTENT);
        core
    }

    /// Signs in and returns the `Set-Cookie` header.
    async fn sign_in(&self, request: Request<Body>) -> String {
        let response = self.send(request).await;
        assert_eq!(response.status(), StatusCode::NO_CONTENT);
        response.headers()[header::SET_COOKIE]
            .to_str()
            .unwrap()
            .to_owned()
    }
}

/// The `name=value` pair a browser sends back.
fn cookie(set_cookie: &str) -> String {
    set_cookie.split(';').next().unwrap().to_owned()
}

fn with_cookie(set_cookie: &str, mut request: Request<Body>) -> Request<Body> {
    let value = cookie(set_cookie).parse().unwrap();
    request.headers_mut().insert(header::COOKIE, value);
    request
}

fn attributes(set_cookie: &str) -> Vec<&str> {
    let mut attributes: Vec<&str> = set_cookie.split("; ").skip(1).collect();
    attributes.sort_unstable();
    attributes
}

#[tokio::test]
async fn the_admin_signs_in_to_a_strict_http_only_cookie_of_30_days() {
    let dir = tempfile::tempdir().unwrap();
    let core = Core::set_up(&dir.path().join("core.sqlite")).await;

    let set_cookie = core.sign_in(post("/api/v1/login", "correct horse")).await;

    assert_eq!(
        attributes(&set_cookie),
        ["HttpOnly", "Max-Age=2592000", "Path=/", "SameSite=Strict"]
    );
    let response = core
        .send(with_cookie(&set_cookie, get("/api/v1/session")))
        .await;
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
}

const AWAY: &str = "198.51.100.7:40000";

/// The status, problem code and `Retry-After` seconds of a refused login.
async fn refusal(response: Response<Body>) -> (StatusCode, String, Option<u64>) {
    let retry = response
        .headers()
        .get(header::RETRY_AFTER)
        .map(|value| value.to_str().unwrap().parse().unwrap());
    let (status, code) = problem(response).await;
    (status, code, retry)
}

fn wrong() -> (StatusCode, String, Option<u64>) {
    (
        StatusCode::UNAUTHORIZED,
        "auth.credentials".to_owned(),
        None,
    )
}

fn wait(seconds: u64) -> (StatusCode, String, Option<u64>) {
    (
        StatusCode::TOO_MANY_REQUESTS,
        "auth.backoff".to_owned(),
        Some(seconds),
    )
}

#[tokio::test]
async fn failed_logins_back_off_exponentially_per_client_address() {
    let dir = tempfile::tempdir().unwrap();
    let core = Core::set_up(&dir.path().join("core.sqlite")).await;
    tokio::time::pause();
    let login = |password| post("/api/v1/login", password);

    assert_eq!(refusal(core.send(login("wrong")).await).await, wrong());
    assert_eq!(
        refusal(core.send(login("correct horse")).await).await,
        wait(1)
    );
    core.sign_in(from(AWAY, login("correct horse"))).await;

    tokio::time::advance(std::time::Duration::from_secs(1)).await;
    assert_eq!(refusal(core.send(login("wrong")).await).await, wrong());
    assert_eq!(refusal(core.send(login("wrong")).await).await, wait(2));

    tokio::time::advance(std::time::Duration::from_secs(2)).await;
    core.sign_in(login("correct horse")).await;
    assert_eq!(refusal(core.send(login("wrong")).await).await, wrong());
    assert_eq!(refusal(core.send(login("wrong")).await).await, wait(1));
}

#[tokio::test]
async fn a_password_over_72_bytes_is_refused_never_truncated() {
    let dir = tempfile::tempdir().unwrap();
    let core = Core::open(&dir.path().join("core.sqlite")).await;
    let longest = "é".repeat(36);
    let longer = format!("{longest}x");

    let response = core.send(post("/api/v1/setup", &longer)).await;
    assert_eq!(
        problem(response).await,
        (StatusCode::UNPROCESSABLE_ENTITY, "auth.password".to_owned())
    );

    let setup = core.send(post("/api/v1/setup", &longest)).await;
    assert_eq!(setup.status(), StatusCode::NO_CONTENT);
    let response = core.send(post("/api/v1/login", &longer)).await;
    assert_eq!(
        problem(response).await,
        (StatusCode::UNPROCESSABLE_ENTITY, "auth.password".to_owned())
    );
    core.sign_in(post("/api/v1/login", &longest)).await;
}

#[tokio::test]
async fn the_cookie_is_secure_when_the_request_arrived_over_tls() {
    let dir = tempfile::tempdir().unwrap();
    let core = Core::set_up(&dir.path().join("core.sqlite")).await;
    let mut request = post("/api/v1/login", "correct horse");
    request
        .headers_mut()
        .insert("x-forwarded-proto", "https".parse().unwrap());

    let set_cookie = core.sign_in(request).await;

    assert!(attributes(&set_cookie).contains(&"Secure"));
}

#[tokio::test]
async fn a_session_ends_30_days_after_its_last_use() {
    let dir = tempfile::tempdir().unwrap();
    let core = Core::set_up(&dir.path().join("core.sqlite")).await;
    let set_cookie = core.sign_in(post("/api/v1/login", "correct horse")).await;
    tokio::time::pause();
    let day = std::time::Duration::from_hours(24);
    let session = || with_cookie(&set_cookie, get("/api/v1/session"));

    tokio::time::advance(day * 29).await;
    assert_eq!(core.send(session()).await.status(), StatusCode::NO_CONTENT);
    tokio::time::advance(day * 29).await;
    assert_eq!(core.send(session()).await.status(), StatusCode::NO_CONTENT);

    tokio::time::advance(day * 30).await;
    assert_eq!(
        problem(core.send(session()).await).await,
        (StatusCode::UNAUTHORIZED, "auth.required".to_owned())
    );
}

#[tokio::test]
async fn the_admin_password_survives_a_restart_and_is_set_only_once() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("core.sqlite");
    drop(Core::set_up(&path).await);

    let core = Core::open(&path).await;

    core.sign_in(post("/api/v1/login", "correct horse")).await;
    assert_eq!(
        problem(core.send(post("/api/v1/setup", "other")).await).await,
        (StatusCode::CONFLICT, "auth.configured".to_owned())
    );
}

impl Core {
    /// A core with the admin signed in; returns it and the session's `Set-Cookie`.
    async fn signed_in(path: &Path) -> (Self, String) {
        let core = Self::set_up(path).await;
        let set_cookie = core.sign_in(post("/api/v1/login", "correct horse")).await;
        (core, set_cookie)
    }
}

#[tokio::test]
async fn capabilities_report_the_profile_table_the_wasm_reports() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;

    let response = core
        .send(with_cookie(&set_cookie, get("/api/v1/capabilities")))
        .await;

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        json(response).await,
        serde_json::json!({
            "version": env!("CARGO_PKG_VERSION"),
            "schema": { "min": 1, "max": 1 },
            "capabilities": ["modbus", "mqtt", "u16", "i16", "u32", "compute", "write", "write-block", "rmw", "activate", "precondition", "unlock", "delay", "snapshot-toggle", "publish"],
            "transports": ["modbus-tcp", "solarman-v5", "sim"],
            "devices": {},
        })
    );
}

#[tokio::test]
async fn capabilities_need_a_session() {
    let dir = tempfile::tempdir().unwrap();
    let core = Core::set_up(&dir.path().join("core.sqlite")).await;

    let response = core.send(get("/api/v1/capabilities")).await;

    assert_eq!(
        problem(response).await,
        (StatusCode::UNAUTHORIZED, "auth.required".to_owned())
    );
}

#[tokio::test]
async fn problems_report_an_unsynced_clock() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let problems = || with_cookie(&set_cookie, get("/api/v1/problems"));
    assert_eq!(
        json(core.send(problems()).await).await,
        serde_json::json!({ "problems": [] })
    );

    core.problems.send_replace(vec![Problem::ClockUnsynced]);

    assert_eq!(
        json(core.send(problems()).await).await,
        serde_json::json!({ "problems": [{ "code": "clock.unsynced" }] })
    );
}

#[tokio::test]
async fn the_openapi_document_describes_api_version_1() {
    let dir = tempfile::tempdir().unwrap();
    let core = Core::open(&dir.path().join("core.sqlite")).await;

    let document = json(core.send(get("/openapi.json")).await).await;

    assert_eq!(
        (&document["info"]["title"], &document["info"]["version"]),
        (&serde_json::json!("SunReye"), &serde_json::json!("1"))
    );
}

/// The SPA's client is generated from this file (ADR 9), so a route or type change that is not
/// regenerated fails here. `SUNREYE_UPDATE_OPENAPI=1` rewrites it.
#[tokio::test]
async fn the_committed_openapi_document_is_the_one_served() {
    let dir = tempfile::tempdir().unwrap();
    let core = Core::open(&dir.path().join("core.sqlite")).await;
    let document = json(core.send(get("/openapi.json")).await).await;
    let served = serde_json::to_string_pretty(&document).unwrap() + "\n";
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("openapi.json");

    if std::env::var_os("SUNREYE_UPDATE_OPENAPI").is_some() {
        std::fs::write(&path, &served).unwrap();
    }
    let committed = std::fs::read_to_string(&path).unwrap_or_default();

    assert!(
        committed == served,
        "{} is stale: run `bun run --cwd apps/web api`",
        path.display()
    );
}

/// The SPA maps each code to text (ADR 11), so the document lists them all.
#[tokio::test]
async fn the_openapi_document_lists_every_problem_code() {
    let dir = tempfile::tempdir().unwrap();
    let core = Core::open(&dir.path().join("core.sqlite")).await;

    let document = json(core.send(get("/openapi.json")).await).await;

    let schemas = &document["components"]["schemas"];
    let codes = schemas["Code"]["enum"].as_array().unwrap();
    for code in [
        "auth.required",
        "clock.unsynced",
        "device.profile-change",
        "layout.module-type",
        "request.route",
    ] {
        assert!(
            codes.contains(&serde_json::json!(code)),
            "{code} is not listed"
        );
    }
    let reference = serde_json::json!("#/components/schemas/Code");
    assert_eq!(
        schemas["ProblemDetails"]["properties"]["code"]["$ref"],
        reference
    );
    assert_eq!(
        schemas["Condition"]["properties"]["code"]["$ref"],
        reference
    );
}

/// A setup scan that touches nothing: no ports, and no home subnet.
fn quiet() -> Scanner {
    Scanner::new(Vec::new(), scan::LIMITS, || None)
}
