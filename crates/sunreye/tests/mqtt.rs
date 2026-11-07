//! The MQTT export against an in-process MQTT 3.1.1 broker written for the test: what reaches the wire,
//! that nothing is subscribed, and that publishing resumes after the broker goes away and returns.

#![allow(clippy::expect_used, clippy::panic, reason = "helpers outside #[test] fns may panic like the tests")]

mod support;

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use sunreye::forecast::Forecast;
use sunreye::mqtt::bridge::Bridge;
use sunreye::mqtt::config::Broker;
use sunreye::mqtt::discovery::{HaDevice, Names, Namespace};
use sunreye::mqtt::link::{self, Dial, Feeds, Link, Open, Pause};
use sunreye::samples::Sample;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, DuplexStream};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{Notify, mpsc, watch};
use tokio_rustls::TlsAcceptor;

/// What the broker saw, in order.
#[derive(Debug, Clone, PartialEq)]
enum Seen {
    Connect {
        client_id: String,
        keep_alive: u16,
        will: (String, String, bool),
        user: Option<String>,
        password: Option<String>,
    },
    Publish {
        topic: String,
        payload: String,
        retain: bool,
    },
    Disconnect,
    /// Any other packet type, SUBSCRIBE (8) among them.
    Other(u8),
}

struct TestBroker {
    port: u16,
    seen: mpsc::UnboundedReceiver<Seen>,
    saw: mpsc::UnboundedSender<Seen>,
    /// While false, a CONNECT is answered by closing the socket.
    up: Arc<AtomicBool>,
    /// Closes every open connection.
    kick: Arc<Notify>,
    /// While true, PINGREQ goes unanswered: a half-open connection.
    deaf: Arc<AtomicBool>,
}

async fn take<R: AsyncRead + Unpin>(input: &mut R) -> Option<(u8, Vec<u8>)> {
    let first = input.read_u8().await.ok()?;
    let (mut length, mut shift) = (0usize, 0);
    loop {
        let byte = input.read_u8().await.ok()?;
        length += usize::from(byte & 0x7F) << shift;
        shift += 7;
        if byte & 0x80 == 0 {
            break;
        }
    }
    let mut body = vec![0; length];
    input.read_exact(&mut body).await.ok()?;
    Some((first, body))
}

/// Reads a length-prefixed string at `at`.
fn text(body: &[u8], at: &mut usize) -> String {
    let n = usize::from(u16::from_be_bytes([body[*at], body[*at + 1]]));
    let s = String::from_utf8(body[*at + 2..*at + 2 + n].to_vec()).expect("utf-8");
    *at += 2 + n;
    s
}

fn connect(body: &[u8]) -> Seen {
    assert_eq!(&body[..7], b"\0\x04MQTT\x04", "MQTT 3.1.1");
    let flags = body[7];
    assert_eq!(flags & 0b0001_1010, 0b0000_0010, "clean session, QoS 0 will");
    let keep_alive = u16::from_be_bytes([body[8], body[9]]);
    let mut at = 10;
    let client_id = text(body, &mut at);
    assert!(flags & 0b100 != 0, "a will is declared");
    let will = (text(body, &mut at), text(body, &mut at), flags & 0b10_0000 != 0);
    let user = (flags & 0x80 != 0).then(|| text(body, &mut at));
    let password = (flags & 0x40 != 0).then(|| text(body, &mut at));
    Seen::Connect { client_id, keep_alive, will, user, password }
}

fn publish(first: u8, body: &[u8]) -> Seen {
    assert_eq!(first & 0b0110, 0, "QoS 0");
    let mut at = 0;
    let topic = text(body, &mut at);
    Seen::Publish {
        topic,
        payload: String::from_utf8(body[at..].to_vec()).expect("utf-8"),
        retain: first & 1 == 1,
    }
}

async fn session<S: AsyncRead + AsyncWrite + Unpin>(
    mut stream: S,
    seen: mpsc::UnboundedSender<Seen>,
    up: bool,
    (kick, deaf): (Arc<Notify>, Arc<AtomicBool>),
) {
    let Some((0x10, body)) = take(&mut stream).await else { return };
    seen.send(connect(&body)).ok();
    if !up {
        return;
    }
    stream.write_all(&[0x20, 2, 0, 0]).await.expect("connack");
    loop {
        let packet = tokio::select! {
            packet = take(&mut stream) => packet,
            () = kick.notified() => return,
        };
        let Some((first, body)) = packet else { return };
        let event = match first >> 4 {
            3 => publish(first, &body),
            12 if deaf.load(Ordering::SeqCst) => continue,
            12 => {
                stream.write_all(&[0xD0, 0]).await.ok();
                continue;
            }
            14 => Seen::Disconnect,
            other => Seen::Other(other),
        };
        seen.send(event).ok();
    }
}

async fn serve(
    tls: Option<TlsAcceptor>,
    tcp: TcpStream,
    seen: mpsc::UnboundedSender<Seen>,
    up: bool,
    kick: (Arc<Notify>, Arc<AtomicBool>),
) {
    match tls {
        None => session(tcp, seen, up, kick).await,
        Some(acceptor) => {
            if let Ok(stream) = acceptor.accept(tcp).await {
                session(stream, seen, up, kick).await;
            }
        }
    }
}

async fn start_broker(tls: Option<TlsAcceptor>) -> TestBroker {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let port = listener.local_addr().expect("addr").port();
    let (saw, seen) = mpsc::unbounded_channel();
    let tx = saw.clone();
    let up = Arc::new(AtomicBool::new(true));
    let kick = Arc::new(Notify::new());
    let deaf = Arc::new(AtomicBool::new(false));
    let (is_up, kicks, deafened) = (Arc::clone(&up), Arc::clone(&kick), Arc::clone(&deaf));
    tokio::spawn(async move {
        while let Ok((tcp, _)) = listener.accept().await {
            let (tx, up) = (tx.clone(), is_up.load(Ordering::SeqCst));
            let kick = (Arc::clone(&kicks), Arc::clone(&deafened));
            tokio::spawn(serve(tls.clone(), tcp, tx, up, kick));
        }
    });
    TestBroker { port, seen, saw, up, kick, deaf }
}

impl TestBroker {
    async fn next(&mut self) -> Seen {
        tokio::time::timeout(Duration::from_secs(20), self.seen.recv())
            .await
            .expect("broker idle")
            .expect("open")
    }

    /// Everything up to and including the publish to `topic`.
    async fn until_topic(&mut self, topic: &str) -> Vec<Seen> {
        self.until(|t, _| t == topic).await
    }

    /// Everything up to and including the first publish whose topic and payload `wanted` accepts; the deadline
    /// fails a wait that other publishes keep alive.
    async fn until(&mut self, wanted: impl Fn(&str, &str) -> bool) -> Vec<Seen> {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(20);
        let mut got: Vec<Seen> = Vec::new();
        loop {
            let Ok(seen) = tokio::time::timeout_at(deadline, self.next()).await else {
                panic!("never published; last seen: {:?}", &got[got.len().saturating_sub(5)..])
            };
            let done = matches!(&seen, Seen::Publish { topic, payload, .. } if wanted(topic, payload));
            got.push(seen);
            if done {
                return got;
            }
        }
    }

    /// Everything up to and including the DISCONNECT.
    async fn until_disconnect(&mut self) -> Vec<Seen> {
        let mut got = Vec::new();
        while got.last() != Some(&Seen::Disconnect) {
            got.push(self.next().await);
        }
        got
    }

    /// Connections over an in-memory pipe: paused time then waits on no socket.
    fn piped(&self) -> Open {
        let (saw, up) = (self.saw.clone(), Arc::clone(&self.up));
        let kick = (Arc::clone(&self.kick), Arc::clone(&self.deaf));
        pipe(move |far| {
            drop(tokio::spawn(session(far, saw.clone(), up.load(Ordering::SeqCst), kick.clone())));
        })
    }

    fn go_away(&self) {
        self.up.store(false, Ordering::SeqCst);
        self.kick.notify_waiters();
    }
}

fn catalog() -> Vec<sunreye::manifest::ManifestMetric> {
    let bundle = sunreye::profile::Bundle::official().expect("bundle");
    let profile = bundle.profile("deye-sg05lp3").expect("profile");
    sunreye::manifest::manifest(profile).metrics
}

fn bridge(discovery: bool) -> Bridge {
    let ns = Namespace { plant_slug: "haus-sud".into(), device_slug: "1".into() };
    let device = HaDevice::new(&ns, "deye-sg05lp3", "Deye SG05LP3", "Deye");
    Bridge::new(Names::new(ns, "sunreye", "homeassistant", device), catalog(), discovery)
}

/// Each backoff the link asks for, and a gate it waits at until the test opens it.
fn gated_pause() -> (Pause, mpsc::UnboundedReceiver<Duration>, Arc<Notify>) {
    let (asked, asks) = mpsc::unbounded_channel();
    let gate = Arc::new(Notify::new());
    let opens = Arc::clone(&gate);
    let pause: Pause = Arc::new(move |delay| {
        asked.send(delay).ok();
        let opens = Arc::clone(&opens);
        Box::pin(async move { opens.notified().await })
    });
    (pause, asks, gate)
}

struct Running {
    samples: watch::Sender<Option<Arc<Sample>>>,
    stop: watch::Sender<bool>,
    task: tokio::task::JoinHandle<()>,
}

fn spawn(dial: Dial, open: Open, pause: Pause, bridge: Bridge) -> Running {
    let (samples, samples_rx) = watch::channel(None);
    let (_forecast, forecast_rx) = watch::channel::<Option<Arc<Forecast>>>(None);
    let (stop, stop_rx) = watch::channel(false);
    let feeds = Feeds { samples: samples_rx, forecast: forecast_rx, stop: stop_rx };
    let task = tokio::spawn(link::run(Link { dial, open, pause, jitter: || 0.5 }, bridge, feeds));
    Running { samples, stop, task }
}

fn dial(port: u16, tls: bool) -> Dial {
    Dial {
        broker: Broker { tls, host: "localhost".into(), port },
        client_id: "sunreye-haus-sud-1".into(),
        username: None,
        password: None,
        roots: Vec::new(),
    }
}

fn reading(soc: f64, power: f64) -> Arc<Sample> {
    Arc::new(Sample { at_ms: 0, values: vec![("battery.soc".into(), soc), ("dc.pv1.power".into(), power)] })
}

async fn asked_for(asked: &mut mpsc::UnboundedReceiver<Duration>) -> Duration {
    tokio::time::timeout(Duration::from_secs(600), asked.recv()).await.expect("backoff").expect("open")
}

fn assert_first_connect(first: &[Seen]) {
    let Seen::Connect { client_id, keep_alive, will, user, password } = &first[0] else {
        panic!("{first:?}")
    };
    assert_eq!(client_id, "sunreye-haus-sud-1");
    assert!(*keep_alive > 0);
    assert_eq!(will, &("sunreye/haus-sud/1/status".into(), "offline".into(), true));
    assert_eq!((user, password), (&None, &None));
    assert_eq!(publishes(first), [("sunreye/haus-sud/1/status", "online")]);
}

fn publishes(seen: &[Seen]) -> Vec<(&str, &str)> {
    seen.iter()
        .filter_map(|s| match s {
            Seen::Publish { topic, payload, .. } => Some((topic.as_str(), payload.as_str())),
            _ => None,
        })
        .collect()
}

#[tokio::test]
async fn mqtt_publishing_resumes_after_the_broker_goes_away_and_returns_with_only_the_latest_readings() {
    let mut broker = start_broker(None).await;
    let (pause, mut asked, gate) = gated_pause();
    let link = spawn(dial(broker.port, false), link::network(), pause, bridge(false));

    let first = broker.until_topic("sunreye/haus-sud/1/status").await;
    assert_first_connect(&first);

    link.samples.send_replace(Some(reading(40.0, 100.0)));
    let live = broker.until_topic("sunreye/haus-sud/1/battery/soc").await;
    assert_eq!(
        publishes(&live),
        [("sunreye/haus-sud/1/dc/pv1/power", "100"), ("sunreye/haus-sud/1/battery/soc", "40")],
        "catalog order"
    );

    broker.go_away();
    let first_wait = asked_for(&mut asked).await;
    for n in 0..1_000 {
        link.samples.send_replace(Some(reading(50.0, f64::from(n))));
        tokio::task::yield_now().await;
    }
    gate.notify_one();
    assert!(matches!(broker.next().await, Seen::Connect { .. }), "a refused redial");
    let second_wait = asked_for(&mut asked).await;
    assert!(second_wait > first_wait, "{first_wait:?} then {second_wait:?}");

    broker.up.store(true, Ordering::SeqCst);
    gate.notify_one();
    assert!(matches!(broker.next().await, Seen::Connect { .. }));
    let resumed = broker.until_topic("sunreye/haus-sud/1/dc/pv1/power").await;
    assert_eq!(
        publishes(&resumed),
        [
            ("sunreye/haus-sud/1/status", "online"),
            ("sunreye/haus-sud/1/battery/soc", "50"),
            ("sunreye/haus-sud/1/dc/pv1/power", "999"),
        ],
        "one publish per state topic, the latest"
    );

    link.stop.send_replace(true);
    link.task.await.expect("link");
    let closing = broker.until_disconnect().await;
    let offline =
        Seen::Publish { topic: "sunreye/haus-sud/1/status".into(), payload: "offline".into(), retain: true };
    assert_eq!(closing, [offline, Seen::Disconnect]);
    let everything = [first, live, resumed, closing].concat();
    assert!(
        !everything.iter().any(|s| matches!(s, Seen::Other(_))),
        "no SUBSCRIBE or other packet: {everything:?}"
    );
}

#[tokio::test]
async fn mqtts_presents_the_credentials_over_a_verified_certificate() {
    let ca = support::Ca::new("test broker CA");
    let mut broker = start_broker(Some(support::acceptor(ca.leaf("localhost")))).await;
    let (pause, mut asked, _gate) = gated_pause();
    let mut secured = dial(broker.port, true);
    secured.username = Some("mqtt".into());
    secured.password = Some("s3cret".into());
    let untrusted = spawn(secured.clone(), link::network(), Arc::clone(&pause), bridge(true));
    asked_for(&mut asked).await;
    assert!(broker.seen.try_recv().is_err(), "no CONNECT before the certificate is trusted");
    untrusted.stop.send_replace(true);
    untrusted.task.await.expect("link");

    secured.roots = vec![ca.root()];
    let link = spawn(secured, link::network(), pause, bridge(true));
    let seen = broker.until_topic("homeassistant/sensor/sunreye_haus-sud_1/forecast_usable/config").await;
    let Seen::Connect { user, password, .. } = &seen[0] else { panic!("{seen:?}") };
    assert_eq!((user.as_deref(), password.as_deref()), (Some("mqtt"), Some("s3cret")));
    assert_eq!(publishes(&seen)[0], ("sunreye/haus-sud/1/status", "online"));
    assert_eq!(publishes(&seen).len(), 2 + catalog().len() + 1, "online, every sensor, both forecasts");
    link.stop.send_replace(true);
    link.task.await.expect("link");
}

#[tokio::test]
async fn mqtt_retries_a_refused_connack_after_a_backoff() {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let port = listener.local_addr().expect("addr").port();
    tokio::spawn(async move {
        while let Ok((mut tcp, _)) = listener.accept().await {
            take(&mut tcp).await;
            tcp.write_all(&[0x20, 2, 0, 5]).await.ok();
        }
    });
    let (pause, mut asked, gate) = gated_pause();
    let link = spawn(dial(port, false), link::network(), pause, bridge(false));
    let first = asked_for(&mut asked).await;
    gate.notify_one();
    let second = asked_for(&mut asked).await;
    assert_eq!((first, second), (Duration::from_millis(750), Duration::from_millis(1_500)));
    link.stop.send_replace(true);
    link.task.await.expect("link");
}

/// How a scripted broker treats one connection.
#[derive(Clone, Copy)]
enum Script {
    /// Reads the CONNECT and never answers.
    Silent,
    /// Accepts, then never reads again.
    Stalled,
    /// Accepts, answers PINGREQ, and closes after this long.
    Open(Duration),
}

/// Dials that reach `serve` over an in-memory pipe holding 64 bytes, so a broker that stops reading
/// blocks the next write.
fn pipe(serve: impl Fn(DuplexStream) + Send + Sync + 'static) -> Open {
    Arc::new(move |_| {
        let (near, far) = tokio::io::duplex(64);
        serve(far);
        Box::pin(std::future::ready(Ok(Box::new(near) as Box<dyn link::Stream>)))
    })
}

/// A broker treating its nth connection by `scripts[n]`, the last repeating.
fn scripted(scripts: Vec<Script>) -> Open {
    let dialled = std::sync::atomic::AtomicUsize::new(0);
    pipe(move |far| {
        let n = dialled.fetch_add(1, Ordering::SeqCst);
        drop(tokio::spawn(play(far, scripts[n.min(scripts.len() - 1)])));
    })
}

async fn play(mut far: DuplexStream, script: Script) {
    take(&mut far).await;
    let Script::Open(open) = script else {
        if matches!(script, Script::Stalled) {
            far.write_all(&[0x20, 2, 0, 0]).await.ok();
        }
        return std::future::pending().await;
    };
    far.write_all(&[0x20, 2, 0, 0]).await.ok();
    let answering = async {
        while let Some((first, _)) = take(&mut far).await {
            if first >> 4 == 12 {
                far.write_all(&[0xD0, 0]).await.ok();
            }
        }
    };
    tokio::time::timeout(open, answering).await.ok();
}

#[tokio::test(start_paused = true)]
async fn mqtt_redials_when_the_broker_never_answers_the_connect() {
    let (pause, mut asked, _gate) = gated_pause();
    let started = tokio::time::Instant::now();
    let link = spawn(dial(0, false), scripted(vec![Script::Silent]), pause, bridge(false));
    asked_for(&mut asked).await;
    let waited = started.elapsed();
    assert!(waited >= Duration::from_secs(10) && waited < Duration::from_secs(11), "{waited:?}");
    link.stop.send_replace(true);
    link.task.await.expect("link");
}

/// More readings than the pipe holds, each given a turn to go out.
async fn flood(link: &Running) {
    for n in 0..20_000 {
        link.samples.send_replace(Some(reading(50.0, f64::from(n))));
        tokio::task::yield_now().await;
    }
}

#[tokio::test(start_paused = true)]
async fn mqtt_drops_a_stalled_broker_after_the_write_timeout_and_stops_while_writing() {
    let (pause, mut asked, gate) = gated_pause();
    let link = spawn(dial(0, false), scripted(vec![Script::Stalled]), pause, bridge(false));
    flood(&link).await;
    let stalled = tokio::time::Instant::now();
    asked_for(&mut asked).await;
    let waited = stalled.elapsed();
    assert!(waited >= Duration::from_secs(60) && waited < Duration::from_secs(61), "{waited:?}");

    gate.notify_one();
    flood(&link).await;
    link.stop.send_replace(true);
    tokio::time::timeout(Duration::from_secs(5), link.task)
        .await
        .expect("stopped while stalled")
        .expect("link");
}

#[tokio::test(start_paused = true)]
async fn mqtt_gives_up_saying_offline_to_a_stalled_broker_after_the_close_timeout() {
    let (pause, _asked, _gate) = gated_pause();
    let link = spawn(dial(0, false), scripted(vec![Script::Stalled]), pause, bridge(false));
    for _ in 0..100 {
        tokio::task::yield_now().await;
    }
    let stopped = tokio::time::Instant::now();
    link.stop.send_replace(true);
    tokio::time::timeout(Duration::from_secs(60), link.task).await.expect("closed").expect("link");
    let waited = stopped.elapsed();
    assert!(waited >= Duration::from_secs(5) && waited < Duration::from_secs(6), "{waited:?}");
}

#[tokio::test(start_paused = true)]
async fn mqtt_backoff_resets_only_after_a_session_that_outlived_the_keep_alive() {
    let flap = Script::Open(Duration::ZERO);
    let secs = |s| Script::Open(Duration::from_secs(s));
    let broker =
        scripted(vec![flap, flap, flap, Script::Open(Duration::from_millis(59_500)), secs(60), flap]);
    let (pause, mut asked, gate) = gated_pause();
    let link = spawn(dial(0, false), broker, pause, bridge(false));
    let mut delays = Vec::new();
    for _ in 0..12 {
        delays.push(asked_for(&mut asked).await.as_millis());
        gate.notify_one();
    }
    assert_eq!(delays, [750, 1_500, 3_000, 6_000, 750, 1_500, 3_000, 6_000, 12_000, 24_000, 45_000, 45_000]);
    link.stop.send_replace(true);
    link.task.await.expect("link");
}

#[tokio::test(start_paused = true)]
async fn mqtt_drops_a_session_whose_broker_stops_answering_and_republishes_its_latest_readings() {
    let mut broker = start_broker(None).await;
    broker.deaf.store(true, Ordering::SeqCst);
    let (pause, mut asked, gate) = gated_pause();
    let link = spawn(dial(broker.port, false), broker.piped(), pause, bridge(false));
    broker.until_topic("sunreye/haus-sud/1/status").await;
    let connected = tokio::time::Instant::now();
    link.samples.send_replace(Some(reading(40.0, 100.0)));
    broker.until_topic("sunreye/haus-sud/1/battery/soc").await;
    asked_for(&mut asked).await;
    let silent = connected.elapsed();
    assert!(silent >= Duration::from_secs(90) && silent < Duration::from_secs(91), "{silent:?}");

    let soc_only = Sample { at_ms: 0, values: vec![("battery.soc".into(), 50.0)] };
    link.samples.send_replace(Some(Arc::new(soc_only)));
    tokio::task::yield_now().await;
    broker.deaf.store(false, Ordering::SeqCst);
    gate.notify_one();
    let resumed = broker.until_topic("sunreye/haus-sud/1/dc/pv1/power").await;
    assert_eq!(
        publishes(&resumed),
        [
            ("sunreye/haus-sud/1/status", "online"),
            ("sunreye/haus-sud/1/battery/soc", "50"),
            ("sunreye/haus-sud/1/dc/pv1/power", "100"),
        ],
        "what the dead session carried goes out again, latest per topic"
    );

    tokio::time::sleep(Duration::from_secs(300)).await;
    assert!(asked.try_recv().is_err(), "a broker answering PINGREQ keeps the session");
    link.stop.send_replace(true);
    link.task.await.expect("link");
}

/// Each connection's publishes, split at its CONNECT.
fn per_session(seen: &[Seen]) -> Vec<Vec<(&str, &str)>> {
    seen.split(|s| matches!(s, Seen::Connect { .. })).skip(1).map(publishes).collect()
}

#[tokio::test(start_paused = true)]
async fn mqtt_republishes_readings_queued_while_away_after_each_session_that_dies_silent() {
    let mut broker = start_broker(None).await;
    broker.up.store(false, Ordering::SeqCst);
    let (pause, mut asked, gate) = gated_pause();
    let link = spawn(dial(broker.port, false), broker.piped(), pause, bridge(false));
    asked_for(&mut asked).await;
    for n in 0..100 {
        link.samples.send_replace(Some(reading(42.0, f64::from(n) + 24.0)));
        tokio::task::yield_now().await;
    }
    broker.up.store(true, Ordering::SeqCst);
    broker.deaf.store(true, Ordering::SeqCst);
    for _ in 0..2 {
        gate.notify_one();
        asked_for(&mut asked).await;
    }
    broker.deaf.store(false, Ordering::SeqCst);
    gate.notify_one();
    tokio::time::sleep(Duration::from_secs(1)).await;
    link.stop.send_replace(true);
    link.task.await.expect("link");

    let seen = broker.until_disconnect().await;
    let carried = [
        ("sunreye/haus-sud/1/status", "online"),
        ("sunreye/haus-sud/1/battery/soc", "42"),
        ("sunreye/haus-sud/1/dc/pv1/power", "123"),
    ];
    let offline = [("sunreye/haus-sud/1/status", "offline")];
    assert_eq!(
        per_session(&seen),
        [vec![], carried.to_vec(), carried.to_vec(), [&carried[..], &offline[..]].concat()],
        "refused, two silent sessions, a live one: the queue goes out once per session, latest per topic"
    );
}

fn data_dir(name: &str) -> std::path::PathBuf {
    let dir =
        std::path::Path::new(env!("CARGO_TARGET_TMPDIR")).join(format!("mqtt-{name}-{}", std::process::id()));
    drop(std::fs::remove_dir_all(&dir));
    dir
}

/// A store polling the simulator on `sim_port` every 50 ms and exporting to `broker_port`; the device id.
async fn seed(dir: &std::path::Path, sim_port: u16, broker_port: u16) -> i64 {
    use sunreye::modbus::Transport;
    use sunreye::store::{NewConnection, NewDevice, Store};

    let store = Store::open(dir).await.expect("store");
    store.set_setting("poll.interval_ms", "50").await.expect("interval");
    let connection = NewConnection {
        transport: Transport::Tcp,
        host: "127.0.0.1".into(),
        port: sim_port,
        logger_serial: None,
    };
    let connection = store.add_connection(&connection).await.expect("connection");
    let device = NewDevice { connection_id: connection, profile_id: "deye-sg05lp3".into(), unit_id: 1 };
    let device = store.add_device(&device).await.expect("device");
    store.set_setting("mqtt", &exporting_to(broker_port)).await.expect("mqtt");
    store.close().await;
    device
}

/// The export settings sending to `broker_port`.
fn exporting_to(broker_port: u16) -> String {
    let settings = serde_json::json!({
        "enabled": true, "brokerUrl": format!("mqtt://127.0.0.1:{broker_port}"), "plantSlug": "haus-sud",
        "haDiscoveryEnabled": true, "username": "mqtt", "password": "s3cret"
    });
    settings.to_string()
}

/// No route in the way: the store publishes each write, and the export re-reads the store on any burst of them.
#[tokio::test]
async fn the_export_follows_a_burst_of_store_writes_past_the_ring_to_the_last_broker_written() {
    let oracle = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/oracle");
    let case = sunreye_sim::profile_case(&oracle, "deye-sg05lp3", "ramp").expect("case");
    let sim = sunreye_sim::Simulator::start(case.registers, &[1]).await.expect("sim");
    let mut broker = start_broker(None).await;
    let dir = data_dir("follows");
    let device = seed(&dir, sim.addr.port(), 1).await;
    let core = sunreye::run::Core::open(&dir).await.expect("core");

    for n in 0..40 {
        core.store.set_setting("burst", &n.to_string()).await.expect("burst");
    }
    core.store.set_setting("mqtt", &exporting_to(broker.port)).await.expect("mqtt");
    let seen = broker.until_topic(&format!("sunreye/haus-sud/{device}/battery/soc")).await;
    let Seen::Connect { client_id, .. } = &seen[0] else { panic!("{seen:?}") };
    assert_eq!(client_id, &format!("sunreye-haus-sud-{device}"));
    core.stop().await;
    broker.until_disconnect().await;
    drop(std::fs::remove_dir_all(&dir));
}

#[tokio::test]
async fn the_core_publishes_each_polled_device_to_mqtt_under_the_plant_slug_and_offline_when_it_stops() {
    let oracle = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/oracle");
    let case = sunreye_sim::profile_case(&oracle, "deye-sg05lp3", "ramp").expect("case");
    let sim = sunreye_sim::Simulator::start(case.registers, &[1]).await.expect("sim");
    let mut broker = start_broker(None).await;
    let dir = data_dir("core");
    let device = seed(&dir, sim.addr.port(), broker.port).await;

    let core = sunreye::run::Core::open(&dir).await.expect("core");
    let base = format!("sunreye/haus-sud/{device}");
    let soc = case.readings["battery.soc"];
    let seen = broker.until_topic(&format!("{base}/battery/soc")).await;
    let Seen::Connect { client_id, password, .. } = &seen[0] else { panic!("{seen:?}") };
    assert_eq!(
        (client_id.clone(), password.as_deref()),
        (format!("sunreye-haus-sud-{device}"), Some("s3cret"))
    );
    let published = publishes(&seen);
    assert_eq!(published[0], (format!("{base}/status").as_str(), "online"));
    let config = format!("homeassistant/sensor/sunreye_haus-sud_{device}/battery_soc/config");
    assert!(published.iter().any(|(t, _)| *t == config));
    assert_eq!(published.last().expect("state").1.parse::<f64>().expect("number"), soc);

    core.stop().await;
    let rest = broker.until_disconnect().await;
    let offline = Seen::Publish { topic: format!("{base}/status"), payload: "offline".into(), retain: true };
    assert!(rest.contains(&offline), "{rest:?}");
    assert!(![seen, rest].concat().iter().any(|s| matches!(s, Seen::Other(_))), "nothing subscribed");
    drop(std::fs::remove_dir_all(&dir));
}

fn client_ids(seen: &[Seen]) -> Vec<&str> {
    seen.iter()
        .filter_map(|s| match s {
            Seen::Connect { client_id, .. } => Some(client_id.as_str()),
            _ => None,
        })
        .collect()
}

/// No route in the way: the export re-plans from the roster the store holds after each device write.
#[tokio::test]
async fn the_export_starts_a_device_added_through_the_store_and_stops_one_retired() {
    use sunreye::store::{DeviceEdit, NewDevice};

    let oracle = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/oracle");
    let case = sunreye_sim::profile_case(&oracle, "deye-sg05lp3", "ramp").expect("case");
    let sim = sunreye_sim::Simulator::start(case.registers, &[1, 2]).await.expect("sim");
    let mut broker = start_broker(None).await;
    let dir = data_dir("roster");
    let first = seed(&dir, sim.addr.port(), broker.port).await;
    let core = sunreye::run::Core::open(&dir).await.expect("core");
    broker.until_topic(&format!("sunreye/haus-sud/{first}/battery/soc")).await;

    let connection_id = core.store.devices().await.expect("devices")[0].connection_id;
    let added = NewDevice { connection_id, profile_id: "deye-sg05lp3".into(), unit_id: 2 };
    let added = core.store.add_device(&added).await.expect("add");
    let seen = broker
        .until_topic(&format!("homeassistant/sensor/sunreye_haus-sud_{added}/battery_soc/config"))
        .await;
    assert!(client_ids(&seen).contains(&format!("sunreye-haus-sud-{added}").as_str()), "{seen:?}");

    let retire =
        DeviceEdit { retired_at: Some(Some("2026-11-07T00:00:00Z".into())), ..DeviceEdit::default() };
    assert!(core.store.edit_device(added, &retire).await.expect("retire"));
    let status = format!("sunreye/haus-sud/{added}/status");
    broker.until(|topic, payload| topic == status && payload == "offline").await;
    let rest = broker.until_topic(&format!("sunreye/haus-sud/{first}/battery/soc")).await;
    assert_eq!(client_ids(&rest), [format!("sunreye-haus-sud-{first}")], "{rest:?}");

    core.stop().await;
    drop(std::fs::remove_dir_all(&dir));
}

/// An official profile's file under the id `acme-deye`, named `name`.
fn acme_deye(name: &str) -> sunreye::sources::Installed {
    let (_, mut file) =
        support::official_files().into_iter().find(|(id, _)| id == "deye-sg05lp3").expect("official");
    file["id"] = serde_json::json!("acme-deye");
    file["name"] = serde_json::json!(name);
    sunreye::sources::Installed::validate(file.to_string()).expect("valid profile")
}

/// A re-import changes no setting and no device row, only the installed text the export plans from.
#[tokio::test]
async fn the_export_re_plans_a_device_whose_installed_profile_is_re_imported() {
    use sunreye::sources::import_profile;
    use sunreye::store::DeviceEdit;

    let oracle = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/oracle");
    let case = sunreye_sim::profile_case(&oracle, "deye-sg05lp3", "ramp").expect("case");
    let sim = sunreye_sim::Simulator::start(case.registers, &[1]).await.expect("sim");
    let mut broker = start_broker(None).await;
    let dir = data_dir("reimport");
    let device = seed(&dir, sim.addr.port(), broker.port).await;
    let core = sunreye::run::Core::open(&dir).await.expect("core");
    let config = format!("homeassistant/sensor/sunreye_haus-sud_{device}/battery_soc/config");
    broker.until_topic(&config).await;

    import_profile(&core.store, &acme_deye("Acme One")).await.expect("import");
    let edit = DeviceEdit { profile_id: Some("acme-deye".into()), ..DeviceEdit::default() };
    assert!(core.store.edit_device(device, &edit).await.expect("re-profile"));
    broker.until(|topic, payload| topic == config && payload.contains("\"Acme One\"")).await;

    import_profile(&core.store, &acme_deye("Acme Two")).await.expect("re-import");
    broker.until(|topic, payload| topic == config && payload.contains("\"Acme Two\"")).await;

    core.stop().await;
    drop(std::fs::remove_dir_all(&dir));
}
