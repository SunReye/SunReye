//! The MQTT publisher (ADR 10): the `plant` device's role values and each device's availability
//! under a broker connection's topic root, with optional Home Assistant discovery.
//!
//! It publishes only what a `read` token reads, live values, and offers no command topic.

use std::collections::{BTreeMap, HashMap};
use std::time::{Duration, SystemTime};

use serde_json::{Map, Value, json};
use tokio::sync::{broadcast, watch};
use tokio::task::JoinHandle;
use tokio::time::MissedTickBehavior;

use crate::bus::{Bus, DeviceId, Reading, SeriesId};
use crate::endpoint::CADENCE;
use crate::mqtt;
use crate::plant;

/// Home Assistant's birth topic: discovery is sent again when it reads `online`.
pub const BIRTH: &str = "homeassistant/status";
/// Values coalesce for a second, as live values do (ADR 9).
const TICK: Duration = Duration::from_secs(1);
/// Home Assistant's discovery prefix, its default.
const PREFIX: &str = "homeassistant";
/// The plant's roles Home Assistant is told of, as (role, name, device class, unit): each power
/// role and the battery's state.
const DISCOVERED: &[(&str, &str, &str, &str)] = &[
    ("grid.power", "Grid power", "power", "W"),
    ("pv.power", "PV power", "power", "W"),
    ("generator.power", "Generator power", "power", "W"),
    ("battery.power", "Battery power", "power", "W"),
    ("load.power", "Load power", "power", "W"),
    ("backup.power", "Backup power", "power", "W"),
    ("ev.charge.power", "EV charge power", "power", "W"),
    ("battery.soc", "Battery state of charge", "battery", "%"),
    (
        "battery.capacity",
        "Battery capacity",
        "energy_storage",
        "kWh",
    ),
];
/// A device silent past the gap threshold (ADR 3) is offline.
const STALE: Duration = Duration::from_secs(15);

/// What a broker connection publishes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Publishing {
    /// The connection's topic root.
    pub root: String,
    /// Whether Home Assistant discovery is sent.
    pub discovery: bool,
}

/// A running publisher; dropping it stops it.
#[derive(Debug)]
pub struct Publisher(JoinHandle<()>);

impl Drop for Publisher {
    fn drop(&mut self) {
        self.0.abort();
    }
}

/// Starts publishing through `client`, for the configured devices `devices` as (id, name). Must
/// be called inside a Tokio runtime.
#[must_use]
pub fn spawn(
    client: &mqtt::Client,
    publishing: Publishing,
    devices: watch::Receiver<Vec<(DeviceId, String)>>,
    bus: &Bus,
) -> Publisher {
    let messages = client.messages();
    let task = Task {
        publisher: client.publisher(),
        status: client.watch(),
        publishing,
        bus: bus.clone(),
        devices,
        pending: BTreeMap::new(),
        last: HashMap::new(),
        sent: HashMap::new(),
    };
    Publisher(tokio::spawn(task.run(bus.subscribe(), messages)))
}

struct Task {
    publisher: mqtt::Publisher,
    status: watch::Receiver<mqtt::Status>,
    publishing: Publishing,
    bus: Bus,
    devices: watch::Receiver<Vec<(DeviceId, String)>>,
    /// The plant's values since the last tick.
    pending: BTreeMap<SeriesId, f64>,
    /// Each device's latest reading time.
    last: HashMap<DeviceId, SystemTime>,
    /// Each device's availability as last sent, and when.
    sent: HashMap<DeviceId, (bool, tokio::time::Instant)>,
}

impl Task {
    async fn run(
        mut self,
        mut readings: broadcast::Receiver<Reading>,
        mut messages: broadcast::Receiver<mqtt::Message>,
    ) {
        let mut tick = tokio::time::interval(TICK);
        tick.set_missed_tick_behavior(MissedTickBehavior::Delay);
        // Discovery is due on every connect: the first may have happened already.
        self.status.mark_changed();
        let mut status = self.status.clone();
        let mut devices = self.devices.clone();
        loop {
            tokio::select! {
                biased;
                reading = readings.recv() => match reading {
                    Ok(reading) => self.read(&reading),
                    // Values recur every cadence.
                    Err(broadcast::error::RecvError::Lagged(_)) => {}
                    Err(broadcast::error::RecvError::Closed) => return,
                },
                Ok(()) = status.changed() => {
                    if status.borrow_and_update().connected {
                        self.reconnected();
                    }
                }
                Ok(()) = devices.changed() => {
                    devices.mark_unchanged();
                    self.discover();
                }
                Ok(message) = messages.recv() => {
                    if message.topic == BIRTH && message.payload == b"online" {
                        self.reconnected();
                    }
                }
                _ = tick.tick() => self.publish(),
            }
        }
    }

    /// A broker or Home Assistant that starts afresh is sent discovery, and every availability on
    /// the next tick.
    fn reconnected(&mut self) {
        self.sent.clear();
        self.discover();
    }

    /// Sends Home Assistant discovery, if wanted.
    fn discover(&self) {
        if !self.publishing.discovery {
            return;
        }
        let devices = self.devices.borrow().clone();
        let (topic, payload) = discovery(&self.publishing.root, &devices);
        self.publisher.publish(&topic, &payload.to_string()).ok();
    }

    fn read(&mut self, reading: &Reading) {
        if reading.device == plant::DEVICE {
            self.pending.insert(reading.series, reading.value);
        }
        let last = self.last.entry(reading.device).or_insert(reading.time);
        *last = (*last).max(reading.time);
    }

    /// Sends the plant's values since the last tick; one not sent recurs within a cadence.
    fn publish(&mut self) {
        for (series, value) in std::mem::take(&mut self.pending) {
            let Some(series) = self.bus.series(series) else {
                continue;
            };
            let topic = format!("{}/plant/{series}", self.publishing.root);
            let value = home_assistant(&series.role, value);
            self.publisher.publish(&topic, &value.to_string()).ok();
        }
        self.availability();
    }

    /// Sends each device's availability when it changes, and once a cadence.
    fn availability(&mut self) {
        let (now, at) = (SystemTime::now(), tokio::time::Instant::now());
        let devices: Vec<DeviceId> = self.devices.borrow().iter().map(|(id, _)| *id).collect();
        for id in devices {
            let online = self
                .last
                .get(&id)
                .is_some_and(|&time| now.duration_since(time).unwrap_or_default() <= STALE);
            let due = self
                .sent
                .get(&id)
                .is_none_or(|&(was, sent)| was != online || at.duration_since(sent) >= CADENCE);
            if !due {
                continue;
            }
            let topic = format!("{}/devices/{}/availability", self.publishing.root, id.0);
            let payload = if online { "online" } else { "offline" };
            if self.publisher.publish(&topic, payload).is_ok() {
                self.sent.insert(id, (online, at));
            }
        }
    }
}

/// Home Assistant's device discovery message for a publisher under `root`: one device, the
/// plant, with a sensor per discovered role and a connectivity sensor per device. Each expires
/// past the gap threshold, so a core that stops reads as unavailable.
fn discovery(root: &str, devices: &[(DeviceId, String)]) -> (String, Value) {
    let object: String = root
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let object = format!("sunreye_{object}");
    let expire = STALE.as_secs();
    let mut components = Map::new();
    for (role, name, class, unit) in DISCOVERED {
        let key = role.replace('.', "_");
        let component = json!({ "platform": "sensor", "unique_id": format!("{object}_{key}"),
            "name": name, "state_topic": format!("{root}/plant/{role}"), "device_class": class,
            "state_class": "measurement", "unit_of_measurement": unit, "expire_after": expire });
        components.insert(key, component);
    }
    for (DeviceId(id), name) in devices {
        let key = format!("device_{id}");
        let component = json!({ "platform": "binary_sensor",
            "unique_id": format!("{object}_{key}"), "name": name,
            "state_topic": format!("{root}/devices/{id}/availability"),
            "device_class": "connectivity", "payload_on": "online", "payload_off": "offline",
            "expire_after": expire });
        components.insert(key, component);
    }
    let payload = json!({
        "device": { "identifiers": [object], "name": "SunReye plant", "manufacturer": "SunReye" },
        "origin": { "name": "SunReye" },
        "components": components,
    });
    (format!("{PREFIX}/device/{object}/config"), payload)
}

/// Converts at this edge (ADR 4, 10): Home Assistant's energy dashboard reads a battery as
/// positive when discharging, ours is positive when charging. Grid import is positive in both.
fn home_assistant(role: &str, value: f64) -> f64 {
    let value = if matches!(role, "battery.power" | "battery.current") {
        -value
    } else {
        value
    };
    // No `-0`.
    value + 0.0
}

#[cfg(test)]
mod tests;
