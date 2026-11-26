//! Signed-in browsers, kept in memory: a restart signs everyone out and using a session writes
//! nothing to flash.

use std::collections::HashMap;
use std::time::Duration;

use tokio::time::Instant;

/// A session ends after this long unused.
pub const IDLE: Duration = Duration::from_hours(30 * 24);
/// Sessions held at once; a new one beyond this ends the least recently used.
const CAPACITY: usize = 64;

/// Who a session or token acts as.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Grant {
    Admin,
    /// A viewer account, by id.
    Viewer(u32),
}

#[derive(Debug)]
struct Session {
    used: Instant,
    grant: Grant,
}

#[derive(Debug, Default)]
pub struct Sessions(HashMap<String, Session>);

impl Sessions {
    /// Starts a session for `grant` and returns its token.
    pub fn start(&mut self, grant: Grant, now: Instant) -> Option<String> {
        let token = random_token()?;
        self.0.retain(|_, s| now.duration_since(s.used) < IDLE);
        if self.0.len() >= CAPACITY
            && let Some(oldest) = self
                .0
                .iter()
                .min_by_key(|(_, s)| s.used)
                .map(|(t, _)| t.clone())
        {
            self.0.remove(&oldest);
        }
        self.0.insert(token.clone(), Session { used: now, grant });
        Some(token)
    }

    /// Who `token` acts as, if it is a live session; using it restarts its idle time.
    pub fn touch(&mut self, token: &str, now: Instant) -> Option<Grant> {
        match self.0.get_mut(token) {
            Some(session) if now.duration_since(session.used) < IDLE => {
                session.used = now;
                Some(session.grant)
            }
            Some(_) => {
                self.0.remove(token);
                None
            }
            None => None,
        }
    }

    /// Ends every session of `grant`.
    pub fn end(&mut self, grant: Grant) {
        self.0.retain(|_, s| s.grant != grant);
    }
}

/// 32 random bytes as hex.
pub(super) fn random_token() -> Option<String> {
    let mut bytes = [0; 32];
    getrandom::fill(&mut bytes).ok()?;
    Some(hex(&bytes))
}

/// `bytes` as lowercase hex.
pub fn hex(bytes: &[u8]) -> String {
    bytes
        .iter()
        .flat_map(|b| [b >> 4, b & 15])
        .filter_map(|nibble| char::from_digit(u32::from(nibble), 16))
        .collect()
}
