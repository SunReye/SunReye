//! A failed upstream fetch held against its key, so requests queued on a cache do not each refetch.

use std::time::Duration;

use tokio::time::Instant;

/// Bounds an outage to one fetch a minute per key however many requests queue on the cache.
const RETRY: Duration = Duration::from_secs(60);

/// The last failed fetch's key and when it failed, on the monotonic clock: requests that read the wall clock
/// out of queue order, or a wall clock stepped back, cannot reopen the window.
#[derive(Debug)]
pub struct Failed<K>(Option<(K, Instant)>);

impl<K> Default for Failed<K> {
    fn default() -> Self {
        Self(None)
    }
}

impl<K: PartialEq> Failed<K> {
    /// Whether a fetch for `key` failed inside the retry interval.
    pub fn holds(&self, key: &K) -> bool {
        self.0.as_ref().is_some_and(|(k, at)| k == key && at.elapsed() < RETRY)
    }

    pub fn record(&mut self, key: K) {
        self.0 = Some((key, Instant::now()));
    }

    pub fn clear(&mut self) {
        self.0 = None;
    }
}
