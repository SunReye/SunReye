//! Failed logins per client address: each failure doubles the wait before the next attempt.

use std::collections::HashMap;
use std::net::IpAddr;
use std::time::Duration;

use tokio::time::Instant;

const FIRST: Duration = Duration::from_secs(1);
const LONGEST: Duration = Duration::from_mins(15);
/// Addresses tracked at once; beyond this the one locked out longest ago is forgotten.
const CAPACITY: usize = 1024;

#[derive(Debug)]
struct Failures {
    count: u32,
    /// No attempt is heard before this.
    until: Instant,
}

#[derive(Debug, Default)]
pub struct Backoff(HashMap<IpAddr, Failures>);

impl Backoff {
    /// The wait left before `address` may try again, if any.
    pub fn wait(&self, address: IpAddr, now: Instant) -> Option<Duration> {
        let until = self.0.get(&address)?.until;
        (until > now).then(|| until - now)
    }

    pub fn fail(&mut self, address: IpAddr, now: Instant) {
        // A failure count outlives its lockout by the longest wait, then is forgotten.
        self.0
            .retain(|_, f| now.saturating_duration_since(f.until) < LONGEST);
        if self.0.len() >= CAPACITY
            && !self.0.contains_key(&address)
            && let Some(oldest) = self.0.iter().min_by_key(|(_, f)| f.until).map(|(a, _)| *a)
        {
            self.0.remove(&oldest);
        }
        let failures = self.0.entry(address).or_insert(Failures {
            count: 0,
            until: now,
        });
        failures.count = failures.count.saturating_add(1);
        let wait = FIRST
            .saturating_mul(1 << failures.count.saturating_sub(1).min(16))
            .min(LONGEST);
        failures.until = now + wait;
    }

    pub fn succeed(&mut self, address: IpAddr) {
        self.0.remove(&address);
    }
}
