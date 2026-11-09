//! Storage (ADR 3): readings become change points in one SQLite file, owned by one thread fed by
//! a bounded channel (ADR 2).

mod block;
mod encode;
mod forecast;
mod rollup;
mod thread;

use std::fmt;
use std::ops::Range;
use std::path::Path;
use std::time::{Duration, SystemTime};

use sunreye_profile::{RoleKind, Unit};
use tokio::sync::{broadcast, mpsc, oneshot, watch};
use tokio::task::JoinHandle;

use crate::bus::{Bus, DeviceId, Reading, Series, SeriesId};
pub use thread::Log;
use thread::{Command, Forecasting, Request, Rewriting};

/// Commands the storage thread may fall behind by before senders wait.
const QUEUE: usize = 1024;
/// How long change points are kept: the setting's default (ADR 3), five years of 365.25 days.
pub const RETENTION: Duration = Duration::from_hours(5 * 8766);

/// How one series of one device is stored.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Policy {
    /// What its values are: decides the rollup.
    pub kind: RoleKind,
    /// The quantisation step, in the role's unit: stored values are integer multiples of it.
    pub step: f64,
    /// The smallest stored change, in the role's unit; zero stores every change.
    pub deadband: f64,
    /// The poll cadence, which sets the gap threshold.
    pub cadence: Duration,
}

impl Policy {
    /// Counters and enums get no deadband; a measurement gets its unit's default (ADR 4).
    #[must_use]
    pub const fn new(kind: RoleKind, unit: Option<Unit>, step: f64, cadence: Duration) -> Self {
        let deadband = match (kind, unit) {
            (RoleKind::Measurement, Some(Unit::Watt)) => 5.0,
            (RoleKind::Measurement, Some(Unit::Volt | Unit::Celsius)) => 0.5,
            (RoleKind::Measurement, Some(Unit::Ampere)) => 0.1,
            (RoleKind::Measurement, Some(Unit::Hertz)) => 0.02,
            _ => 0.0,
        };
        Self {
            kind,
            step,
            deadband,
            cadence,
        }
    }
}

/// A stored value and the instant it began; `None` is a gap.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ChangePoint {
    pub time: SystemTime,
    pub value: Option<f64>,
}

/// A rollup tier: UTC hours, or plant-local days.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tier {
    Hour,
    Day,
}

/// One hour or day of one series, over the history rolled up so far.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rollup {
    pub start: SystemTime,
    pub end: SystemTime,
    pub aggregate: Aggregate,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Aggregate {
    Measurement {
        /// Time with a value; gaps are excluded.
        duration: Duration,
        /// Time-weighted over `duration`.
        mean: f64,
        min: f64,
        max: f64,
        /// `Σ value·duration` in the unit times hours: Wh for power, EUR for a `cost.*` rate.
        integral: f64,
    },
    Counter {
        first: f64,
        last: f64,
        /// The rises from value to value: a drop is a reset and adds nothing, as does a gap.
        delta: f64,
    },
}

/// A value issued at one time about a later target time (ADR 15).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Forecast {
    pub target: SystemTime,
    pub issued: SystemTime,
    pub value: f64,
}

/// One issue of forecasts of a series: `(target, value)` pairs in multiples of `step`.
#[derive(Debug, Clone, PartialEq)]
pub struct Issue {
    pub issued: SystemTime,
    pub step: f64,
    pub values: Vec<(SystemTime, f64)>,
}

/// History of one series from an older release (ADR 18), each list in time order.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Backfill {
    /// Readings, each held from its instant.
    pub raw: Vec<Held>,
    /// Values of whole UTC hours, by the hour's start: a mean, or a counter's value.
    pub hours: Vec<(SystemTime, f64)>,
    /// Values of whole UTC days, by the day's start.
    pub days: Vec<(SystemTime, f64)>,
}

/// A reading and how long its value was held; `None` when that was not recorded.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Held {
    pub time: SystemTime,
    pub value: f64,
    pub hold: Option<Duration>,
}

/// What an import wrote: change points, hourly and daily rollups.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Backfilled {
    pub points: usize,
    pub hours: usize,
    pub days: usize,
}

/// A condition the API reports.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Problem {
    /// The wall clock is not past the build time or the last stored instant: history is held.
    ClockUnsynced,
}

impl Problem {
    #[must_use]
    pub const fn code(self) -> &'static str {
        match self {
            Self::ClockUnsynced => "clock.unsynced",
        }
    }
}

#[derive(Debug)]
pub enum Error {
    Sqlite(rusqlite::Error),
    /// The file's permissions cannot be set.
    Io(std::io::Error),
    /// A series was declared with a step other than the one its history is stored in.
    StepChanged,
    /// A step that is not a positive finite number.
    Step,
    /// A stored block this build cannot read.
    Corrupt,
    /// A series the bus never interned, or not declared where it must be.
    UnknownSeries,
    /// A plant timezone that is not an IANA name the core knows.
    Zone,
    /// The storage thread has stopped.
    Stopped,
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Sqlite(e) => write!(f, "sqlite: {e}"),
            Self::Io(e) => write!(f, "{e}"),
            Self::StepChanged => f.write_str("the series is stored in another step"),
            Self::Step => f.write_str("the step must be positive and finite"),
            Self::Corrupt => f.write_str("a stored block cannot be read"),
            Self::UnknownSeries => f.write_str("unknown series"),
            Self::Zone => f.write_str("unknown timezone"),
            Self::Stopped => f.write_str("storage has stopped"),
        }
    }
}

impl std::error::Error for Error {}

impl From<rusqlite::Error> for Error {
    fn from(e: rusqlite::Error) -> Self {
        Self::Sqlite(e)
    }
}

/// The handle to the storage thread. Dropping it stops the thread without writing the open
/// bucket, as a crash would; [`Storage::shutdown`] writes it.
#[derive(Debug)]
pub struct Storage {
    commands: mpsc::Sender<Command>,
    bus: Bus,
    feed: JoinHandle<()>,
    zone: std::sync::Arc<watch::Sender<jiff::tz::TimeZone>>,
}

impl Drop for Storage {
    fn drop(&mut self) {
        self.feed.abort();
    }
}

impl Storage {
    /// Opens or creates the file at `path` and starts storing the bus's readings of declared
    /// series, with days cut in the plant timezone: the one the admin set, else `zone`. Must be
    /// called inside a Tokio runtime.
    ///
    /// # Errors
    /// The zone is unknown, or the file cannot be opened or migrated.
    pub fn open(path: &Path, build: SystemTime, zone: &str, bus: &Bus) -> Result<Self, Error> {
        let tz = jiff::tz::TimeZone::get(zone).map_err(|_| Error::Zone)?;
        let (commands, current) = thread::spawn(path, build, (zone.to_owned(), tz), QUEUE)?;
        let feed = tokio::spawn(feed(bus.subscribe(), commands.clone()));
        Ok(Self {
            commands,
            bus: bus.clone(),
            feed,
            zone: std::sync::Arc::new(watch::channel(current).0),
        })
    }

    /// A handle that reads and sets the plant timezone (ADR 3).
    #[must_use]
    pub fn zones(&self) -> Zones {
        Zones {
            commands: self.commands.clone(),
            current: std::sync::Arc::clone(&self.zone),
        }
    }

    /// Stores `series` of `device` from now on, resuming its history.
    ///
    /// # Errors
    /// The step differs from the stored one or is not positive, or the series is unknown.
    pub async fn declare(
        &self,
        device: DeviceId,
        series: SeriesId,
        policy: Policy,
    ) -> Result<(), Error> {
        self.declarer().declare(device, series, policy).await
    }

    /// A handle that declares series, for the module that starts devices.
    #[must_use]
    pub fn declarer(&self) -> Declarer {
        Declarer {
            commands: self.commands.clone(),
            bus: self.bus.clone(),
        }
    }

    /// Offers one reading; a reading of an undeclared series is not stored.
    ///
    /// # Errors
    /// The storage thread has stopped.
    pub async fn record(&self, reading: Reading) -> Result<(), Error> {
        self.send(Command::Reading(reading)).await
    }

    /// Tells storage the wall clock: a closed bucket is written and a silent series gets its gap.
    ///
    /// # Errors
    /// The storage thread has stopped.
    pub async fn tick(&self, now: SystemTime) -> Result<(), Error> {
        self.send(Command::Tick(now)).await
    }

    /// The change points of `series` from `from` to `to`, led by the one in force at `from`.
    /// The open bucket is not yet history.
    ///
    /// # Errors
    /// The series is unknown, or the file cannot be read.
    pub async fn history(
        &self,
        device: DeviceId,
        series: SeriesId,
        from: SystemTime,
        to: SystemTime,
    ) -> Result<Vec<ChangePoint>, Error> {
        let series = self.bus.series(series).ok_or(Error::UnknownSeries)?;
        self.reader().history(device, &series, from, to).await
    }

    /// The rollups of `series` in `tier` that start within `range`. Hours are rolled up once
    /// closed; the current day covers its closed hours.
    ///
    /// # Errors
    /// The series is unknown, or the file cannot be read.
    pub async fn rollups(
        &self,
        device: DeviceId,
        series: SeriesId,
        tier: Tier,
        range: Range<SystemTime>,
    ) -> Result<Vec<Rollup>, Error> {
        let series = self.bus.series(series).ok_or(Error::UnknownSeries)?;
        self.reader().rollups(device, &series, tier, range).await
    }

    /// A handle that reads history by series name, for the API.
    #[must_use]
    pub fn reader(&self) -> Reader {
        Reader(self.commands.clone())
    }

    /// Rebuilds from its change points every rollup of a declared `series` that overlaps
    /// `range`.
    ///
    /// # Errors
    /// The series is not declared, or the file cannot be written.
    pub async fn rebuild(
        &self,
        device: DeviceId,
        series: SeriesId,
        range: Range<SystemTime>,
    ) -> Result<(), Error> {
        self.request(|reply| {
            Request::Rewriting(Rewriting::Rebuild {
                device,
                series,
                range,
                reply,
            })
        })
        .await?
    }

    /// Replaces the change points of a declared `series` within `range` with `points`, and
    /// rebuilds the rollups they touch. The last of `points` holds until the next stored point.
    ///
    /// # Errors
    /// The series is not declared, or the file cannot be written.
    pub async fn replace(
        &self,
        device: DeviceId,
        series: SeriesId,
        range: Range<SystemTime>,
        points: Vec<ChangePoint>,
    ) -> Result<(), Error> {
        self.rewriter().replace(device, series, range, points).await
    }

    /// Writes `backfill` as the history of `series` before its first stored change point, in
    /// `policy`'s step and deadband (ADR 18). Raw readings become change points; an hour or day
    /// becomes a rollup only where no raw reading falls. A second import of the same history
    /// writes nothing.
    ///
    /// # Errors
    /// The step differs from the stored one or is not positive, the series is unknown, or the
    /// file cannot be written.
    pub async fn import(
        &self,
        device: DeviceId,
        series: SeriesId,
        policy: Policy,
        backfill: Backfill,
    ) -> Result<Backfilled, Error> {
        self.importer()
            .import(device, series, policy, backfill)
            .await
    }

    /// A handle that imports history, for the import the admin starts from the SPA (ADR 18).
    #[must_use]
    pub fn importer(&self) -> Importer {
        Importer {
            commands: self.commands.clone(),
            bus: self.bus.clone(),
        }
    }

    /// A handle that replaces derived history, for the module that derives it.
    #[must_use]
    pub fn rewriter(&self) -> Rewriter {
        Rewriter(self.commands.clone())
    }

    /// Stores one issue of forecasts of `series`.
    ///
    /// # Errors
    /// The step differs from the stored one or is not positive, or the series is unknown.
    pub async fn forecast(
        &self,
        device: DeviceId,
        series: SeriesId,
        issue: Issue,
    ) -> Result<(), Error> {
        if !(issue.step.is_finite() && issue.step > 0.0) {
            return Err(Error::Step);
        }
        let name = self.name(series)?;
        self.request(|reply| {
            Request::Forecasting(Forecasting::Forecast {
                device,
                name,
                issue,
                reply,
            })
        })
        .await?
    }

    /// Every stored forecast of `series` with a target from `from` to before `to`, by target,
    /// then issue.
    ///
    /// # Errors
    /// The file cannot be read.
    pub async fn forecasts(
        &self,
        device: DeviceId,
        series: SeriesId,
        from: SystemTime,
        to: SystemTime,
    ) -> Result<Vec<Forecast>, Error> {
        let name = self.name(series)?;
        self.request(|reply| {
            Request::Forecasting(Forecasting::Forecasts {
                device,
                name,
                from,
                to,
                reply,
            })
        })
        .await?
    }

    /// The problems as of every command sent before.
    ///
    /// # Errors
    /// The storage thread has stopped.
    pub async fn problems(&self) -> Result<Vec<Problem>, Error> {
        self.request(Request::Problems).await
    }

    /// A handle through which another feature module runs SQL on its own tables.
    #[must_use]
    pub fn database(&self) -> Database {
        Database(self.commands.clone())
    }

    /// Writes the open bucket and stops the thread.
    ///
    /// # Errors
    /// The bucket could not be written.
    pub async fn shutdown(self) -> Result<(), Error> {
        self.request(Request::Shutdown).await?
    }

    fn name(&self, series: SeriesId) -> Result<String, Error> {
        let series = self.bus.series(series).ok_or(Error::UnknownSeries)?;
        Ok(series.to_string())
    }

    async fn send(&self, command: Command) -> Result<(), Error> {
        self.commands
            .send(command)
            .await
            .map_err(|_| Error::Stopped)
    }

    async fn request<T>(
        &self,
        make: impl FnOnce(oneshot::Sender<T>) -> Request,
    ) -> Result<T, Error> {
        request(&self.commands, make).await
    }
}

async fn request<T>(
    commands: &mpsc::Sender<Command>,
    make: impl FnOnce(oneshot::Sender<T>) -> Request,
) -> Result<T, Error> {
    let (reply, answer) = oneshot::channel();
    commands
        .send(Command::Request(make(reply)))
        .await
        .map_err(|_| Error::Stopped)?;
    answer.await.map_err(|_| Error::Stopped)
}

/// The plant timezone days are cut in (ADR 3).
#[derive(Debug, Clone)]
pub struct Zones {
    commands: mpsc::Sender<Command>,
    current: std::sync::Arc<watch::Sender<jiff::tz::TimeZone>>,
}

impl Zones {
    /// The zone, now and after each change.
    #[must_use]
    pub fn watch(&self) -> watch::Receiver<jiff::tz::TimeZone> {
        self.current.subscribe()
    }

    /// Cuts days from now on in the IANA zone `name`, kept across restarts; `log` runs in the same
    /// transaction.
    ///
    /// # Errors
    /// The zone is unknown, or the file cannot be written.
    pub async fn set(&self, name: &str, log: thread::Log) -> Result<(), Error> {
        let tz = jiff::tz::TimeZone::get(name).map_err(|_| Error::Zone)?;
        let zone = (name.to_owned(), tz.clone());
        request(&self.commands, |reply| Request::Zone { zone, log, reply }).await??;
        self.current.send_replace(tz);
        Ok(())
    }
}

/// Declares the series storage stores.
#[derive(Debug, Clone)]
pub struct Declarer {
    commands: mpsc::Sender<Command>,
    bus: Bus,
}

impl Declarer {
    /// Stores `series` of `device` from now on, resuming its history.
    ///
    /// # Errors
    /// The step differs from the stored one or is not positive, or the series is unknown.
    pub async fn declare(
        &self,
        device: DeviceId,
        series: SeriesId,
        policy: Policy,
    ) -> Result<(), Error> {
        if !(policy.step.is_finite() && policy.step > 0.0) {
            return Err(Error::Step);
        }
        let name = self
            .bus
            .series(series)
            .ok_or(Error::UnknownSeries)?
            .to_string();
        request(&self.commands, |reply| Request::Declare {
            device,
            series,
            name,
            policy,
            reply,
        })
        .await?
    }
}

/// Imports history from an older release (ADR 18).
#[derive(Debug, Clone)]
pub struct Importer {
    commands: mpsc::Sender<Command>,
    bus: Bus,
}

impl Importer {
    /// As [`Storage::import`].
    ///
    /// # Errors
    /// The step differs from the stored one or is not positive, the series is unknown, or the
    /// file cannot be written.
    pub async fn import(
        &self,
        device: DeviceId,
        series: SeriesId,
        policy: Policy,
        backfill: Backfill,
    ) -> Result<Backfilled, Error> {
        if !(policy.step.is_finite() && policy.step > 0.0) {
            return Err(Error::Step);
        }
        let name = self
            .bus
            .series(series)
            .ok_or(Error::UnknownSeries)?
            .to_string();
        request(&self.commands, |reply| {
            Request::Rewriting(Rewriting::Import {
                device,
                name,
                policy,
                backfill,
                reply,
            })
        })
        .await?
    }
}

/// Replaces the change points of derived series (ADR 3).
#[derive(Debug, Clone)]
pub struct Rewriter(mpsc::Sender<Command>);

impl Rewriter {
    /// Replaces the change points of a declared `series` within `range` with `points`, and
    /// rebuilds the rollups they touch. The last of `points` holds until the next stored point.
    ///
    /// # Errors
    /// The series is not declared, or the file cannot be written.
    pub async fn replace(
        &self,
        device: DeviceId,
        series: SeriesId,
        range: Range<SystemTime>,
        points: Vec<ChangePoint>,
    ) -> Result<(), Error> {
        request(&self.0, |reply| {
            Request::Rewriting(Rewriting::Replace {
                device,
                series,
                range,
                points,
                reply,
            })
        })
        .await?
    }
}

/// Reads stored history by series, whether or not the bus has interned it since the start.
#[derive(Debug, Clone)]
pub struct Reader(mpsc::Sender<Command>);

impl Reader {
    /// The change points of `series` from `from` to `to`, led by the one in force at `from`;
    /// none for a series without history. The open bucket is not yet history.
    ///
    /// # Errors
    /// The file cannot be read.
    pub async fn history(
        &self,
        device: DeviceId,
        series: &Series,
        from: SystemTime,
        to: SystemTime,
    ) -> Result<Vec<ChangePoint>, Error> {
        let name = series.to_string();
        request(&self.0, |reply| Request::History {
            device,
            name,
            from,
            to,
            reply,
        })
        .await?
    }

    /// The rollups of `series` in `tier` that start within `range`.
    ///
    /// # Errors
    /// The file cannot be read.
    pub async fn rollups(
        &self,
        device: DeviceId,
        series: &Series,
        tier: Tier,
        range: Range<SystemTime>,
    ) -> Result<Vec<Rollup>, Error> {
        let name = series.to_string();
        request(&self.0, |reply| Request::Rollups {
            device,
            name,
            tier,
            range,
            reply,
        })
        .await?
    }

    /// Every stored forecast of `series` with a target from `from` to before `to`, by target,
    /// then issue.
    ///
    /// # Errors
    /// The file cannot be read.
    pub async fn forecasts(
        &self,
        device: DeviceId,
        series: &Series,
        from: SystemTime,
        to: SystemTime,
    ) -> Result<Vec<Forecast>, Error> {
        let name = series.to_string();
        request(&self.0, |reply| {
            Request::Forecasting(Forecasting::Forecasts {
                device,
                name,
                from,
                to,
                reply,
            })
        })
        .await?
    }
}

/// The storage thread's connection, lent to the feature module that owns a table (ADR 19). Its
/// SQL touches only that module's tables, which storage's migrations create.
#[derive(Debug, Clone)]
pub struct Database(mpsc::Sender<Command>);

impl Database {
    /// Runs `job` on the storage thread, between flushes.
    ///
    /// # Errors
    /// The job failed or the storage thread has stopped.
    pub async fn run<T: Send + 'static>(
        &self,
        job: impl FnOnce(&rusqlite::Connection) -> rusqlite::Result<T> + Send + 'static,
    ) -> Result<T, Error> {
        let (reply, answer) = oneshot::channel();
        let job: thread::Job = Box::new(move |db| {
            reply.send(job(db)).ok();
        });
        self.0
            .send(Command::Request(Request::Run(job)))
            .await
            .map_err(|_| Error::Stopped)?;
        Ok(answer.await.map_err(|_| Error::Stopped)??)
    }
}

/// Forwards the bus's readings to the storage thread.
async fn feed(mut readings: broadcast::Receiver<Reading>, commands: mpsc::Sender<Command>) {
    loop {
        match readings.recv().await {
            Ok(reading) => {
                if commands.send(Command::Reading(reading)).await.is_err() {
                    return;
                }
            }
            // Fallen behind: the lost readings are lost to history, never to live values.
            Err(broadcast::error::RecvError::Lagged(_)) => {}
            Err(broadcast::error::RecvError::Closed) => return,
        }
    }
}

#[cfg(test)]
mod tests;
