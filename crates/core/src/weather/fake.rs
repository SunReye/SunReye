//! Weather providers for tests: no network.

use std::sync::Mutex;

use jiff::civil::Date;
use tokio::sync::mpsc;
use tokio::time::Instant;

use super::{Archive, Error, Provider, Slot};
use crate::location::Location;

/// Answers every fetch with `slots`, failing those listed in `fail`, and reports each call.
pub struct Fake {
    slots: Vec<Slot>,
    fail: Mutex<Vec<bool>>,
    calls: mpsc::UnboundedSender<(Instant, Location)>,
}

impl Fake {
    #[must_use]
    pub fn new(
        slots: Vec<Slot>,
        fail: &[bool],
    ) -> (Self, mpsc::UnboundedReceiver<(Instant, Location)>) {
        let (calls, received) = mpsc::unbounded_channel();
        let fail = Mutex::new(fail.iter().rev().copied().collect());
        (Self { slots, fail, calls }, received)
    }
}

impl Provider for Fake {
    fn fetch(&self, location: Location) -> impl Future<Output = Result<Vec<Slot>, Error>> + Send {
        // The receiver may be gone: the test has seen what it wanted.
        self.calls.send((Instant::now(), location)).ok();
        let failed = self.fail.lock().unwrap().pop() == Some(true);
        std::future::ready(if failed {
            Err(Error::Fetch("offline".into()))
        } else {
            Ok(self.slots.clone())
        })
    }
}

/// Past weather for tests: answers each fetch with the `slots` on the days asked, and reports
/// each call.
pub struct FakeArchive {
    slots: Vec<Slot>,
    calls: mpsc::UnboundedSender<(Instant, Location, Date, Date)>,
}

impl FakeArchive {
    #[must_use]
    pub fn new(
        slots: Vec<Slot>,
    ) -> (
        Self,
        mpsc::UnboundedReceiver<(Instant, Location, Date, Date)>,
    ) {
        let (calls, received) = mpsc::unbounded_channel();
        (Self { slots, calls }, received)
    }
}

impl Archive for FakeArchive {
    fn fetch(
        &self,
        location: Location,
        from: Date,
        to: Date,
    ) -> impl Future<Output = Result<Vec<Slot>, Error>> + Send {
        self.calls.send((Instant::now(), location, from, to)).ok();
        let day = |s: &Slot| {
            let at = jiff::Timestamp::try_from(s.target).ok()?;
            Some(at.to_zoned(jiff::tz::TimeZone::UTC).date())
        };
        let slots = self
            .slots
            .iter()
            .filter(|s| day(s).is_some_and(|d| (from..=to).contains(&d)))
            .copied()
            .collect();
        std::future::ready(Ok(slots))
    }
}
