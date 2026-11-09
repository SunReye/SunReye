//! Endpoint tasks (ADR 6): one task per endpoint serialises every read for every device behind it,
//! decodes through the device's profile and publishes typed readings on the bus.

use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, SystemTime};

use sunreye_profile::{Block, Framing, Profile, Registers, Unit};
use tokio::task::JoinHandle;
use tokio::time::Instant;

use crate::bus::{Bus, DeviceId, Reading, SeriesId};
use crate::transport::{Client, Endpoint, Error};

/// Until a profile declares poll groups, every quantity is polled at this cadence.
pub const CADENCE: Duration = Duration::from_secs(5);
const TIMEOUT: Duration = Duration::from_secs(3);
/// One missed cycle then costs 10 s of silence, under ADR 3's 15 s gap threshold.
const FIRST_BACKOFF: Duration = CADENCE;
const MAX_BACKOFF: Duration = Duration::from_secs(60);
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

/// The last good value of every quantity, with the instant it was read; `None` until read.
type Latest = Arc<Mutex<Vec<Option<(Reading, Instant)>>>>;

/// A running endpoint task; dropping it stops the task.
#[derive(Debug)]
pub struct Task {
    handle: JoinHandle<()>,
    latest: Latest,
}

impl Task {
    /// The last good value of every quantity read so far, with its age.
    #[must_use]
    pub fn latest(&self) -> Vec<(Reading, Duration)> {
        let now = Instant::now();
        let latest = self.latest.lock().unwrap_or_else(PoisonError::into_inner);
        latest
            .iter()
            .flatten()
            .map(|(reading, read)| (*reading, now - *read))
            .collect()
    }
}

impl Drop for Task {
    fn drop(&mut self) {
        self.handle.abort();
    }
}

/// Starts polling `devices` through `endpoint`: the first cycle at once, then one per cadence.
#[must_use]
pub fn spawn(endpoint: Endpoint, devices: Vec<Device>, bus: Bus) -> Task {
    let mut slots = 0;
    let devices: Vec<Polled> = devices
        .into_iter()
        .map(|d| {
            let polled = Polled::new(d, &bus, slots);
            slots += polled.values.len();
            polled
        })
        .collect();
    let latest = Latest::new(Mutex::new(vec![None; slots]));
    let out = Out {
        bus,
        latest: Arc::clone(&latest),
    };
    Task {
        handle: tokio::spawn(run(endpoint, devices, out)),
        latest,
    }
}

/// Where a cycle's readings go.
struct Out {
    bus: Bus,
    latest: Latest,
}

/// The wait before the next attempt after `failures` failed cycles in a row, at least one.
fn backoff(failures: u32) -> Duration {
    let doublings = failures.saturating_sub(1).min(16);
    FIRST_BACKOFF
        .saturating_mul(1 << doublings)
        .min(MAX_BACKOFF)
}

/// A device and its buffers, reused every cycle so a poll allocates nothing.
struct Polled {
    device: Device,
    plan: Vec<Block>,
    series: Vec<(SeriesId, Option<Unit>)>,
    /// Its first slot in [`Latest`].
    slot: usize,
    registers: Registers,
    values: Vec<Option<f64>>,
}

impl Polled {
    fn new(device: Device, bus: &Bus, slot: usize) -> Self {
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
            slot,
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

    fn publish(&self, out: &Out) {
        let time = SystemTime::now();
        let read = Instant::now();
        let mut latest = out.latest.lock().unwrap_or_else(PoisonError::into_inner);
        let slots = latest.iter_mut().skip(self.slot);
        for ((value, (series, unit)), slot) in self.values.iter().zip(&self.series).zip(slots) {
            if let Some(value) = *value {
                let reading = Reading {
                    device: self.device.id,
                    series: *series,
                    value,
                    unit: *unit,
                    time,
                };
                *slot = Some((reading, read));
                out.bus.publish(reading);
            }
        }
        drop(latest);
    }
}

async fn run(endpoint: Endpoint, mut devices: Vec<Polled>, out: Out) {
    let mut client = None;
    let mut words = [0; MAX_READ];
    let mut failures: u32 = 0;
    let mut next = Instant::now();
    loop {
        tokio::time::sleep_until(next).await;
        if cycle(&endpoint, &mut client, &mut devices, &out, &mut words)
            .await
            .is_ok()
        {
            failures = 0;
            next += CADENCE;
        } else {
            // The wire may hold half a reply.
            client = None;
            failures = failures.saturating_add(1);
            next = Instant::now() + backoff(failures);
        }
    }
}

async fn cycle(
    endpoint: &Endpoint,
    client: &mut Option<Client>,
    devices: &mut [Polled],
    out: &Out,
    words: &mut [u16],
) -> Result<(), Error> {
    let client = match client {
        Some(client) => client,
        None => client.insert(Client::connect(endpoint, TIMEOUT).await?),
    };
    for device in devices {
        device.read(client, words).await?;
        device.publish(out);
    }
    Ok(())
}

#[cfg(test)]
mod tests;
