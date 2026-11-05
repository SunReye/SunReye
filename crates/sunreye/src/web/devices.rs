//! The device roster on the 3.x paths and shapes (`DeviceRoster`, `DeviceView`, `ConnectionView` in
//! `packages/contracts/src/devices/types.ts`): connections and devices listed, added, edited, retired and
//! removed by id. Every change re-applies polling. What the core keeps no store for (PV arrays, a pack,
//! integration settings) is answered empty or null.

use std::collections::BTreeMap;
use std::sync::Arc;

use axum::Json;
use axum::extract::State;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use utoipa::ToSchema;

use super::{ApiError, ApiJson, ApiPath, ErrorBody};
use crate::live::iso;
use crate::profile::Profile;
use crate::run::Core;
use crate::settings::{INTERVAL_KEY, TIMEOUT_KEY, Transport, poll_interval, poll_timeout};
use crate::sources::{find_profile, installed};
use crate::store::{
    ConnectionEdit, ConnectionRow, DeviceEdit, DeviceRow, NewConnection, NewDevice, Removal, first_in_service,
};
use crate::weather::{Battery, DevicePv, PvArray};

/// The roles an operator may add, as 3.x lists them.
const ROLES: [&str; 4] = ["inverter", "meter", "charger", "controller"];
/// Modbus unit ids; 248–255 are reserved.
const UNIT_MAX: i64 = 247;
/// 3.x's slug limit, which bounds a name.
const NAME_MAX: usize = 48;
const DEFAULT_PORT: i64 = 502;

#[derive(Debug, Clone, Copy, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum ConnectionKind {
    Modbus,
}

/// A Modbus endpoint. `timeoutMs` and `pollIntervalMs` are the core's, for every connection, and
/// `/api/settings/inverter` sets them: an edit stating other values is refused, an add ignores them.
// No per-connection timings: an edit refuses a stated value not the core's (null included), an add drops both.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ModbusParams {
    host: String,
    #[serde(default = "default_port")]
    port: i64,
    #[serde(default = "default_transport")]
    transport: Transport,
    #[serde(default, deserialize_with = "present")]
    #[schema(value_type = i64, required = false)]
    timeout_ms: Option<i64>,
    #[serde(default, deserialize_with = "present")]
    #[schema(value_type = i64, required = false)]
    poll_interval_ms: Option<i64>,
    /// The stick's serial, `solarman-v5` only.
    #[serde(skip_serializing_if = "Option::is_none")]
    logger_serial: Option<i64>,
}

/// A cleared field sends `null`; read as absent it would pass an edit as an unchanged save, so it fails to parse.
fn present<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<i64>, D::Error> {
    i64::deserialize(d).map(Some)
}

const fn default_port() -> i64 {
    DEFAULT_PORT
}

const fn default_transport() -> Transport {
    Transport::Tcp
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ConnectionView {
    id: i64,
    name: String,
    kind: ConnectionKind,
    params: ModbusParams,
}

#[derive(Debug, Clone, Copy, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum DeviceKind {
    Modbus,
}

/// Why a device is, or is not, polled.
#[derive(Debug, Clone, Copy, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum DeviceState {
    Polling,
    /// Its profile is not installed.
    Idle,
    Retired,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DeviceView {
    id: i64,
    /// The device id as a decimal string.
    slug: String,
    name: String,
    profile_id: String,
    role: String,
    unit_id: u8,
    connection_id: i64,
    #[schema(value_type = Object)]
    params: Map<String, Value>,
    arrays: Vec<PvArray>,
    /// %/°C; the plant's when null.
    temp_coefficient: Option<f64>,
    /// %; the plant's when null.
    system_loss: Option<f64>,
    /// UTC ISO 8601 while retired.
    retired_at: Option<String>,
    connection: Option<ConnectionView>,
    battery: Option<Battery>,
    profile_name: Option<String>,
    profile_known: bool,
    kind: DeviceKind,
    state: DeviceState,
    integration: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DeviceRoster {
    devices: Vec<DeviceView>,
    connections: Vec<ConnectionView>,
}

/// A connection as a writer states it.
#[derive(Debug, Deserialize, ToSchema)]
pub struct NewConnectionRequest {
    name: String,
    /// `modbus`; the core reaches no other kind.
    kind: String,
    #[schema(value_type = ModbusParams)]
    params: Value,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ConnectionPatch {
    name: Option<String>,
    /// Accepted when it is the connection's own kind.
    kind: Option<String>,
    #[schema(value_type = Option<ModbusParams>)]
    params: Option<Value>,
}

/// An existing connection by id, or one to create with the device.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(untagged)]
pub enum ConnectionChoice {
    Existing { id: i64 },
    Create { create: NewConnectionRequest },
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct NewDeviceRequest {
    /// `profile` or absent; the core authors no other tier.
    via: Option<String>,
    connection: ConnectionChoice,
    role: String,
    name: String,
    profile_id: String,
    unit_id: i64,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DevicePatch {
    name: Option<String>,
    role: Option<String>,
    unit_id: Option<i64>,
    connection_id: Option<i64>,
    profile_id: Option<String>,
    /// True retires the device: kept with its history, no longer polled. False restores it.
    retired: Option<bool>,
    /// Replaces the inverter's arrays.
    arrays: Option<Vec<PvArray>>,
    temp_coefficient: Option<f64>,
    system_loss: Option<f64>,
    /// `null` removes the pack; absent leaves it.
    #[allow(clippy::option_option, reason = "absent leaves the pack, null removes it")]
    #[serde(default, deserialize_with = "stated_or_null")]
    #[schema(value_type = Option<Battery>, required = false)]
    battery: Option<Option<Battery>>,
}

#[allow(clippy::option_option, reason = "absent leaves the pack, null removes it")]
fn stated_or_null<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<Option<Battery>>, D::Error> {
    Option::<Battery>::deserialize(d).map(Some)
}

impl DevicePatch {
    /// The inverter-only field the patch names first.
    fn pv_field(&self) -> Option<&'static str> {
        if self.battery.is_some() {
            return Some("battery");
        }
        (self.arrays.is_some() || self.temp_coefficient.is_some() || self.system_loss.is_some())
            .then_some("arrays")
    }

    fn apply_pv(self, mut pv: DevicePv) -> DevicePv {
        pv.arrays = self.arrays.unwrap_or(pv.arrays);
        pv.temp_coefficient = self.temp_coefficient.or(pv.temp_coefficient);
        pv.system_loss = self.system_loss.or(pv.system_loss);
        pv.battery = self.battery.unwrap_or(pv.battery);
        pv
    }
}

/// The `index` of every `pv.string.*` metric the profile reads.
fn strings(profile: Option<&Profile>) -> Vec<u32> {
    let metrics = profile.map(|p| p.metrics.as_slice()).unwrap_or_default();
    metrics
        .iter()
        .filter(|m| m.role.as_deref().is_some_and(|r| r.starts_with("pv.string.")))
        .filter_map(|m| m.index)
        .collect()
}

#[derive(Debug, Serialize, ToSchema)]
pub struct Removed {
    ok: bool,
    id: i64,
}

/// 3.x's refusal to retire or delete the inverter settings' device.
fn polled() -> ApiError {
    ApiError::conflict("this device is the one being polled; change the inverter connection first")
}

fn refused(field: &'static str, message: &str) -> ApiError {
    ApiError::bad_request(format!("{field}: {message}")).on(field)
}

fn positive_id(id: i64) -> Result<i64, ApiError> {
    if id > 0 { Ok(id) } else { Err(ApiError::bad_request("id must be a positive integer")) }
}

fn checked_name(name: &str) -> Result<String, ApiError> {
    let name = name.trim();
    if name.chars().count() > NAME_MAX {
        return Err(refused("name", &format!("must be at most {NAME_MAX} characters")));
    }
    if !name.chars().any(char::is_alphanumeric) {
        return Err(refused("name", "must contain a letter or a digit"));
    }
    Ok(name.to_owned())
}

fn checked_role(role: &str) -> Result<String, ApiError> {
    ROLES
        .contains(&role)
        .then(|| role.to_owned())
        .ok_or_else(|| refused("role", &format!("one of {}", ROLES.join(", "))))
}

fn checked_unit(unit: i64) -> Result<u8, ApiError> {
    u8::try_from(unit)
        .ok()
        .filter(|unit| i64::from(*unit) <= UNIT_MAX)
        .ok_or_else(|| refused("unitId", &format!("unit id must be 0–{UNIT_MAX}")))
}

fn modbus_only(kind: &str) -> Result<(), ApiError> {
    if kind == "modbus" { Ok(()) } else { Err(refused("kind", "this core reaches Modbus connections only")) }
}

fn modbus_params(params: Value) -> Result<ModbusParams, ApiError> {
    serde_json::from_value(params).map_err(|e| refused("params", &e.to_string()))
}

/// An added connection's endpoint: the core's poll timing applies whatever the writer states.
fn added_endpoint(mut params: Value) -> Result<NewConnection, ApiError> {
    if let Some(params) = params.as_object_mut() {
        params.remove("timeoutMs");
        params.remove("pollIntervalMs");
    }
    checked_endpoint(&modbus_params(params)?)
}

fn checked_endpoint(params: &ModbusParams) -> Result<NewConnection, ApiError> {
    let host = params.host.trim();
    if host.is_empty() {
        return Err(refused("host", "host is required"));
    }
    let port = u16::try_from(params.port).ok().filter(|port| *port > 0);
    let port = port.ok_or_else(|| refused("params", "port must be 1–65535"))?;
    let serial = match (params.transport, params.logger_serial) {
        (Transport::SolarmanV5, Some(serial)) => Some(
            u32::try_from(serial)
                .ok()
                .filter(|serial| *serial > 0)
                .ok_or_else(|| refused("params", "logger serial must be 1–4294967295"))?,
        ),
        _ => None,
    };
    Ok(NewConnection {
        transport: params.transport.wire(),
        host: host.to_owned(),
        port,
        logger_serial: serial,
    })
}

/// What a view needs besides the rows.
struct Context {
    profiles: Vec<crate::sources::Installed>,
    pv: BTreeMap<i64, DevicePv>,
    timeout_ms: i64,
    interval_ms: i64,
}

impl Context {
    async fn load(core: &Core) -> Result<Self, ApiError> {
        let millis = |d: std::time::Duration| i64::try_from(d.as_millis()).unwrap_or(i64::MAX);
        Ok(Self {
            profiles: installed(&core.store).await?,
            pv: core.store.device_pv().await?,
            timeout_ms: millis(poll_timeout(core.store.setting(TIMEOUT_KEY).await?.as_deref())),
            interval_ms: millis(poll_interval(core.store.setting(INTERVAL_KEY).await?.as_deref())),
        })
    }

    /// An edit's stated poll timing must be the core's, so a changed value is not dropped unsaid.
    fn same_timing(&self, params: &ModbusParams) -> Result<(), ApiError> {
        let stated = [
            ("timeoutMs", params.timeout_ms, self.timeout_ms),
            ("pollIntervalMs", params.poll_interval_ms, self.interval_ms),
        ];
        match stated.into_iter().find(|(_, value, core)| value.is_some_and(|value| value != *core)) {
            Some((key, _, core)) => Err(refused(
                "params",
                &format!("{key} is {core} for every connection; change it in the inverter settings"),
            )),
            None => Ok(()),
        }
    }

    fn profile(&self, core: &Core, id: &str) -> Option<Arc<Profile>> {
        find_profile(&core.bundle, &self.profiles, id)
    }

    fn connection(&self, row: &ConnectionRow) -> ConnectionView {
        let params = ModbusParams {
            host: row.host.clone(),
            port: i64::from(row.port),
            transport: row.transport.into(),
            timeout_ms: Some(self.timeout_ms),
            poll_interval_ms: Some(self.interval_ms),
            logger_serial: row.logger_serial.map(i64::from),
        };
        ConnectionView { id: row.id, name: row.name.clone(), kind: ConnectionKind::Modbus, params }
    }

    fn device(&self, core: &Core, row: DeviceRow, connections: &[ConnectionRow]) -> DeviceView {
        let profile_name = self.profile(core, &row.profile_id).map(|profile| profile.name.clone());
        let state = match (row.in_service(), &profile_name) {
            (false, _) => DeviceState::Retired,
            (true, Some(_)) => DeviceState::Polling,
            (true, None) => DeviceState::Idle,
        };
        // An unnamed device is its profile's, as 3.x names the device it provisions.
        let name = row.name.or_else(|| profile_name.clone()).unwrap_or_else(|| row.profile_id.clone());
        let pv = self.pv.get(&row.id).cloned().unwrap_or_default();
        DeviceView {
            id: row.id,
            slug: row.id.to_string(),
            name,
            profile_id: row.profile_id,
            role: row.role,
            unit_id: row.unit_id,
            connection_id: row.connection_id,
            params: Map::new(),
            arrays: pv.arrays,
            temp_coefficient: pv.temp_coefficient,
            system_loss: pv.system_loss,
            retired_at: row.retired_at,
            connection: connections.iter().find(|c| c.id == row.connection_id).map(|c| self.connection(c)),
            battery: pv.battery,
            profile_known: profile_name.is_some(),
            profile_name,
            kind: DeviceKind::Modbus,
            state,
            integration: None,
        }
    }
}

async fn view_of(core: &Core, id: i64) -> Result<DeviceView, ApiError> {
    let context = Context::load(core).await?;
    let connections = core.store.connections().await?;
    let row = core.store.devices().await?.into_iter().find(|device| device.id == id);
    let row = row.ok_or_else(ApiError::internal)?;
    Ok(context.device(core, row, &connections))
}

/// Every device, retired ones included, with every connection.
#[utoipa::path(
    get,
    path = "/api/devices",
    operation_id = "listDevices",
    responses(
        (status = 200, body = DeviceRoster),
        (status = 401, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 500, body = ErrorBody)
    )
)]
pub async fn list(State(core): State<Arc<Core>>) -> Result<Json<DeviceRoster>, ApiError> {
    let context = Context::load(&core).await?;
    let connections = core.store.connections().await?;
    let devices = core.store.devices().await?;
    Ok(Json(DeviceRoster {
        devices: devices.into_iter().map(|row| context.device(&core, row, &connections)).collect(),
        connections: connections.iter().map(|row| context.connection(row)).collect(),
    }))
}

/// Checks a device's profile, connection and unit id before anything is written.
async fn check_target(
    core: &Core,
    device: Option<i64>,
    profile_id: &str,
    connection: Option<(i64, &'static str)>,
    unit: (i64, u8),
) -> Result<(), ApiError> {
    if core.profile(profile_id).await?.is_none() {
        return Err(refused("profileId", "profile not installed on this server"));
    }
    if let Some((id, field)) = connection
        && !core.store.connections().await?.iter().any(|c| c.id == id)
    {
        return Err(refused(field, "not one of this core's connections"));
    }
    let (connection_id, unit_id) = unit;
    let taken = core
        .store
        .devices()
        .await?
        .iter()
        .any(|d| Some(d.id) != device && d.connection_id == connection_id && d.unit_id == unit_id);
    if taken {
        return Err(ApiError::conflict("unit id: already used by a device on this connection").on("unitId"));
    }
    Ok(())
}

#[utoipa::path(
    post,
    path = "/api/devices",
    operation_id = "addDevice",
    request_body = NewDeviceRequest,
    responses(
        (status = 200, body = DeviceView),
        (status = 400, body = ErrorBody),
        (status = 401, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 409, body = ErrorBody),
        (status = 500, body = ErrorBody)
    )
)]
pub async fn add(
    State(core): State<Arc<Core>>,
    ApiJson(request): ApiJson<NewDeviceRequest>,
) -> Result<Json<DeviceView>, ApiError> {
    if request.via.as_deref().is_some_and(|via| via != "profile") {
        return Err(refused("via", "this core adds devices by profile only"));
    }
    let (name, role, unit_id) =
        (checked_name(&request.name)?, checked_role(&request.role)?, checked_unit(request.unit_id)?);
    let connection_id = match request.connection {
        ConnectionChoice::Existing { id } => {
            check_target(&core, None, &request.profile_id, Some((id, "connection")), (id, unit_id)).await?;
            id
        }
        ConnectionChoice::Create { create } => {
            modbus_only(&create.kind)?;
            let connection_name = checked_name(&create.name)?;
            let new = added_endpoint(create.params)?;
            check_target(&core, None, &request.profile_id, None, (0, unit_id)).await?;
            core.store.create_connection(&connection_name, &new).await?
        }
    };
    let device = NewDevice { connection_id, profile_id: request.profile_id, unit_id };
    let id = core.store.create_device(&device, Some(&name), &role).await?;
    core.apply().await?;
    Ok(Json(view_of(&core, id).await?))
}

#[utoipa::path(
    patch,
    path = "/api/devices/{id}",
    operation_id = "patchDevice",
    params(("id" = i64, Path)),
    request_body = DevicePatch,
    responses(
        (status = 200, body = DeviceView),
        (status = 400, body = ErrorBody),
        (status = 401, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 409, body = ErrorBody),
        (status = 500, body = ErrorBody)
    )
)]
pub async fn patch(
    State(core): State<Arc<Core>>,
    ApiPath(id): ApiPath<i64>,
    ApiJson(patch): ApiJson<DevicePatch>,
) -> Result<Json<DeviceView>, ApiError> {
    let id = positive_id(id)?;
    let devices = core.store.devices().await?;
    let current = devices.iter().find(|device| device.id == id);
    let current = current.ok_or_else(|| ApiError::not_found(format!("device {id} does not exist")))?;
    if patch.retired == Some(true) && first_in_service(&devices).is_some_and(|first| first.id == id) {
        return Err(polled());
    }
    let edit = DeviceEdit {
        name: patch.name.as_deref().map(checked_name).transpose()?,
        role: patch.role.as_deref().map(checked_role).transpose()?,
        unit_id: patch.unit_id.map(checked_unit).transpose()?,
        connection_id: patch.connection_id,
        profile_id: patch.profile_id.clone(),
        retired_at: patch.retired.map(|retired| retired.then(|| iso(core.now_ms()))),
    };
    if edit == DeviceEdit::default() && patch.pv_field().is_none() {
        return Err(ApiError::bad_request("nothing to change"));
    }
    let pv = patched_pv(&core, current, &edit, patch).await?;
    check_moved(&core, current, &edit).await?;
    save_patch(&core, id, &edit, pv.as_ref()).await?;
    Ok(Json(view_of(&core, id).await?))
}

/// A device moved to another connection, profile or unit id must land on a free, known one.
async fn check_moved(core: &Core, current: &DeviceRow, edit: &DeviceEdit) -> Result<(), ApiError> {
    if edit.connection_id.is_none() && edit.profile_id.is_none() && edit.unit_id.is_none() {
        return Ok(());
    }
    let connection_id = edit.connection_id.unwrap_or(current.connection_id);
    let profile_id = edit.profile_id.as_deref().unwrap_or(&current.profile_id);
    let unit = (connection_id, edit.unit_id.unwrap_or(current.unit_id));
    let named = edit.connection_id.map(|connection| (connection, "connectionId"));
    check_target(core, Some(current.id), profile_id, named, unit).await
}

/// The inverter's PV description with the patch applied, if it names one, checked against the strings its profile reads.
async fn patched_pv(
    core: &Core,
    current: &DeviceRow,
    edit: &DeviceEdit,
    patch: DevicePatch,
) -> Result<Option<DevicePv>, ApiError> {
    let Some(field) = patch.pv_field() else { return Ok(None) };
    if edit.role.as_deref().unwrap_or(&current.role) != "inverter" {
        return Err(refused(field, "only an inverter carries PV arrays and a pack"));
    }
    let profile = core.profile(edit.profile_id.as_deref().unwrap_or(&current.profile_id)).await?;
    let pv = patch.apply_pv(core.store.device_pv().await?.remove(&current.id).unwrap_or_default());
    pv.validate(&strings(profile.as_deref())).map_err(|(field, message)| refused(field, &message))?;
    Ok(Some(pv))
}

/// Polling restarts only for a change to the device itself.
async fn save_patch(core: &Core, id: i64, edit: &DeviceEdit, pv: Option<&DevicePv>) -> Result<(), ApiError> {
    if let Some(pv) = pv {
        core.store.save_device_pv(id, pv).await?;
    }
    if *edit != DeviceEdit::default() {
        core.store.edit_device(id, edit).await?;
        core.apply().await?;
    }
    Ok(())
}

/// Only a device that never stored a reading: one with history is refused with `field: "history"`, so
/// the page offers retiring it instead.
#[utoipa::path(
    delete,
    path = "/api/devices/{id}",
    operation_id = "removeDevice",
    params(("id" = i64, Path)),
    responses(
        (status = 200, body = Removed),
        (status = 400, body = ErrorBody),
        (status = 401, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 409, body = ErrorBody),
        (status = 500, body = ErrorBody)
    )
)]
pub async fn remove(
    State(core): State<Arc<Core>>,
    ApiPath(id): ApiPath<i64>,
) -> Result<Json<Removed>, ApiError> {
    let id = positive_id(id)?;
    let devices = core.store.devices().await?;
    if !devices.iter().any(|device| device.id == id) {
        return Err(ApiError::not_found(format!("device {id} does not exist")));
    }
    if first_in_service(&devices).is_some_and(|first| first.id == id) {
        return Err(polled());
    }
    let history = || {
        ApiError::conflict("this device has recorded history; retire it instead to keep that history")
            .on("history")
    };
    // The open minute is history not yet stored.
    if !core.unstored.held(id).is_empty() {
        return Err(history());
    }
    match core.store.remove_device(id).await? {
        Removal::Missing => Err(ApiError::not_found(format!("device {id} does not exist"))),
        Removal::Kept => Err(history()),
        Removal::Removed => {
            core.apply().await?;
            Ok(Json(Removed { ok: true, id }))
        }
    }
}

/// A connection on its own, before any device is on it.
#[utoipa::path(
    post,
    path = "/api/connections",
    operation_id = "addConnection",
    request_body = NewConnectionRequest,
    responses(
        (status = 200, body = ConnectionView),
        (status = 400, body = ErrorBody),
        (status = 401, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 500, body = ErrorBody)
    )
)]
pub async fn add_connection(
    State(core): State<Arc<Core>>,
    ApiJson(request): ApiJson<NewConnectionRequest>,
) -> Result<Json<ConnectionView>, ApiError> {
    modbus_only(&request.kind)?;
    let name = checked_name(&request.name)?;
    let id = core.store.create_connection(&name, &added_endpoint(request.params)?).await?;
    Ok(Json(connection_view(&core, id).await?))
}

async fn connection_view(core: &Core, id: i64) -> Result<ConnectionView, ApiError> {
    let context = Context::load(core).await?;
    let row = core.store.connections().await?.into_iter().find(|connection| connection.id == id);
    Ok(context.connection(&row.ok_or_else(ApiError::internal)?))
}

/// Every device on the connection follows it.
#[utoipa::path(
    patch,
    path = "/api/connections/{id}",
    operation_id = "patchConnection",
    params(("id" = i64, Path)),
    request_body = ConnectionPatch,
    responses(
        (status = 200, body = ConnectionView),
        (status = 400, body = ErrorBody),
        (status = 401, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 409, body = ErrorBody),
        (status = 500, body = ErrorBody)
    )
)]
pub async fn patch_connection(
    State(core): State<Arc<Core>>,
    ApiPath(id): ApiPath<i64>,
    ApiJson(patch): ApiJson<ConnectionPatch>,
) -> Result<Json<ConnectionView>, ApiError> {
    let id = positive_id(id)?;
    if !core.store.connections().await?.iter().any(|connection| connection.id == id) {
        return Err(ApiError::not_found(format!("connection {id} does not exist")));
    }
    if patch.kind.as_deref().is_some_and(|kind| kind != "modbus") {
        return Err(ApiError::conflict(
            "kind: a connection's kind cannot change (this one is modbus); add a new connection instead",
        )
        .on("kind"));
    }
    let endpoint = match patch.params {
        Some(params) => {
            let params = modbus_params(params)?;
            let endpoint = checked_endpoint(&params)?;
            Context::load(&core).await?.same_timing(&params)?;
            Some(endpoint)
        }
        None => None,
    };
    let edit = ConnectionEdit { name: patch.name.as_deref().map(checked_name).transpose()?, endpoint };
    if edit == ConnectionEdit::default() {
        return Err(ApiError::bad_request("nothing to change"));
    }
    core.store.edit_connection(id, &edit).await?;
    core.apply().await?;
    Ok(Json(connection_view(&core, id).await?))
}

/// Refused while any device, retired included, is on it.
#[utoipa::path(
    delete,
    path = "/api/connections/{id}",
    operation_id = "removeConnection",
    params(("id" = i64, Path)),
    responses(
        (status = 200, body = Removed),
        (status = 400, body = ErrorBody),
        (status = 401, body = ErrorBody),
        (status = 403, body = ErrorBody),
        (status = 404, body = ErrorBody),
        (status = 409, body = ErrorBody),
        (status = 500, body = ErrorBody)
    )
)]
pub async fn remove_connection(
    State(core): State<Arc<Core>>,
    ApiPath(id): ApiPath<i64>,
) -> Result<Json<Removed>, ApiError> {
    let id = positive_id(id)?;
    match core.store.remove_connection(id).await? {
        Removal::Missing => Err(ApiError::not_found(format!("connection {id} does not exist"))),
        Removal::Kept => {
            let devices = core.store.devices().await?;
            let bound: Vec<String> =
                devices.iter().filter(|d| d.connection_id == id).map(|d| d.id.to_string()).collect();
            Err(ApiError::conflict(format!(
                "connection still has {} device(s): {}",
                bound.len(),
                bound.join(", ")
            )))
        }
        Removal::Removed => Ok(Json(Removed { ok: true, id })),
    }
}
