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
use sunreye_profile::{Profile, Setting, Toggle};
use tokio::sync::Mutex;
use utoipa::ToSchema;

use crate::api::{Code, Problem};
use crate::bus::{Bus, DeviceId};
use crate::changes::{Action, Entry, Subject};
use crate::endpoint::{self, CADENCE, Task};
use crate::layout::Inverters;
use crate::profiles::Catalogue;
use crate::settings::{
    self, Enable, Job, Outcome, Permit, Request, Secret, Snapshot, enable, log, snapshot,
};
use crate::storage::{self, Database, Declarer, Policy};
use crate::transport::Endpoint;

const INTERNAL: Problem = Problem {
    status: StatusCode::INTERNAL_SERVER_ERROR,
    code: Code::Internal,
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
            Refusal::NoConnection => (StatusCode::NOT_FOUND, Code::ConnectionNone),
            Refusal::NoDevice => (StatusCode::NOT_FOUND, Code::DeviceNone),
            Refusal::ConnectionValue => (StatusCode::UNPROCESSABLE_ENTITY, Code::ConnectionValue),
            Refusal::InUse => (StatusCode::CONFLICT, Code::ConnectionInUse),
            Refusal::DeviceConnection => (StatusCode::UNPROCESSABLE_ENTITY, Code::DeviceConnection),
            Refusal::Profile => (StatusCode::UNPROCESSABLE_ENTITY, Code::DeviceProfile),
            Refusal::ProfileChange => (StatusCode::CONFLICT, Code::DeviceProfileChange),
            Refusal::Address => (StatusCode::CONFLICT, Code::DeviceAddress),
        };
        Self { status, code }
    }
}

/// The wire framing on a connection's endpoint.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "kebab-case")]
pub enum Transport {
    ModbusTcp,
    SolarmanV5,
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
#[derive(Clone, Deserialize, ToSchema)]
pub struct ConnectionDraft {
    #[serde(flatten)]
    pub reach: Reach,
    /// Credentials by name: a value sets one, `null` removes it, an absent name is kept.
    #[serde(default)]
    pub secrets: BTreeMap<String, Option<String>>,
}

/// Shows the names of the secrets alone, so no log line can carry a value.
impl std::fmt::Debug for ConnectionDraft {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ConnectionDraft")
            .field("reach", &self.reach)
            .field("secrets", &self.secrets.keys().collect::<Vec<_>>())
            .finish()
    }
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
    /// Whether settings may be written (ADR 7); off when left out.
    #[serde(default)]
    pub writes: bool,
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

/// A device's writes switch and its profile's settings with their enables, in the profile's order.
#[derive(Debug, Clone)]
pub struct Writable {
    pub id: u32,
    pub writes: bool,
    pub settings: Vec<(Setting, Enable)>,
}

/// A device being written, with its profile and the endpoint tasks, held while it is.
struct Writing<'a> {
    running: &'a [Running],
    device: Device,
    profile: Arc<Profile>,
}

/// An endpoint task and the devices it polls.
struct Running {
    endpoint: Endpoint,
    devices: Vec<Polled>,
    task: Task,
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

    /// Every device with its writes switch and its settings, by id.
    ///
    /// # Errors
    /// The file cannot be read.
    pub async fn writable(&self) -> Result<Vec<Writable>, storage::Error> {
        let mut writable = Vec::new();
        for device in self.devices().await? {
            let Some(profile) = self.catalogue.get(&device.draft.profile) else {
                continue;
            };
            let mut settings = Vec::new();
            for setting in profile.settings() {
                let enable = self.enable(&device, setting).await?;
                settings.push((setting.clone(), enable));
            }
            writable.push(Writable {
                id: device.id,
                writes: device.draft.writes,
                settings,
            });
        }
        Ok(writable)
    }

    /// Enables the writes of setting `key` of device `id` as it is declared now (ADR 8), or
    /// disables them.
    ///
    /// # Errors
    /// The device or setting is unknown or read-only, or the file cannot be written.
    pub async fn enable_setting(
        &self,
        id: u32,
        key: String,
        on: bool,
        changed: SystemTime,
    ) -> Result<(), Problem> {
        let device = self.device(id).await?;
        let profile = self.profile(&device.draft.profile)?;
        let fingerprint = match profile.setting(&key) {
            Some(setting) => enable::fingerprint(setting),
            None if profile.quantities().iter().any(|q| q.key == key) => {
                return Err(settings::Refusal::ReadOnly.into());
            }
            None => return Err(settings::Refusal::None.into()),
        };
        let fingerprint = on.then_some(fingerprint);
        self.database
            .run(move |db| enable::set(db, id, &key, fingerprint.as_deref(), changed))
            .await
            .map_err(|_| INTERNAL)
    }

    /// Whether `setting` of `device` may be written, as far as trust goes.
    async fn enable(&self, device: &Device, setting: &Setting) -> Result<Enable, storage::Error> {
        let (id, key) = (device.id, setting.key.clone());
        let enabled = self
            .database
            .run(move |db| enable::stored(db, id, &key))
            .await?;
        let official = self.catalogue.official(&device.draft.profile);
        Ok(Enable::of(setting, official, enabled.as_deref()))
    }

    async fn device(&self, id: u32) -> Result<Device, Problem> {
        let device = self
            .database
            .run(move |db| store::device(db, id))
            .await
            .map_err(|_| INTERNAL)?;
        Ok(device.ok_or(Refusal::NoDevice)?)
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

    /// The one funnel (ADR 7): writes `request` to device `id` through its endpoint task, and
    /// appends the attempt to the write log. A snapshot toggle writes its target instead: 1 stores
    /// the target's value and writes the locked one, 0 writes the stored value back.
    ///
    /// Changes to devices wait for it, so its task cannot restart mid-write.
    ///
    /// # Errors
    /// The device or setting is unknown or read-only, the value does not fit, the device's writes
    /// are off, the setting needs an enable it lacks, its minimum interval has not passed, its
    /// unlock's secret is not set or not a code, a precondition does not hold, a toggle is released
    /// with no value stored, or the file cannot be written.
    pub async fn write_setting(
        &self,
        id: u32,
        request: Request,
        now: SystemTime,
    ) -> Result<log::Entry, Problem> {
        let running = self.running.lock().await;
        let device = self.device(id).await?;
        let profile = self.profile(&device.draft.profile)?;
        let writing = Writing {
            running: &running,
            device,
            profile,
        };
        let toggle = writing
            .profile
            .setting(&request.key)
            .and_then(Setting::toggle)
            .cloned();
        let entry = match toggle {
            Some(toggle) => self.toggle(&writing, request, toggle, now).await,
            None => self.funnel(&writing, request, None, now).await,
        };
        drop(running);
        entry
    }

    /// Engages or releases snapshot toggle `request.key`, through a write of its target.
    async fn toggle(
        &self,
        writing: &Writing<'_>,
        request: Request,
        toggle: Toggle,
        now: SystemTime,
    ) -> Result<log::Entry, Problem> {
        let id = writing.device.id;
        let permit = self.permit(writing, &request.key).await?;
        // The toggle takes 0 or 1 and writes only when the device's writes and it are enabled.
        let (_, words) = settings::check(&writing.profile, &request, permit, None, now)?;
        let key = request.key;
        let stored = {
            let key = key.clone();
            self.database
                .run(move |db| snapshot::stored(db, id, &key))
                .await
                .map_err(|_| INTERNAL)?
        };
        let target = |value| Request {
            key: toggle.target.clone(),
            value,
            actor: request.actor,
        };
        if words == [1] {
            // An engaged toggle keeps the value it stored first: the target now holds the lock.
            let store = stored.is_none().then(|| self.snapshot(id, key));
            return self
                .funnel(writing, target(toggle.locked), store, now)
                .await;
        }
        let value = stored.ok_or(settings::Refusal::NoSnapshot)?;
        let entry = self.funnel(writing, target(value), None, now).await?;
        // Any other outcome may have left the lock in place: the value stays for a retry.
        if matches!(entry.outcome, Outcome::Verified | Outcome::Unchanged) {
            self.database
                .run(move |db| snapshot::clear(db, id, &key))
                .await
                .map_err(|_| INTERNAL)?;
        }
        Ok(entry)
    }

    /// Stores the value toggle `key` of device `id` locks over.
    fn snapshot(&self, id: u32, key: String) -> Snapshot {
        let database = self.database.clone();
        Snapshot::new(move |value| async move {
            let store = move |db: &rusqlite::Connection| snapshot::store(db, id, &key, value);
            database.run(store).await.is_ok()
        })
    }

    /// Checks `request`, runs it in the device's endpoint task and logs the attempt.
    async fn funnel(
        &self,
        writing: &Writing<'_>,
        request: Request,
        snapshot: Option<Snapshot>,
        now: SystemTime,
    ) -> Result<log::Entry, Problem> {
        let Writing {
            running,
            device,
            profile,
        } = writing;
        let id = device.id;
        let setting = request.key.clone();
        let last = self
            .database
            .run(move |db| log::last_write(db, id, &setting))
            .await
            .map_err(|_| INTERNAL)?;
        let permit = self.permit(writing, &request.key).await?;
        let (setting, words) = settings::check(profile, &request, permit, last, now)?;
        let unlock = self.unlock(device.draft.connection, &setting).await?;
        let task = running
            .iter()
            .find(|r| r.devices.iter().any(|d| d.id == id))
            .map(|r| &r.task)
            .ok_or(INTERNAL)?;
        let job = Job {
            unit: device.draft.unit,
            setting,
            words,
            unlock,
            snapshot,
        };
        // A precondition that does not hold is a refusal: nothing was written, nothing is logged.
        let applied = task.write(job).await.ok_or(INTERNAL)??;
        // Logged before the running lock is released: the next write's interval check reads it.
        self.database
            .run(move |db| {
                let attempt = log::Attempt {
                    time: now,
                    device: id,
                    setting: &request.key,
                    requested: request.value,
                    applied,
                    actor: request.actor,
                };
                log::append(db, &attempt)
            })
            .await
            .map_err(|_| INTERNAL)
    }

    /// What lets setting `key` of the device being written write; an undeclared key is refused
    /// by the check before its enable counts.
    async fn permit(&self, writing: &Writing<'_>, key: &str) -> Result<Permit, Problem> {
        let enable = match writing.profile.setting(key) {
            Some(setting) => self
                .enable(&writing.device, setting)
                .await
                .map_err(|_| INTERNAL)?,
            None => Enable::Off,
        };
        Ok(Permit {
            writes: writing.device.draft.writes,
            enable,
        })
    }

    /// The words of the secret `setting`'s unlock names, from `connection`.
    async fn unlock(&self, connection: u32, setting: &Setting) -> Result<Option<Secret>, Problem> {
        let Some(name) = setting.unlock().map(|unlock| unlock.secret.clone()) else {
            return Ok(None);
        };
        let secret = self
            .database
            .run(move |db| store::secret(db, connection, &name))
            .await
            .map_err(|_| INTERNAL)?;
        Ok(settings::unlock(setting, secret.as_deref())?)
    }

    /// Every write attempt, oldest first.
    ///
    /// # Errors
    /// The file cannot be read.
    pub async fn writes(&self) -> Result<Vec<log::Entry>, storage::Error> {
        self.database.run(log::entries).await
    }

    /// Profile `id`; a device whose profile is gone has no settings.
    fn profile(&self, id: &str) -> Result<Arc<Profile>, Problem> {
        Ok(self.catalogue.get(id).ok_or(settings::Refusal::None)?)
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
                task: endpoint::spawn(endpoint.clone(), polled, self.bus.clone()),
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
