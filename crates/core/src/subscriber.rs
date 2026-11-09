//! Devices behind a broker (ADR 10): one task per broker connection decodes each message through
//! its device's profile and publishes typed readings on the bus.
//!
//! A broker sends a retained topic only when it changes, so the task republishes every value it
//! holds once per cadence while the broker is connected: a silent broker reads as held, a lost one
//! as a gap (ADR 3).

use std::time::SystemTime;

use sunreye_profile::Unit;
use tokio::sync::broadcast::error::RecvError;
use tokio::task::JoinHandle;

use crate::bus::{Bus, Reading, SeriesId};
use crate::endpoint::{CADENCE, Device};
use crate::mqtt::{self, Broker, Message};

/// A running broker client and its reader; dropping it stops both.
#[derive(Debug)]
pub struct Subscriber {
    client: mqtt::Client,
    handle: JoinHandle<()>,
}

impl Subscriber {
    #[must_use]
    pub fn status(&self) -> mqtt::Status {
        self.client.status()
    }
}

impl Drop for Subscriber {
    fn drop(&mut self) {
        self.handle.abort();
    }
}

/// Starts reading `devices` through `broker`, each at its unit as the device address, under topic
/// `root`. Must be called inside a Tokio runtime.
#[must_use]
pub fn spawn(broker: Broker, root: &str, devices: Vec<Device>, bus: Bus) -> Subscriber {
    let read: Vec<Read> = devices.into_iter().map(|d| Read::new(d, &bus)).collect();
    let topics: Vec<(String, usize, usize)> = read
        .iter()
        .enumerate()
        .flat_map(|(at, r)| {
            r.device
                .profile
                .topics(u32::from(r.device.unit))
                .into_iter()
                .map(move |(position, topic)| (format!("{root}/{topic}"), at, position))
        })
        .collect();
    let filters = topics.iter().map(|(topic, ..)| topic.clone()).collect();
    let client = mqtt::spawn(broker, filters);
    let messages = client.messages();
    let status = client.watch();
    let handle = tokio::spawn(async move {
        let mut read = read;
        let mut messages = messages;
        let mut tick = tokio::time::interval(CADENCE);
        loop {
            tokio::select! {
                message = messages.recv() => match message {
                    Ok(Message { topic, payload }) => {
                        for (_, at, position) in topics.iter().filter(|(t, ..)| *t == topic) {
                            if let Some(r) = read.get_mut(*at) {
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
    Subscriber { client, handle }
}

/// A device and the values its messages left.
struct Read {
    device: Device,
    series: Vec<(SeriesId, Option<Unit>)>,
    values: Vec<Option<f64>>,
}

impl Read {
    fn new(device: Device, bus: &Bus) -> Self {
        let quantities = device.profile.quantities();
        let series = quantities
            .iter()
            .map(|q| (bus.intern(&q.role, q.index), q.unit()))
            .collect();
        let values = vec![None; quantities.len()];
        Self {
            device,
            series,
            values,
        }
    }

    fn receive(&mut self, position: usize, payload: &[u8], bus: &Bus) {
        self.device
            .profile
            .receive(position, payload, &mut self.values);
        self.publish(bus);
    }

    fn publish(&self, bus: &Bus) {
        let time = SystemTime::now();
        for (value, (series, unit)) in self.values.iter().zip(&self.series) {
            if let Some(value) = *value {
                bus.publish(Reading {
                    device: self.device.id,
                    series: *series,
                    value,
                    unit: *unit,
                    time,
                });
            }
        }
    }
}

#[cfg(test)]
mod tests;
