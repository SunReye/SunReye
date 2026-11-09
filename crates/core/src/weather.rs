//! The weather computed device (ADR 15, 17): irradiance, temperature and wind forecasts for the
//! plant's location, fetched by its own task through an interchangeable provider.

#[cfg(test)]
pub mod fake;
mod open_meteo;

use std::fmt;
use std::future::Future;
use std::ops::ControlFlow;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use sunreye_profile::RoleKind;

use tokio::sync::watch;
use tokio::time::Instant;

use crate::bus::{Bus, DeviceId, SeriesId};
use crate::location::Location;
use crate::storage::{self, ChangePoint, Issue, Policy, Storage};

#[cfg(test)]
pub use open_meteo::parse_archive;
pub use open_meteo::{OpenMeteo, OpenMeteoArchive};

const HOUR: Duration = Duration::from_secs(3600);

/// The weather device's id: computed devices count down from the top, registered devices up
/// from 1 (ADR 15).
pub const DEVICE: DeviceId = DeviceId(u32::MAX);

/// The weather at one 15-minute target, irradiance in W/m².
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Slot {
    pub target: SystemTime,
    pub ghi: f64,
    pub dni: f64,
    pub dhi: f64,
    /// Air temperature in °C.
    pub temperature: f64,
    /// Wind speed in m/s, when the provider has it.
    pub wind: Option<f64>,
}

/// A source of weather forecasts: Open-Meteo, or a fake in tests.
pub trait Provider: Sync {
    /// The forecast at 15-minute resolution for today and two more days at `location`.
    fn fetch(&self, location: Location) -> impl Future<Output = Result<Vec<Slot>, Error>> + Send;
}

/// A source of past weather: Open-Meteo's archive, or a fake in tests.
pub trait Archive: Sync {
    /// The weather hourly at `location` over the UTC days `from` to `to`, both included; hours
    /// the source has not settled yet are absent.
    fn fetch(
        &self,
        location: Location,
        from: jiff::civil::Date,
        to: jiff::civil::Date,
    ) -> impl Future<Output = Result<Vec<Slot>, Error>> + Send;
}

#[derive(Debug)]
pub enum Error {
    /// The provider could not be reached or refused the request.
    Fetch(String),
    /// The provider's answer is not a forecast.
    Format,
    Storage(storage::Error),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Fetch(e) => write!(f, "fetch: {e}"),
            Self::Format => f.write_str("the answer is not a forecast"),
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

/// One stored quantity: its role, the step it is stored in and its value in a slot.
struct Quantity {
    role: &'static str,
    step: f64,
    value: fn(&Slot) -> Option<f64>,
}

const QUANTITIES: [Quantity; 5] = [
    Quantity {
        role: "weather.ghi",
        step: 0.1,
        value: |s| Some(s.ghi),
    },
    Quantity {
        role: "weather.dni",
        step: 0.1,
        value: |s| Some(s.dni),
    },
    Quantity {
        role: "weather.dhi",
        step: 0.1,
        value: |s| Some(s.dhi),
    },
    Quantity {
        role: "weather.temperature",
        step: 0.1,
        value: |s| Some(s.temperature),
    },
    Quantity {
        role: "weather.wind",
        step: 0.01,
        value: |s| s.wind,
    },
];

/// The weather device. Only its own task fetches; everyone else reads the forecast store.
pub struct Weather<P> {
    provider: P,
    device: DeviceId,
    series: [SeriesId; QUANTITIES.len()],
    issued: watch::Sender<Option<SystemTime>>,
}

impl<P: Provider> Weather<P> {
    pub fn new(provider: P, device: DeviceId, bus: &Bus) -> Self {
        Self {
            provider,
            device,
            series: QUANTITIES.map(|q| bus.intern(q.role, None)),
            issued: watch::channel(None).0,
        }
    }

    /// The issue time of the latest forecast stored, announced as each is stored.
    pub fn issues(&self) -> watch::Receiver<Option<SystemTime>> {
        self.issued.subscribe()
    }

    /// Fetches for the plant's `location` while one is set: on start, at once when it changes,
    /// and hourly from then, until storage or the location stops. A failed fetch keeps the last
    /// good forecast.
    pub async fn run(
        &self,
        storage: &Storage,
        mut location: watch::Receiver<Option<Location>>,
        clock: impl Fn() -> SystemTime + Sync,
    ) {
        let mut next = Instant::now();
        loop {
            let current = *location.borrow_and_update();
            if let Some(at) = current
                && self.announce(storage, at, clock()).await.is_break()
            {
                return;
            }
            next += HOUR;
            // Armed only after the refresh, so no timer is pending while it waits on storage.
            tokio::select! {
                () = tokio::time::sleep_until(next) => {}
                changed = location.changed() => {
                    if changed.is_err() {
                        return;
                    }
                    next = Instant::now();
                }
            }
        }
    }

    /// Refreshes and announces the issue; breaks once storage has stopped.
    async fn announce(
        &self,
        storage: &Storage,
        location: Location,
        issued: SystemTime,
    ) -> ControlFlow<()> {
        match self.refresh(storage, location, issued).await {
            Ok(()) => {
                self.issued.send_replace(Some(issued));
            }
            Err(Error::Storage(storage::Error::Stopped)) => return ControlFlow::Break(()),
            Err(e) => tracing::warn!("weather: {e}"),
        }
        ControlFlow::Continue(())
    }

    /// Fetches one forecast for the plant at `location` and stores it as issued at `issued`.
    ///
    /// # Errors
    /// The provider or storage failed.
    pub async fn refresh(
        &self,
        storage: &Storage,
        location: Location,
        issued: SystemTime,
    ) -> Result<(), Error> {
        let slots = self.provider.fetch(location.rounded()).await?;
        for (quantity, series) in QUANTITIES.iter().zip(self.series) {
            let values = slots
                .iter()
                .filter_map(|s| Some((s.target, (quantity.value)(s)?)))
                .collect();
            let issue = Issue {
                issued,
                step: quantity.step,
                values,
            };
            storage.forecast(self.device, series, issue).await?;
        }
        Ok(())
    }
}

/// Past weather (ADR 17): fetched from an archive and stored as `weather.*` history, so learning
/// and charts read it locally.
pub struct Past<A> {
    archive: A,
    device: DeviceId,
    series: [SeriesId; QUANTITIES.len()],
}

impl<A: Archive> Past<A> {
    pub fn new(archive: A, device: DeviceId, bus: &Bus) -> Self {
        Self {
            archive,
            device,
            series: QUANTITIES.map(|q| bus.intern(q.role, None)),
        }
    }

    /// Fetches the UTC days `from` to `to` for the plant at `location` and stores them hourly,
    /// replacing what was stored for those hours; an hour the archive lacks is a gap.
    ///
    /// # Errors
    /// The archive or storage failed.
    pub async fn fetch(
        &self,
        storage: &Storage,
        location: Location,
        from: jiff::civil::Date,
        to: jiff::civil::Date,
    ) -> Result<(), Error> {
        let slots = self.archive.fetch(location.rounded(), from, to).await?;
        let (Some(first), Some(last)) = (slots.first(), slots.last()) else {
            return Ok(());
        };
        let hours: Vec<SystemTime> = hours(first.target, last.target + HOUR).collect();
        for (quantity, series) in QUANTITIES.iter().zip(self.series) {
            let policy = Policy::new(RoleKind::Measurement, None, quantity.step, HOUR);
            storage.declare(self.device, series, policy).await?;
            let mut points: Vec<ChangePoint> = hours
                .iter()
                .map(|&time| ChangePoint {
                    time,
                    value: slots
                        .iter()
                        .find(|s| s.target == time)
                        .and_then(|s| (quantity.value)(s)),
                })
                .collect();
            // Past the last hour nothing is known.
            points.push(ChangePoint {
                time: last.target + HOUR,
                value: None,
            });
            let range = first.target..last.target + HOUR + Duration::from_secs(1);
            storage.replace(self.device, series, range, points).await?;
        }
        Ok(())
    }

    /// The stored weather at each whole hour from `from` to before `to` that has irradiance and
    /// temperature.
    ///
    /// # Errors
    /// Storage failed.
    pub async fn read(
        &self,
        storage: &Storage,
        from: SystemTime,
        to: SystemTime,
    ) -> Result<Vec<Slot>, Error> {
        let mut stored = Vec::with_capacity(QUANTITIES.len());
        for series in self.series {
            stored.push(storage.history(self.device, series, from, to).await?);
        }
        let at = |i: usize, time: SystemTime| {
            let points: &Vec<ChangePoint> = stored.get(i)?;
            points.iter().rev().find(|p| p.time <= time)?.value
        };
        Ok(hours(from, to)
            .filter_map(|target| {
                Some(Slot {
                    target,
                    ghi: at(0, target)?,
                    dni: at(1, target)?,
                    dhi: at(2, target)?,
                    temperature: at(3, target)?,
                    wind: at(4, target),
                })
            })
            .collect())
    }
}

/// The whole hours from `from` to before `to`.
fn hours(from: SystemTime, to: SystemTime) -> impl Iterator<Item = SystemTime> {
    let since = from
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let first = UNIX_EPOCH + Duration::from_secs(since.div_ceil(HOUR.as_secs()) * HOUR.as_secs());
    std::iter::successors(Some(first), |t| Some(*t + HOUR)).take_while(move |t| *t < to)
}

#[cfg(test)]
mod tests;
