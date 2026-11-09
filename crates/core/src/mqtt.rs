//! The MQTT client (ADR 10): one per broker connection, owned by a task that reconnects with a
//! backoff and reports its status. Profiles with `mqtt` bindings and the publisher share it.

#[cfg(test)]
pub mod fake;
#[cfg(test)]
mod tests;

use std::time::{Duration, SystemTime};

use rumqttc::{AsyncClient, Event, EventLoop, MqttOptions, Packet, QoS, SubscribeFilter};
use tokio::sync::{broadcast, watch};
use tokio::task::JoinHandle;

const FIRST_BACKOFF: Duration = Duration::from_secs(1);
const MAX_BACKOFF: Duration = Duration::from_mins(1);
/// Requests queued for the broker before a sender waits (ADR 2: every queue bounded).
const QUEUE: usize = 16;
/// Messages a reader may fall behind by before it loses the oldest; above EVCC's retained state
/// of about 190 topics for one loadpoint.
const MESSAGES: usize = 1024;

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

/// A message received on a subscribed topic.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Message {
    pub topic: String,
    pub payload: Vec<u8>,
}

/// A running client; dropping it stops its task.
#[derive(Debug)]
pub struct Client {
    handle: JoinHandle<()>,
    status: watch::Receiver<Status>,
    messages: broadcast::Sender<Message>,
    requests: AsyncClient,
}

/// Why a message was not sent: the client is not connected, or its queue is full.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Unsent;

impl Client {
    #[must_use]
    pub fn status(&self) -> Status {
        self.status.borrow().clone()
    }

    /// The status, as it changes.
    #[must_use]
    pub fn watch(&self) -> watch::Receiver<Status> {
        self.status.clone()
    }

    /// Messages received from now on: subscribe before the runtime next yields to receive the
    /// retained state the broker sends on connect.
    #[must_use]
    pub fn messages(&self) -> broadcast::Receiver<Message> {
        self.messages.subscribe()
    }

    /// Publishes `payload` to `topic`, unretained and at most once (`QoS` 0): a message queued
    /// across a reconnect is never sent twice.
    ///
    /// # Errors
    /// The client is not connected, or its queue is full; nothing was sent.
    pub fn publish(&self, topic: &str, payload: &str) -> Result<(), Unsent> {
        if !self.status.borrow().connected {
            return Err(Unsent);
        }
        self.requests
            .try_publish(topic, QoS::AtMostOnce, false, payload.as_bytes().to_vec())
            .map_err(|_| Unsent)
    }
}

impl Drop for Client {
    fn drop(&mut self) {
        self.handle.abort();
    }
}

/// Starts a client for `broker`, subscribed to `filters`.
///
/// It connects at once, and after a failure waits a second, doubling up to a minute while failures
/// continue. It subscribes at `QoS` 0 on every connect, so the broker sends the filters' retained
/// state each time. Must be called inside a Tokio runtime.
#[must_use]
pub fn spawn(broker: Broker, filters: Vec<String>) -> Client {
    let (report, status) = watch::channel(Status::default());
    let (messages, _) = broadcast::channel(MESSAGES);
    let out = Out {
        report,
        messages: messages.clone(),
    };
    let mut options = MqttOptions::new(client_id(), broker.host, broker.port);
    if let Some((username, password)) = broker.credentials {
        options.set_credentials(username, password);
    }
    // The handle keeps the request queue open: the event loop ends once every handle is dropped.
    let (requests, events) = AsyncClient::new(options, QUEUE);
    Client {
        handle: tokio::spawn(run(requests.clone(), events, filters, out)),
        status,
        messages,
        requests,
    }
}

/// Where the client's task reports.
struct Out {
    report: watch::Sender<Status>,
    messages: broadcast::Sender<Message>,
}

async fn run(requests: AsyncClient, mut events: EventLoop, filters: Vec<String>, out: Out) {
    let Out { report, messages } = out;
    let mut failures = 0;
    loop {
        match events.poll().await {
            Ok(Event::Incoming(Packet::ConnAck(_))) => {
                failures = 0;
                subscribe(&requests, &filters);
                report.send_modify(|s| {
                    s.connected = true;
                    s.last_connected_at = Some(SystemTime::now());
                });
            }
            Ok(Event::Incoming(Packet::Publish(publish))) => {
                // No reader is not an error.
                messages
                    .send(Message {
                        topic: publish.topic,
                        payload: publish.payload.to_vec(),
                    })
                    .ok();
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

/// Subscribes to `filters`, if any.
fn subscribe(requests: &AsyncClient, filters: &[String]) {
    if filters.is_empty() {
        return;
    }
    let filters = filters
        .iter()
        .map(|f| SubscribeFilter::new(f.clone(), QoS::AtMostOnce));
    // The queue is empty after a connect, so a refusal is a filter the broker would refuse too.
    if let Err(e) = requests.try_subscribe_many(filters) {
        tracing::warn!("mqtt: subscribe: {e}");
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
