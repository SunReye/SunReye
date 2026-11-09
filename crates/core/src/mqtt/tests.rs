//! The client against an in-test broker: its status, its credentials and its reconnect backoff.

use std::time::Duration;

use tokio::time::Instant;

use super::fake::{self, Connect, Fake};
use super::{Broker, Client, Status, spawn};

fn broker(fake: &Fake, credentials: Option<(&str, &str)>) -> Broker {
    Broker {
        host: fake.address.ip().to_string(),
        port: fake.address.port(),
        credentials: credentials.map(|(u, p)| (u.to_owned(), p.to_owned())),
    }
}

/// The client's status once `holds` holds, within a second.
async fn until(client: &Client, holds: impl Fn(&Status) -> bool) -> Status {
    let deadline = Instant::now() + Duration::from_secs(1);
    loop {
        let status = client.status();
        if holds(&status) {
            return status;
        }
        assert!(Instant::now() < deadline, "never held: {status:?}");
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

#[tokio::test]
async fn a_client_connects_with_its_credentials_and_reports_it() {
    let mut fake = fake::serve(0).await;
    let client = spawn(broker(&fake, Some(("sunreye", "hunter2"))));
    let status = until(&client, |s| s.connected).await;
    assert!(status.last_connected_at.is_some());
    assert_eq!(status.last_error, None);
    let Connect {
        username, password, ..
    } = fake.connects.recv().await.unwrap();
    assert_eq!(username.as_deref(), Some("sunreye"));
    assert_eq!(password.as_deref(), Some("hunter2"));
}

#[tokio::test]
async fn a_client_without_credentials_sends_none() {
    let mut fake = fake::serve(0).await;
    let _client = spawn(broker(&fake, None));
    let connect = fake.connects.recv().await.unwrap();
    assert_eq!((connect.username, connect.password), (None, None));
}

#[tokio::test]
async fn a_lost_session_reports_its_error_and_keeps_when_it_last_connected() {
    let mut fake = fake::serve(0).await;
    let client = spawn(broker(&fake, None));
    let connected = until(&client, |s| s.connected).await;
    let _first = fake.connects.recv().await.unwrap();
    fake.close();
    let lost = until(&client, |s| !s.connected).await;
    assert!(lost.last_error.is_some());
    assert_eq!(lost.last_connected_at, connected.last_connected_at);
}

#[tokio::test(start_paused = true)]
async fn a_refused_client_backs_off_from_one_second_to_sixty() {
    let mut fake = fake::serve(5).await;
    let client = spawn(broker(&fake, None));
    let mut at = Vec::new();
    for _ in 0..9 {
        at.push(fake.connects.recv().await.unwrap().at);
    }
    let waits: Vec<u64> = at.windows(2).map(|w| (w[1] - w[0]).as_secs()).collect();
    assert_eq!(waits, [1, 2, 4, 8, 16, 32, 60, 60]);
    let status = client.status();
    assert!(!status.connected);
    assert_eq!(status.last_connected_at, None);
    assert!(status.last_error.unwrap().contains("NotAuthorized"));
}

#[tokio::test(start_paused = true)]
async fn a_lost_session_reconnects_after_one_second() {
    let mut fake = fake::serve(0).await;
    let client = spawn(broker(&fake, None));
    let first = fake.connects.recv().await.unwrap().at;
    until(&client, |s| s.connected).await;
    let lost = Instant::now();
    fake.close();
    let again = fake.connects.recv().await.unwrap().at;
    assert!(again > first);
    assert_eq!((again - lost).as_secs(), 1);
}
