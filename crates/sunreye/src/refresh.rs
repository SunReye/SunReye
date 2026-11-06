//! Keeps the conditions reading and the forecast irradiance fresh off the request path: a request reads what
//! the last refresh landed and never waits on Open-Meteo.

use std::time::Duration;

use tokio::sync::watch;

/// How often a landed refresh is repeated.
pub const PERIOD: Duration = Duration::from_mins(15);
/// How soon a failed refresh is retried.
const RETRY: Duration = Duration::from_mins(1);

/// Runs `refresh` now, [`PERIOD`] after it landed, [`RETRY`] after it failed, and at once when `changed`
/// fires, until `stopped` changes, which also drops a refresh in flight, or until `refresh` has nothing to run.
pub(crate) async fn keep_fresh<F, R>(
    mut refresh: F,
    mut changed: watch::Receiver<()>,
    mut stopped: watch::Receiver<bool>,
) where
    F: FnMut() -> Option<R>,
    R: Future<Output = bool>,
{
    loop {
        let Some(run) = refresh() else { return };
        let landed = tokio::select! {
            biased;
            _ = stopped.changed() => return,
            landed = run => landed,
        };
        tokio::select! {
            biased;
            _ = stopped.changed() => return,
            Ok(()) = changed.changed() => {}
            () = tokio::time::sleep(if landed { PERIOD } else { RETRY }) => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use tokio::task::JoinSet;

    use super::*;

    /// A loop over a refresh that lands while `lands` says so; counts its runs.
    struct Looping {
        runs: Arc<AtomicUsize>,
        lands: Arc<std::sync::atomic::AtomicBool>,
        changed: watch::Sender<()>,
        stop: watch::Sender<bool>,
        task: JoinSet<()>,
    }

    /// Whether it `lands`, at once unless it `hangs`.
    async fn run(lands: bool, hangs: bool) -> bool {
        if hangs {
            std::future::pending::<()>().await;
        }
        lands
    }

    impl Looping {
        fn start(hangs: bool) -> Self {
            let (runs, lands) =
                (Arc::new(AtomicUsize::new(0)), Arc::new(std::sync::atomic::AtomicBool::new(true)));
            let (changed, stop) = (watch::Sender::new(()), watch::Sender::new(false));
            let (counted, landing) = (Arc::clone(&runs), Arc::clone(&lands));
            let refresh = move || {
                counted.fetch_add(1, Ordering::SeqCst);
                Some(run(landing.load(Ordering::SeqCst), hangs))
            };
            let mut task = JoinSet::new();
            task.spawn(keep_fresh(refresh, changed.subscribe(), stop.subscribe()));
            Self { runs, lands, changed, stop, task }
        }

        /// Runs so far, once the loop has settled `by` from now.
        async fn runs_after(&self, by: Duration) -> usize {
            tokio::time::advance(by).await;
            for _ in 0..3 {
                tokio::task::yield_now().await;
            }
            self.runs.load(Ordering::SeqCst)
        }
    }

    const MS: Duration = Duration::from_millis(1);
    const QUARTER_HOUR: Duration = Duration::from_mins(15);

    #[tokio::test(start_paused = true)]
    async fn a_landed_refresh_runs_at_once_and_again_fifteen_minutes_later() {
        let looping = Looping::start(false);
        assert_eq!(looping.runs_after(Duration::ZERO).await, 1, "at start");
        assert_eq!(looping.runs_after(QUARTER_HOUR.saturating_sub(MS)).await, 1, "inside the period");
        assert_eq!(looping.runs_after(MS).await, 2, "at the period");
    }

    #[tokio::test(start_paused = true)]
    async fn a_failed_refresh_is_retried_a_minute_later_not_before() {
        let looping = Looping::start(false);
        looping.lands.store(false, Ordering::SeqCst);
        assert_eq!(looping.runs_after(Duration::ZERO).await, 1);
        assert_eq!(looping.runs_after(Duration::from_millis(59_999)).await, 1, "inside the retry interval");
        assert_eq!(looping.runs_after(MS).await, 2, "at the retry interval");
    }

    #[tokio::test(start_paused = true)]
    async fn a_settings_change_refreshes_at_once() {
        let looping = Looping::start(false);
        assert_eq!(looping.runs_after(Duration::ZERO).await, 1);
        looping.changed.send_replace(());
        assert_eq!(looping.runs_after(MS).await, 2);
    }

    #[tokio::test(start_paused = true)]
    async fn stopping_ends_the_loop_with_a_refresh_in_flight() {
        let mut looping = Looping::start(true);
        assert_eq!(looping.runs_after(Duration::ZERO).await, 1);
        looping.stop.send_replace(true);
        let joined = tokio::time::timeout(MS, looping.task.join_next()).await.expect("stopped");
        assert!(joined.expect("the loop").is_ok());
    }
}
