//! Signed-in browsers, kept in memory: a restart signs everyone out and using a session writes
//! nothing to flash.

use std::collections::HashMap;
use std::fmt::Write;
use std::time::Duration;

use tokio::time::Instant;

/// A session ends after this long unused.
pub const IDLE: Duration = Duration::from_hours(30 * 24);
/// Sessions held at once; a new one beyond this ends the least recently used.
const CAPACITY: usize = 64;

#[derive(Debug, Default)]
pub struct Sessions(HashMap<String, Instant>);

impl Sessions {
    /// Starts a session and returns its token.
    pub fn start(&mut self, now: Instant) -> Option<String> {
        let mut bytes = [0; 32];
        getrandom::fill(&mut bytes).ok()?;
        let mut token = String::with_capacity(64);
        for byte in bytes {
            write!(token, "{byte:02x}").ok()?;
        }
        self.0.retain(|_, used| now.duration_since(*used) < IDLE);
        if self.0.len() >= CAPACITY
            && let Some(oldest) = self
                .0
                .iter()
                .min_by_key(|(_, used)| **used)
                .map(|(t, _)| t.clone())
        {
            self.0.remove(&oldest);
        }
        self.0.insert(token.clone(), now);
        Some(token)
    }

    /// Whether `token` is a live session; using it restarts its idle time.
    pub fn touch(&mut self, token: &str, now: Instant) -> bool {
        match self.0.get_mut(token) {
            Some(used) if now.duration_since(*used) < IDLE => {
                *used = now;
                true
            }
            Some(_) => {
                self.0.remove(token);
                false
            }
            None => false,
        }
    }
}
