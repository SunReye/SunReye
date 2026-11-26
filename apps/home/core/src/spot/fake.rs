//! A spot-price provider for tests: no network.

use std::sync::Mutex;
use std::time::SystemTime;

use tokio::sync::mpsc;
use tokio::time::Instant;

use super::{BiddingZone, Error, Provider, Slot};

/// Answers every fetch with `slots`, failing those listed in `fail`, and reports each call.
pub struct Fake {
    slots: Vec<Slot>,
    fail: Mutex<Vec<bool>>,
    calls: mpsc::UnboundedSender<(Instant, BiddingZone)>,
}

impl Fake {
    #[must_use]
    pub fn new(
        slots: Vec<Slot>,
        fail: &[bool],
    ) -> (Self, mpsc::UnboundedReceiver<(Instant, BiddingZone)>) {
        let (calls, received) = mpsc::unbounded_channel();
        let fail = Mutex::new(fail.iter().rev().copied().collect());
        (Self { slots, fail, calls }, received)
    }
}

impl Provider for Fake {
    fn fetch(
        &self,
        zone: BiddingZone,
        _at: SystemTime,
    ) -> impl Future<Output = Result<Vec<Slot>, Error>> + Send {
        // The receiver may be gone: the test has seen what it wanted.
        self.calls.send((Instant::now(), zone)).ok();
        let failed = self.fail.lock().unwrap().pop() == Some(true);
        std::future::ready(if failed {
            Err(Error::Fetch("offline".into()))
        } else {
            Ok(self.slots.clone())
        })
    }
}
