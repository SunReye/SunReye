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
use crate::bus::DeviceId;
use crate::cars::CarBodies;
use crate::changes::Changes;
use crate::correction::Corrections;
use crate::devices::{Devices, Transport};
use crate::import::Imports;
use crate::layout::{Layouts, Version, in_force};
use crate::live::{Frame, Live};
use crate::location::PlantLocation;
use crate::logs::Logs;
use crate::profiles::Profiles;
use crate::settings::{Declared, Enable};
use crate::spa;
use crate::spot::SpotZone;
use crate::storage;
use crate::tariff::Tariffs;
use crate::topology::Topologies;
use crate::views::Views;

const ROUTE: Problem = Problem {
    status: StatusCode::NOT_FOUND,
    code: Code::RequestRoute,
};
const METHOD: Problem = Problem {
    status: StatusCode::METHOD_NOT_ALLOWED,
    code: Code::RequestMethod,
};

mod battery;
mod forecasts;
mod history;
mod records;
mod roles;
mod series;
mod statistics;

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
    /// Explore's saved views (ADR 22).
    pub views: Views,
    /// The plant timezone and change-point retention.
    pub storage: storage::Settings,
    pub imports: Imports,
    pub backups: Backups,
    /// The core's last log lines (ADR 2).
    pub logs: Logs,
    /// The wall clock: history ends at its now.
    pub clock: Clock,
}

pub type Clock = std::sync::Arc<dyn Fn() -> std::time::SystemTime + Send + Sync>;

pub fn router(api: Api) -> Router {
    let api_routes = merged(vec![
        capability_routes(&api),
        stored_routes(&api),
        OpenApiRouter::new()
            .routes(routes!(live_values))
            .routes(routes!(roles::role))
            .with_state(api.live),
        OpenApiRouter::new()
            .routes(routes!(problems))
            .with_state(api.problems),
        api.topologies.clone().residual_routes(api.history),
        api.topologies
            .routes(api.devices.clone(), Clock::clone(&api.clock)),
        api.devices.routes(Clock::clone(&api.clock)),
        api.tariffs.routes(Clock::clone(&api.clock)),
        api.changes.routes(),
        api.cars.routes(),
        api.views.routes(Clock::clone(&api.clock)),
        api.location.routes(Clock::clone(&api.clock)),
        api.spot.routes(Clock::clone(&api.clock)),
        storage_routes(api.storage, &api.clock),
        api.profiles.routes(Clock::clone(&api.clock)),
        api.imports.routes(),
        api.backups.routes(),
        api.logs.routes(),
        api.layouts.routes(Clock::clone(&api.clock)),
    ]);
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

/// Merges feature routers into one.
///
/// # Panics
///
/// On a schema name two of them define differently: utoipa keeps the first, which would type the
/// other's route wrong (ADR 9). Every core start builds the router, so a test catches it.
pub(crate) fn merged<S>(routers: impl IntoIterator<Item = OpenApiRouter<S>>) -> OpenApiRouter<S>
where
    S: Clone + Send + Sync + 'static,
{
    routers
        .into_iter()
        .fold(OpenApiRouter::new(), |all, router| {
            let schemas = |r: &OpenApiRouter<S>| {
                r.get_openapi()
                    .components
                    .as_ref()
                    .map(|c| c.schemas.clone())
                    .unwrap_or_default()
            };
            let (had, adds) = (schemas(&all), schemas(&router));
            for (name, schema) in &adds {
                assert!(
                    had.get(name).is_none_or(|first| first == schema),
                    "schema `{name}` is defined twice, differently"
                );
            }
            all.merge(router)
        })
}

/// The plant's storage settings: its timezone and change-point retention.
fn storage_routes(storage: storage::Settings, clock: &Clock) -> OpenApiRouter {
    merged([
        crate::zone::routes(storage.zones, Clock::clone(clock)),
        crate::retention::routes(storage.retention, Clock::clone(clock)),
    ])
}

/// History, forecasts and the learned corrections: what storage holds, read like history.
fn stored_routes(api: &Api) -> OpenApiRouter {
    merged([
        OpenApiRouter::new()
            .routes(routes!(history::history))
            .with_state((api.history.clone(), Clock::clone(&api.clock))),
        OpenApiRouter::new()
            .routes(routes!(statistics::statistics))
            .with_state((api.history.clone(), api.storage.zones.watch())),
        OpenApiRouter::new()
            .routes(routes!(forecasts::forecasts))
            .with_state(api.history.clone()),
        OpenApiRouter::new()
            .routes(routes!(records::records))
            .with_state((
                api.history.clone(),
                api.storage.zones.watch(),
                Clock::clone(&api.clock),
            )),
        OpenApiRouter::new()
            .routes(routes!(series::catalog))
            .with_state((
                api.history.clone(),
                api.devices.clone(),
                api.layouts.clone(),
            )),
        OpenApiRouter::new()
            .routes(routes!(battery::capacity))
            .with_state((api.history.clone(), Clock::clone(&api.clock))),
        api.corrections.clone().routes(
            api.location.watch(),
            api.storage.zones.watch(),
            Clock::clone(&api.clock),
        ),
    ])
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
    /// The transports a connection can be configured with.
    transports: &'static [Transport],
    /// By device id, what the layout in force says of its series.
    devices: BTreeMap<String, DeviceSupport>,
}

#[derive(Default, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
struct DeviceSupport {
    /// Series computed from others, not measured, such as `pv.string.power[3]` of a string
    /// in parallel (ADR 17).
    estimated: Vec<String>,
    /// The series its profile publishes, extras left out, such as `load.phase.power[2]`: what
    /// it can report, not what it reports now.
    series: Vec<String>,
    /// Whether the admin switched its writes on (ADR 7).
    writes: bool,
    /// What its profile lets the core write, in the profile's order.
    settings: Vec<SettingSupport>,
    /// An inverter's maximum DC input voltage in volts, from its profile: what a string's
    /// open-circuit voltage at −10 °C is checked against (ADR 20).
    #[serde(skip_serializing_if = "Option::is_none")]
    max_input_voltage: Option<f64>,
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
    let versions = layouts.versions().await.map_err(internal)?;
    let estimated = in_force(&versions, clock()).map(Version::estimated);
    let mut support: BTreeMap<String, DeviceSupport> = BTreeMap::new();
    for (device, ids) in estimated.unwrap_or_default() {
        support.entry(device.to_string()).or_default().estimated = ids
            .into_iter()
            .map(|id| format!("pv.string.power[{id}]"))
            .collect();
    }
    for device in devices.writable().await.map_err(internal)? {
        let entry = support.entry(device.id.to_string()).or_default();
        entry.series = device.series;
        entry.writes = device.writes;
        entry.settings = device
            .settings
            .iter()
            .map(|(setting, enable)| setting_support(setting, *enable))
            .collect();
    }
    for (DeviceId(device), volts) in layouts.inverters().max_input_voltages() {
        support
            .entry(device.to_string())
            .or_default()
            .max_input_voltage = Some(volts);
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
        transports: &Transport::ALL,
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
/// which a value changed or went stale. There is no replay: a client that falls behind is disconnected and
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

/// An internal error: the core failed, not the caller.
pub const INTERNAL: Problem = Problem {
    status: StatusCode::INTERNAL_SERVER_ERROR,
    code: Code::Internal,
};

/// Logs `cause` once and answers [`INTERNAL`]: the caller sees only the code.
pub fn internal(cause: impl std::fmt::Display) -> Problem {
    tracing::error!("internal: {cause}");
    INTERNAL
}

/// An instant as the API writes it: RFC 3339, UTC.
#[must_use]
pub fn rfc3339(time: std::time::SystemTime) -> String {
    jiff::Timestamp::try_from(time)
        .map(|t| t.to_string())
        .unwrap_or_default()
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
    /// No saved view has the id.
    #[serde(rename = "views.none")]
    ViewsNone,
    /// Another saved view holds the name.
    #[serde(rename = "views.name")]
    ViewsName,
    /// Twenty views are saved.
    #[serde(rename = "views.full")]
    ViewsFull,
    /// A blank or overlong name, or a query past 2 KB.
    #[serde(rename = "views.value")]
    ViewsValue,
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
    /// A module overlaps a roof chimney or a roof window.
    #[serde(rename = "layout.covered")]
    LayoutCovered,
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
    #[serde(rename = "tariff.charge")]
    TariffCharge,
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
    /// A retention of no days.
    #[serde(rename = "retention.value")]
    RetentionValue,
    #[serde(rename = "zone.value")]
    ZoneValue,
    #[serde(rename = "connection.none")]
    ConnectionNone,
    #[serde(rename = "connection.value")]
    ConnectionValue,
    /// A poll cycle outside 1 to 60 s, or one on a broker or an HTTP host.
    #[serde(rename = "connection.poll-seconds")]
    ConnectionPollSeconds,
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
    #[serde(rename = "deadband.role")]
    DeadbandRole,
    #[serde(rename = "deadband.kind")]
    DeadbandKind,
    #[serde(rename = "deadband.step")]
    DeadbandStep,
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
    /// The disk is full: history stops, live values continue.
    #[serde(rename = "storage.full")]
    StorageFull,
    #[serde(rename = "internal")]
    Internal,
}

impl From<storage::Problem> for Code {
    fn from(problem: storage::Problem) -> Self {
        match problem {
            storage::Problem::ClockUnsynced => Self::ClockUnsynced,
            storage::Problem::StorageFull => Self::StorageFull,
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
    /// The request body's member at fault, as an RFC 6901 JSON pointer such as
    /// `/strings/0/modules`, where the core can name it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pointer: Option<String>,
}

/// A [`Problem`] that names the request body's member at fault.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Refused {
    pub problem: Problem,
    pub pointer: Option<String>,
}

impl From<Problem> for Refused {
    fn from(problem: Problem) -> Self {
        Self {
            problem,
            pointer: None,
        }
    }
}

impl IntoResponse for Refused {
    fn into_response(self) -> Response {
        let Self { problem, pointer } = self;
        let details = ProblemDetails {
            status: problem.status.as_u16(),
            code: problem.code,
            pointer,
        };
        let mut response = (problem.status, axum::Json(details)).into_response();
        response.headers_mut().insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/problem+json"),
        );
        response
    }
}

impl IntoResponse for Problem {
    fn into_response(self) -> Response {
        Refused::from(self).into_response()
    }
}

#[cfg(test)]
mod tests;
