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
use tokio::time::Instant;
use tokio::time::Interval;
use tokio_rustls::TlsConnector;

use super::bridge::{Bridge, Publish};
use super::config::Broker;
use super::wire;
use crate::forecast::Forecast;
use crate::samples::Sample;

const BASE: Duration = Duration::from_secs(1);
const CAP: Duration = Duration::from_secs(60);
pub(super) const KEEP_ALIVE: Duration = Duration::from_secs(60);
/// 1.5 × keep-alive without a packet from the broker: the connection is dead (PINGREQ goes every half).
pub(super) const SILENCE: Duration = Duration::from_secs(90);
/// Bounds the dial, the TLS handshake and the CONNACK.
pub(super) const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// A broker that stops reading fills the socket; past this the connection is dropped.
pub(super) const WRITE_TIMEOUT: Duration = KEEP_ALIVE;
/// Bounds `offline` and DISCONNECT on stop.
pub(super) const CLOSE_TIMEOUT: Duration = Duration::from_secs(5);

/// The delay before redial `attempt` (0 after a session that lasted a keep-alive): doubling from 1 s, capped at 60 s,
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

#[derive(Clone, PartialEq)]
pub struct Dial {
    pub broker: Broker,
    pub client_id: String,
    pub username: Option<String>,
    pub password: Option<String>,
    /// Trusted besides the built-in roots, for a broker behind a private certificate authority.
    pub roots: Vec<CertificateDer<'static>>,
}

/// Opens the byte stream to the broker; [`network`] outside tests.
pub type Open =
    Arc<dyn Fn(&Dial) -> Pin<Box<dyn Future<Output = Result<Box<dyn Stream>, String>> + Send>> + Send + Sync>;

pub fn network() -> Open {
    Arc::new(|dial| {
        let dial = dial.clone();
        Box::pin(async move { open(&dial).await })
    })
}

pub struct Link {
    pub dial: Dial,
    pub open: Open,
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

pub trait Stream: AsyncRead + AsyncWrite + Send + Unpin {}
impl<S: AsyncRead + AsyncWrite + Send + Unpin> Stream for S {}

enum Ended {
    Stopped,
    /// The connection failed or dropped; `stable` when it had lasted a keep-alive.
    Lost {
        stable: bool,
    },
}

/// Runs until `feeds.stop` is set: connected, it publishes; away, it queues in the bridge and redials.
pub async fn run(link: Link, mut bridge: Bridge, mut feeds: Feeds) {
    let mut failures = 0;
    loop {
        match session(&link, &mut bridge, &mut feeds).await {
            Ended::Stopped => return,
            Ended::Lost { stable: true } => failures = 0,
            Ended::Lost { stable: false } => {}
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
pub(super) async fn handshake(link: &Link, will: Option<&Publish>) -> Result<Box<dyn Stream>, String> {
    let dial = &link.dial;
    let mut stream = (link.open)(dial).await?;
    let connect = wire::connect(&wire::Connect {
        client_id: &dial.client_id,
        keep_alive_secs: u16::try_from(KEEP_ALIVE.as_secs()).unwrap_or(u16::MAX),
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

type Out = WriteHalf<Box<dyn Stream>>;

fn encode(publishes: &[Publish]) -> Vec<u8> {
    publishes.iter().flat_map(wire::publish).collect()
}

pub(super) fn timed_out(what: &str) -> std::io::Error {
    std::io::Error::new(std::io::ErrorKind::TimedOut, what)
}

/// `None` once stopped, so a broker that stopped reading never holds up a stop.
async fn write(out: &mut Out, bytes: &[u8], stop: &mut watch::Receiver<bool>) -> Option<std::io::Result<()>> {
    let writing = tokio::time::timeout(WRITE_TIMEOUT, async {
        out.write_all(bytes).await?;
        out.flush().await
    });
    tokio::select! {
        written = writing => Some(written.unwrap_or_else(|_| Err(timed_out("the broker stopped reading")))),
        _ = stop.wait_for(|stopped| *stopped) => None,
    }
}

/// Reads until the connection fails or falls silent: PINGRESP is all a publish-only client is sent.
async fn drain(mut input: ReadHalf<Box<dyn Stream>>) -> std::io::Error {
    loop {
        match tokio::time::timeout(SILENCE, wire::read(&mut input)).await {
            Ok(Ok(_)) => {}
            Ok(Err(error)) => return error,
            Err(_) => return timed_out("no PINGRESP from the broker"),
        }
    }
}

/// Readings that arrive while dialling queue in the bridge; returns once stopped.
async fn queue(bridge: &mut Bridge, feeds: &mut Feeds) {
    while apply(bridge, feeds.next().await).is_some() {}
}

/// The stream once the broker accepted it; `None` when stopped while dialling.
async fn dial_queueing(
    link: &Link,
    bridge: &mut Bridge,
    feeds: &mut Feeds,
) -> Option<Result<Box<dyn Stream>, String>> {
    let will = bridge.will();
    tokio::select! {
        opened = tokio::time::timeout(CONNECT_TIMEOUT, handshake(link, Some(&will))) => {
            Some(opened.unwrap_or_else(|_| Err("no answer in time".into())))
        }
        () = queue(bridge, feeds) => None,
    }
}

async fn session(link: &Link, bridge: &mut Bridge, feeds: &mut Feeds) -> Ended {
    let broker = &link.dial.broker;
    match dial_queueing(link, bridge, feeds).await {
        None => Ended::Stopped,
        Some(Ok(stream)) => {
            log_connected(broker);
            let (input, mut out) = tokio::io::split(stream);
            publishing(bridge, feeds, &mut out, drain(input)).await
        }
        Some(Err(error)) => {
            log_unreachable(broker, &error);
            Ended::Lost { stable: false }
        }
    }
}

/// `offline`, then DISCONNECT, so the broker does not fire the will.
async fn close(out: &mut Out, bridge: &mut Bridge) {
    let mut bytes = encode(&bridge.close());
    bytes.extend_from_slice(&wire::DISCONNECT);
    let closing = async {
        out.write_all(&bytes).await?;
        out.shutdown().await
    };
    tokio::time::timeout(CLOSE_TIMEOUT, closing).await.ok();
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

/// What goes out next; `None` once stopped, after `offline`.
async fn next(bridge: &mut Bridge, out: &mut Out, step: Step) -> Option<std::io::Result<Vec<u8>>> {
    match step {
        Step::Lost(error) => Some(Err(error)),
        Step::Ping => Some(Ok(wire::PINGREQ.to_vec())),
        Step::Event(event) => {
            let Some(publishes) = apply(bridge, event) else {
                close(out, bridge).await;
                return None;
            };
            Some(Ok(encode(&publishes)))
        }
    }
}

async fn publishing(
    bridge: &mut Bridge,
    feeds: &mut Feeds,
    out: &mut Out,
    lost: impl Future<Output = std::io::Error>,
) -> Ended {
    let started = Instant::now();
    let mut lost = std::pin::pin!(lost);
    let mut ping = tokio::time::interval(KEEP_ALIVE / 2);
    ping.tick().await;
    let mut bytes = encode(&bridge.connected());
    let error = loop {
        match write(out, &bytes, &mut feeds.stop).await {
            None => return Ended::Stopped,
            Some(Err(error)) => break error,
            Some(Ok(())) => {}
        }
        bytes = match next(bridge, out, step(lost.as_mut(), &mut ping, feeds).await).await {
            None => return Ended::Stopped,
            Some(Err(error)) => break error,
            Some(Ok(bytes)) => bytes,
        };
    };
    log_lost(&error);
    Ended::Lost { stable: started.elapsed() >= KEEP_ALIVE }
}

fn log_connected(broker: &Broker) {
    tracing::info!(host = %broker.host, port = broker.port, "MQTT export connected");
}

pub(super) fn log_unreachable(broker: &Broker, error: &str) {
    tracing::warn!(host = %broker.host, port = broker.port, %error, "MQTT broker unreachable");
}

pub(super) fn log_lost(error: &std::io::Error) {
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
        let shown = format!(
            "{:?}",
            Link { dial, open: network(), pause: Arc::new(|_| Box::pin(std::future::ready(()))), jitter }
        );
        assert!(shown.contains("1883") && shown.contains("\"u\"") && !shown.contains("s3cret"), "{shown}");
    }

    #[test]
    fn the_jitter_draws_vary_inside_zero_to_one() {
        let draws: Vec<f64> = (0..64).map(|_| jitter()).collect();
        assert!(draws.iter().all(|d| (0.0..1.0).contains(d)), "{draws:?}");
        assert!(draws.windows(2).any(|w| w[0].to_bits() != w[1].to_bits()));
    }
}
