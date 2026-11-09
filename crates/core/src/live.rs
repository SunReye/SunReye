//! Live values (ADR 9): the latest value of every series, from memory, and one coalesced delta
//! per second with a change.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use serde::Serialize;
use tokio::sync::broadcast;
use tokio::task::JoinHandle;
use tokio::time::{Instant, MissedTickBehavior};
use utoipa::ToSchema;

use crate::bus::{Bus, DeviceId, Reading, Series, SeriesId};

const TICK: Duration = Duration::from_secs(1);
/// Deltas a client may fall behind by before its stream ends; it reconnects to a snapshot.
const BACKLOG: usize = 16;

/// Values by device id, then by series name, such as `pv.mppt.power[2]`.
#[derive(Serialize, ToSchema)]
pub struct Frame {
    devices: BTreeMap<String, BTreeMap<String, f64>>,
}

type Values = BTreeMap<(u32, SeriesId), f64>;
/// Each value with when it was read and its gap threshold.
type Seen = BTreeMap<(u32, SeriesId), (f64, Instant, Duration)>;

/// A handle to the live task; clones share it, and the last one dropped stops it.
#[derive(Debug, Clone)]
pub struct Live(Arc<Inner>);

#[derive(Debug)]
struct Inner {
    bus: Bus,
    shared: Arc<Mutex<Shared>>,
    task: JoinHandle<()>,
}

impl Drop for Inner {
    fn drop(&mut self) {
        self.task.abort();
    }
}

/// Held under one lock so a client's snapshot and its first delta neither overlap nor miss.
#[derive(Debug)]
struct Shared {
    values: Seen,
    deltas: broadcast::Sender<Arc<str>>,
}

impl Live {
    /// Starts collecting the bus's readings. Must be called inside a Tokio runtime.
    #[must_use]
    pub fn spawn(bus: &Bus) -> Self {
        let shared = Arc::new(Mutex::new(Shared {
            values: Seen::new(),
            deltas: broadcast::channel(BACKLOG).0,
        }));
        let task = tokio::spawn(run(bus.clone(), Arc::clone(&shared)));
        Self(Arc::new(Inner {
            bus: bus.clone(),
            shared,
            task,
        }))
    }

    /// The snapshot as JSON, and every later delta, each serialised once for all clients.
    #[must_use]
    pub fn subscribe(&self) -> (String, broadcast::Receiver<Arc<str>>) {
        let shared = self.0.shared.lock().unwrap_or_else(PoisonError::into_inner);
        let values = shared.values.iter().map(|(&k, &(v, ..))| (k, v)).collect();
        let snapshot = serialise(&self.0.bus, &values);
        let deltas = shared.deltas.subscribe();
        drop(shared);
        (snapshot, deltas)
    }

    /// The latest value of `series` from `device`, as of the last tick; `None` once stale.
    #[must_use]
    pub fn value(&self, device: DeviceId, series: &Series) -> Option<f64> {
        let shared = self.0.shared.lock().unwrap_or_else(PoisonError::into_inner);
        shared
            .values
            .iter()
            .find(|&(&(d, id), _)| d == device.0 && self.0.bus.series(id).as_ref() == Some(series))
            .and_then(|(_, &(value, seen, gap))| (seen.elapsed() <= gap).then_some(value))
    }
}

async fn run(bus: Bus, shared: Arc<Mutex<Shared>>) {
    let mut readings = bus.subscribe();
    let mut tick = tokio::time::interval(TICK);
    tick.set_missed_tick_behavior(MissedTickBehavior::Delay);
    let mut pending = Seen::new();
    loop {
        tokio::select! {
            // Readings first, so a tick sees every reading that arrived before it.
            biased;
            reading = readings.recv() => match reading {
                Ok(reading) => {
                    let Reading { device: DeviceId(device), series, value, .. } = reading;
                    let entry = (value, Instant::now(), reading.gap_threshold());
                    pending.insert((device, series), entry);
                }
                // Live values only need the latest; the next reading catches up.
                Err(broadcast::error::RecvError::Lagged(_)) => {}
                Err(broadcast::error::RecvError::Closed) => return,
            },
            _ = tick.tick() => publish(&bus, &shared, &mut pending),
        }
    }
}

/// Folds `pending` into the values and sends the series whose value changed.
fn publish(bus: &Bus, shared: &Mutex<Shared>, pending: &mut Seen) {
    if pending.is_empty() {
        return;
    }
    let mut shared = shared.lock().unwrap_or_else(PoisonError::into_inner);
    let mut delta = Values::new();
    for (key, entry @ (value, ..)) in std::mem::take(pending) {
        let old = shared.values.insert(key, entry);
        if old.is_none_or(|(old, ..)| old.to_bits() != value.to_bits()) {
            delta.insert(key, value);
        }
    }
    if !delta.is_empty() {
        // No client is not an error.
        shared.deltas.send(serialise(bus, &delta).into()).ok();
    }
    drop(shared);
}

fn serialise(bus: &Bus, values: &Values) -> String {
    let mut frame = Frame {
        devices: BTreeMap::new(),
    };
    for (&(device, series), &value) in values {
        if let Some(series) = bus.series(series) {
            frame
                .devices
                .entry(device.to_string())
                .or_default()
                .insert(series.to_string(), value);
        }
    }
    serde_json::to_string(&frame).unwrap_or_default()
}
