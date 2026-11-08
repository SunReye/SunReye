//! The MQTT oracle (`fixtures/oracle/mqtt.ndjson`) as the export's inputs, and a broker to run a link against.

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use serde_json::Value;
use tokio::io::{AsyncRead, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::{broadcast, mpsc, watch};

use super::bridge::Publish;
use super::link::{Open, Stream};
use super::wire;

use super::discovery::{HaDevice, Namespace};
use crate::manifest::ManifestMetric;
use crate::oracle::oracle;

pub fn cases(prefix: &str) -> Vec<Value> {
    oracle("mqtt.ndjson")
        .into_iter()
        .filter(|case| case["case"].as_str().is_some_and(|name| name.starts_with(prefix)))
        .collect()
}

pub fn case(name: &str) -> Value {
    oracle("mqtt.ndjson").into_iter().find(|case| case["case"] == name).expect("case")
}

pub fn catalog() -> Vec<ManifestMetric> {
    serde_json::from_value(case("catalog/main")["metrics"].clone()).expect("metrics")
}

pub fn text(value: &Value) -> &str {
    value.as_str().expect("string")
}

pub fn namespace(input: &Value) -> Namespace {
    let ns = &input["namespace"];
    Namespace { plant_slug: text(&ns["plantSlug"]).into(), device_slug: text(&ns["deviceSlug"]).into() }
}

/// The input's profile, or the catalog's when the case names none.
pub fn device(input: &Value, ns: &Namespace) -> HaDevice {
    let catalog = case("catalog/main");
    let profile = if input["profile"].is_object() { &input["profile"] } else { &catalog["profile"] };
    HaDevice::new(ns, text(&profile["id"]), text(&profile["name"]), text(&profile["manufacturer"]))
}

/// A packet a client sent the [`FakeBroker`], on its `connection`th connection.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Seen {
    pub connection: usize,
    /// The packet type: 1 CONNECT, 3 PUBLISH, 8 SUBSCRIBE, 12 PINGREQ, 14 DISCONNECT.
    pub kind: u8,
    pub body: Vec<u8>,
}

impl Seen {
    /// A SUBSCRIBE's filters.
    pub fn filters(&self) -> Vec<String> {
        let mut filters = Vec::new();
        let mut at = 2;
        while let Some(length) = self.body.get(at..at + 2) {
            let end = at + 2 + usize::from(u16::from_be_bytes([length[0], length[1]]));
            filters.push(String::from_utf8_lossy(&self.body[at + 2..end]).into_owned());
            at = end + 1;
        }
        filters
    }
}

#[derive(Clone)]
struct Shared {
    retained: Vec<Publish>,
    live: broadcast::Sender<Publish>,
    kick: watch::Sender<usize>,
    seen: mpsc::UnboundedSender<Seen>,
    accepted: Arc<AtomicUsize>,
}

/// An in-process MQTT 3.1.1 broker for tests: answers CONNECT, SUBSCRIBE and PINGREQ, hands each subscriber the
/// retained messages its filters match, and records every packet a client sends.
pub struct FakeBroker {
    shared: Shared,
    packets: mpsc::UnboundedReceiver<Seen>,
    /// Every packet read so far.
    pub log: Vec<Seen>,
}

fn matches(filters: &[String], topic: &str) -> bool {
    filters.iter().any(|filter| match filter.strip_suffix('#') {
        Some(prefix) => topic.starts_with(prefix),
        None => filter == topic,
    })
}

async fn serve<S: AsyncRead + AsyncWrite + Send + 'static>(stream: S, shared: Shared) {
    let connection = shared.accepted.fetch_add(1, Ordering::SeqCst);
    let (mut input, out) = tokio::io::split(stream);
    let (read, packets) = mpsc::unbounded_channel();
    let reader = tokio::spawn(async move {
        while let Ok(packet) = wire::read(&mut input).await {
            if read.send(packet).is_err() {
                return;
            }
        }
    });
    answer(connection, &shared, packets, out).await;
    // The read half closes with its task, so the client reads EOF.
    reader.abort();
}

async fn answer(
    connection: usize,
    shared: &Shared,
    mut packets: mpsc::UnboundedReceiver<(u8, Vec<u8>)>,
    mut out: impl AsyncWrite + Unpin,
) {
    let (mut live, mut kick) = (shared.live.subscribe(), shared.kick.subscribe());
    let mut filters: Vec<String> = Vec::new();
    loop {
        let reply = tokio::select! {
            packet = packets.recv() => {
                let Some((first, body)) = packet else { return };
                let seen = Seen { connection, kind: first >> 4, body };
                shared.seen.send(seen.clone()).ok();
                match seen.kind {
                    1 => vec![wire::CONNACK, 2, 0, 0],
                    8 => {
                        filters.extend(seen.filters());
                        let mut reply = vec![wire::SUBACK, 3, seen.body[0], seen.body[1], 0];
                        let retained = shared.retained.iter().filter(|p| matches(&filters, &p.topic));
                        reply.extend(retained.flat_map(wire::publish));
                        reply
                    }
                    12 => vec![0xD0, 0],
                    14 => return,
                    _ => Vec::new(),
                }
            }
            Ok(publish) = live.recv() => {
                if matches(&filters, &publish.topic) { wire::publish(&publish) } else { Vec::new() }
            }
            _ = kick.changed() => return,
        };
        if out.write_all(&reply).await.is_err() {
            return;
        }
    }
}

impl FakeBroker {
    /// `retained` as `(topic, payload)`, handed to each subscription in this order.
    pub fn new(retained: &[(&str, &str)]) -> Self {
        let (seen, packets) = mpsc::unbounded_channel();
        let retained = retained
            .iter()
            .map(|(topic, payload)| Publish {
                topic: (*topic).into(),
                payload: (*payload).into(),
                retain: true,
            })
            .collect();
        let shared = Shared {
            retained,
            live: broadcast::channel(64).0,
            kick: watch::Sender::new(0),
            seen,
            accepted: Arc::default(),
        };
        Self { shared, packets, log: Vec::new() }
    }

    /// Connections over an in-memory pipe.
    pub fn open(&self) -> Open {
        let shared = self.shared.clone();
        Arc::new(move |_| {
            let (near, far) = tokio::io::duplex(64 * 1024);
            tokio::spawn(serve(far, shared.clone()));
            Box::pin(std::future::ready(Ok(Box::new(near) as Box<dyn Stream>)))
        })
    }

    /// Accepts on a loopback port, for a whole core.
    pub async fn listen(&self) -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let port = listener.local_addr().expect("addr").port();
        let shared = self.shared.clone();
        tokio::spawn(async move {
            while let Ok((tcp, _)) = listener.accept().await {
                tokio::spawn(serve(tcp, shared.clone()));
            }
        });
        port
    }

    /// A live, unretained message to every matching subscription.
    pub fn send(&self, topic: &str, payload: &str) {
        let publish = Publish { topic: topic.into(), payload: payload.into(), retain: false };
        self.shared.live.send(publish).ok();
    }

    /// Closes every open connection.
    pub fn kick(&self) {
        self.shared.kick.send_modify(|n| *n += 1);
    }

    /// Reads packets until one of `kind` arrives; the 20 s deadline only fails the wait.
    pub async fn until(&mut self, kind: u8) -> &Seen {
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(20);
        loop {
            let Ok(Some(seen)) = tokio::time::timeout_at(deadline, self.packets.recv()).await else {
                panic!("no packet of type {kind}; read {:?}", self.log)
            };
            self.log.push(seen);
            if self.log.last().is_some_and(|seen| seen.kind == kind) {
                return self.log.last().expect("seen");
            }
        }
    }
}
