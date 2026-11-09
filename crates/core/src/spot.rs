//! The spot-price computed device (ADR 12, 15): a bidding zone's day-ahead prices, fetched by its
//! own task into the forecast store; each slot is published as `price.spot` when it begins.

mod energy_charts;
#[cfg(test)]
pub mod fake;

use std::fmt;
use std::future::Future;
use std::ops::ControlFlow;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sunreye_profile::RoleKind;
use tokio::sync::watch;
use utoipa::ToSchema;

use crate::bus::{Bus, DeviceId, Reading, SeriesId};
use crate::storage::{self, Issue, Policy, Storage};

pub use energy_charts::EnergyCharts;

/// Computed device ids count down from `u32::MAX`, the weather device's (ADR 15).
pub const DEVICE: DeviceId = DeviceId(u32::MAX - 3);
/// A bidding zone's day-ahead price; the tariff's `price.import` and `price.export` stay what the
/// bill is priced at (ADR 12).
const ROLE: &str = "price.spot";
/// The market time unit; every slot starts on a quarter hour of the Unix epoch.
const SLOT: Duration = Duration::from_mins(15);
/// The auction clears around 13:00 market time, but not reliably: polled, never timed.
const POLL: Duration = Duration::from_hours(1);
/// EUR/kWh to a thousandth of a cent: a day-ahead price in EUR/MWh has two decimals.
const STEP: f64 = 0.000_01;

/// A day-ahead market area.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub enum BiddingZone {
    /// Germany and Luxembourg.
    #[serde(rename = "DE-LU")]
    DeLu,
}

impl BiddingZone {
    const fn code(self) -> &'static str {
        match self {
            Self::DeLu => "DE-LU",
        }
    }

    /// The timezone the market's delivery days are cut in.
    const fn market_zone(self) -> &'static str {
        match self {
            Self::DeLu => "Europe/Berlin",
        }
    }
}

/// One day-ahead price, in EUR/kWh, for the 15 minutes from `start`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Slot {
    pub start: SystemTime,
    pub price: f64,
}

/// A source of day-ahead prices: energy-charts, or a fake in tests.
pub trait Provider: Sync {
    /// The prices published for today and tomorrow on the market's calendar at `at`.
    fn fetch(
        &self,
        zone: BiddingZone,
        at: SystemTime,
    ) -> impl Future<Output = Result<Vec<Slot>, Error>> + Send;
}

#[derive(Debug)]
pub enum Error {
    /// The source could not be reached or refused the request; an unpublished day is refused.
    Fetch(String),
    /// The source's answer is not a price list.
    Format,
    Storage(storage::Error),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Fetch(e) => write!(f, "fetch: {e}"),
            Self::Format => f.write_str("the answer is not a price list"),
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

/// The spot-price device. Only its own task fetches; it publishes from the forecast store, so a
/// failed fetch or a restart serves the last good prices.
pub struct SpotPrices<P> {
    provider: P,
    series: SeriesId,
    bus: Bus,
}

impl<P: Provider> SpotPrices<P> {
    pub fn new(provider: P, bus: &Bus) -> Self {
        Self {
            provider,
            series: bus.intern(ROLE, None),
            bus: bus.clone(),
        }
    }

    /// While a bidding `zone` is set: fetches on start, at once when it changes and hourly from
    /// then, and publishes the price in force on start and at each slot's first instant, until
    /// storage or the zone stops. A slot without a price publishes nothing: unknown, never zero.
    pub async fn run(
        &self,
        storage: &Storage,
        mut zone: watch::Receiver<Option<BiddingZone>>,
        clock: impl Fn() -> SystemTime + Sync,
    ) {
        let mut at = clock();
        let mut due = Due {
            fetch: at,
            declared: false,
        };
        loop {
            let current = *zone.borrow_and_update();
            let next = match current {
                Some(current) => match self.serve(storage, current, at, &mut due).await {
                    ControlFlow::Continue(next) => Some(next),
                    ControlFlow::Break(()) => return,
                },
                None => None,
            };
            // Armed only after storage has answered, so a paused clock does not run to it.
            let wait = next.map(|next| next.duration_since(clock()).unwrap_or_default());
            tokio::select! {
                () = sleep(wait) => at = next.unwrap_or(at),
                changed = zone.changed() => {
                    if changed.is_err() {
                        return;
                    }
                    at = clock();
                    due.fetch = at;
                }
            }
        }
    }

    /// Fetches when due and publishes the price in force at `at`; continues with when to wake
    /// next, or breaks once storage has stopped.
    async fn serve(
        &self,
        storage: &Storage,
        zone: BiddingZone,
        at: SystemTime,
        due: &mut Due,
    ) -> ControlFlow<(), SystemTime> {
        if at >= due.fetch {
            self.fetch(storage, zone, at).await?;
            due.fetch = at + POLL;
        }
        self.publish(storage, at, &mut due.declared).await?;
        ControlFlow::Continue(slot_after(at).min(due.fetch))
    }

    /// Fetches the prices for `zone` and stores them as issued at `issued`.
    ///
    /// # Errors
    /// The provider or storage failed.
    pub async fn refresh(
        &self,
        storage: &Storage,
        zone: BiddingZone,
        issued: SystemTime,
    ) -> Result<(), Error> {
        let slots = self.provider.fetch(zone, issued).await?;
        let issue = Issue {
            issued,
            step: STEP,
            values: slots.iter().map(|s| (s.start, s.price)).collect(),
        };
        storage.forecast(DEVICE, self.series, issue).await?;
        Ok(())
    }

    /// Refreshes; breaks once storage has stopped. A failed fetch keeps the stored prices.
    async fn fetch(&self, storage: &Storage, zone: BiddingZone, at: SystemTime) -> ControlFlow<()> {
        match self.refresh(storage, zone, at).await {
            Ok(()) => {}
            Err(Error::Storage(storage::Error::Stopped)) => return ControlFlow::Break(()),
            Err(e) => tracing::warn!("spot prices: {e}"),
        }
        ControlFlow::Continue(())
    }

    /// Publishes the latest stored price of the slot holding `at`; breaks once storage has
    /// stopped.
    async fn publish(
        &self,
        storage: &Storage,
        at: SystemTime,
        declared: &mut bool,
    ) -> ControlFlow<()> {
        let start = slot_after(at) - SLOT;
        let stored = match storage
            .forecasts(DEVICE, self.series, start, start + SLOT)
            .await
        {
            Ok(stored) => stored,
            Err(storage::Error::Stopped) => return ControlFlow::Break(()),
            Err(e) => {
                tracing::warn!("spot prices: {e}");
                return ControlFlow::Continue(());
            }
        };
        // By target, then issue: the last is the latest issue.
        let Some(price) = stored.last() else {
            return ControlFlow::Continue(());
        };
        if !*declared {
            *declared = true;
            let policy = Policy::new(RoleKind::Measurement, None, STEP, SLOT);
            // A refusal, such as another step, stands until a restart.
            if let Err(e) = storage
                .declarer()
                .declare(DEVICE, self.series, policy)
                .await
            {
                tracing::warn!("spot price not stored: {e}");
            }
        }
        self.bus.publish(Reading {
            device: DEVICE,
            series: self.series,
            value: price.value,
            unit: None,
            time: at,
        });
        ControlFlow::Continue(())
    }
}

/// When the device next fetches, and whether its series is declared.
struct Due {
    fetch: SystemTime,
    declared: bool,
}

/// Sleeps for `wait`, or forever without one.
async fn sleep(wait: Option<Duration>) {
    match wait {
        Some(wait) => tokio::time::sleep(wait).await,
        None => std::future::pending().await,
    }
}

/// The first slot start after `at`.
fn slot_after(at: SystemTime) -> SystemTime {
    let since = at.duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
    let slot = SLOT.as_secs();
    UNIX_EPOCH + Duration::from_secs((since / slot + 1) * slot)
}

#[cfg(test)]
mod tests;
