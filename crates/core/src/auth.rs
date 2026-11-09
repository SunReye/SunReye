//! Admin sign-in (ADR 9). Auth owns the `admin` table.

mod backoff;
mod sessions;

use std::net::{IpAddr, SocketAddr};
use std::sync::{Arc, Mutex, PoisonError};

use axum::Json;
use axum::extract::rejection::JsonRejection;
use axum::extract::{ConnectInfo, Request, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use rusqlite::OptionalExtension;
use serde::Deserialize;
use tokio::time::Instant;
use utoipa::ToSchema;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::api::{Problem, ProblemDetails};
use crate::storage::{Database, Error};
use backoff::Backoff;
use sessions::{IDLE, Sessions};

/// bcrypt's work factor, as v4 used.
const COST: u32 = 12;
/// bcrypt reads no further; a longer password is refused, never truncated. The crate's
/// non-truncating calls also refuse exactly 72 bytes, so its plain calls run behind this check.
const LONGEST: usize = 72;
const COOKIE: &str = "sunreye_session";
/// The prefix Home Assistant's Supervisor stripped from an ingress request.
const INGRESS_PATH: &str = "x-ingress-path";

const SETUP: Problem = Problem {
    status: StatusCode::UNAUTHORIZED,
    code: "auth.setup",
};
const REQUIRED: Problem = Problem {
    status: StatusCode::UNAUTHORIZED,
    code: "auth.required",
};
const CREDENTIALS: Problem = Problem {
    status: StatusCode::UNAUTHORIZED,
    code: "auth.credentials",
};
const BACKOFF: Problem = Problem {
    status: StatusCode::TOO_MANY_REQUESTS,
    code: "auth.backoff",
};
const CONFIGURED: Problem = Problem {
    status: StatusCode::CONFLICT,
    code: "auth.configured",
};
const PASSWORD: Problem = Problem {
    status: StatusCode::UNPROCESSABLE_ENTITY,
    code: "auth.password",
};
const BODY: Problem = Problem {
    status: StatusCode::BAD_REQUEST,
    code: "request.body",
};
const INTERNAL: Problem = Problem {
    status: StatusCode::INTERNAL_SERVER_ERROR,
    code: "internal",
};

#[derive(Deserialize, ToSchema)]
pub struct Credentials {
    password: String,
}

/// The password of a request body.
fn password(body: Result<Json<Credentials>, JsonRejection>) -> Result<String, Problem> {
    let Json(Credentials { password }) = body.map_err(|_| BODY)?;
    if password.len() > LONGEST {
        return Err(PASSWORD);
    }
    Ok(password)
}

#[derive(Debug, Clone)]
pub struct Auth(Arc<Inner>);

#[derive(Debug)]
struct Inner {
    database: Database,
    /// The address whose ingress requests act as admin (ADR 9).
    ingress: Option<IpAddr>,
    /// The admin's bcrypt hash; `None` until the first run sets it.
    admin: Mutex<Option<String>>,
    sessions: Mutex<Sessions>,
    backoff: Mutex<Backoff>,
}

impl Auth {
    /// `ingress` is the Home Assistant Supervisor's address, set only in the add-on image.
    ///
    /// # Errors
    /// The stored admin cannot be read.
    pub async fn open(database: Database, ingress: Option<IpAddr>) -> Result<Self, Error> {
        let admin = database
            .run(|db| {
                db.query_row("SELECT hash FROM admin", [], |row| row.get(0))
                    .optional()
            })
            .await?;
        Ok(Self(Arc::new(Inner {
            database,
            ingress,
            admin: Mutex::new(admin),
            sessions: Mutex::default(),
            backoff: Mutex::default(),
        })))
    }

    /// The sign-in routes, and `protected` behind a session.
    pub fn routes(&self, protected: OpenApiRouter) -> OpenApiRouter {
        let protected = protected
            .routes(routes!(session))
            .layer(middleware::from_fn_with_state(self.clone(), require));
        OpenApiRouter::new()
            .routes(routes!(setup))
            .routes(routes!(login))
            .with_state(self.clone())
            .merge(protected)
    }

    /// Whether the Supervisor proxied `request` through ingress, which names its prefix in
    /// `X-Ingress-Path`. Anyone may send the header; only the Supervisor's address is trusted.
    fn via_ingress(&self, request: &Request) -> bool {
        let client = request
            .extensions()
            .get::<ConnectInfo<SocketAddr>>()
            .map(|ConnectInfo(client)| client.ip().to_canonical());
        self.0
            .ingress
            .is_some_and(|ingress| client == Some(ingress))
            && request.headers().contains_key(INGRESS_PATH)
    }

    fn admin(&self) -> Option<String> {
        self.0
            .admin
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    fn backoff(&self) -> std::sync::MutexGuard<'_, Backoff> {
        self.0
            .backoff
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }

    fn sessions(&self) -> std::sync::MutexGuard<'_, Sessions> {
        self.0
            .sessions
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }
}

/// Whether the request carries a live session.
#[utoipa::path(get, path = "/api/v1/session", responses(
    (status = 204, description = "Signed in"),
    (status = 401, body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn session() -> StatusCode {
    StatusCode::NO_CONTENT
}

/// The first run sets the admin password; there is no registration.
#[utoipa::path(post, path = "/api/v1/setup", request_body = Credentials, responses(
    (status = 204, description = "The admin password is set"),
    (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn setup(
    State(auth): State<Auth>,
    body: Result<Json<Credentials>, JsonRejection>,
) -> Result<StatusCode, Problem> {
    let password = password(body)?;
    if auth.admin().is_some() {
        return Err(CONFIGURED);
    }
    let hash = blocking(move || hash(&password)).await?;
    let stored = hash.clone();
    let inserted = auth
        .0
        .database
        .run(move |db| {
            db.execute(
                "INSERT INTO admin (id, hash) VALUES (0, ?1) ON CONFLICT DO NOTHING",
                [stored],
            )
        })
        .await
        .map_err(|_| INTERNAL)?;
    if inserted == 0 {
        return Err(CONFIGURED);
    }
    *auth.0.admin.lock().unwrap_or_else(PoisonError::into_inner) = Some(hash);
    Ok(StatusCode::NO_CONTENT)
}

/// A refused login.
enum Refused {
    Problem(Problem),
    /// Backing off: the whole seconds to wait.
    Wait(u64),
}

impl From<Problem> for Refused {
    fn from(problem: Problem) -> Self {
        Self::Problem(problem)
    }
}

impl IntoResponse for Refused {
    fn into_response(self) -> Response {
        match self {
            Self::Problem(problem) => problem.into_response(),
            Self::Wait(seconds) => ([(header::RETRY_AFTER, seconds)], BACKOFF).into_response(),
        }
    }
}

/// Signs the admin in to a session cookie.
#[utoipa::path(post, path = "/api/v1/login", request_body = Credentials, responses(
    (status = 204, description = "Signed in; the cookie is set"),
    (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn login(
    State(auth): State<Auth>,
    ConnectInfo(client): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    body: Result<Json<Credentials>, JsonRejection>,
) -> Result<Response, Refused> {
    let password = password(body)?;
    let admin = auth.admin().ok_or(SETUP)?;
    let address = client.ip();
    let wait = auth.backoff().wait(address, Instant::now());
    if let Some(wait) = wait {
        // Rounding up never invites an early attempt.
        return Err(Refused::Wait(
            wait.as_secs() + u64::from(wait.subsec_nanos() > 0),
        ));
    }
    // Counted as failed until it succeeds, so concurrent guesses wait too.
    auth.backoff().fail(address, Instant::now());
    let matches = blocking(move || bcrypt::verify(password, &admin)).await?;
    if !matches {
        return Err(CREDENTIALS.into());
    }
    auth.backoff().succeed(address);
    let token = auth.sessions().start(Instant::now()).ok_or(INTERNAL)?;
    let tls = over_tls(&headers);
    Ok(with_cookie(
        &token,
        tls,
        StatusCode::NO_CONTENT.into_response(),
    ))
}

/// Refuses a request without a live session, and renews the cookie of one with it. An ingress
/// request from the Supervisor needs neither: Home Assistant signed its user in.
async fn require(State(auth): State<Auth>, request: Request, next: Next) -> Response {
    if auth.via_ingress(&request) {
        return next.run(request).await;
    }
    if auth.admin().is_none() {
        return SETUP.into_response();
    }
    let Some(token) = session_token(request.headers()) else {
        return REQUIRED.into_response();
    };
    if !auth.sessions().touch(&token, Instant::now()) {
        return REQUIRED.into_response();
    }
    let tls = over_tls(request.headers());
    with_cookie(&token, tls, next.run(request).await)
}

fn session_token(headers: &HeaderMap) -> Option<String> {
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(';'))
        .find_map(|pair| pair.trim().strip_prefix(COOKIE)?.strip_prefix('='))
        .map(str::to_owned)
}

/// TLS ends at a reverse proxy (ADR 9), which says so in `X-Forwarded-Proto`.
fn over_tls(headers: &HeaderMap) -> bool {
    headers
        .get("x-forwarded-proto")
        .is_some_and(|proto| proto.as_bytes().eq_ignore_ascii_case(b"https"))
}

fn with_cookie(token: &str, tls: bool, mut response: Response) -> Response {
    let secure = if tls { "; Secure" } else { "" };
    let cookie = format!(
        "{COOKIE}={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={}{secure}",
        IDLE.as_secs()
    );
    if let Ok(cookie) = HeaderValue::try_from(cookie) {
        response.headers_mut().insert(header::SET_COOKIE, cookie);
    }
    response
}

fn hash(password: &str) -> bcrypt::BcryptResult<String> {
    bcrypt::hash(password, COST)
}

/// Runs bcrypt off the I/O thread.
async fn blocking<T: Send + 'static>(
    job: impl FnOnce() -> bcrypt::BcryptResult<T> + Send + 'static,
) -> Result<T, Problem> {
    tokio::task::spawn_blocking(job)
        .await
        .map_err(|_| INTERNAL)?
        .map_err(|_| INTERNAL)
}

#[cfg(test)]
mod tests;
