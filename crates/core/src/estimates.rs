//! Parallel-string estimates (ADR 17).
//!
//! Each measured `pv.mppt.power` is split over the strings on its input by their modelled
//! current, read from the solar forecast, and published as `pv.string.power`. A string alone on
//! its input is reported as measured.

use std::collections::HashSet;
use std::time::{Duration, SystemTime};

use sunreye_profile::{RoleKind, Unit};
use tokio::sync::broadcast;
use tokio::task::JoinHandle;

use crate::bus::{Bus, DeviceId, Reading, Series};
use crate::endpoint::CADENCE;
use crate::layout::{Layouts, in_force};
use crate::storage::{Declarer, Policy, Reader};

/// The weather's resolution, and so the solar forecast's: the nearest target is at most half
/// of it away, and one is looked for this far on either side.
const SLOT: Duration = Duration::from_mins(15);
/// Watts, as the solar forecast stores them.
const STEP: f64 = 1.0;
const MEASURED: &str = "pv.mppt.power";
const ESTIMATED: &str = "pv.string.power";

/// The estimating task; dropping the handle stops it.
#[derive(Debug)]
pub struct StringEstimates(JoinHandle<()>);

impl Drop for StringEstimates {
    fn drop(&mut self) {
        self.0.abort();
    }
}

impl StringEstimates {
    /// Starts estimating from the bus's readings. Must be called inside a Tokio runtime.
    #[must_use]
    pub fn spawn(layouts: Layouts, history: Reader, declarer: Declarer, bus: &Bus) -> Self {
        let task = Task {
            layouts,
            history,
            declarer,
            bus: bus.clone(),
            declared: HashSet::new(),
        };
        // Subscribed before the task first runs, so no reading published from now on is missed.
        Self(tokio::spawn(task.run(bus.subscribe())))
    }
}

struct Task {
    layouts: Layouts,
    history: Reader,
    declarer: Declarer,
    bus: Bus,
    /// The estimated series already declared to storage.
    declared: HashSet<(DeviceId, u32)>,
}

impl Task {
    async fn run(mut self, mut readings: broadcast::Receiver<Reading>) {
        loop {
            match readings.recv().await {
                Ok(reading) => self.estimate(reading).await,
                // A missed reading is replaced by the next poll's.
                Err(broadcast::error::RecvError::Lagged(_)) => {}
                Err(broadcast::error::RecvError::Closed) => return,
            }
        }
    }

    async fn estimate(&mut self, reading: Reading) {
        let Some(Series {
            role,
            index: Some(input),
        }) = self.bus.series(reading.series)
        else {
            return;
        };
        if role != MEASURED {
            return;
        }
        let versions = match self.layouts.versions().await {
            Ok(versions) => versions,
            Err(e) => {
                tracing::warn!("string estimates: {e}");
                return;
            }
        };
        let strings: Vec<u32> = in_force(&versions, reading.time)
            .map(|v| {
                v.strings
                    .iter()
                    .filter(|s| s.wiring.device == reading.device.0 && s.wiring.input == input)
                    .map(|s| s.id)
                    .collect()
            })
            .unwrap_or_default();
        let shares = self.shares(reading.device, &strings, reading.time).await;
        for (id, share) in strings.into_iter().zip(shares) {
            self.publish(reading, id, reading.value * share).await;
        }
    }

    /// Each string's share of its input's current: by the solar forecast nearest `time`, or equal
    /// while there is none, as before the first forecast or at night.
    async fn shares(&self, device: DeviceId, strings: &[u32], time: SystemTime) -> Vec<f64> {
        let mut modelled = Vec::with_capacity(strings.len());
        if strings.len() > 1 {
            for id in strings {
                modelled.push(self.forecast(device, *id, time).await.unwrap_or(0.0));
            }
        }
        let total: f64 = modelled.iter().sum();
        if total > 0.0 {
            return modelled.iter().map(|m| m / total).collect();
        }
        #[expect(
            clippy::cast_precision_loss,
            reason = "an input has a handful of strings"
        )]
        let equal = 1.0 / strings.len() as f64;
        vec![equal; strings.len()]
    }

    /// The latest forecast of string `id` at the target nearest `time`.
    async fn forecast(&self, device: DeviceId, id: u32, time: SystemTime) -> Option<f64> {
        let series = Series {
            role: ESTIMATED.to_owned(),
            index: Some(id),
        };
        let forecasts = self
            .history
            .forecasts(device, &series, time - SLOT, time + SLOT)
            .await
            .inspect_err(|e| tracing::warn!("string estimates: {e}"))
            .ok()?;
        let distance =
            |target: SystemTime| time.duration_since(target).unwrap_or_else(|e| e.duration());
        // By target, then issue: reversed, the first nearest is the latest issue.
        forecasts
            .iter()
            .rev()
            .min_by_key(|f| distance(f.target))
            .map(|f| f.value)
    }

    async fn publish(&mut self, measured: Reading, id: u32, value: f64) {
        let series = self.bus.intern(ESTIMATED, Some(id));
        // Declared once: a refusal, such as another step, stands until a restart.
        if self.declared.insert((measured.device, id)) {
            let policy = Policy::new(RoleKind::Measurement, Some(Unit::Watt), STEP, CADENCE);
            if let Err(e) = self.declarer.declare(measured.device, series, policy).await {
                tracing::warn!(string = id, "estimate not stored: {e}");
            }
        }
        self.bus.publish(Reading {
            device: measured.device,
            series,
            value,
            unit: Some(Unit::Watt),
            time: measured.time,
        });
    }
}

#[cfg(test)]
mod tests;
