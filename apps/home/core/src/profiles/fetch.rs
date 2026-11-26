//! Fetching an index and its profiles: over HTTPS, or from a fake host in tests.

use std::time::Duration;

const TIMEOUT: Duration = Duration::from_secs(30);

/// A source of the bytes at a URL. Blocking: callers run it on Tokio's blocking pool.
pub trait Fetch: Send + Sync + std::fmt::Debug {
    /// The body at `url`.
    ///
    /// # Errors
    /// The host could not be reached or refused the request.
    fn get(&self, url: &str) -> Result<Vec<u8>, String>;
}

/// Fetches over HTTPS with `ureq` (ADR 2).
#[derive(Debug, Clone, Copy, Default)]
pub struct Https;

impl Fetch for Https {
    fn get(&self, url: &str) -> Result<Vec<u8>, String> {
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .timeout_global(Some(TIMEOUT))
            .build()
            .into();
        agent
            .get(url)
            .call()
            .and_then(|mut response| response.body_mut().read_to_vec())
            .map_err(|e| e.to_string())
    }
}
