//! The API over HTTP, against a real SQLite file.

use std::net::SocketAddr;
use std::path::Path;
use std::time::UNIX_EPOCH;

use axum::Router;
use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::{Request, Response, StatusCode, header};
use tower::ServiceExt;

use super::router;
use crate::auth::Auth;
use crate::bus::Bus;
use crate::storage::Storage;

const HOME: &str = "192.0.2.1:50000";

struct Core {
    _storage: Storage,
    router: Router,
}

impl Core {
    async fn open(path: &Path) -> Self {
        let storage = Storage::open(path, UNIX_EPOCH, &Bus::default()).unwrap();
        let auth = Auth::open(storage.database()).await.unwrap();
        Self {
            router: router(&auth),
            _storage: storage,
        }
    }

    async fn send(&self, request: Request<Body>) -> Response<Body> {
        self.router.clone().oneshot(request).await.unwrap()
    }
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
    let body = axum::body::to_bytes(response.into_body(), 1 << 16)
        .await
        .unwrap();
    let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
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
