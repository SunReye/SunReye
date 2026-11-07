//! The core's time source: Unix milliseconds that advance with tokio's clock, so a paused test moves it.

use tokio::time::Instant;

#[derive(Debug, Clone, Copy)]
pub struct Clock {
    epoch_ms: i64,
    base: Instant,
}

impl Clock {
    /// A clock reading `epoch_ms` now.
    pub fn new(epoch_ms: i64) -> Self {
        Self { epoch_ms, base: Instant::now() }
    }

    pub fn now_ms(&self) -> i64 {
        let elapsed = i64::try_from(self.base.elapsed().as_millis()).unwrap_or(i64::MAX);
        self.epoch_ms.saturating_add(elapsed)
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;

    /// 2026-03-29T00:59:59Z.
    const EPOCH_MS: i64 = 1_774_745_999_000;

    #[tokio::test(start_paused = true)]
    async fn now_moves_exactly_by_each_paused_advance() {
        let clock = Clock::new(EPOCH_MS);
        assert_eq!(clock.now_ms(), EPOCH_MS);
        tokio::time::advance(Duration::ZERO).await;
        assert_eq!(clock.now_ms(), EPOCH_MS);
        tokio::time::advance(Duration::from_millis(1)).await;
        assert_eq!(clock.now_ms(), EPOCH_MS + 1);
        tokio::time::advance(Duration::from_hours(24)).await;
        assert_eq!(clock.now_ms(), EPOCH_MS + 86_400_001);
    }
}
