//! The plant computed device (ADR 14, 15): the plant's aggregates, balanced over the topology in
//! force at each reading and published as the readings of one device.
//!
//! Each reading of a power role, or of a battery's state of charge or capacity, balances the tree
//! again over the latest fresh reading of every point. The plant publishes its totals under the
//! same roles its devices use, and each measured point's own consumption as `point.power`, indexed
//! by point id.

use std::collections::{HashMap, HashSet};
use std::time::{Duration, SystemTime};

use sunreye_profile::{RoleKind, Unit};
use tokio::sync::{broadcast, watch};
use tokio::task::JoinHandle;

use crate::bus::{Bus, DeviceId, Reading, Series, SeriesId};
use crate::endpoint::CADENCE;
use crate::storage::{Declarer, Policy};
use crate::topology::{Topologies, Version, balance, in_force};

/// Computed device ids count down from `u32::MAX`, the weather device's (ADR 15).
pub const DEVICE: DeviceId = DeviceId(u32::MAX - 1);
/// Each measured point's own consumption, by point id.
const POINT: &str = "point.power";
/// A reading older than the gap threshold (ADR 3) no longer measures its point.
const STALE: Duration = Duration::from_secs(15);
/// The roles the plant reads, with the unit and step it stores its own in.
const ROLES: &[(&str, Unit, f64)] = &[
    ("grid.power", Unit::Watt, 1.0),
    ("pv.power", Unit::Watt, 1.0),
    ("generator.power", Unit::Watt, 1.0),
    ("battery.power", Unit::Watt, 1.0),
    ("load.power", Unit::Watt, 1.0),
    ("backup.power", Unit::Watt, 1.0),
    ("ev.charge.power", Unit::Watt, 1.0),
    ("battery.soc", Unit::Percent, 0.1),
    ("battery.capacity", Unit::KilowattHour, 0.01),
];

/// The plant's task; dropping the handle stops it.
#[derive(Debug)]
pub struct Plant(JoinHandle<()>);

impl Drop for Plant {
    fn drop(&mut self) {
        self.0.abort();
    }
}

impl Plant {
    /// Starts balancing the bus's readings. Must be called inside a Tokio runtime.
    #[must_use]
    pub fn spawn(topologies: Topologies, declarer: Declarer, bus: &Bus) -> Self {
        let task = Task {
            changes: topologies.changes(),
            topologies,
            declarer,
            bus: bus.clone(),
            versions: None,
            latest: HashMap::new(),
            declared: HashSet::new(),
            published: HashMap::new(),
        };
        // Subscribed before the task first runs, so no reading published from now on is missed.
        Self(tokio::spawn(task.run(bus.subscribe())))
    }
}

struct Task {
    topologies: Topologies,
    changes: watch::Receiver<()>,
    declarer: Declarer,
    bus: Bus,
    /// Read again after each topology change.
    versions: Option<Vec<Version>>,
    /// The latest reading of each device's role, with its instant.
    latest: HashMap<(u32, String), (f64, SystemTime)>,
    /// The plant's series already declared to storage.
    declared: HashSet<SeriesId>,
    /// What each plant series last published, and when.
    published: HashMap<SeriesId, (f64, SystemTime)>,
}

impl Task {
    async fn run(mut self, mut readings: broadcast::Receiver<Reading>) {
        loop {
            match readings.recv().await {
                Ok(reading) => self.balance(reading).await,
                // A missed reading is replaced by the next poll's.
                Err(broadcast::error::RecvError::Lagged(_)) => {}
                Err(broadcast::error::RecvError::Closed) => return,
            }
        }
    }

    async fn balance(&mut self, reading: Reading) {
        if reading.device == DEVICE {
            return;
        }
        let Some(Series { role, index: None }) = self.bus.series(reading.series) else {
            return;
        };
        if !ROLES.iter().any(|(r, ..)| *r == role) {
            return;
        }
        self.latest
            .insert((reading.device.0, role), (reading.value, reading.time));
        let Some(version) = self.version(reading.time).await else {
            return;
        };
        let now = reading.time;
        let balance = balance(&version.points, |device, role| {
            let &(value, time) = self.latest.get(&(device, role.to_owned()))?;
            let age = now.duration_since(time).unwrap_or_else(|e| e.duration());
            (age <= STALE).then_some(value)
        });
        for (role, value) in balance.totals {
            if let Some(&(_, unit, step)) = ROLES.iter().find(|(r, ..)| *r == role) {
                self.publish((role, None), (unit, step), value, now).await;
            }
        }
        for (point, watts) in balance.own {
            self.publish((POINT, Some(point)), (Unit::Watt, 1.0), watts, now)
                .await;
        }
    }

    /// The topology in force at `at`.
    async fn version(&mut self, at: SystemTime) -> Option<Version> {
        if self.changes.has_changed().unwrap_or(false) || self.versions.is_none() {
            self.changes.mark_unchanged();
            match self.topologies.versions().await {
                Ok(versions) => self.versions = Some(versions),
                Err(e) => tracing::warn!("plant: {e}"),
            }
        }
        in_force(self.versions.as_deref()?, at).cloned()
    }

    async fn publish(
        &mut self,
        (role, index): (&str, Option<u32>),
        (unit, step): (Unit, f64),
        value: f64,
        time: SystemTime,
    ) {
        let series = self.bus.intern(role, index);
        // Declared once: a refusal, such as another step, stands until a restart.
        if self.declared.insert(series) {
            let policy = Policy::new(RoleKind::Measurement, Some(unit), step, CADENCE);
            if let Err(e) = self.declarer.declare(DEVICE, series, policy).await {
                tracing::warn!(role, ?index, "plant value not stored: {e}");
            }
        }
        // Every reading balances the tree again; an unchanged value is sent once a cadence, which
        // keeps it from being a gap without flooding the bus.
        let repeated = self.published.get(&series).is_some_and(|&(last, at)| {
            last.to_bits() == value.to_bits()
                && time.duration_since(at).is_ok_and(|age| age < CADENCE)
        });
        if repeated {
            return;
        }
        self.published.insert(series, (value, time));
        self.bus.publish(Reading {
            device: DEVICE,
            series,
            value,
            unit: Some(unit),
            time,
        });
    }
}

#[cfg(test)]
mod tests;
