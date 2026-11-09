//! The weather computed device (ADR 15, 17): irradiance, temperature and wind forecasts for the
//! plant's location, fetched by its own task through an interchangeable provider.

mod open_meteo;

use std::fmt;
use std::future::Future;
use std::time::{Duration, SystemTime};

use tokio::sync::watch;
use tokio::time::Instant;

use crate::bus::{Bus, DeviceId, SeriesId};
use crate::location::Location;
use crate::storage::{self, Issue, Storage};

pub use open_meteo::OpenMeteo;

const HOUR: Duration = Duration::from_secs(3600);

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
}

impl<P: Provider> Weather<P> {
    pub fn new(provider: P, device: DeviceId, bus: &Bus) -> Self {
        Self {
            provider,
            device,
            series: QUANTITIES.map(|q| bus.intern(q.role, None)),
        }
    }

    /// Fetches on start and hourly for the plant's `location`, while set, until storage stops.
    /// A failed fetch keeps the last good forecast.
    pub async fn run(
        &self,
        storage: &Storage,
        location: watch::Receiver<Option<Location>>,
        clock: impl Fn() -> SystemTime + Sync,
    ) {
        let mut next = Instant::now();
        loop {
            let current = *location.borrow();
            let refreshed = match current {
                Some(at) => self.refresh(storage, at, clock()).await,
                None => Ok(()),
            };
            if matches!(refreshed, Err(Error::Storage(storage::Error::Stopped))) {
                return;
            }
            next += HOUR;
            // Armed only after the refresh, so no timer is pending while it waits on storage.
            tokio::time::sleep_until(next).await;
        }
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
