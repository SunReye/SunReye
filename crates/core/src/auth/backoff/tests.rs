//! Check and record are one step, so no guess slips between them.

use std::net::{IpAddr, Ipv4Addr};
use std::time::Duration;

use tokio::time::Instant;

use super::Backoff;

const HOME: IpAddr = IpAddr::V4(Ipv4Addr::new(192, 0, 2, 1));

#[test]
fn an_attempt_heard_counts_as_failed_until_it_succeeds() {
    let mut backoff = Backoff::default();
    let now = Instant::now();

    assert_eq!(backoff.attempt(HOME, now), None);
    assert_eq!(backoff.attempt(HOME, now), Some(Duration::from_secs(1)));

    backoff.succeed(HOME);
    assert_eq!(backoff.attempt(HOME, now), None);
}
