//! The connection and device routes, behind the admin's session.

use axum::Json;
use axum::extract::rejection::{JsonRejection, PathRejection};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use serde::Serialize;
use utoipa::ToSchema;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use super::{Connection, ConnectionDraft, Device, DeviceDraft, Devices, INTERNAL};
use crate::api::{Clock, Problem, ProblemDetails};

const BODY: Problem = Problem {
    status: StatusCode::BAD_REQUEST,
    code: "request.body",
};
const PATH: Problem = Problem {
    status: StatusCode::BAD_REQUEST,
    code: "request.path",
};

type DevicesState = State<(Devices, Clock)>;

impl Devices {
    pub fn routes(self, clock: Clock) -> OpenApiRouter {
        OpenApiRouter::new()
            .routes(routes!(list_connections, add_connection))
            .routes(routes!(change_connection, remove_connection))
            .routes(routes!(list_devices, add_device))
            .routes(routes!(change_device, remove_device))
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
    let connections = devices.connections().await.map_err(|_| INTERNAL)?;
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
    let devices = devices.devices().await.map_err(|_| INTERNAL)?;
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
