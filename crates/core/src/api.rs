//! The HTTP API (ADR 9). Every route is registered with its OpenAPI description, so the document
//! served at `/openapi.json` cannot miss one.

use std::collections::BTreeMap;
use std::convert::Infallible;

use axum::extract::State;
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode, Uri, header};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use futures_util::{Stream, StreamExt, stream};
use serde::Serialize;
use sunreye_profile::Unit;
use tokio::sync::watch;
use utoipa::{OpenApi, ToSchema};
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::auth::Auth;
use crate::backup::Backups;
use crate::cars::CarBodies;
use crate::changes::Changes;
use crate::correction::Corrections;
use crate::devices::Devices;
use crate::import::Imports;
use crate::layout::{Layouts, Version, in_force};
use crate::live::{Frame, Live};
use crate::location::PlantLocation;
use crate::profiles::Profiles;
use crate::settings::{Declared, Enable};
use crate::spa;
use crate::spot::SpotZone;
use crate::storage;
use crate::tariff::Tariffs;
use crate::topology::Topologies;
use crate::transport::Endpoint;

const ROUTE: Problem = Problem {
    status: StatusCode::NOT_FOUND,
    code: Code::RequestRoute,
};
const INTERNAL: Problem = Problem {
    status: StatusCode::INTERNAL_SERVER_ERROR,
    code: Code::Internal,
};
const METHOD: Problem = Problem {
    status: StatusCode::METHOD_NOT_ALLOWED,
    code: Code::RequestMethod,
};

mod forecasts;
mod history;
mod roles;

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
    pub corrections: Corrections,
    pub devices: Devices,
    pub changes: Changes,
    pub location: PlantLocation,
    pub spot: SpotZone,
    pub profiles: Profiles,
    pub topologies: Topologies,
    pub tariffs: Tariffs,
    pub cars: CarBodies,
    pub zones: storage::Zones,
    pub imports: Imports,
    pub backups: Backups,
    /// The wall clock: history ends at its now.
    pub clock: Clock,
}

pub type Clock = std::sync::Arc<dyn Fn() -> std::time::SystemTime + Send + Sync>;

pub fn router(api: Api) -> Router {
    let api_routes = OpenApiRouter::new()
        .merge(capability_routes(&api))
        .merge(stored_routes(&api))
        .merge(
            OpenApiRouter::new()
                .routes(routes!(live_values))
                .routes(routes!(roles::role))
                .with_state(api.live),
        )
        .merge(
            OpenApiRouter::new()
                .routes(routes!(problems))
                .with_state(api.problems),
        )
        .merge(api.topologies.clone().residual_routes(api.history))
        .merge(
            api.topologies
                .routes(api.devices.clone(), Clock::clone(&api.clock)),
        )
        .merge(api.devices.routes(Clock::clone(&api.clock)))
        .merge(api.tariffs.routes(Clock::clone(&api.clock)))
        .merge(api.changes.routes())
        .merge(api.cars.routes())
        .merge(api.location.routes(Clock::clone(&api.clock)))
        .merge(api.spot.routes(Clock::clone(&api.clock)))
        .merge(crate::zone::routes(api.zones, Clock::clone(&api.clock)))
        .merge(api.profiles.routes(Clock::clone(&api.clock)))
        .merge(api.imports.routes())
        .merge(api.backups.routes())
        .merge(api.layouts.routes(Clock::clone(&api.clock)));
    let (router, document) = OpenApiRouter::with_openapi(Document::openapi())
        .merge(api.auth.routes(api_routes, api.clock))
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

/// History, forecasts and the learned corrections: what storage holds, read like history.
fn stored_routes(api: &Api) -> OpenApiRouter {
    OpenApiRouter::new()
        .merge(
            OpenApiRouter::new()
                .routes(routes!(history::history))
                .with_state((api.history.clone(), Clock::clone(&api.clock))),
        )
        .merge(
            OpenApiRouter::new()
                .routes(routes!(forecasts::forecasts))
                .with_state(api.history.clone()),
        )
        .merge(api.corrections.clone().routes(
            api.location.watch(),
            api.zones.watch(),
            Clock::clone(&api.clock),
        ))
}

fn capability_routes(api: &Api) -> OpenApiRouter {
    OpenApiRouter::new()
        .routes(routes!(capabilities))
        .with_state((
            api.layouts.clone(),
            api.devices.clone(),
            Clock::clone(&api.clock),
        ))
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
    /// By device id, what the layout in force says of its series.
    devices: BTreeMap<String, DeviceSupport>,
}

#[derive(Default, Serialize, ToSchema)]
struct DeviceSupport {
    /// Series computed from others, not measured, such as `pv.string.power[3]` of a string
    /// in parallel (ADR 17).
    estimated: Vec<String>,
    /// Whether the admin switched its writes on (ADR 7).
    writes: bool,
    /// What its profile lets the core write, in the profile's order.
    settings: Vec<SettingSupport>,
}

/// A setting a device's profile declares (ADR 5, 7).
#[derive(Serialize, ToSchema)]
struct SettingSupport {
    key: String,
    /// What the settings screen calls it; the key when absent.
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    /// The unit of its value, such as `A`.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<String>)]
    unit: Option<Unit>,
    /// The text for each value the profile labels.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    labels: Vec<Label>,
    #[serde(flatten)]
    declared: Declared,
    /// Whether trust lets it write (ADR 8); the device's `writes` switch applies as well.
    enable: Enable,
}

/// The text a setting's value is shown as.
#[derive(Serialize, ToSchema)]
struct Label {
    value: f64,
    text: String,
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
async fn capabilities(
    State((layouts, devices, clock)): State<(Layouts, Devices, Clock)>,
) -> Result<Json<Support>, Problem> {
    let versions = layouts.versions().await.map_err(|_| INTERNAL)?;
    let estimated = in_force(&versions, clock()).map(Version::estimated);
    let mut support: BTreeMap<String, DeviceSupport> = BTreeMap::new();
    for (device, ids) in estimated.unwrap_or_default() {
        support.entry(device.to_string()).or_default().estimated = ids
            .into_iter()
            .map(|id| format!("pv.string.power[{id}]"))
            .collect();
    }
    for device in devices.writable().await.map_err(|_| INTERNAL)? {
        let entry = support.entry(device.id.to_string()).or_default();
        entry.writes = device.writes;
        entry.settings = device
            .settings
            .iter()
            .map(|(setting, enable)| setting_support(setting, *enable))
            .collect();
    }
    let devices = support;
    let support = sunreye_profile::SUPPORT;
    Ok(Json(Support {
        version: env!("CARGO_PKG_VERSION"),
        schema: Schemas {
            min: support.schema.min,
            max: support.schema.max,
        },
        capabilities: support.capabilities,
        transports: Endpoint::TRANSPORTS,
        devices,
    }))
}

fn setting_support(setting: &sunreye_profile::Setting, enable: Enable) -> SettingSupport {
    SettingSupport {
        key: setting.key.clone(),
        name: setting.name().map(str::to_owned),
        unit: setting.unit(),
        labels: setting
            .labels()
            .iter()
            .map(|(value, text)| Label {
                value: *value,
                text: text.clone(),
            })
            .collect(),
        declared: Declared::from(setting),
        enable,
    }
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
    #[serde(rename = "auth.forbidden")]
    AuthForbidden,
    #[serde(rename = "viewer.none")]
    ViewerNone,
    #[serde(rename = "viewer.name")]
    ViewerName,
    #[serde(rename = "viewer.value")]
    ViewerValue,
    #[serde(rename = "token.none")]
    TokenNone,
    #[serde(rename = "token.value")]
    TokenValue,
    #[serde(rename = "history.range")]
    HistoryRange,
    #[serde(rename = "history.counter")]
    HistoryCounter,
    #[serde(rename = "forecast.range")]
    ForecastRange,
    #[serde(rename = "role.none")]
    RoleNone,
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
    /// A scene's grid names no roof face, or a module no string of the layout or one of
    /// another module type.
    #[serde(rename = "layout.scene")]
    LayoutScene,
    #[serde(rename = "layout.setback")]
    LayoutSetback,
    #[serde(rename = "layout.overlap")]
    LayoutOverlap,
    /// An uploaded car body past 20 MB.
    #[serde(rename = "car.size")]
    CarSize,
    /// An uploaded car body that is no glTF 2.0 binary container.
    #[serde(rename = "car.file")]
    CarFile,
    /// An uploaded car body naming a `uri`: its buffers and images must be embedded.
    #[serde(rename = "car.uri")]
    CarUri,
    #[serde(rename = "car.none")]
    CarNone,
    #[serde(rename = "topology.none")]
    TopologyNone,
    #[serde(rename = "topology.tree")]
    TopologyTree,
    #[serde(rename = "topology.point")]
    TopologyPoint,
    #[serde(rename = "topology.claim")]
    TopologyClaim,
    #[serde(rename = "topology.role")]
    TopologyRole,
    #[serde(rename = "topology.device")]
    TopologyDevice,
    #[serde(rename = "tariff.none")]
    TariffNone,
    #[serde(rename = "tariff.band")]
    TariffBand,
    #[serde(rename = "tariff.past")]
    TariffPast,
    #[serde(rename = "tariff.retention")]
    TariffRetention,
    #[serde(rename = "investment.value")]
    InvestmentValue,
    #[serde(rename = "location.none")]
    LocationNone,
    #[serde(rename = "location.value")]
    LocationValue,
    #[serde(rename = "zone.value")]
    ZoneValue,
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
    #[serde(rename = "device.transport")]
    DeviceTransport,
    #[serde(rename = "device.profile")]
    DeviceProfile,
    #[serde(rename = "device.profile-change")]
    DeviceProfileChange,
    #[serde(rename = "device.address")]
    DeviceAddress,
    #[serde(rename = "scan.subnet")]
    ScanSubnet,
    #[serde(rename = "scan.busy")]
    ScanBusy,
    #[serde(rename = "setting.none")]
    SettingNone,
    #[serde(rename = "setting.read-only")]
    SettingReadOnly,
    #[serde(rename = "setting.value")]
    SettingValue,
    #[serde(rename = "setting.writes-off")]
    SettingWritesOff,
    #[serde(rename = "setting.interval")]
    SettingInterval,
    #[serde(rename = "setting.precondition")]
    SettingPrecondition,
    #[serde(rename = "setting.community")]
    SettingCommunity,
    #[serde(rename = "setting.no-snapshot")]
    SettingNoSnapshot,
    #[serde(rename = "setting.not-enabled")]
    SettingNotEnabled,
    #[serde(rename = "secret.missing")]
    SecretMissing,
    #[serde(rename = "secret.value")]
    SecretValue,
    #[serde(rename = "index.value")]
    IndexValue,
    #[serde(rename = "update.none")]
    UpdateNone,
    /// An import already runs.
    #[serde(rename = "import.busy")]
    ImportBusy,
    /// No archive at that path under `/share`, or none uploaded.
    #[serde(rename = "import.path")]
    ImportPath,
    /// An uploaded archive past the size cap.
    #[serde(rename = "import.size")]
    ImportSize,
    /// The file is no v3 archive this build reads.
    #[serde(rename = "import.file")]
    ImportFile,
    /// A mapping names a v3 device the archive lacks or a v5 device not registered.
    #[serde(rename = "import.device")]
    ImportDevice,
    /// The archive lacks the v3 profile of a mapped device.
    #[serde(rename = "import.profile")]
    ImportProfile,
    /// A backup's name that is empty, hidden or holds a path.
    #[serde(rename = "backup.name")]
    BackupName,
    /// A backup never overwrites a file.
    #[serde(rename = "backup.exists")]
    BackupExists,
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
