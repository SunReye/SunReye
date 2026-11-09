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

/// Values by device id, then by series name, such as `pv.mppt.power[2]`. A value in a delta is
/// fresh; one in `stale` is past its gap threshold (ADR 3) and keeps its last value.
#[derive(Serialize, ToSchema)]
pub struct Frame {
    devices: BTreeMap<String, BTreeMap<String, f64>>,
    /// The age in whole seconds of each stale value, by device id, then by series name.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    stale: BTreeMap<String, BTreeMap<String, u64>>,
}

type Key = (u32, SeriesId);

/// A series' latest value.
#[derive(Debug, Clone, Copy)]
struct Latest {
    value: f64,
    read: Instant,
    gap: Duration,
    stale: bool,
}

impl Latest {
    fn age(&self) -> u64 {
        self.read.elapsed().as_secs()
    }

    fn expired(&self) -> bool {
        self.read.elapsed() > self.gap
    }
}

/// What one frame carries: fresh values and stale values' ages.
#[derive(Default)]
struct Changes {
    fresh: BTreeMap<Key, f64>,
    stale: BTreeMap<Key, u64>,
}

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
    values: BTreeMap<Key, Latest>,
    deltas: broadcast::Sender<Arc<str>>,
}

impl Live {
    /// Starts collecting the bus's readings. Must be called inside a Tokio runtime.
    #[must_use]
    pub fn spawn(bus: &Bus) -> Self {
        let shared = Arc::new(Mutex::new(Shared {
            values: BTreeMap::new(),
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
        let snapshot = Changes {
            fresh: shared.values.iter().map(|(&k, v)| (k, v.value)).collect(),
            stale: shared
                .values
                .iter()
                .filter(|(_, v)| v.stale || v.expired())
                .map(|(&k, v)| (k, v.age()))
                .collect(),
        };
        let snapshot = serialise(&self.0.bus, &snapshot);
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
            .and_then(|(_, v)| (!v.expired()).then_some(v.value))
    }
}

async fn run(bus: Bus, shared: Arc<Mutex<Shared>>) {
    let mut readings = bus.subscribe();
    let mut tick = tokio::time::interval(TICK);
    tick.set_missed_tick_behavior(MissedTickBehavior::Delay);
    let mut pending = BTreeMap::new();
    loop {
        tokio::select! {
            // Readings first, so a tick sees every reading that arrived before it.
            biased;
            reading = readings.recv() => match reading {
                Ok(reading) => {
                    let Reading { device: DeviceId(device), series, value, .. } = reading;
                    let gap = reading.gap_threshold();
                    let read = Instant::now();
                    pending.insert((device, series), Latest { value, read, gap, stale: false });
                }
                // Live values only need the latest; the next reading catches up.
                Err(broadcast::error::RecvError::Lagged(_)) => {}
                Err(broadcast::error::RecvError::Closed) => return,
            },
            _ = tick.tick() => publish(&bus, &shared, &mut pending),
        }
    }
}

/// Folds `pending` into the values and sends the series whose value changed or that were read
/// again after going stale, and the series that went stale.
fn publish(bus: &Bus, shared: &Mutex<Shared>, pending: &mut BTreeMap<Key, Latest>) {
    let mut shared = shared.lock().unwrap_or_else(PoisonError::into_inner);
    let mut changes = Changes::default();
    for (key, value) in std::mem::take(pending) {
        let old = shared.values.insert(key, value);
        if old.is_none_or(|old| old.stale || old.value.to_bits() != value.value.to_bits()) {
            changes.fresh.insert(key, value.value);
        }
    }
    for (&key, value) in &mut shared.values {
        if !value.stale && value.expired() {
            value.stale = true;
            changes.stale.insert(key, value.age());
        }
    }
    if !(changes.fresh.is_empty() && changes.stale.is_empty()) {
        // No client is not an error.
        shared.deltas.send(serialise(bus, &changes).into()).ok();
    }
    drop(shared);
}

fn serialise(bus: &Bus, changes: &Changes) -> String {
    let mut frame = Frame {
        devices: BTreeMap::new(),
        stale: BTreeMap::new(),
    };
    for (&(device, series), &value) in &changes.fresh {
        if let Some(series) = bus.series(series) {
            frame
                .devices
                .entry(device.to_string())
                .or_default()
                .insert(series.to_string(), value);
        }
    }
    for (&(device, series), &age) in &changes.stale {
        if let Some(series) = bus.series(series) {
            frame
                .stale
                .entry(device.to_string())
                .or_default()
                .insert(series.to_string(), age);
        }
    }
    serde_json::to_string(&frame).unwrap_or_default()
}
