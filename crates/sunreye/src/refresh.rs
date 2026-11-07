//! Keeps the conditions reading and the forecast irradiance fresh off the request path: a request reads what
//! the last refresh landed and never waits on Open-Meteo.

use std::time::Duration;

use tokio::sync::watch;

use crate::events::Events;

/// How often a landed refresh is repeated.
pub const PERIOD: Duration = Duration::from_mins(15);

/// Whether a value that landed at `landed_ms` is younger than `ttl` at `now_ms`; one landed after `now_ms`
/// (the wall clock stepped back) is not.
pub(crate) fn within(ttl: Duration, landed_ms: i64, now_ms: i64) -> bool {
    u128::try_from(now_ms.saturating_sub(landed_ms)).is_ok_and(|age| age < ttl.as_millis())
}

/// How soon a failed refresh is retried.
const RETRY: Duration = Duration::from_mins(1);

/// Runs `refresh` now, [`PERIOD`] after it landed, [`RETRY`] after it failed, and at once on a `changed` hint,
/// once for any burst of them, until `stopped` changes, which also drops a refresh in flight, or until
/// `refresh` has nothing to run.
pub(crate) async fn keep_fresh<F, R, T: Clone>(
    mut refresh: F,
    mut changed: Events<T>,
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
            Some(_) = changed.newest() => {}
            () = tokio::time::sleep(if landed { PERIOD } else { RETRY }) => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use tokio::sync::Semaphore;
    use tokio::task::JoinSet;

    use super::*;
    use crate::events::Event;

    /// A loop over a refresh that lands while `lands` says so; counts its runs.
    struct Looping {
        runs: Arc<AtomicUsize>,
        lands: Arc<std::sync::atomic::AtomicBool>,
        changed: Event<u32>,
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

    /// Lands once `gate` has a permit.
    async fn gated(gate: Arc<Semaphore>) -> bool {
        gate.acquire().await.is_ok()
    }

    impl Looping {
        fn start(hangs: bool) -> Self {
            let (runs, lands) =
                (Arc::new(AtomicUsize::new(0)), Arc::new(std::sync::atomic::AtomicBool::new(true)));
            let (changed, stop) = (Event::default(), watch::Sender::new(false));
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

    #[test]
    fn a_fetch_is_fresh_from_its_landing_until_the_period_and_not_once_the_clock_stepped_back() {
        const LANDED: i64 = 1_774_745_999_000;
        assert!(within(PERIOD, LANDED, LANDED), "at landing");
        assert!(within(PERIOD, LANDED, LANDED + 899_999), "inside the period");
        assert!(!within(PERIOD, LANDED, LANDED + 900_000), "at the period");
        assert!(!within(PERIOD, LANDED, LANDED - 1), "landed after now: the wall clock stepped back");
    }

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
        looping.changed.publish(1);
        assert_eq!(looping.runs_after(MS).await, 2);
    }

    #[tokio::test(start_paused = true)]
    async fn a_refresh_that_falls_behind_a_burst_of_changes_runs_once_more_and_reads_the_last() {
        let (state, read) = (Arc::new(AtomicUsize::new(0)), Arc::new(std::sync::Mutex::new(Vec::new())));
        let gate = Arc::new(Semaphore::new(0));
        let (reading, landing, seen) = (Arc::clone(&state), Arc::clone(&gate), Arc::clone(&read));
        let refresh = move || {
            seen.lock().expect("read").push(reading.load(Ordering::SeqCst));
            Some(gated(Arc::clone(&landing)))
        };
        let (changed, stop) = (Event::<u32>::default(), watch::Sender::new(false));
        let mut task = JoinSet::new();
        task.spawn(keep_fresh(refresh, changed.subscribe(), stop.subscribe()));
        tokio::task::yield_now().await;
        for n in 1..=300 {
            state.store(n, Ordering::SeqCst);
            changed.publish(u32::try_from(n).expect("small"));
        }
        gate.add_permits(1);
        tokio::time::advance(MS).await;
        for _ in 0..3 {
            tokio::task::yield_now().await;
        }
        assert_eq!(*read.lock().expect("read"), [0, 300], "one refresh for the burst, of the latest state");
        stop.send_replace(true);
        task.join_next().await.expect("the loop").expect("ended");
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
