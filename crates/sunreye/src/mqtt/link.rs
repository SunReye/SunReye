//! One device's connection to the broker: dial, publish what the bridge says, redial with a capped,
//! jittered backoff. Publish-only: nothing here subscribes, so no topic can reach a register (ADR 0005).

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use rustls::pki_types::{CertificateDer, ServerName};
use tokio::io::{AsyncRead, AsyncWrite, AsyncWriteExt, ReadHalf, WriteHalf};
use tokio::net::TcpStream;
use tokio::sync::watch;
use tokio::time::Interval;
use tokio_rustls::TlsConnector;

use super::bridge::{Bridge, Publish};
use super::config::Broker;
use super::wire;
use crate::forecast::Forecast;
use crate::samples::Sample;

const BASE: Duration = Duration::from_secs(1);
const CAP: Duration = Duration::from_secs(60);
const KEEP_ALIVE_SECS: u16 = 60;
/// Bounds the dial, the TLS handshake and the CONNACK.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

/// The delay before redial `attempt` (0 after a session that connected): doubling from 1 s, capped at 60 s,
/// then scaled into its upper half by `jitter` in [0, 1) so a broker restart is not met by every client at once.
pub fn backoff(attempt: u32, jitter: f64) -> Duration {
    let doubled = BASE.saturating_mul(2u32.saturating_pow(attempt.min(31)));
    doubled.min(CAP).mul_f64(0.5 + jitter.clamp(0.0, 1.0) / 2.0)
}

/// A uniform draw in [0, 1) from the system's random source.
pub fn jitter() -> f64 {
    let mut bytes = [0u8; 4];
    let drawn = ring::rand::SecureRandom::fill(&ring::rand::SystemRandom::new(), &mut bytes);
    if drawn.is_err() {
        return 0.5;
    }
    f64::from(u32::from_le_bytes(bytes)) / 4_294_967_296.0
}

/// Waits out a backoff; `tokio::time::sleep` outside tests.
pub type Pause = Arc<dyn Fn(Duration) -> Pin<Box<dyn Future<Output = ()> + Send>> + Send + Sync>;

pub fn sleep() -> Pause {
    Arc::new(|delay| Box::pin(tokio::time::sleep(delay)))
}

#[derive(Clone)]
pub struct Dial {
    pub broker: Broker,
    pub client_id: String,
    pub username: Option<String>,
    pub password: Option<String>,
    /// Trusted besides the built-in roots, for a broker behind a private certificate authority.
    pub roots: Vec<CertificateDer<'static>>,
}

pub struct Link {
    pub dial: Dial,
    pub pause: Pause,
    pub jitter: fn() -> f64,
}

impl std::fmt::Debug for Dial {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let Self { broker, client_id, username, .. } = self;
        f.debug_struct("Dial")
            .field("broker", broker)
            .field("client_id", client_id)
            .field("username", username)
            .finish_non_exhaustive()
    }
}

impl std::fmt::Debug for Link {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Link").field("dial", &self.dial).finish_non_exhaustive()
    }
}

/// What the link publishes from: the device's latest sample, the plant forecast, and the stop signal.
#[derive(Debug)]
pub struct Feeds {
    pub samples: watch::Receiver<Option<Arc<Sample>>>,
    pub forecast: watch::Receiver<Option<Arc<Forecast>>>,
    pub stop: watch::Receiver<bool>,
}

enum Event {
    Sample(Option<Arc<Sample>>),
    Forecast(Option<Arc<Forecast>>),
    Stop,
}

impl Feeds {
    /// The next change; a closed feed never fires again, a dropped stop sender stops.
    async fn next(&mut self) -> Event {
        loop {
            tokio::select! {
                biased;
                stopped = self.stop.changed() => if stopped.is_err() || *self.stop.borrow_and_update() {
                    return Event::Stop;
                },
                Ok(()) = self.samples.changed() => return Event::Sample(self.samples.borrow_and_update().clone()),
                Ok(()) = self.forecast.changed() => return Event::Forecast(self.forecast.borrow_and_update().clone()),
            }
        }
    }
}

/// Feeds an event to the bridge; what it answers is for the wire.
fn apply(bridge: &mut Bridge, event: Event) -> Option<Vec<Publish>> {
    match event {
        Event::Sample(Some(sample)) => Some(bridge.sample(&sample)),
        Event::Forecast(forecast) => Some(bridge.forecast(forecast)),
        Event::Sample(None) => Some(Vec::new()),
        Event::Stop => None,
    }
}

trait Stream: AsyncRead + AsyncWrite + Send + Unpin {}
impl<S: AsyncRead + AsyncWrite + Send + Unpin> Stream for S {}

enum Ended {
    Stopped,
    /// The connection failed or dropped; `connected` when the broker had accepted it.
    Lost {
        connected: bool,
    },
}

/// Runs until `feeds.stop` is set: connected, it publishes; away, it queues in the bridge and redials.
pub async fn run(link: Link, mut bridge: Bridge, mut feeds: Feeds) {
    let mut failures = 0;
    loop {
        match session(&link.dial, &mut bridge, &mut feeds).await {
            Ended::Stopped => return,
            Ended::Lost { connected: true } => failures = 0,
            Ended::Lost { connected: false } => {}
        }
        bridge.dropped();
        let mut waited = (link.pause)(backoff(failures, (link.jitter)()));
        failures = failures.saturating_add(1);
        loop {
            tokio::select! {
                () = &mut waited => break,
                event = feeds.next() => if apply(&mut bridge, event).is_none() { return },
            }
        }
    }
}

async fn open(dial: &Dial) -> Result<Box<dyn Stream>, String> {
    let tcp =
        TcpStream::connect((dial.broker.host.as_str(), dial.broker.port)).await.map_err(|e| e.to_string())?;
    if !dial.broker.tls {
        return Ok(Box::new(tcp));
    }
    let config = crate::https::tls_config(&dial.roots).map_err(|e| e.to_string())?;
    let name = ServerName::try_from(dial.broker.host.clone()).map_err(|e| e.to_string())?;
    let tls = TlsConnector::from(Arc::new(config)).connect(name, tcp).await.map_err(|e| e.to_string())?;
    Ok(Box::new(tls))
}

/// Dials and reads the CONNACK; the will goes with the CONNECT.
async fn handshake(dial: &Dial, will: &Publish) -> Result<Box<dyn Stream>, String> {
    let mut stream = open(dial).await?;
    let connect = wire::connect(&wire::Connect {
        client_id: &dial.client_id,
        keep_alive_secs: KEEP_ALIVE_SECS,
        username: dial.username.as_deref(),
        password: dial.password.as_deref(),
        will,
    });
    stream.write_all(&connect).await.map_err(|e| e.to_string())?;
    match wire::read_connack(&mut stream).await.map_err(|e| e.to_string())? {
        0 => Ok(stream),
        code => Err(format!("broker refused the connection, CONNACK code {code}")),
    }
}

async fn send(out: &mut WriteHalf<Box<dyn Stream>>, publishes: &[Publish]) -> std::io::Result<()> {
    for p in publishes {
        out.write_all(&wire::publish(p)).await?;
    }
    out.flush().await
}

/// Reads until the connection fails: PINGRESP is all a publish-only client is sent.
async fn drain(mut input: ReadHalf<Box<dyn Stream>>) -> std::io::Error {
    loop {
        if let Err(error) = wire::read(&mut input).await {
            return error;
        }
    }
}

/// Readings that arrive while dialling queue in the bridge; returns once stopped.
async fn queue(bridge: &mut Bridge, feeds: &mut Feeds) {
    while apply(bridge, feeds.next().await).is_some() {}
}

/// The stream once the broker accepted it; `None` when stopped while dialling.
async fn dial_queueing(
    dial: &Dial,
    bridge: &mut Bridge,
    feeds: &mut Feeds,
) -> Option<Result<Box<dyn Stream>, String>> {
    let will = bridge.will();
    tokio::select! {
        opened = tokio::time::timeout(CONNECT_TIMEOUT, handshake(dial, &will)) => {
            Some(opened.unwrap_or_else(|_| Err("no answer in time".into())))
        }
        () = queue(bridge, feeds) => None,
    }
}

async fn session(dial: &Dial, bridge: &mut Bridge, feeds: &mut Feeds) -> Ended {
    let broker = &dial.broker;
    match dial_queueing(dial, bridge, feeds).await {
        None => Ended::Stopped,
        Some(Ok(stream)) => {
            log_connected(broker);
            let (input, mut out) = tokio::io::split(stream);
            publishing(bridge, feeds, &mut out, drain(input)).await
        }
        Some(Err(error)) => {
            log_unreachable(broker, &error);
            Ended::Lost { connected: false }
        }
    }
}

/// `offline`, then DISCONNECT, so the broker does not fire the will.
async fn close(out: &mut WriteHalf<Box<dyn Stream>>, bridge: &mut Bridge) {
    let closed = send(out, &bridge.close()).await;
    if closed.is_ok() && out.write_all(&wire::DISCONNECT).await.is_ok() {
        out.shutdown().await.ok();
    }
}

enum Step {
    Lost(std::io::Error),
    Ping,
    Event(Event),
}

async fn step(
    lost: Pin<&mut impl Future<Output = std::io::Error>>,
    ping: &mut Interval,
    feeds: &mut Feeds,
) -> Step {
    tokio::select! {
        error = lost => Step::Lost(error),
        _ = ping.tick() => Step::Ping,
        event = feeds.next() => Step::Event(event),
    }
}

async fn publishing(
    bridge: &mut Bridge,
    feeds: &mut Feeds,
    out: &mut WriteHalf<Box<dyn Stream>>,
    lost: impl Future<Output = std::io::Error>,
) -> Ended {
    let mut lost = std::pin::pin!(lost);
    let mut ping = tokio::time::interval(Duration::from_secs(u64::from(KEEP_ALIVE_SECS) / 2));
    ping.tick().await;
    let mut sent = send(out, &bridge.connected()).await;
    while sent.is_ok() {
        sent = match step(lost.as_mut(), &mut ping, feeds).await {
            Step::Lost(error) => Err(error),
            Step::Ping => out.write_all(&wire::PINGREQ).await,
            Step::Event(event) => {
                let Some(publishes) = apply(bridge, event) else {
                    close(out, bridge).await;
                    return Ended::Stopped;
                };
                send(out, &publishes).await
            }
        };
    }
    if let Err(error) = sent {
        log_lost(&error);
    }
    Ended::Lost { connected: true }
}

fn log_connected(broker: &Broker) {
    tracing::info!(host = %broker.host, port = broker.port, "MQTT export connected");
}

fn log_unreachable(broker: &Broker, error: &str) {
    tracing::warn!(host = %broker.host, port = broker.port, %error, "MQTT broker unreachable");
}

fn log_lost(error: &std::io::Error) {
    tracing::warn!(%error, "MQTT connection lost");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_backoff_doubles_from_one_second_to_a_one_minute_cap_within_its_upper_half() {
        let ms = |attempt, jitter| backoff(attempt, jitter).as_millis();
        assert_eq!([ms(0, 0.0), ms(1, 0.0), ms(2, 0.0), ms(5, 0.0)], [500, 1_000, 2_000, 16_000]);
        assert_eq!([ms(5, 0.999_999), ms(6, 0.0), ms(6, 0.999_999)], [31_999, 30_000, 59_999]);
        assert_eq!([ms(u32::MAX, 0.0), ms(40, 2.0), ms(0, -1.0)], [30_000, 60_000, 500]);
    }

    #[test]
    fn a_link_logs_its_broker_and_never_its_password() {
        let dial = Dial {
            broker: Broker { tls: false, host: "b".into(), port: 1883 },
            client_id: "c".into(),
            username: Some("u".into()),
            password: Some("s3cret".into()),
            roots: Vec::new(),
        };
        let shown =
            format!("{:?}", Link { dial, pause: Arc::new(|_| Box::pin(std::future::ready(()))), jitter });
        assert!(shown.contains("1883") && shown.contains("\"u\"") && !shown.contains("s3cret"), "{shown}");
    }

    #[test]
    fn the_jitter_draws_vary_inside_zero_to_one() {
        let draws: Vec<f64> = (0..64).map(|_| jitter()).collect();
        assert!(draws.iter().all(|d| (0.0..1.0).contains(d)), "{draws:?}");
        assert!(draws.windows(2).any(|w| w[0].to_bits() != w[1].to_bits()));
    }
}
