//! The tariff device's task: the prices in force, published from the instant each begins.
//!
//! It publishes on every whole minute, so a held price is never a gap (ADR 3), and at once at each
//! band edge and each version's start; storage keeps only the changes.
//!
//! It prices the plant's flows (ADR 12): each reading of the plant's grid power or house load, or
//! of a price, publishes the `cost.*` rates while both flows are fresh.

use std::time::{Duration, SystemTime};

use sunreye_profile::RoleKind;
use tokio::sync::{broadcast, watch};
use tokio::task::JoinHandle;

use super::cost::Meter;
use super::{Tariffs, Version, in_force, wake};
use crate::api::Clock;
use crate::bus::{Bus, DeviceId, Reading, SeriesId};
use crate::endpoint;
use crate::plant;
use crate::storage::{Error, Policy};

/// Computed device ids count down from `u32::MAX`, the weather device's (ADR 15).
pub const DEVICE: DeviceId = DeviceId(u32::MAX - 2);
/// The device publishes at least once a minute, which sets its gap threshold.
const CADENCE: Duration = Duration::from_secs(60);
/// EUR/kWh to a thousandth of a cent, as fine as a day-ahead price in EUR/MWh.
const STEP: f64 = 0.000_01;
/// What a kWh bought costs and a kWh fed in earns.
pub const PRICES: [&str; 2] = ["price.import", "price.export"];
/// The rates, in EUR/h to a thousandth of a cent: paid, earned and saved.
pub const COSTS: [&str; 3] = ["cost.import.rate", "cost.export.rate", "cost.savings.rate"];
/// A plant reading older than the gap threshold (ADR 3) no longer prices its flow.
const STALE: Duration = Duration::from_secs(15);

/// The tariff device's task; dropping the handle stops it.
#[derive(Debug)]
pub struct TariffDevice(JoinHandle<()>);

impl Drop for TariffDevice {
    fn drop(&mut self) {
        self.0.abort();
    }
}

impl TariffDevice {
    /// Starts publishing the tariff's prices and the plant's cost rates. Must be called inside a
    /// Tokio runtime.
    #[must_use]
    pub fn spawn(tariffs: Tariffs, clock: Clock) -> Self {
        let bus = tariffs.bus.clone();
        let inputs = [
            (plant::DEVICE, bus.intern("grid.power", None)),
            (plant::DEVICE, bus.intern("load.power", None)),
            (DEVICE, tariffs.prices[0]),
            (DEVICE, tariffs.prices[1]),
        ];
        let task = Task {
            changes: tariffs.changes(),
            readings: bus.subscribe(),
            inputs,
            meter: Meter::default(),
            flows: [None; 2],
            bus,
            declared: false,
            clock,
            tariffs,
        };
        Self(tokio::spawn(task.run()))
    }
}

/// Declares the prices and the rates to storage. The rates follow the plant, so they share its
/// cadence.
///
/// # Errors
/// A series is stored in another step, or storage has stopped.
pub async fn declare(tariffs: &Tariffs) -> Result<(), Error> {
    let prices = Policy::new(RoleKind::Measurement, None, STEP, CADENCE);
    let costs = Policy::new(RoleKind::Measurement, None, STEP, endpoint::CADENCE);
    let all = tariffs.prices.map(|s| (s, prices));
    for (series, policy) in all.into_iter().chain(tariffs.costs.map(|s| (s, costs))) {
        tariffs.declarer.declare(DEVICE, series, policy).await?;
    }
    Ok(())
}

enum Wake {
    /// The next publication is due.
    Due,
    Changed,
}

struct Task {
    tariffs: Tariffs,
    changes: watch::Receiver<()>,
    readings: broadcast::Receiver<Reading>,
    /// What the rates are priced from: the plant's grid power and house load, then the prices.
    inputs: [(DeviceId, SeriesId); 4],
    meter: Meter,
    /// When the plant's grid power and house load were last read.
    flows: [Option<SystemTime>; 2],
    bus: Bus,
    declared: bool,
    clock: Clock,
}

impl Task {
    async fn run(mut self) {
        let mut versions = self.versions().await;
        let mut at = (self.clock)();
        loop {
            if let Some(version) = in_force(&versions, at) {
                let version = version.clone();
                self.publish(&version, at).await;
            }
            let next = wake(&versions, at);
            let wait = next.duration_since((self.clock)()).unwrap_or_default();
            // The timer is dropped before the versions are read, or a paused clock runs to it.
            match self.until(tokio::time::sleep(wait)).await {
                Some(Wake::Due) => at = next,
                Some(Wake::Changed) => {
                    versions = self.versions().await;
                    at = (self.clock)();
                }
                None => return,
            }
        }
    }

    /// Prices the readings heard until `sleep` ends or the tariff changes; `None` once the bus or
    /// the tariff is gone.
    async fn until(&mut self, sleep: tokio::time::Sleep) -> Option<Wake> {
        let mut sleep = std::pin::pin!(sleep);
        loop {
            tokio::select! {
                () = &mut sleep => return Some(Wake::Due),
                changed = self.changes.changed() => return changed.ok().map(|()| Wake::Changed),
                reading = self.readings.recv() => match reading {
                    Ok(reading) => self.price(reading).await,
                    // A missed flow is read again within a cadence, a missed price within a minute.
                    Err(broadcast::error::RecvError::Lagged(_)) => {}
                    Err(broadcast::error::RecvError::Closed) => return None,
                },
            }
        }
    }

    /// Every version; none when the file cannot be read, until the next change.
    async fn versions(&mut self) -> Vec<Version> {
        self.changes.mark_unchanged();
        self.tariffs.versions().await.unwrap_or_else(|e| {
            tracing::warn!("tariff: {e}");
            Vec::new()
        })
    }

    /// Declared once: a refusal, such as another step, stands until a restart.
    async fn declare(&self) {
        if let Err(e) = declare(&self.tariffs).await {
            tracing::warn!("tariff value not stored: {e}");
        }
    }

    /// Publishes the rates after a reading of an input, while both flows are fresh.
    async fn price(&mut self, reading: Reading) {
        let Some(input) = self
            .inputs
            .iter()
            .position(|&input| input == (reading.device, reading.series))
        else {
            return;
        };
        self.meter.set(input, Some(reading.value));
        if let Some(seen) = self.flows.get_mut(input) {
            *seen = Some(reading.time);
        }
        let fresh = self.flows.iter().all(|seen| {
            seen.is_some_and(|seen| {
                reading
                    .time
                    .duration_since(seen)
                    .unwrap_or_else(|e| e.duration())
                    <= STALE
            })
        });
        let Some(rates) = self.meter.rates().filter(|_| fresh) else {
            return;
        };
        if !self.declared {
            self.declared = true;
            self.declare().await;
        }
        let values = [rates.import, rates.export, rates.savings];
        for (series, value) in self.tariffs.costs.into_iter().zip(values) {
            self.bus.publish(Reading {
                device: DEVICE,
                series,
                value,
                unit: None,
                time: reading.time,
            });
        }
    }

    async fn publish(&mut self, version: &Version, at: SystemTime) {
        if !self.declared {
            self.declared = true;
            self.declare().await;
        }
        let prices = version.prices(&self.tariffs.zone.borrow(), at);
        for (series, value) in self
            .tariffs
            .prices
            .into_iter()
            .zip([prices.import, prices.export])
        {
            self.bus.publish(Reading {
                device: DEVICE,
                series,
                value,
                unit: None,
                time: at,
            });
        }
    }
}
