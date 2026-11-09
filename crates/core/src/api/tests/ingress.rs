//! Home Assistant ingress (ADR 9): HA's login stands in for the core's, from one address only.

use std::net::IpAddr;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use tempfile::TempDir;

use super::{AWAY, Core, from, get, problem, with_cookie};

/// The Supervisor's address on the add-on network.
const SUPERVISOR: &str = "172.30.32.2:41000";

fn supervisor() -> IpAddr {
    SUPERVISOR.parse::<std::net::SocketAddr>().unwrap().ip()
}

/// `request` as the Supervisor proxies it: with the prefix it stripped in `X-Ingress-Path`.
fn ingress(address: &str, mut request: Request<Body>) -> Request<Body> {
    request.headers_mut().insert(
        "x-ingress-path",
        "/api/hassio_ingress/abc123".parse().unwrap(),
    );
    from(address, request)
}

async fn behind_ingress() -> (TempDir, Core) {
    let dir = tempfile::tempdir().unwrap();
    let core = Core::trusting(&dir.path().join("core.sqlite"), Some(supervisor())).await;
    (dir, core)
}

async fn refused(core: &Core, request: Request<Body>) -> String {
    let (status, problem_code) = problem(core.send(request).await).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    problem_code
}

#[tokio::test]
async fn an_ingress_request_from_the_supervisor_acts_as_admin_before_any_setup() {
    let (_dir, core) = behind_ingress().await;

    for path in [
        "/api/v1/session",
        "/api/v1/capabilities",
        "/api/v1/problems",
    ] {
        let response = core.send(ingress(SUPERVISOR, get(path))).await;

        assert!(
            response.status().is_success(),
            "{path}: {}",
            response.status()
        );
    }
}

#[tokio::test]
async fn the_ingress_header_from_any_other_address_needs_the_login() {
    let (_dir, core) = behind_ingress().await;
    assert_eq!(
        refused(&core, ingress(AWAY, get("/api/v1/session"))).await,
        "auth.setup"
    );

    let core = core.with_admin().await;

    assert_eq!(
        refused(&core, ingress(AWAY, get("/api/v1/session"))).await,
        "auth.required"
    );
}

#[tokio::test]
async fn the_supervisor_address_without_the_ingress_header_needs_the_login() {
    let (_dir, core) = behind_ingress().await;
    let core = core.with_admin().await;

    assert_eq!(
        refused(&core, from(SUPERVISOR, get("/api/v1/session"))).await,
        "auth.required"
    );
}

#[tokio::test]
async fn without_the_ingress_option_no_address_is_trusted() {
    let dir = tempfile::tempdir().unwrap();
    let core = Core::set_up(&dir.path().join("core.sqlite")).await;

    assert_eq!(
        refused(&core, ingress(SUPERVISOR, get("/api/v1/session"))).await,
        "auth.required"
    );
}

#[tokio::test]
async fn the_core_login_still_works_beside_ingress() {
    let (_dir, core) = behind_ingress().await;
    let core = core.with_admin().await;
    let set_cookie = core
        .sign_in(from(AWAY, super::post("/api/v1/login", "correct horse")))
        .await;

    let response = core
        .send(with_cookie(&set_cookie, from(AWAY, get("/api/v1/session"))))
        .await;

    assert_eq!(response.status(), StatusCode::NO_CONTENT);
}

impl Core {
    /// Sets the admin password `correct horse` on this core.
    async fn with_admin(self) -> Self {
        let setup = self
            .send(super::post("/api/v1/setup", "correct horse"))
            .await;
        assert_eq!(setup.status(), StatusCode::NO_CONTENT);
        self
    }
}

#[tokio::test]
async fn a_dual_stack_listener_still_recognises_the_supervisor() {
    let (_dir, core) = behind_ingress().await;

    let response = core
        .send(ingress(
            "[::ffff:172.30.32.2]:41000",
            get("/api/v1/session"),
        ))
        .await;

    assert_eq!(response.status(), StatusCode::NO_CONTENT);
}
