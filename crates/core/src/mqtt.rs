//! The MQTT client (ADR 10): one per broker connection, owned by a task that reconnects with a
//! backoff and reports its status. Profiles with `mqtt` bindings and the publisher share it.

#[cfg(test)]
pub mod fake;
#[cfg(test)]
mod tests;

use std::time::{Duration, SystemTime};

use rumqttc::{AsyncClient, Event, MqttOptions, Packet};
use tokio::sync::watch;
use tokio::task::JoinHandle;

const FIRST_BACKOFF: Duration = Duration::from_secs(1);
const MAX_BACKOFF: Duration = Duration::from_mins(1);
/// Requests queued for the broker before a sender waits (ADR 2: every queue bounded).
const QUEUE: usize = 16;

/// Where a client connects. No `Debug`, so no log line can carry the password.
#[derive(Clone, PartialEq, Eq)]
pub struct Broker {
    pub host: String,
    pub port: u16,
    /// Username and password, from the connection's secrets.
    pub credentials: Option<(String, String)>,
}

/// The client's state as observed.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Status {
    pub connected: bool,
    /// Why the last attempt or session failed; never cleared.
    pub last_error: Option<String>,
    pub last_connected_at: Option<SystemTime>,
}

/// A running client; dropping it stops its task.
#[derive(Debug)]
pub struct Client {
    handle: JoinHandle<()>,
    status: watch::Receiver<Status>,
}

impl Client {
    #[must_use]
    pub fn status(&self) -> Status {
        self.status.borrow().clone()
    }
}

impl Drop for Client {
    fn drop(&mut self) {
        self.handle.abort();
    }
}

/// Starts a client for `broker`: it connects at once, and after a failure waits a second, doubling
/// up to a minute while failures continue. Must be called inside a Tokio runtime.
#[must_use]
pub fn spawn(broker: Broker) -> Client {
    let (report, status) = watch::channel(Status::default());
    Client {
        handle: tokio::spawn(run(broker, report)),
        status,
    }
}

async fn run(broker: Broker, report: watch::Sender<Status>) {
    let mut options = MqttOptions::new(client_id(), broker.host, broker.port);
    if let Some((username, password)) = broker.credentials {
        options.set_credentials(username, password);
    }
    // The handle keeps the request queue open: the event loop ends once every handle is dropped.
    let (_requests, mut events) = AsyncClient::new(options, QUEUE);
    let mut failures = 0;
    loop {
        match events.poll().await {
            Ok(Event::Incoming(Packet::ConnAck(_))) => {
                failures = 0;
                report.send_modify(|s| {
                    s.connected = true;
                    s.last_connected_at = Some(SystemTime::now());
                });
            }
            Ok(_) => {}
            Err(e) => {
                failures += 1;
                let error = e.to_string();
                tracing::warn!("mqtt: {error}");
                report.send_modify(|s| {
                    s.connected = false;
                    s.last_error = Some(error);
                });
                tokio::time::sleep(backoff(failures)).await;
            }
        }
    }
}

/// The wait before the next attempt after `failures` failures in a row, at least one.
fn backoff(failures: u32) -> Duration {
    let doublings = failures.saturating_sub(1).min(16);
    FIRST_BACKOFF
        .saturating_mul(1 << doublings)
        .min(MAX_BACKOFF)
}

/// Unique per client: a broker drops the older of two sessions with one id, and another install
/// may share the broker.
fn client_id() -> String {
    let mut bytes = [0; 4];
    let suffix = getrandom::fill(&mut bytes).map_or(0, |()| u32::from_be_bytes(bytes));
    format!("sunreye-{suffix:08x}")
}
