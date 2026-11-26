//! Devices behind a broker (ADR 10): one task per broker connection decodes each message through
//! its device's profile and publishes typed readings on the bus.
//!
//! A broker sends a retained topic only when it changes, so the task republishes every value it
//! holds once per cadence while the broker is connected: a silent broker reads as held, a lost one
//! as a gap (ADR 3).

use std::time::SystemTime;

use std::time::Duration;

use sunreye_profile::{ADDRESS, Unit};
use tokio::sync::broadcast::error::RecvError;
use tokio::sync::watch;
use tokio::task::JoinHandle;

use crate::bus::{Bus, DeviceId, Reading, SeriesId};
use crate::endpoint::{CADENCE, Device};
use crate::mqtt::{self, Broker, Message};

/// A running broker client and its reader; dropping it stops both.
#[derive(Debug)]
pub struct Subscriber {
    client: mqtt::Client,
    handle: JoinHandle<()>,
    root: String,
    /// Each device's id, address and held values.
    held: Vec<(DeviceId, u8, Held)>,
}

/// The value of each quantity of a device, by position, as its messages left them.
type Held = watch::Receiver<Vec<Option<f64>>>;

impl Subscriber {
    #[must_use]
    pub fn status(&self) -> mqtt::Status {
        self.client.status()
    }

    /// The broker client, which the publisher shares.
    #[must_use]
    pub const fn client(&self) -> &mqtt::Client {
        &self.client
    }

    /// What writes device `id`'s settings; `None` when it is not read here.
    #[must_use]
    pub fn writer(&self, id: DeviceId) -> Option<Writer> {
        let (_, address, values) = self.held.iter().find(|(d, ..)| *d == id)?;
        Some(Writer {
            publisher: self.client.publisher(),
            root: self.root.clone(),
            address: address.to_string(),
            values: values.clone(),
        })
    }
}

/// Publishes to a device's topics and reads the values its broker's messages left (ADR 10).
#[derive(Debug)]
pub struct Writer {
    publisher: mqtt::Publisher,
    root: String,
    address: String,
    values: Held,
}

impl Writer {
    /// The value quantity `position` holds now.
    #[must_use]
    pub fn held(&self, position: usize) -> Option<f64> {
        self.values.borrow().get(position).copied().flatten()
    }

    /// Publishes `payload` to `topic` under the root, at the device's address.
    ///
    /// # Errors
    /// Nothing was sent.
    pub fn publish(&self, topic: &str, payload: &str) -> Result<(), mqtt::Unsent> {
        let topic = topic.replace(ADDRESS, &self.address);
        self.publisher
            .publish(&format!("{}/{topic}", self.root), payload)
    }

    /// The value quantity `position` holds once `holds` holds for it, or after `wait`.
    pub async fn until(
        &mut self,
        position: usize,
        holds: impl Fn(f64) -> bool + Send + Sync,
        wait: Duration,
    ) -> Option<f64> {
        let value = |values: &Vec<Option<f64>>| values.get(position).copied().flatten();
        let held = self
            .values
            .wait_for(|values| value(values).is_some_and(&holds));
        // A timeout leaves the value as it is held now.
        tokio::time::timeout(wait, held).await.ok();
        self.held(position)
    }
}

impl Drop for Subscriber {
    fn drop(&mut self) {
        self.handle.abort();
    }
}

/// Starts reading `devices` through `broker`, each at its unit as the device address, under topic
/// `root`; the client also subscribes to `also`, such as the publisher's. Must be called inside a
/// Tokio runtime.
#[must_use]
pub fn spawn(
    broker: Broker,
    root: &str,
    devices: Vec<Device>,
    also: Vec<String>,
    bus: Bus,
) -> Subscriber {
    let read: Vec<Read> = devices.into_iter().map(|d| Read::new(d, &bus)).collect();
    let topics = topics(&read, root);
    let mut filters: Vec<String> = topics.iter().map(|(topic, ..)| topic.clone()).collect();
    filters.extend(also);
    let held = read
        .iter()
        .map(|r| (r.device.id, r.device.unit, r.values.subscribe()))
        .collect();
    let client = mqtt::spawn(broker, filters);
    let messages = client.messages();
    let status = client.watch();
    let handle = tokio::spawn(async move {
        let mut messages = messages;
        let mut tick = tokio::time::interval(CADENCE);
        loop {
            tokio::select! {
                message = messages.recv() => match message {
                    Ok(Message { topic, payload }) => {
                        for (_, at, position) in topics.iter().filter(|(t, ..)| *t == topic) {
                            if let Some(r) = read.get(*at) {
                                r.receive(*position, &payload, &bus);
                            }
                        }
                    }
                    // The retained state comes again on the next connect.
                    Err(RecvError::Lagged(_)) => {}
                    Err(RecvError::Closed) => return,
                },
                _ = tick.tick() => {
                    if status.borrow().connected {
                        for r in &read {
                            r.publish(&bus);
                        }
                    }
                }
            }
        }
    });
    Subscriber {
        client,
        handle,
        root: root.to_owned(),
        held,
    }
}

/// Each topic under `root` with the device it is read for and its quantity's position.
fn topics(read: &[Read], root: &str) -> Vec<(String, usize, usize)> {
    read.iter()
        .enumerate()
        .flat_map(|(at, r)| {
            r.device
                .profile
                .topics(u32::from(r.device.unit))
                .into_iter()
                .map(move |(position, topic)| (format!("{root}/{topic}"), at, position))
        })
        .collect()
}

/// A device and the values its messages left.
struct Read {
    device: Device,
    series: Vec<(SeriesId, Option<Unit>)>,
    values: watch::Sender<Vec<Option<f64>>>,
}

impl Read {
    fn new(device: Device, bus: &Bus) -> Self {
        let quantities = device.profile.quantities();
        let series = quantities
            .iter()
            .map(|q| (bus.intern(&q.role, q.index), q.unit()))
            .collect();
        let (values, _) = watch::channel(vec![None; quantities.len()]);
        Self {
            device,
            series,
            values,
        }
    }

    fn receive(&self, position: usize, payload: &[u8], bus: &Bus) {
        self.values
            .send_modify(|values| self.device.profile.receive(position, payload, values));
        self.publish(bus);
    }

    fn publish(&self, bus: &Bus) {
        let time = SystemTime::now();
        for (value, (series, unit)) in self.values.borrow().iter().zip(&self.series) {
            if let Some(value) = *value {
                bus.publish(Reading {
                    device: self.device.id,
                    series: *series,
                    value,
                    unit: *unit,
                    time,
                    cadence: CADENCE,
                });
            }
        }
    }
}

#[cfg(test)]
mod tests;
