//! `/ws`: the live feed, multiplexed over one socket in the 3.x contract.

use std::sync::Arc;
use std::time::Duration;

use axum::Extension;
use axum::extract::State;
use axum::extract::ws::{Message, Utf8Bytes, WebSocket, WebSocketUpgrade};
use axum::response::{IntoResponse, Response};
use tokio::sync::watch;
use tokio::time::{Instant, Interval, MissedTickBehavior, interval_at, sleep_until, timeout_at};

use super::ApiError;
use super::auth::AuthSession;
use crate::events::Events;
use crate::live::{
    ClientFrame, MetricsFrame, PlantFrame, Topic, ack_frame, parse_client_frame, resolve_subscribe,
    resolve_unsubscribe,
};
use crate::run::Core;

/// What keeps a dead or stalled connection from holding a task and a socket.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limits {
    /// How often the server pings; a browser answers on its own.
    pub ping: Duration,
    /// A connection the client has sent nothing on, a pong included, for this long is closed, even
    /// mid-send.
    pub idle: Duration,
    /// Open connections at most; an upgrade past it is a 503.
    pub connections: usize,
    /// Of those, at most this many without a session, so strangers cannot lock out the admin.
    pub strangers: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Self { ping: Duration::from_secs(30), idle: Duration::from_secs(120), connections: 64, strangers: 48 }
    }
}

/// A client frame is a short topic list; anything longer is refused by the socket.
const MAX_CLIENT_MESSAGE: usize = 16 * 1024;
/// tungstenite reserves 128 KiB each way per socket by default; a frame is written as it is sent.
const READ_BUFFER: usize = 4 * 1024;

pub async fn upgrade(
    State(core): State<Arc<Core>>,
    Extension(limits): Extension<Limits>,
    auth: AuthSession,
    upgrade: WebSocketUpgrade,
) -> Response {
    let feed = Feed { metrics: core.bus.metrics.subscribe(), plant: core.bus.plant.subscribe() };
    let kiosk = auth.user.is_none().then(|| core.watch_kiosk());
    if core.bus.metrics.subscribers() > limits.connections || core.strangers() > limits.strangers {
        tracing::warn!(stranger = kiosk.is_some(), "live connection refused at the cap");
        return ApiError::unavailable("Too many live connections").into_response();
    }
    upgrade
        .max_message_size(MAX_CLIENT_MESSAGE)
        .max_frame_size(MAX_CLIENT_MESSAGE)
        .read_buffer_size(READ_BUFFER)
        .write_buffer_size(0)
        .on_upgrade(move |socket| serve(Peer::new(socket, limits.idle, kiosk), feed, limits.ping))
}

/// The socket, the instant it is closed unless the client speaks first and, for a stranger, the
/// kiosk view it came in on.
struct Peer {
    socket: WebSocket,
    idle: Duration,
    deadline: Instant,
    kiosk: Option<watch::Receiver<bool>>,
}

impl Peer {
    fn new(socket: WebSocket, idle: Duration, kiosk: Option<watch::Receiver<bool>>) -> Self {
        Self { socket, idle, deadline: Instant::now() + idle, kiosk }
    }

    /// Resolves once a stranger's kiosk view is off; never for a session.
    async fn revoked(kiosk: Option<&mut watch::Receiver<bool>>) {
        let Some(kiosk) = kiosk else { return std::future::pending().await };
        if kiosk.wait_for(|on| !on).await.is_err() {
            std::future::pending::<()>().await;
        }
    }

    fn heard(&mut self) {
        self.deadline = Instant::now() + self.idle;
    }

    /// `false` once the socket refuses the write or the deadline passes during it.
    async fn send(&mut self, message: Message) -> bool {
        matches!(timeout_at(self.deadline, self.socket.send(message)).await, Ok(Ok(())))
    }
}

/// One connection's view of the bus. Holds no sender, so it ends once the core drops the bus.
struct Feed {
    metrics: Events<MetricsFrame>,
    plant: watch::Receiver<Option<PlantFrame>>,
}

/// Until the client leaves or goes silent, a send fails or the core stops.
async fn serve(mut peer: Peer, mut feed: Feed, ping: Duration) {
    let mut held: Vec<Topic> = Vec::new();
    let mut pings = interval_at(Instant::now() + ping, ping);
    pings.set_missed_tick_behavior(MissedTickBehavior::Delay);
    loop {
        let step = next_step(&mut peer, &mut feed, &mut pings).await;
        if !take(&mut peer, &mut feed, &mut held, step).await {
            return;
        }
    }
}

/// Biased: a reading's `metrics` frame is published before its `plant` fold and goes out first.
async fn next_step(peer: &mut Peer, feed: &mut Feed, pings: &mut Interval) -> Step {
    tokio::select! {
        biased;
        incoming = peer.socket.recv() => Step::Client(incoming),
        frame = feed.metrics.next() => Step::Metrics(frame),
        changed = feed.plant.changed() => {
            Step::Plant(changed.ok().and_then(|()| feed.plant.borrow_and_update().clone()))
        }
        _ = pings.tick() => Step::Ping,
        () = sleep_until(peer.deadline) => Step::Idle,
        () = Peer::revoked(peer.kiosk.as_mut()) => Step::Revoked,
    }
}

enum Step {
    Client(Option<Result<Message, axum::Error>>),
    Metrics(Option<MetricsFrame>),
    Plant(Option<PlantFrame>),
    Ping,
    Idle,
    Revoked,
}

/// `false` once the connection is done.
async fn take(peer: &mut Peer, feed: &mut Feed, held: &mut Vec<Topic>, step: Step) -> bool {
    match step {
        Step::Client(Some(Ok(message))) => receive(peer, feed, held, message).await,
        Step::Client(Some(Err(_)) | None) | Step::Idle => false,
        Step::Metrics(frame) => forward(peer, held, Topic::Metrics, frame.map(|frame| frame.0)).await,
        Step::Plant(frame) => forward(peer, held, Topic::Plant, frame.map(|frame| frame.0)).await,
        Step::Ping => peer.send(Message::Ping(Vec::new().into())).await,
        Step::Revoked => {
            peer.send(Message::Close(None)).await;
            false
        }
    }
}

/// Any frame from the client, a pong included, puts the idle deadline back.
async fn receive(peer: &mut Peer, feed: &mut Feed, held: &mut Vec<Topic>, message: Message) -> bool {
    peer.heard();
    match message {
        Message::Text(text) => answer(peer, feed, held, &text).await,
        Message::Close(_) => false,
        _ => true,
    }
}

/// Sends a frame on a held topic; closes the socket once the bus is gone.
async fn forward(peer: &mut Peer, held: &[Topic], topic: Topic, frame: Option<Utf8Bytes>) -> bool {
    match frame {
        Some(text) if held.contains(&topic) => peer.send(Message::Text(text)).await,
        Some(_) => true,
        None => {
            peer.send(Message::Close(None)).await;
            false
        }
    }
}

/// Applies one client frame; `false` once the socket refuses a write. A malformed frame is ignored.
async fn answer(peer: &mut Peer, feed: &mut Feed, held: &mut Vec<Topic>, text: &str) -> bool {
    match parse_client_frame(text) {
        Some(ClientFrame::Sub(topics)) => {
            let decision = resolve_subscribe(&topics);
            if !peer.send(Message::Text(ack_frame(&decision).into())).await {
                return false;
            }
            let fresh: Vec<Topic> = decision.subscribe.into_iter().filter(|t| !held.contains(t)).collect();
            held.extend(&fresh);
            let snapshot = fresh.contains(&Topic::Plant).then(|| feed.plant.borrow_and_update().clone());
            match snapshot.flatten() {
                Some(snapshot) => peer.send(Message::Text(snapshot.0)).await,
                None => true,
            }
        }
        Some(ClientFrame::Unsub(topics)) => {
            let dropped = resolve_unsubscribe(&topics);
            held.retain(|topic| !dropped.contains(topic));
            true
        }
        None => true,
    }
}
