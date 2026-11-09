//! An MQTT 3.1.1 broker on a local port, for tests.
//!
//! It answers every CONNECT with one return code, answers pings, sends retained and published
//! messages to matching subscriptions at `QoS` 0, and closes its sessions on demand.

use std::net::SocketAddr;
use std::sync::{Arc, Mutex, PoisonError};

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{broadcast, mpsc};
use tokio::task::JoinHandle;
use tokio::time::Instant;

/// A CONNECT the broker received, and when.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Connect {
    pub username: Option<String>,
    pub password: Option<String>,
    pub at: Instant,
}

#[derive(Debug)]
pub struct Fake {
    pub address: SocketAddr,
    pub connects: mpsc::UnboundedReceiver<Connect>,
    /// One message per accepted session the client closed.
    pub hung_up: mpsc::UnboundedReceiver<()>,
    /// Every message a client published, in order.
    pub published: mpsc::UnboundedReceiver<Published>,
    close: broadcast::Sender<()>,
    retained: Retained,
    sent: broadcast::Sender<(String, String)>,
    listener: JoinHandle<()>,
}

/// A message a client published.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Published {
    pub topic: String,
    pub payload: String,
    pub retain: bool,
}

/// The retained message of each topic, as (topic, payload).
type Retained = Arc<Mutex<Vec<(String, String)>>>;

impl Fake {
    /// Closes every open session.
    pub fn close(&self) {
        let _closed = self.close.send(());
    }

    /// Stops accepting connections and closes every open session: the broker is gone.
    pub fn shut(&self) {
        self.listener.abort();
        self.close();
    }

    /// Keeps `payload` as `topic`'s retained message, sent to each later subscription, and sends
    /// it to the sessions subscribed now.
    pub fn retain(&self, topic: &str, payload: &str) {
        let mut retained = self.retained.lock().unwrap_or_else(PoisonError::into_inner);
        retained.retain(|(t, _)| t != topic);
        retained.push((topic.to_owned(), payload.to_owned()));
        drop(retained);
        self.publish(topic, payload);
    }

    /// Sends `payload` on `topic` to the sessions subscribed now.
    pub fn publish(&self, topic: &str, payload: &str) {
        let _sent = self.sent.send((topic.to_owned(), payload.to_owned()));
    }
}

/// Serves on a free local port until the runtime stops, answering CONNECT with `code`: 0 accepts,
/// 5 refuses as not authorised.
///
/// # Panics
/// No local port is free.
pub async fn serve(code: u8) -> Fake {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let (sent, connects) = mpsc::unbounded_channel();
    let (hangs_up, hung_up) = mpsc::unbounded_channel();
    let (relay, published) = mpsc::unbounded_channel();
    let (close, _) = broadcast::channel(1);
    let (outgoing, _) = broadcast::channel(64);
    let retained = Retained::default();
    let session_close = close.clone();
    let session_sent = outgoing.clone();
    let session_retained = Arc::clone(&retained);
    let listener = tokio::spawn(async move {
        loop {
            let (socket, _) = listener.accept().await.unwrap();
            let channels = Channels {
                connects: sent.clone(),
                hangs_up: hangs_up.clone(),
                publishes: relay.clone(),
                close: session_close.subscribe(),
                sent: session_sent.subscribe(),
                retained: Arc::clone(&session_retained),
            };
            tokio::spawn(session(socket, code, channels));
        }
    });
    Fake {
        address,
        connects,
        hung_up,
        published,
        close,
        retained,
        sent: outgoing,
        listener,
    }
}

struct Channels {
    connects: mpsc::UnboundedSender<Connect>,
    hangs_up: mpsc::UnboundedSender<()>,
    publishes: mpsc::UnboundedSender<Published>,
    close: broadcast::Receiver<()>,
    sent: broadcast::Receiver<(String, String)>,
    retained: Retained,
}

async fn session(mut socket: TcpStream, code: u8, mut channels: Channels) {
    let Some((0x10, body)) = packet(&mut socket).await else {
        return;
    };
    let _sent = channels.connects.send(connect(&body));
    socket.write_all(&[0x20, 2, 0, code]).await.unwrap();
    if code != 0 {
        return;
    }
    let mut filters: Vec<String> = Vec::new();
    loop {
        tokio::select! {
            read = packet(&mut socket) => match read {
                Some((0xC0, _)) => socket.write_all(&[0xD0, 0]).await.unwrap(),
                Some((0x82, body)) => {
                    let (id, new) = subscribe(&body);
                    let mut ack = vec![0x90, 2 + u8::try_from(new.len()).unwrap()];
                    ack.extend(id.to_be_bytes());
                    ack.extend(std::iter::repeat_n(0, new.len()));
                    socket.write_all(&ack).await.unwrap();
                    let retained = channels
                        .retained
                        .lock()
                        .unwrap_or_else(PoisonError::into_inner)
                        .clone();
                    for (topic, payload) in retained {
                        if new.iter().any(|f| matches(f, &topic)) {
                            socket.write_all(&publish(&topic, &payload, true)).await.unwrap();
                        }
                    }
                    filters.extend(new);
                }
                Some((kind, body)) if kind & 0xF0 == 0x30 => {
                    let _sent = channels.publishes.send(published(kind, &body));
                }
                Some(_) => {}
                None => {
                    let _sent = channels.hangs_up.send(());
                    return;
                }
            },
            Ok((topic, payload)) = channels.sent.recv() => {
                if filters.iter().any(|f| matches(f, &topic)) {
                    socket.write_all(&publish(&topic, &payload, false)).await.unwrap();
                }
            }
            _ = channels.close.recv() => return,
        }
    }
}

/// A client's PUBLISH: its retain flag, then its topic, a packet id above `QoS` 0 and its payload.
fn published(kind: u8, body: &[u8]) -> Published {
    let length = usize::from(u16::from_be_bytes([body[0], body[1]]));
    let id = if kind & 0x06 == 0 { 0 } else { 2 };
    Published {
        topic: String::from_utf8(body[2..2 + length].to_vec()).unwrap(),
        payload: String::from_utf8(body[2 + length + id..].to_vec()).unwrap(),
        retain: kind & 0x01 != 0,
    }
}

/// A SUBSCRIBE body's packet id and topic filters, each followed by its `QoS` byte.
fn subscribe(body: &[u8]) -> (u16, Vec<String>) {
    let id = u16::from_be_bytes([body[0], body[1]]);
    let mut rest = &body[2..];
    let mut filters = Vec::new();
    while !rest.is_empty() {
        let length = usize::from(u16::from_be_bytes([rest[0], rest[1]]));
        filters.push(String::from_utf8(rest[2..2 + length].to_vec()).unwrap());
        rest = &rest[3 + length..];
    }
    (id, filters)
}

/// Whether `filter` matches `topic`: equal, or a prefix ending in `/#`. `+` is not served.
fn matches(filter: &str, topic: &str) -> bool {
    filter.strip_suffix("/#").map_or(filter == topic, |prefix| {
        topic
            .strip_prefix(prefix)
            .is_some_and(|rest| rest.starts_with('/'))
    })
}

/// A `QoS` 0 PUBLISH of `payload` on `topic`.
fn publish(topic: &str, payload: &str, retain: bool) -> Vec<u8> {
    let mut body = u16::try_from(topic.len()).unwrap().to_be_bytes().to_vec();
    body.extend(topic.as_bytes());
    body.extend(payload.as_bytes());
    let mut packet = vec![0x30 | u8::from(retain)];
    let mut length = body.len();
    loop {
        let byte = u8::try_from(length % 128).unwrap();
        length /= 128;
        if length == 0 {
            packet.push(byte);
            break;
        }
        packet.push(byte | 0x80);
    }
    packet.extend(body);
    packet
}

/// The next packet's first byte and body; `None` once the socket closes.
async fn packet(socket: &mut TcpStream) -> Option<(u8, Vec<u8>)> {
    let kind = socket.read_u8().await.ok()?;
    let (mut length, mut shift) = (0usize, 0);
    loop {
        let byte = socket.read_u8().await.ok()?;
        length |= usize::from(byte & 0x7F) << shift;
        shift += 7;
        if byte & 0x80 == 0 {
            break;
        }
    }
    let mut body = vec![0; length];
    socket.read_exact(&mut body).await.ok()?;
    Some((kind, body))
}

/// The credentials of a CONNECT body: protocol name, level, flags, keep-alive, then the client id,
/// the will, the username and the password as their flags say.
fn connect(body: &[u8]) -> Connect {
    let flags = body[7];
    let mut rest = &body[10..];
    let mut field = || {
        let length = usize::from(u16::from_be_bytes([rest[0], rest[1]]));
        let value = String::from_utf8(rest[2..2 + length].to_vec()).unwrap();
        rest = &rest[2 + length..];
        value
    };
    let _client = field();
    if flags & 0x04 != 0 {
        let _topic = field();
        let _message = field();
    }
    let username = (flags & 0x80 != 0).then(&mut field);
    let password = (flags & 0x40 != 0).then(&mut field);
    Connect {
        username,
        password,
        at: Instant::now(),
    }
}
