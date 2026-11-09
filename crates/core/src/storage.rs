//! Storage (ADR 3): readings become change points in one SQLite file, owned by one thread fed by
//! a bounded channel (ADR 2).

mod block;
mod encode;
mod thread;

use std::fmt;
use std::path::Path;
use std::time::{Duration, SystemTime};

use sunreye_profile::{RoleKind, Unit};
use tokio::sync::{broadcast, mpsc, oneshot};
use tokio::task::JoinHandle;

use crate::bus::{Bus, DeviceId, Reading, SeriesId};
use thread::{Command, Request};

/// Commands the storage thread may fall behind by before senders wait.
const QUEUE: usize = 1024;

/// How one series of one device is stored.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Policy {
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
    /// A series was declared with a step other than the one its history is stored in.
    StepChanged,
    /// A step that is not a positive finite number.
    Step,
    /// A stored block this build cannot read.
    Corrupt,
    /// A series the bus never interned.
    UnknownSeries,
    /// The storage thread has stopped.
    Stopped,
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Sqlite(e) => write!(f, "sqlite: {e}"),
            Self::StepChanged => f.write_str("the series is stored in another step"),
            Self::Step => f.write_str("the step must be positive and finite"),
            Self::Corrupt => f.write_str("a stored block cannot be read"),
            Self::UnknownSeries => f.write_str("unknown series"),
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
}

impl Drop for Storage {
    fn drop(&mut self) {
        self.feed.abort();
    }
}

impl Storage {
    /// Opens or creates the file at `path` and starts storing the bus's readings of declared
    /// series. Must be called inside a Tokio runtime.
    ///
    /// # Errors
    /// The file cannot be opened or migrated.
    pub fn open(path: &Path, build: SystemTime, bus: &Bus) -> Result<Self, Error> {
        let commands = thread::spawn(path, build, QUEUE)?;
        let feed = tokio::spawn(feed(bus.subscribe(), commands.clone()));
        Ok(Self {
            commands,
            bus: bus.clone(),
            feed,
        })
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
        if !(policy.step.is_finite() && policy.step > 0.0) {
            return Err(Error::Step);
        }
        let name = self.name(series)?;
        self.request(|reply| Request::Declare {
            device,
            series,
            name,
            policy,
            reply,
        })
        .await?
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
    /// The file cannot be read.
    pub async fn history(
        &self,
        device: DeviceId,
        series: SeriesId,
        from: SystemTime,
        to: SystemTime,
    ) -> Result<Vec<ChangePoint>, Error> {
        let name = self.name(series)?;
        self.request(|reply| Request::History {
            device,
            name,
            from,
            to,
            reply,
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
        Ok(series.index.map_or_else(
            || series.role.clone(),
            |index| format!("{}[{index}]", series.role),
        ))
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
        let (reply, answer) = oneshot::channel();
        self.send(Command::Request(make(reply))).await?;
        answer.await.map_err(|_| Error::Stopped)
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
