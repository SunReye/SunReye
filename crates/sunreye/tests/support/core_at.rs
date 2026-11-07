//! A core at a chosen instant and plant zone on tokio's paused clock, for `#[tokio::test(start_paused = true)]`:
//! a clock paused at the runtime's start keeps whole-millisecond timers exact. Unit tests only: it opens the
//! core through test-only openers.

use std::path::Path;
use std::sync::Arc;

use crate::run::{Clock, Core};
use crate::store::Store;

/// Keeps tokio from auto-advancing its paused clock until the runtime drops its tasks, so no timer fires until
/// the test advances it. Auto-advance would leap to the pool's acquire timeout while a store query waits on its
/// thread. Call before the test's first store query.
pub fn hold_still() {
    let (keep, kept) = std::sync::mpsc::channel::<()>();
    // A running blocking task inhibits auto-advance.
    tokio::task::spawn_blocking(move || kept.recv().ok());
    tokio::spawn(async move {
        let _keep = keep;
        std::future::pending::<()>().await;
    });
}

/// [`hold_still`], and a clock reading `at`, an RFC 3339 instant.
pub fn paused_at(at: &str) -> Clock {
    hold_still();
    Clock::at(at.parse::<jiff::Timestamp>().expect("instant").as_millisecond())
}

/// A core over `dir` at `at`, cutting plant days in `zone`, on a clock from [`paused_at`].
pub async fn core_at(dir: &Path, at: &str, zone: &str) -> Arc<Core> {
    let clock = paused_at(at);
    let store = Store::open(dir).await.expect("store");
    crate::plant_zone::save(&store, zone).await.expect("zone");
    store.close().await;
    Core::open_at(dir, clock).await.expect("core")
}
