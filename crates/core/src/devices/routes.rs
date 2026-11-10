//! The connection and device routes, behind the admin's session.

use axum::Json;
use axum::extract::rejection::{JsonRejection, PathRejection};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use super::deadband::RoleDeadband;
use super::{ACTOR, Connection, ConnectionDraft, Device, DeviceDraft, Devices};
use crate::api::{Clock, Code, INTERNAL, Problem, ProblemDetails, internal};
use crate::scan::{ScanReport, ScanRequest};
use crate::settings::{Request, log};

const BODY: Problem = Problem {
    status: StatusCode::BAD_REQUEST,
    code: Code::RequestBody,
};
const PATH: Problem = Problem {
    status: StatusCode::BAD_REQUEST,
    code: Code::RequestPath,
};

type DevicesState = State<(Devices, Clock)>;

impl Devices {
    pub fn routes(self, clock: Clock) -> OpenApiRouter {
        OpenApiRouter::new()
            .routes(routes!(list_connections, add_connection))
            .routes(routes!(change_connection, remove_connection))
            .routes(routes!(list_devices, add_device))
            .routes(routes!(change_device, remove_device))
            .routes(routes!(write_setting))
            .routes(routes!(enable_setting, disable_setting))
            .routes(routes!(deadbands))
            .routes(routes!(set_deadband, remove_deadband))
            .routes(routes!(writes))
            .routes(routes!(scan))
            .with_state((self, clock))
    }
}

#[derive(Serialize, ToSchema)]
struct Connections {
    connections: Vec<Connection>,
}

#[utoipa::path(get, path = "/api/v1/connections", responses(
    (status = 200, body = Connections),
    (status = 401, body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn list_connections(State((devices, _)): DevicesState) -> Result<Json<Connections>, Problem> {
    let connections = devices.connections().await.map_err(internal)?;
    Ok(Json(Connections { connections }))
}

/// Adds a connection: an endpoint and its credentials.
#[utoipa::path(post, path = "/api/v1/connections", request_body = ConnectionDraft, responses(
    (status = 201, body = Connection),
    (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn add_connection(
    State((devices, clock)): DevicesState,
    body: Result<Json<ConnectionDraft>, JsonRejection>,
) -> Result<(StatusCode, Json<Connection>), Problem> {
    let Json(draft) = body.map_err(|_| BODY)?;
    let added = devices.add_connection(draft, clock()).await?;
    Ok((StatusCode::CREATED, Json(added)))
}

/// Changes a connection; its devices are polled through it at once.
#[utoipa::path(put, path = "/api/v1/connections/{id}", request_body = ConnectionDraft,
    params(("id" = u32, Path)), responses(
    (status = 200, body = Connection),
    (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn change_connection(
    State((devices, clock)): DevicesState,
    id: Result<Path<u32>, PathRejection>,
    body: Result<Json<ConnectionDraft>, JsonRejection>,
) -> Result<Json<Connection>, Problem> {
    let Path(id) = id.map_err(|_| PATH)?;
    let Json(draft) = body.map_err(|_| BODY)?;
    Ok(Json(devices.change_connection(id, draft, clock()).await?))
}

/// Removes a connection no device uses.
#[utoipa::path(delete, path = "/api/v1/connections/{id}", params(("id" = u32, Path)), responses(
    (status = 204),
    (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn remove_connection(
    State((devices, clock)): DevicesState,
    id: Result<Path<u32>, PathRejection>,
) -> Result<StatusCode, Problem> {
    let Path(id) = id.map_err(|_| PATH)?;
    devices.remove_connection(id, clock()).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Serialize, ToSchema)]
struct DeviceList {
    devices: Vec<Device>,
}

#[utoipa::path(get, path = "/api/v1/devices", responses(
    (status = 200, body = DeviceList),
    (status = 401, body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn list_devices(State((devices, _)): DevicesState) -> Result<Json<DeviceList>, Problem> {
    let devices = devices.devices().await.map_err(internal)?;
    Ok(Json(DeviceList { devices }))
}

/// Adds a device behind a connection and starts polling it.
#[utoipa::path(post, path = "/api/v1/devices", request_body = DeviceDraft, responses(
    (status = 201, body = Device),
    (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn add_device(
    State((devices, clock)): DevicesState,
    body: Result<Json<DeviceDraft>, JsonRejection>,
) -> Result<(StatusCode, Json<Device>), Problem> {
    let Json(draft) = body.map_err(|_| BODY)?;
    let added = devices.add_device(draft, clock()).await?;
    Ok((StatusCode::CREATED, Json(added)))
}

/// Changes a device's name, connection or unit id; its profile is fixed.
#[utoipa::path(put, path = "/api/v1/devices/{id}", request_body = DeviceDraft,
    params(("id" = u32, Path)), responses(
    (status = 200, body = Device),
    (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn change_device(
    State((devices, clock)): DevicesState,
    id: Result<Path<u32>, PathRejection>,
    body: Result<Json<DeviceDraft>, JsonRejection>,
) -> Result<Json<Device>, Problem> {
    let Path(id) = id.map_err(|_| PATH)?;
    let Json(draft) = body.map_err(|_| BODY)?;
    Ok(Json(devices.change_device(id, draft, clock()).await?))
}

/// Removes a device and stops polling it; its history stays under its id.
#[utoipa::path(delete, path = "/api/v1/devices/{id}", params(("id" = u32, Path)), responses(
    (status = 204),
    (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn remove_device(
    State((devices, clock)): DevicesState,
    id: Result<Path<u32>, PathRejection>,
) -> Result<StatusCode, Problem> {
    let Path(id) = id.map_err(|_| PATH)?;
    devices.remove_device(id, clock()).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// A setting's new value.
#[derive(Deserialize, ToSchema)]
struct SettingValue {
    /// In the setting's unit, a whole number of its steps.
    value: f64,
}

/// Writes a setting through the one funnel (ADR 7) and answers the attempt as the write log keeps
/// it. A refusal never reaches the device.
#[utoipa::path(put, path = "/api/v1/devices/{id}/settings/{key}", request_body = SettingValue,
    params(("id" = u32, Path), ("key" = String, Path)), responses(
    (status = 200, body = log::Entry),
    (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn write_setting(
    State((devices, clock)): DevicesState,
    path: Result<Path<(u32, String)>, PathRejection>,
    body: Result<Json<SettingValue>, JsonRejection>,
) -> Result<Json<log::Entry>, Problem> {
    let Path((id, key)) = path.map_err(|_| PATH)?;
    let Json(SettingValue { value }) = body.map_err(|_| BODY)?;
    let request = Request {
        key,
        value,
        actor: ACTOR,
        via: None,
    };
    let written = devices.write_setting(id, request, clock()).await?;
    Ok(Json(written))
}

/// Enables the writes of a setting as its profile declares it now (ADR 8). A community profile's
/// setting, or an official one not verified on hardware, writes only while enabled; a changed
/// declaration is off again until re-enabled.
#[utoipa::path(put, path = "/api/v1/devices/{id}/settings/{key}/enabled",
    params(("id" = u32, Path), ("key" = String, Path)), responses(
    (status = 204),
    (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn enable_setting(
    State((devices, clock)): DevicesState,
    path: Result<Path<(u32, String)>, PathRejection>,
) -> Result<StatusCode, Problem> {
    let Path((id, key)) = path.map_err(|_| PATH)?;
    devices.enable_setting(id, key, true, clock()).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Withdraws the admin's enable of a setting.
#[utoipa::path(delete, path = "/api/v1/devices/{id}/settings/{key}/enabled",
    params(("id" = u32, Path), ("key" = String, Path)), responses(
    (status = 204),
    (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn disable_setting(
    State((devices, clock)): DevicesState,
    path: Result<Path<(u32, String)>, PathRejection>,
) -> Result<StatusCode, Problem> {
    let Path((id, key)) = path.map_err(|_| PATH)?;
    devices.enable_setting(id, key, false, clock()).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Serialize, ToSchema)]
struct Deadbands {
    deadbands: Vec<RoleDeadband>,
}

/// Each role of a device with the deadband it is stored with (ADR 4): the admin's override, else
/// the profile's, else the role's default, else none.
#[utoipa::path(get, path = "/api/v1/devices/{id}/deadbands", params(("id" = u32, Path)),
    responses(
    (status = 200, body = Deadbands),
    (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn deadbands(
    State((devices, _)): DevicesState,
    id: Result<Path<u32>, PathRejection>,
) -> Result<Json<Deadbands>, Problem> {
    let Path(id) = id.map_err(|_| PATH)?;
    let deadbands = devices.deadbands(id).await?;
    Ok(Json(Deadbands { deadbands }))
}

/// A deadband override, in the role's unit.
#[derive(Deserialize, ToSchema)]
struct Override {
    deadband: f64,
}

/// Overrides a role's deadband for this device. Its series are stored with it at once, after
/// their pending change points are written. Refused below the role's quantisation step and on a
/// counter or enum.
#[utoipa::path(put, path = "/api/v1/devices/{id}/deadbands/{role}", request_body = Override,
    params(("id" = u32, Path), ("role" = String, Path)), responses(
    (status = 200, body = RoleDeadband),
    (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn set_deadband(
    State((devices, clock)): DevicesState,
    path: Result<Path<(u32, String)>, PathRejection>,
    body: Result<Json<Override>, JsonRejection>,
) -> Result<Json<RoleDeadband>, Problem> {
    let Path((id, role)) = path.map_err(|_| PATH)?;
    let Json(Override { deadband }) = body.map_err(|_| BODY)?;
    devices
        .set_deadband(id, role.clone(), Some(deadband), clock())
        .await?;
    let deadbands = devices.deadbands(id).await?;
    let set = deadbands.into_iter().find(|d| d.role == role);
    Ok(Json(set.ok_or(INTERNAL)?))
}

/// Removes a role's deadband override; the profile's or the role's default applies at once.
#[utoipa::path(delete, path = "/api/v1/devices/{id}/deadbands/{role}",
    params(("id" = u32, Path), ("role" = String, Path)), responses(
    (status = 204),
    (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn remove_deadband(
    State((devices, clock)): DevicesState,
    path: Result<Path<(u32, String)>, PathRejection>,
) -> Result<StatusCode, Problem> {
    let Path((id, role)) = path.map_err(|_| PATH)?;
    devices.set_deadband(id, role, None, clock()).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Serialize, ToSchema)]
struct WriteLog {
    writes: Vec<log::Entry>,
}

/// Every write attempt, oldest first.
#[utoipa::path(get, path = "/api/v1/writes", responses(
    (status = 200, body = WriteLog),
    (status = 401, body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn writes(State((devices, _)): DevicesState) -> Result<Json<WriteLog>, Problem> {
    let writes = devices.writes().await.map_err(internal)?;
    Ok(Json(WriteLog { writes }))
}

/// Scans the local network for devices and proposes a profile and unit id for each (ADR 6). Read
/// only; an endpoint already configured is not touched.
#[utoipa::path(post, path = "/api/v1/scan", request_body = ScanRequest, responses(
    (status = 200, body = ScanReport),
    (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn scan(
    State((devices, _)): DevicesState,
    body: Result<Json<ScanRequest>, JsonRejection>,
) -> Result<Json<ScanReport>, Problem> {
    let Json(request) = body.map_err(|_| BODY)?;
    Ok(Json(devices.scan(request.subnet.as_deref()).await?))
}
