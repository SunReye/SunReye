//! Admin sign-in (ADR 9). Auth owns the `admin` table.

mod access;
mod backoff;
mod sessions;
mod tokens;
mod viewers;

pub use access::{Access, access};
pub(crate) use sessions::hex;

use std::net::{IpAddr, SocketAddr};
use std::sync::{Arc, Mutex, PoisonError};

use axum::Json;
use axum::extract::rejection::JsonRejection;
use axum::extract::{ConnectInfo, MatchedPath, Request, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use rusqlite::OptionalExtension;
use serde::Deserialize;
use tokio::time::Instant;
use utoipa::ToSchema;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::api::{Clock, Code, Problem, ProblemDetails};
use crate::storage::{Database, Error};
use backoff::Backoff;
use sessions::{Grant, IDLE, Sessions};
use tokens::{Known, Scope};

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
    code: Code::AuthSetup,
};
const REQUIRED: Problem = Problem {
    status: StatusCode::UNAUTHORIZED,
    code: Code::AuthRequired,
};
const CREDENTIALS: Problem = Problem {
    status: StatusCode::UNAUTHORIZED,
    code: Code::AuthCredentials,
};
const BACKOFF: Problem = Problem {
    status: StatusCode::TOO_MANY_REQUESTS,
    code: Code::AuthBackoff,
};
const CONFIGURED: Problem = Problem {
    status: StatusCode::CONFLICT,
    code: Code::AuthConfigured,
};
const PASSWORD: Problem = Problem {
    status: StatusCode::UNPROCESSABLE_ENTITY,
    code: Code::AuthPassword,
};
const FORBIDDEN: Problem = Problem {
    status: StatusCode::FORBIDDEN,
    code: Code::AuthForbidden,
};
const PATH: Problem = Problem {
    status: StatusCode::BAD_REQUEST,
    code: Code::RequestPath,
};
const BODY: Problem = Problem {
    status: StatusCode::BAD_REQUEST,
    code: Code::RequestBody,
};
const INTERNAL: Problem = Problem {
    status: StatusCode::INTERNAL_SERVER_ERROR,
    code: Code::Internal,
};

/// The admin's password, set on the first run.
#[derive(Deserialize, ToSchema)]
pub struct Password {
    password: String,
}

/// A sign-in: the admin's password alone, or a viewer's name and password.
#[derive(Deserialize, ToSchema)]
pub struct Credentials {
    /// A viewer's name; absent for the admin.
    #[serde(default)]
    name: Option<String>,
    password: String,
}

fn checked(password: String) -> Result<String, Problem> {
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
    tokens: Mutex<Known>,
    backoff: Mutex<Backoff>,
}

impl Auth {
    /// `ingress` is the Home Assistant Supervisor's address, set only in the add-on image.
    ///
    /// # Errors
    /// The stored admin or tokens cannot be read.
    pub async fn open(database: Database, ingress: Option<IpAddr>) -> Result<Self, Error> {
        let (admin, tokens) = database
            .run(|db| {
                let admin = db
                    .query_row("SELECT hash FROM admin", [], |row| row.get(0))
                    .optional()?;
                Ok((admin, tokens::load(db)?))
            })
            .await?;
        Ok(Self(Arc::new(Inner {
            database,
            ingress,
            admin: Mutex::new(admin),
            sessions: Mutex::default(),
            tokens: Mutex::new(tokens),
            backoff: Mutex::default(),
        })))
    }

    /// The sign-in and viewer routes beside `api`, each guarded as the access table classifies
    /// it.
    pub fn routes(&self, api: OpenApiRouter, clock: Clock) -> OpenApiRouter {
        crate::api::merged([
            OpenApiRouter::new()
                .routes(routes!(session))
                .routes(routes!(setup))
                .routes(routes!(login))
                .with_state(self.clone()),
            OpenApiRouter::new()
                .routes(routes!(viewers::list_viewers, viewers::add_viewer))
                .routes(routes!(viewers::remove_viewer))
                .routes(routes!(tokens::list_tokens, tokens::add_token))
                .routes(routes!(tokens::remove_token))
                .with_state((self.clone(), clock)),
            api,
        ])
        .layer(middleware::from_fn_with_state(self.clone(), guard))
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

    fn tokens(&self) -> std::sync::MutexGuard<'_, Known> {
        self.0.tokens.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Who signed `headers`: a bearer token, else a live session, whose use renews it.
    fn identify(&self, headers: &HeaderMap) -> Result<Caller, Problem> {
        if let Some(token) = bearer(headers) {
            let scope = self.tokens().get(&tokens::digest(token)).map(|&(_, s)| s);
            return scope.map(Caller::Token).ok_or(REQUIRED);
        }
        let session = session_token(headers)
            .and_then(|token| Some((self.sessions().touch(&token, Instant::now())?, token)));
        match session {
            Some((grant, token)) => Ok(Caller::Session(grant, token)),
            None if self.admin().is_none() => Err(SETUP),
            None => Err(REQUIRED),
        }
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
#[utoipa::path(post, path = "/api/v1/setup", request_body = Password, responses(
    (status = 204, description = "The admin password is set"),
    (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn setup(
    State(auth): State<Auth>,
    body: Result<Json<Password>, JsonRejection>,
) -> Result<StatusCode, Problem> {
    let Json(Password { password }) = body.map_err(|_| BODY)?;
    let password = checked(password)?;
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

/// Signs the admin, or a viewer by name, in to a session cookie.
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
    let Json(Credentials { name, password }) = body.map_err(|_| BODY)?;
    let password = checked(password)?;
    if name.is_none() && auth.admin().is_none() {
        return Err(SETUP.into());
    }
    let address = client.ip();
    let wait = auth.backoff().attempt(address, Instant::now());
    if let Some(wait) = wait {
        // Rounding up never invites an early attempt.
        return Err(Refused::Wait(
            wait.as_secs() + u64::from(wait.subsec_nanos() > 0),
        ));
    }
    let found = match name {
        None => Some((Grant::Admin, auth.admin().ok_or(SETUP)?)),
        Some(name) => auth
            .0
            .database
            .run(move |db| viewers::find(db, &name))
            .await
            .map_err(|_| INTERNAL)?
            .map(|(id, hash)| (Grant::Viewer(id), hash)),
    };
    let verify = |password: String, hash: String| blocking(move || bcrypt::verify(password, &hash));
    let grant = verified(found, password, verify).await?;
    auth.backoff().succeed(address);
    let token = auth
        .sessions()
        .start(grant, Instant::now())
        .ok_or(INTERNAL)?;
    let tls = over_tls(&headers);
    Ok(with_cookie(
        &token,
        tls,
        StatusCode::NO_CONTENT.into_response(),
    ))
}

/// Lets a request through as the access table classifies its route; an unclassified one needs
/// admin.
async fn guard(State(auth): State<Auth>, request: Request, next: Next) -> Response {
    let access = request
        .extensions()
        .get::<MatchedPath>()
        .and_then(|path| access(request.method(), path.as_str()))
        .unwrap_or(Access::Admin);
    if access == Access::Public {
        return next.run(request).await;
    }
    // Home Assistant signed the user of an ingress request in.
    if auth.via_ingress(&request) {
        return next.run(request).await;
    }
    let caller = match auth.identify(request.headers()) {
        Ok(caller) => caller,
        Err(problem) => return problem.into_response(),
    };
    if access == Access::Admin && !caller.admin() {
        return FORBIDDEN.into_response();
    }
    let tls = over_tls(request.headers());
    let response = next.run(request).await;
    match caller {
        // Using a session renews its cookie.
        Caller::Session(_, token) => with_cookie(&token, tls, response),
        Caller::Token(_) => response,
    }
}

/// Who a request comes from.
enum Caller {
    /// A browser session, with its token.
    Session(Grant, String),
    Token(Scope),
}

impl Caller {
    const fn admin(&self) -> bool {
        matches!(
            self,
            Self::Session(Grant::Admin, _) | Self::Token(Scope::Admin)
        )
    }
}

/// The token of an `Authorization: Bearer` header.
fn bearer(headers: &HeaderMap) -> Option<&str> {
    let value = headers.get(header::AUTHORIZATION)?.to_str().ok()?;
    let (scheme, token) = value.split_once(' ')?;
    scheme.eq_ignore_ascii_case("bearer").then(|| token.trim())
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

/// A bcrypt hash at [`COST`] of no password anyone knows: an unknown viewer's name is verified
/// against it, so it takes as long as a wrong password.
const DUMMY: &str = "$2b$12$/seIJLMGBZCTdIVr.NVTEOv7p49Hj1tf52kUZxQHzSZTN.oRa51gu";

/// The grant `found` signs in with `password`, verified by `verify`; with nothing found it still
/// verifies, against [`DUMMY`], and is refused.
async fn verified<F>(
    found: Option<(Grant, String)>,
    password: String,
    verify: impl FnOnce(String, String) -> F,
) -> Result<Grant, Problem>
where
    F: Future<Output = Result<bool, Problem>>,
{
    let (grant, hash) = match found {
        Some((grant, hash)) => (Some(grant), hash),
        None => (None, DUMMY.to_owned()),
    };
    match (verify(password, hash).await?, grant) {
        (true, Some(grant)) => Ok(grant),
        _ => Err(CREDENTIALS),
    }
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
