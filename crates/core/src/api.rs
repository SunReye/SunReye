//! The HTTP API (ADR 9). Every route is registered with its OpenAPI description, so the document
//! served at `/openapi.json` cannot miss one.

use std::convert::Infallible;

use axum::extract::State;
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode, Uri, header};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use futures_util::{Stream, StreamExt, stream};
use serde::Serialize;
use tokio::sync::watch;
use utoipa::{OpenApi, ToSchema};
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::auth::Auth;
use crate::changes::Changes;
use crate::devices::Devices;
use crate::layout::Layouts;
use crate::live::{Frame, Live};
use crate::spa;
use crate::storage;
use crate::transport::Endpoint;

const ROUTE: Problem = Problem {
    status: StatusCode::NOT_FOUND,
    code: Code::RequestRoute,
};
const METHOD: Problem = Problem {
    status: StatusCode::METHOD_NOT_ALLOWED,
    code: Code::RequestMethod,
};

mod forecasts;
mod history;

#[derive(OpenApi)]
#[openapi(info(title = "SunReye", version = "1"))]
struct Document;

/// What the API serves from.
pub struct Api {
    pub auth: Auth,
    pub live: Live,
    /// Storage's problems, as of its last tick.
    pub problems: watch::Receiver<Vec<storage::Problem>>,
    pub history: storage::Reader,
    pub layouts: Layouts,
    pub devices: Devices,
    pub changes: Changes,
    /// The wall clock: history ends at its now.
    pub clock: Clock,
}

pub type Clock = std::sync::Arc<dyn Fn() -> std::time::SystemTime + Send + Sync>;

pub fn router(api: Api) -> Router {
    let protected = OpenApiRouter::new()
        .routes(routes!(capabilities))
        .merge(
            OpenApiRouter::new()
                .routes(routes!(live_values))
                .with_state(api.live),
        )
        .merge(
            OpenApiRouter::new()
                .routes(routes!(problems))
                .with_state(api.problems),
        )
        .merge(
            OpenApiRouter::new()
                .routes(routes!(history::history))
                .with_state((api.history.clone(), Clock::clone(&api.clock))),
        )
        .merge(
            OpenApiRouter::new()
                .routes(routes!(forecasts::forecasts))
                .with_state(api.history),
        )
        .merge(api.devices.routes(Clock::clone(&api.clock)))
        .merge(api.changes.routes())
        .merge(api.layouts.routes(api.clock));
    let (router, document) = OpenApiRouter::with_openapi(Document::openapi())
        .merge(api.auth.routes(protected))
        .split_for_parts();
    // Serialised once: the document changes only with the build.
    let document = document.to_json().unwrap_or_default();
    router
        .route(
            "/openapi.json",
            get(|| async { ([(header::CONTENT_TYPE, "application/json")], document) }),
        )
        .fallback(|method: Method, uri: Uri, headers: HeaderMap| async move {
            spa::serve(&method, &uri, &headers).unwrap_or_else(|| ROUTE.into_response())
        })
        .method_not_allowed_fallback(|| async { METHOD })
}

/// What this core supports (ADR 9). The schemas and capabilities are the profile crate's table,
/// the one its WASM build reports.
#[derive(Serialize, ToSchema)]
struct Support {
    /// The core's version.
    version: &'static str,
    /// The profile schemas this core loads.
    schema: Schemas,
    /// The bindings, decoders and computed quantities a profile may require.
    capabilities: &'static [&'static str],
    transports: &'static [&'static str],
}

/// An inclusive range of profile schemas.
#[derive(Serialize, ToSchema)]
struct Schemas {
    min: u32,
    max: u32,
}

#[utoipa::path(get, path = "/api/v1/capabilities", responses(
    (status = 200, body = Support),
    (status = 401, body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn capabilities() -> Json<Support> {
    let support = sunreye_profile::SUPPORT;
    Json(Support {
        version: env!("CARGO_PKG_VERSION"),
        schema: Schemas {
            min: support.schema.min,
            max: support.schema.max,
        },
        capabilities: support.capabilities,
        transports: Endpoint::TRANSPORTS,
    })
}

/// Conditions that degrade the core.
#[derive(Serialize, ToSchema)]
struct Problems {
    problems: Vec<Condition>,
}

#[derive(Serialize, ToSchema)]
struct Condition {
    /// A stable machine code, such as `clock.unsynced`.
    code: Code,
}

#[utoipa::path(get, path = "/api/v1/problems", responses(
    (status = 200, body = Problems),
    (status = 401, body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn problems(
    State(problems): State<watch::Receiver<Vec<storage::Problem>>>,
) -> Json<Problems> {
    let problems = problems
        .borrow()
        .iter()
        .map(|&p| Condition { code: p.into() })
        .collect();
    Json(Problems { problems })
}

/// Server-sent events: a `snapshot` of every value on connect, then a `delta` per second in
/// which a value changed. There is no replay: a client that falls behind is disconnected and
/// reconnects to a fresh snapshot.
#[utoipa::path(get, path = "/api/v1/live", responses(
    (status = 200, body = Frame, content_type = "text/event-stream"),
    (status = 401, body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn live_values(
    State(live): State<Live>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let (snapshot, deltas) = live.subscribe();
    let snapshot = Event::default().event("snapshot").data(snapshot);
    let deltas = stream::unfold(deltas, |mut deltas| async move {
        let delta = deltas.recv().await.ok()?;
        Some((Event::default().event("delta").data(&*delta), deltas))
    });
    let events = stream::once(async { snapshot }).chain(deltas).map(Ok);
    Sse::new(events).keep_alive(KeepAlive::default())
}

/// A refusal as `application/problem+json` (RFC 9457): a stable code and no localised text.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Problem {
    pub status: StatusCode,
    pub code: Code,
}

/// Every stable machine code the core answers with; the SPA maps each to text (ADR 11).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
pub enum Code {
    #[serde(rename = "request.route")]
    RequestRoute,
    #[serde(rename = "request.method")]
    RequestMethod,
    #[serde(rename = "request.path")]
    RequestPath,
    #[serde(rename = "request.query")]
    RequestQuery,
    #[serde(rename = "request.body")]
    RequestBody,
    #[serde(rename = "auth.setup")]
    AuthSetup,
    #[serde(rename = "auth.required")]
    AuthRequired,
    #[serde(rename = "auth.credentials")]
    AuthCredentials,
    #[serde(rename = "auth.backoff")]
    AuthBackoff,
    #[serde(rename = "auth.configured")]
    AuthConfigured,
    #[serde(rename = "auth.password")]
    AuthPassword,
    #[serde(rename = "history.range")]
    HistoryRange,
    #[serde(rename = "history.counter")]
    HistoryCounter,
    #[serde(rename = "forecast.range")]
    ForecastRange,
    #[serde(rename = "layout.none")]
    LayoutNone,
    #[serde(rename = "layout.device")]
    LayoutDevice,
    #[serde(rename = "layout.input")]
    LayoutInput,
    #[serde(rename = "layout.string")]
    LayoutString,
    #[serde(rename = "layout.module-type")]
    LayoutModuleType,
    #[serde(rename = "layout.value")]
    LayoutValue,
    #[serde(rename = "connection.none")]
    ConnectionNone,
    #[serde(rename = "connection.value")]
    ConnectionValue,
    #[serde(rename = "connection.in-use")]
    ConnectionInUse,
    #[serde(rename = "device.none")]
    DeviceNone,
    #[serde(rename = "device.connection")]
    DeviceConnection,
    #[serde(rename = "device.profile")]
    DeviceProfile,
    #[serde(rename = "device.profile-change")]
    DeviceProfileChange,
    #[serde(rename = "device.address")]
    DeviceAddress,
    #[serde(rename = "clock.unsynced")]
    ClockUnsynced,
    #[serde(rename = "internal")]
    Internal,
}

impl From<storage::Problem> for Code {
    fn from(problem: storage::Problem) -> Self {
        match problem {
            storage::Problem::ClockUnsynced => Self::ClockUnsynced,
        }
    }
}

/// The body of a refusal.
#[derive(Serialize, ToSchema)]
pub struct ProblemDetails {
    /// The HTTP status.
    status: u16,
    /// A stable machine code, such as `auth.required`.
    code: Code,
}

impl IntoResponse for Problem {
    fn into_response(self) -> Response {
        let details = ProblemDetails {
            status: self.status.as_u16(),
            code: self.code,
        };
        let mut response = (self.status, axum::Json(details)).into_response();
        response.headers_mut().insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/problem+json"),
        );
        response
    }
}

#[cfg(test)]
mod tests;
