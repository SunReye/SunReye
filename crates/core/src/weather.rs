//! The weather computed device (ADR 15, 17): irradiance, temperature and wind forecasts for the
//! plant's location, fetched by its own task through an interchangeable provider.

#[cfg(test)]
pub mod fake;
mod open_meteo;

use std::fmt;
use std::future::Future;
use std::ops::ControlFlow;
use std::time::{Duration, SystemTime};

use tokio::sync::watch;
use tokio::time::Instant;

use crate::bus::{Bus, DeviceId, SeriesId};
use crate::location::Location;
use crate::storage::{self, Issue, Storage};

pub use open_meteo::OpenMeteo;

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

#[cfg(test)]
mod tests;
