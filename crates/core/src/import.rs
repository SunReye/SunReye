//! `sunreye import` (ADR 18): v3's `sunreye-archive` export into v5 history.

mod archive;
mod convert;

use std::collections::{BTreeSet, HashMap};
use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, params};
use sunreye_profile::Profile;

use self::archive::{Config, Line, Tier};
use self::convert::Linear;
use crate::bus::{Bus, DeviceId};
use crate::devices;
use crate::endpoint::CADENCE;
use crate::profiles::{Https, KEYS, Profiles};
use crate::startup;
use crate::storage::{self, Backfill, Backfilled, Held, Policy, Storage};

/// A v3 device, by its slug, and the v5 device its history goes to.
#[derive(Debug, Clone)]
pub struct Target {
    pub slug: String,
    pub device: DeviceId,
    /// The v5 device's profile.
    pub profile: Arc<Profile>,
}

/// What an import wrote, and what it left out.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Report {
    /// Series written to.
    pub series: usize,
    pub written: Backfilled,
    /// v3 metrics with readings that no v5 quantity reads, as `slug/key`.
    pub unread: BTreeSet<String>,
    /// v3 devices with readings and no target.
    pub unmapped: BTreeSet<String>,
}

#[derive(Debug)]
pub enum Error {
    /// The file is not an archive this build reads, or is cut short.
    Archive(String),
    /// A target names a device the archive does not hold.
    UnknownDevice(String),
    /// The archive does not carry the v3 profile of a target's device.
    NoProfile(String),
    /// A mapping names a v5 device that is not registered, or whose profile is not known.
    UnknownTarget(u32),
    Profiles(String),
    Storage(storage::Error),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Archive(reason) => f.write_str(reason),
            Self::UnknownDevice(slug) => write!(f, "the archive holds no device `{slug}`"),
            Self::NoProfile(id) => write!(f, "the archive carries no v3 profile `{id}`"),
            Self::UnknownTarget(id) => write!(f, "no v5 device {id} with a known profile"),
            Self::Profiles(e) => write!(f, "profiles: {e}"),
            Self::Storage(e) => write!(f, "storage: {e}"),
        }
    }
}

impl std::error::Error for Error {}

impl From<storage::Error> for Error {
    fn from(e: storage::Error) -> Self {
        Self::Storage(e)
    }
}

impl From<rusqlite::Error> for Error {
    fn from(e: rusqlite::Error) -> Self {
        Self::Storage(storage::Error::Sqlite(e))
    }
}

/// What `sunreye import` imports, and where.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Options {
    pub file: PathBuf,
    pub data_dir: PathBuf,
    /// Each v3 device slug and the id of the v5 device it maps to.
    pub devices: Vec<(String, u32)>,
}

/// Why the options were refused.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OptionsError {
    Missing(&'static str),
    NoValue(&'static str),
    Device(String),
    Unknown(String),
}

impl fmt::Display for OptionsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Missing(what) => write!(f, "{what} is required"),
            Self::NoValue(flag) => write!(f, "--{flag} needs a value"),
            Self::Device(value) => write!(f, "--device: `{value}` is not <v3 slug>=<v5 device id>"),
            Self::Unknown(arg) => write!(f, "unknown argument `{arg}`"),
        }
    }
}

impl std::error::Error for OptionsError {}

impl Options {
    /// Reads the archive's path, then `--device <slug>=<id>` for each device mapped and
    /// `--data-dir`, which falls back to `SUNREYE_DATA_DIR` from `env`.
    ///
    /// # Errors
    /// No file, no device or no data directory, a malformed mapping, or an unknown argument.
    pub fn parse(
        args: impl IntoIterator<Item = String>,
        env: impl Fn(&str) -> Option<String>,
    ) -> Result<Self, OptionsError> {
        let (mut file, mut data_dir, mut devices) = (None, None, Vec::new());
        let mut args = args.into_iter();
        while let Some(arg) = args.next() {
            if !arg.starts_with("--") && file.is_none() {
                file = Some(PathBuf::from(arg));
                continue;
            }
            let (name, inline) = match arg.split_once('=') {
                Some((name, value)) => (name, Some(value.to_owned())),
                None => (arg.as_str(), None),
            };
            let flag = match name {
                "--device" => "device",
                "--data-dir" => "data-dir",
                _ => return Err(OptionsError::Unknown(arg)),
            };
            let value = inline
                .or_else(|| args.next())
                .ok_or(OptionsError::NoValue(flag))?;
            if flag == "device" {
                devices.push(mapping(&value).ok_or(OptionsError::Device(value))?);
            } else {
                data_dir = Some(value);
            }
        }
        if devices.is_empty() {
            return Err(OptionsError::Missing("--device"));
        }
        let data_dir = data_dir
            .or_else(|| env("SUNREYE_DATA_DIR"))
            .ok_or(OptionsError::Missing("--data-dir or SUNREYE_DATA_DIR"))?;
        Ok(Self {
            file: file.ok_or(OptionsError::Missing("the archive's path"))?,
            data_dir: PathBuf::from(data_dir),
            devices,
        })
    }
}

/// `slug=id`.
fn mapping(value: &str) -> Option<(String, u32)> {
    let (slug, id) = value.rsplit_once('=')?;
    (!slug.is_empty()).then(|| Some((slug.to_owned(), id.parse().ok()?)))?
}

/// One v5 series the archive feeds: its device, its profile and quantity, and the conversion.
#[derive(Debug, Clone)]
struct Planned {
    device: DeviceId,
    profile: Arc<Profile>,
    quantity: usize,
    linear: Linear,
}

/// The series the archive feeds, and what it holds that none takes.
#[derive(Default)]
struct Plan {
    ordinals: HashMap<(String, String), usize>,
    series: Vec<Planned>,
    unread: BTreeSet<String>,
    unmapped: BTreeSet<String>,
}

impl Plan {
    /// The ordinal of the series `line` feeds; `None`, noted, when no target takes it.
    fn ordinal(&mut self, targeted: &Targeted, line: &Line) -> Option<usize> {
        let key = (line.device.clone(), line.metric.clone());
        if let Some(&ordinal) = self.ordinals.get(&key) {
            return Some(ordinal);
        }
        let Some(((device, profile), conversions)) = targeted.get(&line.device) else {
            self.unmapped.insert(line.device.clone());
            return None;
        };
        let Some(&(quantity, linear)) = conversions.get(&line.metric) else {
            self.unread
                .insert(format!("{}/{}", line.device, line.metric));
            return None;
        };
        self.series.push(Planned {
            device: *device,
            profile: Arc::clone(profile),
            quantity,
            linear,
        });
        let ordinal = self.series.len() - 1;
        self.ordinals.insert(key, ordinal);
        Some(ordinal)
    }
}

/// The archive's readings, sorted by series in a scratch database.
struct Staged {
    db: Connection,
    plan: Plan,
}

/// `sunreye import`: imports into the store in the data directory, which no running core holds
/// open, then writes and closes it.
///
/// # Errors
/// The store or the profiles cannot be opened, a mapping names an unknown device, or the import
/// failed.
pub async fn command(options: Options, build: SystemTime) -> Result<Report, Error> {
    let bus = Bus::default();
    let file = options.data_dir.join(startup::STORE);
    let storage = Storage::open(&file, build, &startup::plant_zone(), &bus)?;
    let profiles = Profiles::open(storage.database(), Arc::new(Https), KEYS)
        .await
        .map_err(|e| Error::Profiles(e.to_string()))?;
    let catalogue = profiles.catalogue();
    let registered = devices::registered(&storage.database()).await?;
    let targets = options
        .devices
        .into_iter()
        .map(|(slug, id)| {
            let profile = registered
                .iter()
                .find(|d| d.id == id)
                .and_then(|d| catalogue.get(&d.draft.profile))
                .ok_or(Error::UnknownTarget(id))?;
            Ok(Target {
                slug,
                device: DeviceId(id),
                profile,
            })
        })
        .collect::<Result<_, Error>>()?;
    let report = run(options.file, &storage, &bus, targets).await?;
    storage.shutdown().await?;
    Ok(report)
}

/// Imports the archive at `file` into `storage`, each target's v3 device into its v5 device.
/// Series are written one at a time, so the core keeps running.
///
/// # Errors
/// The archive does not read, a target is unknown to it, or storage refuses a series.
pub async fn run(
    file: PathBuf,
    storage: &Storage,
    bus: &Bus,
    targets: Vec<Target>,
) -> Result<Report, Error> {
    let Staged { mut db, plan } = blocking(move || stage(&file, &targets)).await?;
    let mut report = Report {
        unread: plan.unread,
        unmapped: plan.unmapped,
        ..Report::default()
    };
    for (ordinal, planned) in plan.series.into_iter().enumerate() {
        let (returned, backfill) = blocking(move || {
            let backfill = backfill(&db, ordinal, planned.linear);
            Ok((db, backfill))
        })
        .await?;
        db = returned;
        let Some(q) = planned.profile.quantities().get(planned.quantity) else {
            continue;
        };
        let series = bus.intern(&q.role, q.index);
        let policy = Policy::new(q.kind(), q.unit(), q.step(), CADENCE);
        let written = storage
            .import(planned.device, series, policy, backfill?)
            .await?;
        report.series += 1;
        report.written.points += written.points;
        report.written.hours += written.hours;
        report.written.days += written.days;
    }
    Ok(report)
}

async fn blocking<T: Send + 'static>(
    job: impl FnOnce() -> Result<T, Error> + Send + 'static,
) -> Result<T, Error> {
    tokio::task::spawn_blocking(job)
        .await
        .map_err(|_| Error::Storage(storage::Error::Stopped))?
}

/// Reads the archive once into a scratch database; the minute tier is not kept.
fn stage(file: &Path, targets: &[Target]) -> Result<Staged, Error> {
    // An empty path is a temporary database SQLite deletes on close, spilling to disk.
    let db = Connection::open("")?;
    db.execute_batch(
        "CREATE TABLE row (
           series INTEGER NOT NULL, tier INTEGER NOT NULL, time INTEGER NOT NULL,
           value REAL NOT NULL, hold INTEGER,
           PRIMARY KEY (series, tier, time)
         ) WITHOUT ROWID;
         BEGIN;",
    )?;
    let mut plan = Plan::default();
    let mut insert = db.prepare(
        "INSERT INTO row (series, tier, time, value, hold) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT DO NOTHING",
    )?;
    archive::read(
        file,
        |config| targets_in(&config, targets),
        |targeted, line| {
            plan.ordinal(targeted, &line)
                .map_or(Ok(()), |ordinal| stage_line(&mut insert, ordinal, &line))
        },
    )?;
    drop(insert);
    db.execute_batch("COMMIT")?;
    Ok(Staged { db, plan })
}

/// Each target's v5 device and profile and its conversions, by v3 slug.
type Targeted = HashMap<String, ((DeviceId, Arc<Profile>), HashMap<String, (usize, Linear)>)>;

fn targets_in(config: &Config, targets: &[Target]) -> Result<Targeted, Error> {
    targets
        .iter()
        .map(|target| {
            let device = config
                .devices
                .iter()
                .find(|d| d.slug == target.slug)
                .ok_or_else(|| Error::UnknownDevice(target.slug.clone()))?;
            let conversions = config
                .profiles
                .get(&device.profile_id)
                .and_then(|v3| convert::conversions(v3, &target.profile))
                .ok_or_else(|| Error::NoProfile(device.profile_id.clone()))?;
            let v5 = (target.device, Arc::clone(&target.profile));
            Ok((target.slug.clone(), (v5, conversions)))
        })
        .collect()
}

fn stage_line(
    insert: &mut rusqlite::Statement<'_>,
    ordinal: usize,
    line: &Line,
) -> Result<(), Error> {
    let tier = match line.tier {
        Tier::Raw => 0,
        Tier::Hourly => 1,
        Tier::Daily => 2,
        Tier::Minute => return Ok(()),
    };
    if line.value.is_finite() {
        insert.execute(params![
            i64::try_from(ordinal).unwrap_or(i64::MAX),
            tier,
            line.time.as_millisecond(),
            line.value,
            line.hold_ms
        ])?;
    }
    Ok(())
}

/// The staged rows of series `ordinal`, converted.
fn backfill(db: &Connection, ordinal: usize, linear: Linear) -> Result<Backfill, Error> {
    let mut backfill = Backfill::default();
    let mut rows = db.prepare_cached(
        "SELECT tier, time, value, hold FROM row WHERE series = ?1 ORDER BY tier, time",
    )?;
    let mut rows = rows.query([i64::try_from(ordinal).unwrap_or(i64::MAX)])?;
    while let Some(row) = rows.next()? {
        let (tier, time, value, hold): (i64, i64, f64, Option<i64>) =
            (row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?);
        let Some(time) = instant(time) else {
            continue;
        };
        let value = linear.apply(value);
        match tier {
            0 => backfill.raw.push(Held {
                time,
                value,
                hold: hold.and_then(|ms| u64::try_from(ms).ok().map(Duration::from_millis)),
            }),
            1 => backfill.hours.push((time, value)),
            _ => backfill.days.push((time, value)),
        }
    }
    Ok(backfill)
}

fn instant(millis: i64) -> Option<SystemTime> {
    UNIX_EPOCH.checked_add(Duration::from_millis(u64::try_from(millis).ok()?))
}

#[cfg(test)]
mod tests;
