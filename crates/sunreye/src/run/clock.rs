//! The core's time source: Unix milliseconds. Production reads the wall clock on every call, so a wall-clock
//! step (first NTP sync) or a suspend shows in the next stamp; a test clock is anchored on tokio's clock, so a
//! paused test moves it.

use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Copy)]
pub struct Clock {
    /// Unix milliseconds at a tokio instant; only a test anchors a clock.
    anchor: Option<(i64, tokio::time::Instant)>,
}

impl Clock {
    pub fn wall() -> Self {
        Self { anchor: None }
    }

    /// A clock reading `epoch_ms` now and advancing with tokio's clock.
    #[cfg(test)]
    pub fn at(epoch_ms: i64) -> Self {
        Self { anchor: Some((epoch_ms, tokio::time::Instant::now())) }
    }

    pub fn now_ms(&self) -> i64 {
        if let Some((epoch_ms, base)) = self.anchor {
            let elapsed = i64::try_from(base.elapsed().as_millis()).unwrap_or(i64::MAX);
            return epoch_ms.saturating_add(elapsed);
        }
        let since_epoch = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
        i64::try_from(since_epoch.as_millis()).unwrap_or(i64::MAX)
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
        let clock = Clock::at(EPOCH_MS);
        assert_eq!(clock.now_ms(), EPOCH_MS);
        tokio::time::advance(Duration::ZERO).await;
        assert_eq!(clock.now_ms(), EPOCH_MS);
        tokio::time::advance(Duration::from_millis(1)).await;
        assert_eq!(clock.now_ms(), EPOCH_MS + 1);
        tokio::time::advance(Duration::from_hours(24)).await;
        assert_eq!(clock.now_ms(), EPOCH_MS + 86_400_001);
    }

    fn system_ms() -> i64 {
        i64::try_from(SystemTime::now().duration_since(UNIX_EPOCH).expect("after 1970").as_millis())
            .expect("in range")
    }

    /// The monotonic clock leaping a day past the wall clock stands for a wall step back or a suspend: the
    /// wall clock still decides.
    #[tokio::test(start_paused = true)]
    async fn the_wall_clock_follows_system_time_not_the_monotonic_clock() {
        let clock = Clock::wall();
        tokio::time::advance(Duration::from_hours(24)).await;
        let (before, now, after) = (system_ms(), clock.now_ms(), system_ms());
        assert!((before..=after).contains(&now), "{before}..={after}: {now}");
    }
}
