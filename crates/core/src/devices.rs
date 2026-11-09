//! Devices and connections (ADR 6): the admin registers devices behind connections, and the core
//! polls them with one task per endpoint.
//!
//! The devices module owns the `connection`, `secret` and `device` tables. Ids are never reused.
//! Every change appends to the change log (ADR 19) in the same transaction and applies at once:
//! the tasks of the endpoints it touches restart, and the series of a device are declared to
//! storage in its profile's steps before it is polled.

mod routes;
mod store;

use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::SystemTime;

use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use sunreye_profile::Profile;
use tokio::sync::Mutex;
use utoipa::ToSchema;

use crate::api::Problem;
use crate::bus::{Bus, DeviceId};
use crate::changes::{Action, Entry, Subject};
use crate::endpoint::{self, CADENCE, Task};
use crate::layout::Inverters;
use crate::profiles::Catalogue;
use crate::storage::{self, Database, Declarer, Policy};
use crate::transport::Endpoint;

const INTERNAL: Problem = Problem {
    status: StatusCode::INTERNAL_SERVER_ERROR,
    code: "internal",
};
/// Who configures devices: the one admin (ADR 9).
const ACTOR: &str = "admin";

/// Why a configuration change was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Refusal {
    NoConnection,
    NoDevice,
    /// An empty name or host, or port 0.
    ConnectionValue,
    /// A device still uses the connection.
    InUse,
    /// The device names no known connection.
    DeviceConnection,
    /// The device names no known profile.
    Profile,
    /// A device's profile is fixed: its history is stored in that profile's steps.
    ProfileChange,
    /// Another device has the unit id on the same endpoint.
    Address,
}

impl From<Refusal> for Problem {
    fn from(refusal: Refusal) -> Self {
        let (status, code) = match refusal {
            Refusal::NoConnection => (StatusCode::NOT_FOUND, "connection.none"),
            Refusal::NoDevice => (StatusCode::NOT_FOUND, "device.none"),
            Refusal::ConnectionValue => (StatusCode::UNPROCESSABLE_ENTITY, "connection.value"),
            Refusal::InUse => (StatusCode::CONFLICT, "connection.in-use"),
            Refusal::DeviceConnection => (StatusCode::UNPROCESSABLE_ENTITY, "device.connection"),
            Refusal::Profile => (StatusCode::UNPROCESSABLE_ENTITY, "device.profile"),
            Refusal::ProfileChange => (StatusCode::CONFLICT, "device.profile-change"),
            Refusal::Address => (StatusCode::CONFLICT, "device.address"),
        };
        Self { status, code }
    }
}

/// The wire framing on a connection's endpoint.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "kebab-case")]
pub enum Transport {
    ModbusTcp,
}

/// How the core reaches an endpoint, without its secrets.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Reach {
    pub name: String,
    pub transport: Transport,
    pub host: String,
    pub port: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct Connection {
    /// Stable; never reused.
    pub id: u32,
    #[serde(flatten)]
    pub reach: Reach,
    /// The names of the secrets set; their values are never read back.
    pub secrets: Vec<String>,
}

/// A connection as the admin enters it.
#[derive(Debug, Clone, Deserialize, ToSchema)]
pub struct ConnectionDraft {
    #[serde(flatten)]
    pub reach: Reach,
    /// Credentials by name: a value sets one, `null` removes it, an absent name is kept.
    #[serde(default)]
    pub secrets: BTreeMap<String, Option<String>>,
}

/// Where a device sits and how it is read.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct DeviceDraft {
    pub name: String,
    /// The connection's id.
    pub connection: u32,
    /// The profile's id, such as `deye-sg05lp3`; fixed once the device is added.
    pub profile: String,
    /// The Modbus unit id: the device address behind the connection.
    pub unit: u8,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct Device {
    /// Stable; never reused. The device id of its history.
    pub id: u32,
    #[serde(flatten)]
    pub draft: DeviceDraft,
}

/// A configured device as its endpoint task polls it.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Polled {
    id: u32,
    unit: u8,
    profile: String,
    endpoint: Endpoint,
}

/// An endpoint task and the devices it polls.
struct Running {
    endpoint: Endpoint,
    devices: Vec<Polled>,
    _task: Task,
}

/// The devices feature module.
#[derive(Clone)]
pub struct Devices {
    database: Database,
    catalogue: Catalogue,
    declarer: Declarer,
    bus: Bus,
    inverters: Inverters,
    /// Held across a change and its restart, so changes apply in order.
    running: Arc<Mutex<Vec<Running>>>,
}

impl std::fmt::Debug for Devices {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Devices").finish_non_exhaustive()
    }
}

impl Devices {
    /// Starts polling every configured device, and keeps `inverters` to the devices whose profile
    /// describes an inverter. Must be called inside a Tokio runtime.
    ///
    /// # Errors
    /// The file cannot be read.
    pub async fn start(
        database: Database,
        declarer: Declarer,
        catalogue: Catalogue,
        bus: Bus,
        inverters: Inverters,
    ) -> Result<Self, storage::Error> {
        let devices = Self {
            database,
            catalogue,
            declarer,
            bus,
            inverters,
            running: Arc::default(),
        };
        let mut running = devices.running.lock().await;
        devices.restart(&mut running).await?;
        drop(running);
        Ok(devices)
    }

    /// Every connection, by id.
    ///
    /// # Errors
    /// The file cannot be read.
    pub async fn connections(&self) -> Result<Vec<Connection>, storage::Error> {
        self.database.run(store::connections).await
    }

    /// Every device, by id.
    ///
    /// # Errors
    /// The file cannot be read.
    pub async fn devices(&self) -> Result<Vec<Device>, storage::Error> {
        self.database.run(store::devices).await
    }

    /// Adds a connection with a fresh id.
    ///
    /// # Errors
    /// A value is empty, or the file cannot be written.
    pub async fn add_connection(
        &self,
        draft: ConnectionDraft,
        changed: SystemTime,
    ) -> Result<Connection, Problem> {
        check_reach(&draft.reach)?;
        self.apply(move |db| store::add_connection(db, &draft, changed))
            .await
    }

    /// Changes a connection; its devices are polled through it from now on.
    ///
    /// # Errors
    /// The connection is unknown, a value is empty, or the file cannot be written.
    pub async fn change_connection(
        &self,
        id: u32,
        draft: ConnectionDraft,
        changed: SystemTime,
    ) -> Result<Connection, Problem> {
        check_reach(&draft.reach)?;
        self.apply(move |db| store::change_connection(db, id, &draft, changed))
            .await
    }

    /// Removes a connection no device uses, with its secrets.
    ///
    /// # Errors
    /// The connection is unknown or in use, or the file cannot be written.
    pub async fn remove_connection(&self, id: u32, changed: SystemTime) -> Result<(), Problem> {
        self.apply(move |db| store::remove_connection(db, id, changed))
            .await
    }

    /// Adds a device with a fresh id and starts polling it.
    ///
    /// # Errors
    /// The connection or profile is unknown, the unit id is taken on the endpoint, or the file
    /// cannot be written.
    pub async fn add_device(
        &self,
        draft: DeviceDraft,
        changed: SystemTime,
    ) -> Result<Device, Problem> {
        self.check_profile(&draft)?;
        self.apply(move |db| store::add_device(db, draft, changed))
            .await
    }

    /// Changes a device's name, connection or unit id.
    ///
    /// # Errors
    /// The device or connection is unknown, the profile differs, the unit id is taken on the
    /// endpoint, or the file cannot be written.
    pub async fn change_device(
        &self,
        id: u32,
        draft: DeviceDraft,
        changed: SystemTime,
    ) -> Result<Device, Problem> {
        self.check_profile(&draft)?;
        self.apply(move |db| store::change_device(db, id, draft, changed))
            .await
    }

    /// Removes a device and stops polling it; its history stays.
    ///
    /// # Errors
    /// The device is unknown, or the file cannot be written.
    pub async fn remove_device(&self, id: u32, changed: SystemTime) -> Result<(), Problem> {
        self.apply(move |db| store::remove_device(db, id, changed))
            .await
    }

    fn check_profile(&self, draft: &DeviceDraft) -> Result<(), Refusal> {
        self.catalogue
            .get(&draft.profile)
            .map(|_| ())
            .ok_or(Refusal::Profile)
    }

    /// Runs one change on the file, then restarts the endpoints it touched.
    async fn apply<T: Send + 'static>(
        &self,
        change: impl FnOnce(&rusqlite::Connection) -> rusqlite::Result<Result<T, Refusal>>
        + Send
        + 'static,
    ) -> Result<T, Problem> {
        let mut running = self.running.lock().await;
        let changed = self.database.run(change).await.map_err(|_| INTERNAL)??;
        self.restart(&mut running).await.map_err(|_| INTERNAL)?;
        Ok(changed)
    }

    /// Brings the endpoint tasks in line with the configured devices: a task whose devices
    /// changed stops before its replacement connects, as a single-slot endpoint needs.
    async fn restart(&self, running: &mut Vec<Running>) -> Result<(), storage::Error> {
        let wanted = by_endpoint(self.database.run(store::polled).await?);
        running.retain(|r| {
            wanted
                .iter()
                .any(|(e, d)| *e == r.endpoint && *d == r.devices)
        });
        let mut inverters = Vec::new();
        for (endpoint, devices) in wanted {
            let polled = self.profiles(&devices);
            inverters.extend(
                polled
                    .iter()
                    .filter(|d| is_inverter(&d.profile))
                    .map(|d| (d.id, Arc::clone(&d.profile))),
            );
            if running
                .iter()
                .any(|r| r.endpoint == endpoint && r.devices == devices)
            {
                continue;
            }
            for device in &polled {
                self.declare(device.id, &device.profile).await?;
            }
            running.push(Running {
                _task: endpoint::spawn(endpoint.clone(), polled, self.bus.clone()),
                endpoint,
                devices,
            });
        }
        self.inverters.replace(inverters);
        Ok(())
    }

    /// The devices with their profiles; one whose profile is not known is skipped.
    fn profiles(&self, devices: &[Polled]) -> Vec<endpoint::Device> {
        devices
            .iter()
            .filter_map(|d| {
                let profile = self.catalogue.get(&d.profile);
                if profile.is_none() {
                    tracing::warn!(device = d.id, profile = d.profile, "unknown profile");
                }
                Some(endpoint::Device {
                    id: DeviceId(d.id),
                    unit: d.unit,
                    profile: profile?,
                })
            })
            .collect()
    }

    /// Declares every series of `device` in its profile's steps. A series storage refuses, such as
    /// one stored in another step, is logged and not stored.
    async fn declare(&self, device: DeviceId, profile: &Profile) -> Result<(), storage::Error> {
        for q in profile.quantities() {
            let series = self.bus.intern(&q.role, q.index);
            let policy = Policy::new(q.kind(), q.unit(), q.step(), CADENCE);
            match self.declarer.declare(device, series, policy).await {
                Ok(()) => {}
                Err(storage::Error::Stopped) => return Err(storage::Error::Stopped),
                Err(e) => tracing::warn!(device = device.0, key = q.key, "not stored: {e}"),
            }
        }
        Ok(())
    }
}

/// The devices grouped by endpoint, in order of their first device.
fn by_endpoint(polled: Vec<Polled>) -> Vec<(Endpoint, Vec<Polled>)> {
    let mut grouped: Vec<(Endpoint, Vec<Polled>)> = Vec::new();
    for device in polled {
        match grouped.iter_mut().find(|(e, _)| *e == device.endpoint) {
            Some((_, devices)) => devices.push(device),
            None => grouped.push((device.endpoint.clone(), vec![device])),
        }
    }
    grouped
}

/// Strings may be wired to a device whose profile declares an inverter's inputs or reads PV.
fn is_inverter(profile: &Profile) -> bool {
    profile.inverter().is_some()
        || profile
            .quantities()
            .iter()
            .any(|q| q.role.starts_with("pv."))
}

fn check_reach(reach: &Reach) -> Result<(), Refusal> {
    if reach.name.trim().is_empty() || reach.host.trim().is_empty() || reach.port == 0 {
        return Err(Refusal::ConnectionValue);
    }
    Ok(())
}

/// The change log entry of a change to `subject` `id`, applying at once.
fn entry(
    subject: Subject,
    id: u32,
    action: Action,
    state: Option<&impl Serialize>,
    changed: SystemTime,
) -> Entry {
    Entry {
        subject,
        id,
        action,
        state: state.and_then(|s| serde_json::to_value(s).ok()),
        actor: ACTOR,
        changed,
        applies_from: changed,
    }
}
