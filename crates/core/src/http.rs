//! Devices behind an HTTP host (ADR 6, 10): one task per connection asks every GET of every
//! device in parallel, once per cadence, and decodes the answers through each device's profile.
//!
//! A device answers in full or not at all: one whose GET failed publishes nothing that cycle, as a
//! Modbus device whose read failed does. A failed cycle backs off as an endpoint task does.

mod digest;
#[cfg(test)]
mod fake;

use std::sync::Arc;
use std::time::SystemTime;

use sunreye_profile::Unit;
use tokio::task::{JoinHandle, JoinSet};
use tokio::time::Instant;

use crate::bus::{Bus, Reading, SeriesId};
use crate::endpoint::{CADENCE, Device, TIMEOUT, backoff};
use digest::Challenge;

/// The most of an answer read: a device status is a few kilobytes.
const LIMIT: u64 = 1 << 20;

/// An HTTP host and its credentials, the connection's secrets `username` and `password`.
#[derive(Clone, PartialEq, Eq)]
pub struct Host {
    pub host: String,
    pub port: u16,
    pub credentials: Option<(String, String)>,
}

/// Shows no credentials, so no log line can carry them.
impl std::fmt::Debug for Host {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Host")
            .field("host", &self.host)
            .field("port", &self.port)
            .finish_non_exhaustive()
    }
}

/// A running host task; dropping it stops the task.
#[derive(Debug)]
pub struct Task {
    handle: JoinHandle<()>,
}

impl Drop for Task {
    fn drop(&mut self) {
        self.handle.abort();
    }
}

/// Starts reading `devices` from `host`, each at its unit as the device address: the first cycle
/// at once, then one per cadence. Must be called inside a Tokio runtime.
#[must_use]
pub fn spawn(host: Host, devices: Vec<Device>, bus: Bus) -> Task {
    let read: Vec<Read> = devices.into_iter().map(|d| Read::new(d, &bus)).collect();
    Task {
        handle: tokio::spawn(run(host, read, bus)),
    }
}

/// A device, its series and its values.
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

async fn run(host: Host, mut read: Vec<Read>, bus: Bus) {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .http_status_as_error(false)
        .timeout_global(Some(TIMEOUT))
        .build()
        .into();
    let host = Arc::new(host);
    let mut failures: u32 = 0;
    let mut next = Instant::now();
    loop {
        tokio::time::sleep_until(next).await;
        if cycle(&agent, &host, &mut read, &bus).await {
            failures = 0;
            next += CADENCE;
        } else {
            failures = failures.saturating_add(1);
            next = Instant::now() + backoff(failures);
        }
    }
}

/// Asks every GET at once and publishes each device that answered all of its; whether all did.
async fn cycle(agent: &ureq::Agent, host: &Arc<Host>, read: &mut [Read], bus: &Bus) -> bool {
    let mut asks = JoinSet::new();
    for (at, r) in read.iter().enumerate() {
        for get in r.device.profile.requests(u32::from(r.device.unit)) {
            let (agent, host) = (agent.clone(), Arc::clone(host));
            asks.spawn_blocking(move || {
                let answer = fetch(&agent, &host, &get);
                (at, get, answer)
            });
        }
    }
    let mut answers: Vec<Vec<(String, Vec<u8>)>> = read.iter().map(|_| Vec::new()).collect();
    let mut failed = vec![false; read.len()];
    while let Some(joined) = asks.join_next().await {
        let Ok((at, get, answer)) = joined else {
            return false;
        };
        match answer {
            Ok(body) => {
                if let Some(answers) = answers.get_mut(at) {
                    answers.push((get, body));
                }
            }
            Err(e) => {
                let device = read.get(at).map(|r| r.device.id.0);
                tracing::warn!(device, get, "not read: {e}");
                if let Some(failed) = failed.get_mut(at) {
                    *failed = true;
                }
            }
        }
    }
    for ((r, answers), failed) in read.iter_mut().zip(answers).zip(&failed) {
        if *failed {
            continue;
        }
        r.values.fill(None);
        for (get, body) in answers {
            let unit = u32::from(r.device.unit);
            r.device.profile.answer(unit, &get, &body, &mut r.values);
        }
        r.publish(bus);
    }
    !failed.contains(&true)
}

/// The answer to `get` on `host`, answering a Digest challenge with its credentials. Blocking.
fn fetch(agent: &ureq::Agent, host: &Host, get: &str) -> Result<Vec<u8>, String> {
    let url = format!("http://{}:{}{get}", host.host, host.port);
    let mut response = agent.get(&url).call().map_err(|e| e.to_string())?;
    if response.status() == 401 {
        let challenge = response
            .headers()
            .get("www-authenticate")
            .and_then(|h| h.to_str().ok())
            .and_then(Challenge::parse);
        let (Some(challenge), Some((username, password))) = (challenge, &host.credentials) else {
            return Err("unauthorized".to_owned());
        };
        let answer = challenge.answer((username, password), "GET", get, &cnonce());
        response = agent
            .get(&url)
            .header("Authorization", &answer)
            .call()
            .map_err(|e| e.to_string())?;
    }
    if response.status() != 200 {
        return Err(format!("status {}", response.status()));
    }
    response
        .body_mut()
        .with_config()
        .limit(LIMIT)
        .read_to_vec()
        .map_err(|e| e.to_string())
}

/// A fresh client nonce, so a recorded answer cannot be replayed.
fn cnonce() -> String {
    let mut bytes = [0_u8; 16];
    getrandom::fill(&mut bytes).ok();
    digest::hex(&bytes)
}

#[cfg(test)]
mod tests;
