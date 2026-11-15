//! Endpoint tasks (ADR 6): one task per endpoint serialises every read for every device behind it,
//! decodes through the device's profile and publishes typed readings on the bus.
//!
//! At each connect it discovers the SunSpec chain of every device whose profile reads one (ADR 5).
//!
//! A settings write or read (ADR 7) runs in the same task, between polls.

use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use sunreye_profile::{Block, Framing, Profile, Registers, Setting, Unit};
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;
use tokio::time::Instant;

use crate::bus::{Bus, DeviceId, Reading, SeriesId};
use crate::settings::{self, Applied, Job, Refusal};
use crate::sunspec;
use crate::transport::{Client, Endpoint, Error};

/// The default poll cycle (ADR 6): a connection's until its `pollSeconds` says otherwise.
pub const CADENCE: Duration = sunreye_profile::CADENCE;
pub const TIMEOUT: Duration = Duration::from_secs(3);
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
    orders: mpsc::Sender<Order>,
}

/// A settings write or read waiting for the task, and where its result goes.
enum Order {
    Write(Job, oneshot::Sender<Result<Applied, Refusal>>),
    /// A setting of the device at a unit id.
    Read(u8, Setting, oneshot::Sender<Option<f64>>),
}

impl Task {
    /// The last good value of every quantity read so far, with its age.
    #[must_use]
    pub fn latest(&self) -> Vec<(Reading, Duration)> {
        let now = Instant::now();
        let latest = crate::lock(&self.latest);
        latest
            .iter()
            .flatten()
            .map(|(reading, read)| (*reading, now - *read))
            .collect()
    }

    /// Runs `job` after the poll cycle in progress; `None` when the task has stopped.
    pub async fn write(&self, job: Job) -> Option<Result<Applied, Refusal>> {
        let (reply, applied) = oneshot::channel();
        self.orders.send(Order::Write(job, reply)).await.ok()?;
        applied.await.ok()
    }

    /// Reads `setting` of unit `unit` after the poll cycle in progress; `None` when it cannot be
    /// read or the task has stopped.
    pub async fn read(&self, unit: u8, setting: Setting) -> Option<f64> {
        let (reply, value) = oneshot::channel();
        self.orders
            .send(Order::Read(unit, setting, reply))
            .await
            .ok()?;
        value.await.ok()?
    }
}

impl Drop for Task {
    fn drop(&mut self) {
        self.handle.abort();
    }
}

/// Starts polling `devices` through `endpoint`: the first cycle at once, then one per `cycle`, or
/// as the last ends when its reads overran.
#[must_use]
pub fn spawn(endpoint: Endpoint, cycle: Duration, devices: Vec<Device>, bus: Bus) -> Task {
    let mut slots = 0;
    let framing = endpoint.framing();
    let devices: Vec<Polled> = devices
        .into_iter()
        .map(|d| {
            let polled = Polled::new(d, framing, &bus, slots, cycle);
            slots += polled.values.len();
            polled
        })
        .collect();
    let latest = Latest::new(Mutex::new(vec![None; slots]));
    let out = Out {
        bus,
        latest: Arc::clone(&latest),
    };
    let (orders, queued) = mpsc::channel(1);
    Task {
        handle: tokio::spawn(run(endpoint, cycle, devices, out, queued)),
        latest,
        orders,
    }
}

/// Where a cycle's readings go.
struct Out {
    bus: Bus,
    latest: Latest,
}

/// The wait before the next attempt after `failures` failed cycles in a row, at least one.
pub(crate) fn backoff(failures: u32) -> Duration {
    let doublings = failures.saturating_sub(1).min(16);
    FIRST_BACKOFF
        .saturating_mul(1 << doublings)
        .min(MAX_BACKOFF)
}

/// A device and its buffers, reused every cycle so a poll allocates nothing.
struct Polled {
    device: Device,
    /// The device's profile, bound to its SunSpec chain once discovered.
    profile: Arc<Profile>,
    gap_tolerance: u16,
    /// Each poll group's plan and the cycles between its polls. A merged block the device refused
    /// stays split for the life of the task.
    groups: Vec<(u32, Vec<Block>)>,
    /// Each quantity's series, unit, and the cycles between its polls.
    series: Vec<(SeriesId, Option<Unit>, u32)>,
    /// The poll cycle of its endpoint.
    period: Duration,
    /// Cycles polled so far.
    cycle: u32,
    /// Its first slot in [`Latest`].
    slot: usize,
    registers: Registers,
    values: Vec<Option<f64>>,
}

impl Polled {
    fn new(device: Device, framing: Framing, bus: &Bus, slot: usize, period: Duration) -> Self {
        let quantities = device.profile.quantities();
        let gap_tolerance = framing.gap_tolerance();
        let groups = groups(&device.profile, gap_tolerance, period);
        let series = quantities
            .iter()
            .map(|q| {
                let every = cycles(q.cadence(), period);
                (bus.intern(&q.role, q.index), q.unit(), every)
            })
            .collect();
        let values = vec![None; quantities.len()];
        Self {
            profile: Arc::clone(&device.profile),
            device,
            gap_tolerance,
            groups,
            series,
            period,
            cycle: 0,
            slot,
            registers: Registers::default(),
            values,
        }
    }

    /// Binds a SunSpec profile to the chain the device holds now, on every connect: a device
    /// without one reads nothing until the next.
    async fn discover(&mut self, client: &mut Client) -> Result<(), Error> {
        if !self.device.profile.reads_sunspec() {
            return Ok(());
        }
        let chain = sunspec::discover(client, self.device.unit).await?;
        if chain.is_none() {
            tracing::warn!(device = self.device.id.0, "no SunSpec map");
        }
        self.profile = Arc::new(chain.map_or_else(
            || (*self.device.profile).clone(),
            |chain| self.device.profile.bind(&chain),
        ));
        self.groups = groups(&self.profile, self.gap_tolerance, self.period);
        Ok(())
    }

    /// Reads the poll groups due this cycle; a quantity of a group not due has no value.
    async fn read(&mut self, client: &mut Client, words: &mut [u16]) -> Result<(), Error> {
        self.registers.clear();
        let cycle = self.cycle;
        for (every, plan) in &mut self.groups {
            if cycle.is_multiple_of(*every) {
                let device = (&self.device, &*self.profile);
                read_plan(client, device, plan, &mut self.registers, words).await?;
            }
        }
        self.profile.decode(&self.registers, &mut self.values);
        for (value, (_, _, every)) in self.values.iter_mut().zip(&self.series) {
            if !cycle.is_multiple_of(*every) {
                *value = None;
            }
        }
        self.cycle = cycle.wrapping_add(1);
        Ok(())
    }

    /// Publishes the cycle's values; `achieved` is the cadence its cycles run at.
    fn publish(&self, out: &Out, achieved: Duration) {
        let time = SystemTime::now();
        let read = Instant::now();
        let mut latest = crate::lock(&out.latest);
        let slots = latest.iter_mut().skip(self.slot);
        for ((value, (series, unit, every)), slot) in
            self.values.iter().zip(&self.series).zip(slots)
        {
            if let Some(value) = *value {
                let reading = Reading {
                    device: self.device.id,
                    series: *series,
                    value,
                    unit: *unit,
                    time,
                    cadence: achieved * *every,
                };
                *slot = Some((reading, read));
                out.bus.publish(reading);
            }
        }
        drop(latest);
    }
}

/// Each poll group of `profile` with the cycles of `period` between its polls, fastest first.
fn groups(profile: &Profile, gap_tolerance: u16, period: Duration) -> Vec<(u32, Vec<Block>)> {
    let groups = profile.poll_groups(gap_tolerance).into_iter();
    groups
        .map(|(cadence, plan)| (cycles(cadence, period), plan))
        .collect()
}

/// The cycles of `period` a group of `cadence` waits between its polls: its seconds rounded up to
/// whole cycles, never below one (ADR 6).
fn cycles(cadence: Duration, period: Duration) -> u32 {
    let cycles = cadence.as_millis().div_ceil(period.as_millis().max(1));
    u32::try_from(cycles).unwrap_or(u32::MAX).max(1)
}

/// The cadence a poll group of `group` runs at on a connection polled every `cycle` (ADR 6).
#[must_use]
pub fn cadence(cycle: Duration, group: Duration) -> Duration {
    cycle.saturating_mul(cycles(group, cycle))
}

/// When an endpoint's cycles start, and the cadence they achieve.
struct Pace {
    cycle: Duration,
    next: Instant,
    /// When the last cycle began; `None` at the start and after a failure.
    last: Option<Instant>,
}

impl Pace {
    const fn new(cycle: Duration, first: Instant) -> Self {
        Self {
            cycle,
            next: first,
            last: None,
        }
    }

    /// When the next cycle is due: one cycle after the last began.
    const fn next(&self) -> Instant {
        self.next
    }

    /// Begins a cycle at `now`, and answers the cadence achieved since the last began: the
    /// configured cycle, or longer when the reads overran it.
    fn begin(&mut self, now: Instant) -> Duration {
        let achieved = self
            .last
            .map_or(self.cycle, |last| (now - last).max(self.cycle));
        self.last = Some(now);
        self.next = now + self.cycle;
        achieved
    }

    /// Tries again at `at` after a failed cycle; a backoff's silence is no cadence.
    const fn retry(&mut self, at: Instant) {
        self.last = None;
        self.next = at;
    }
}

/// Reads `plan` of a device and its profile into `registers`; a merged block the device refuses
/// with exception 2 is split in `plan`.
async fn read_plan(
    client: &mut Client,
    (device, profile): (&Device, &Profile),
    plan: &mut Vec<Block>,
    registers: &mut Registers,
    words: &mut [u16],
) -> Result<(), Error> {
    let mut next = 0;
    while let Some(&block) = plan.get(next) {
        let words = words
            .get_mut(..usize::from(block.count))
            .ok_or(Error::Protocol("count out of range"))?;
        match client.read_holding(device.unit, block.start, words).await {
            Ok(()) => {
                registers.answer(block.start, words);
                next += 1;
            }
            // A merge read unmapped registers the device may not serve.
            Err(Error::Exception(2)) if block.merged => {
                tracing::warn!(
                    device = device.id.0,
                    start = block.start,
                    count = block.count,
                    "refused with exception 2; split"
                );
                plan.splice(next..=next, profile.split(block));
            }
            Err(e) => return Err(e),
        }
    }
    Ok(())
}

/// Reads `device` through `client` as its task would, `cycles` times a cadence apart, and publishes
/// nothing: `sunreye capture` records the wire.
///
/// # Errors
///
/// The first error of a read.
pub async fn poll(
    client: &mut Client,
    framing: Framing,
    device: Device,
    cycles: usize,
) -> Result<(), Error> {
    let mut polled = Polled::new(device, framing, &Bus::default(), 0, CADENCE);
    polled.discover(client).await?;
    let mut words = [0; MAX_READ];
    let mut next = Instant::now();
    for _ in 0..cycles {
        tokio::time::sleep_until(next).await;
        polled.read(client, &mut words).await?;
        next += CADENCE;
    }
    Ok(())
}

async fn run(
    endpoint: Endpoint,
    period: Duration,
    mut devices: Vec<Polled>,
    out: Out,
    mut orders: mpsc::Receiver<Order>,
) {
    let mut client = None;
    let mut words = [0; MAX_READ];
    let mut failures: u32 = 0;
    let mut pace = Pace::new(period, Instant::now());
    loop {
        tokio::select! {
            () = tokio::time::sleep_until(pace.next()) => {}
            Some(order) = orders.recv() => {
                match order {
                    Order::Write(job, reply) => {
                        reply.send(settings::run(&endpoint, &mut client, TIMEOUT, job).await).ok();
                    }
                    Order::Read(unit, setting, reply) => {
                        let read = settings::read(&endpoint, &mut client, TIMEOUT, unit, &setting);
                        reply.send(read.await).ok();
                    }
                }
                continue;
            }
        }
        let achieved = pace.begin(Instant::now());
        let polled = Polling {
            devices: &mut devices,
            out: &out,
            achieved,
        };
        if cycle(&endpoint, &mut client, polled, &mut words)
            .await
            .is_ok()
        {
            failures = 0;
        } else {
            // The wire may hold half a reply.
            client = None;
            failures = failures.saturating_add(1);
            pace.retry(Instant::now() + backoff(failures));
        }
    }
}

/// The devices of a cycle, where their readings go and the cadence they carry.
struct Polling<'a> {
    devices: &'a mut [Polled],
    out: &'a Out,
    achieved: Duration,
}

async fn cycle(
    endpoint: &Endpoint,
    client: &mut Option<Client>,
    polled: Polling<'_>,
    words: &mut [u16],
) -> Result<(), Error> {
    let Polling {
        devices,
        out,
        achieved,
    } = polled;
    if client.is_none() {
        let connected = client.insert(Client::connect(endpoint, TIMEOUT).await?);
        for device in devices.iter_mut() {
            device.discover(connected).await?;
        }
    }
    let Some(client) = client else {
        return Err(Error::Protocol("no client"));
    };
    for device in devices {
        device.read(client, words).await?;
        device.publish(out, achieved);
    }
    Ok(())
}

#[cfg(test)]
mod tests;
