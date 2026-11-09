//! Endpoint tasks (ADR 6): one task per endpoint serialises every read for every device behind it,
//! decodes through the device's profile and publishes typed readings on the bus.

use std::sync::Arc;
use std::time::{Duration, SystemTime};

use sunreye_profile::{Block, Framing, Profile, Registers, Unit};
use tokio::task::JoinHandle;
use tokio::time::Instant;

use crate::bus::{Bus, DeviceId, Reading, SeriesId};
use crate::transport::{Client, Endpoint, Error};

/// Until a profile declares poll groups, every quantity is polled at this cadence.
const CADENCE: Duration = Duration::from_secs(5);
const TIMEOUT: Duration = Duration::from_secs(3);
/// Modbus caps a read at 125 registers.
const MAX_READ: usize = 125;

/// A device behind an endpoint.
#[derive(Debug, Clone)]
pub struct Device {
    pub id: DeviceId,
    /// Its Modbus unit id (ADR 6).
    pub unit: u8,
    pub profile: Arc<Profile>,
}

/// A running endpoint task; dropping it stops the task.
#[derive(Debug)]
pub struct Task {
    handle: JoinHandle<()>,
}

impl Drop for Task {
    fn drop(&mut self) {
        self.handle.abort();
    }
}

/// Starts polling `devices` through `endpoint`: the first cycle at once, then one per cadence.
#[must_use]
pub fn spawn(endpoint: Endpoint, devices: Vec<Device>, bus: Bus) -> Task {
    let devices = devices.into_iter().map(|d| Polled::new(d, &bus)).collect();
    Task {
        handle: tokio::spawn(run(endpoint, devices, bus)),
    }
}

/// A device and its buffers, reused every cycle so a poll allocates nothing.
struct Polled {
    device: Device,
    plan: Vec<Block>,
    series: Vec<(SeriesId, Option<Unit>)>,
    registers: Registers,
    values: Vec<Option<f64>>,
}

impl Polled {
    fn new(device: Device, bus: &Bus) -> Self {
        let quantities = device.profile.quantities();
        // Both transports so far frame as Modbus TCP.
        let plan = device.profile.read_plan(Framing::Tcp.gap_tolerance());
        let series = quantities
            .iter()
            .map(|q| (bus.intern(&q.role, q.index), q.unit()))
            .collect();
        let values = vec![None; quantities.len()];
        Self {
            device,
            plan,
            series,
            registers: Registers::default(),
            values,
        }
    }

    async fn read(&mut self, client: &mut Client, words: &mut [u16]) -> Result<(), Error> {
        self.registers.clear();
        for block in &self.plan {
            let words = words
                .get_mut(..usize::from(block.count))
                .ok_or(Error::Protocol("count out of range"))?;
            client
                .read_holding(self.device.unit, block.start, words)
                .await?;
            self.registers.answer(block.start, words);
        }
        self.device
            .profile
            .decode(&self.registers, &mut self.values);
        Ok(())
    }

    fn publish(&self, bus: &Bus, time: SystemTime) {
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

async fn run(endpoint: Endpoint, mut devices: Vec<Polled>, bus: Bus) {
    let mut client = None;
    let mut words = [0; MAX_READ];
    let mut next = Instant::now();
    loop {
        tokio::time::sleep_until(next).await;
        if cycle(&endpoint, &mut client, &mut devices, &bus, &mut words)
            .await
            .is_err()
        {
            // The wire may hold half a reply.
            client = None;
        }
        next += CADENCE;
    }
}

async fn cycle(
    endpoint: &Endpoint,
    client: &mut Option<Client>,
    devices: &mut [Polled],
    bus: &Bus,
    words: &mut [u16],
) -> Result<(), Error> {
    let client = match client {
        Some(client) => client,
        None => client.insert(Client::connect(endpoint, TIMEOUT).await?),
    };
    for device in devices {
        device.read(client, words).await?;
        device.publish(bus, SystemTime::now());
    }
    Ok(())
}

#[cfg(test)]
mod tests;
