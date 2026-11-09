//! The tariff device's task: the prices in force, published from the instant each begins.
//!
//! It publishes on every whole minute, so a held price is never a gap (ADR 3), and at once at each
//! band edge and each version's start; storage keeps only the changes.

use std::time::{Duration, SystemTime};

use jiff::tz::TimeZone;
use sunreye_profile::RoleKind;
use tokio::sync::watch;
use tokio::task::JoinHandle;

use super::{Tariffs, Version, in_force, wake};
use crate::api::Clock;
use crate::bus::{Bus, DeviceId, Reading, SeriesId};
use crate::storage::{Declarer, Policy};

/// Computed device ids count down from `u32::MAX`, the weather device's (ADR 15).
pub const DEVICE: DeviceId = DeviceId(u32::MAX - 2);
/// The device publishes at least once a minute, which sets its gap threshold.
const CADENCE: Duration = Duration::from_secs(60);
/// EUR/kWh to a thousandth of a cent, as fine as a day-ahead price in EUR/MWh.
const STEP: f64 = 0.000_01;

/// The tariff device's task; dropping the handle stops it.
#[derive(Debug)]
pub struct TariffDevice(JoinHandle<()>);

impl Drop for TariffDevice {
    fn drop(&mut self) {
        self.0.abort();
    }
}

impl TariffDevice {
    /// Starts publishing the tariff's prices, its bands on the wall clock of the plant timezone
    /// `zone`. Must be called inside a Tokio runtime.
    #[must_use]
    pub fn spawn(
        tariffs: Tariffs,
        zone: TimeZone,
        declarer: Declarer,
        bus: &Bus,
        clock: Clock,
    ) -> Self {
        let task = Task {
            changes: tariffs.changes(),
            tariffs,
            zone,
            declarer,
            series: [
                bus.intern("price.import", None),
                bus.intern("price.export", None),
            ],
            bus: bus.clone(),
            declared: false,
            clock,
        };
        Self(tokio::spawn(task.run()))
    }
}

struct Task {
    tariffs: Tariffs,
    changes: watch::Receiver<()>,
    zone: TimeZone,
    declarer: Declarer,
    bus: Bus,
    /// `price.import` and `price.export`.
    series: [SeriesId; 2],
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
            tokio::select! {
                () = tokio::time::sleep(wait) => at = next,
                changed = self.changes.changed() => {
                    if changed.is_err() {
                        return;
                    }
                    versions = self.versions().await;
                    at = (self.clock)();
                }
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
        let policy = Policy::new(RoleKind::Measurement, None, STEP, CADENCE);
        for series in self.series {
            if let Err(e) = self.declarer.declare(DEVICE, series, policy).await {
                tracing::warn!("tariff price not stored: {e}");
            }
        }
    }

    async fn publish(&mut self, version: &Version, at: SystemTime) {
        if !self.declared {
            self.declared = true;
            self.declare().await;
        }
        let prices = version.prices(&self.zone, at);
        for (series, value) in self.series.into_iter().zip([prices.import, prices.export]) {
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
