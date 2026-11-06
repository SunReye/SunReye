//! A failed upstream fetch held against its key, so requests queued on a cache do not each refetch.

/// Bounds an outage to one fetch a minute per key however many requests queue on the cache.
const RETRY_MS: i64 = 60_000;

/// The last failed fetch's key and request time.
#[derive(Debug)]
pub struct Failed<K>(Option<(K, i64)>);

impl<K> Default for Failed<K> {
    fn default() -> Self {
        Self(None)
    }
}

impl<K: PartialEq> Failed<K> {
    /// Whether a fetch for `key` failed inside the retry interval before `now_ms`.
    pub fn holds(&self, key: &K, now_ms: i64) -> bool {
        self.0.as_ref().is_some_and(|(k, at)| k == key && (0..RETRY_MS).contains(&(now_ms - at)))
    }

    pub fn record(&mut self, key: K, now_ms: i64) {
        self.0 = Some((key, now_ms));
    }

    pub fn clear(&mut self) {
        self.0 = None;
    }
}
