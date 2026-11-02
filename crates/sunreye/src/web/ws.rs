//! `/ws`: the live feed, multiplexed over one socket in the 3.x contract.

use std::sync::Arc;
use std::time::Duration;

use axum::Extension;
use axum::extract::State;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::response::{IntoResponse, Response};
use tokio::time::{Instant, MissedTickBehavior, interval_at, sleep_until, timeout_at};

use super::ApiError;
use crate::live::{
    ClientFrame, Frame, Subscription, Topic, ack_frame, parse_client_frame, resolve_subscribe,
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
}

impl Default for Limits {
    fn default() -> Self {
        Self { ping: Duration::from_secs(30), idle: Duration::from_secs(120), connections: 64 }
    }
}

/// A client frame is a short topic list; anything longer is refused by the socket.
const MAX_CLIENT_MESSAGE: usize = 16 * 1024;
/// tungstenite reserves 128 KiB each way per socket by default; a frame is written as it is sent.
const READ_BUFFER: usize = 4 * 1024;

pub async fn upgrade(
    State(core): State<Arc<Core>>,
    Extension(limits): Extension<Limits>,
    upgrade: WebSocketUpgrade,
) -> Response {
    let subscription = core.live.subscribe();
    if core.live.connections() > limits.connections {
        tracing::warn!(cap = limits.connections, "live connection refused at the cap");
        return ApiError::unavailable("Too many live connections").into_response();
    }
    upgrade
        .max_message_size(MAX_CLIENT_MESSAGE)
        .max_frame_size(MAX_CLIENT_MESSAGE)
        .read_buffer_size(READ_BUFFER)
        .write_buffer_size(0)
        .on_upgrade(move |socket| serve(Peer::new(socket, limits.idle), subscription, limits.ping))
}

/// The socket and the instant it is closed unless the client speaks first.
struct Peer {
    socket: WebSocket,
    idle: Duration,
    deadline: Instant,
}

impl Peer {
    fn new(socket: WebSocket, idle: Duration) -> Self {
        Self { socket, idle, deadline: Instant::now() + idle }
    }

    fn heard(&mut self) {
        self.deadline = Instant::now() + self.idle;
    }

    /// `false` once the socket refuses the write or the deadline passes during it.
    async fn send(&mut self, message: Message) -> bool {
        matches!(timeout_at(self.deadline, self.socket.send(message)).await, Ok(Ok(())))
    }
}

/// Until the client leaves or goes silent, a send fails or the core stops.
async fn serve(mut peer: Peer, mut feed: Subscription, ping: Duration) {
    let mut held: Vec<Topic> = Vec::new();
    let mut pings = interval_at(Instant::now() + ping, ping);
    pings.set_missed_tick_behavior(MissedTickBehavior::Delay);
    loop {
        let step = tokio::select! {
            incoming = peer.socket.recv() => Step::Client(incoming),
            frame = feed.next() => Step::Feed(frame),
            _ = pings.tick() => Step::Ping,
            () = sleep_until(peer.deadline) => Step::Idle,
        };
        if !take(&mut peer, &feed, &mut held, step).await {
            return;
        }
    }
}

enum Step {
    Client(Option<Result<Message, axum::Error>>),
    Feed(Option<Frame>),
    Ping,
    Idle,
}

/// `false` once the connection is done.
async fn take(peer: &mut Peer, feed: &Subscription, held: &mut Vec<Topic>, step: Step) -> bool {
    match step {
        Step::Client(Some(Ok(message))) => receive(peer, feed, held, message).await,
        Step::Client(Some(Err(_)) | None) | Step::Idle => false,
        Step::Feed(frame) => forward(peer, held, frame).await,
        Step::Ping => peer.send(Message::Ping(Vec::new().into())).await,
    }
}

/// Any frame from the client, a pong included, puts the idle deadline back.
async fn receive(peer: &mut Peer, feed: &Subscription, held: &mut Vec<Topic>, message: Message) -> bool {
    peer.heard();
    match message {
        Message::Text(text) => answer(peer, feed, held, &text).await,
        Message::Close(_) => false,
        _ => true,
    }
}

/// Sends a frame on a held topic; closes the socket once the feed is gone.
async fn forward(peer: &mut Peer, held: &[Topic], frame: Option<Frame>) -> bool {
    match frame {
        Some(frame) if held.contains(&frame.topic) => peer.send(Message::Text(frame.text)).await,
        Some(_) => true,
        None => {
            peer.send(Message::Close(None)).await;
            false
        }
    }
}

/// Applies one client frame; `false` once the socket refuses a write. A malformed frame is ignored.
async fn answer(peer: &mut Peer, feed: &Subscription, held: &mut Vec<Topic>, text: &str) -> bool {
    match parse_client_frame(text) {
        Some(ClientFrame::Sub(topics)) => {
            let decision = resolve_subscribe(&topics);
            if !peer.send(Message::Text(ack_frame(&decision).into())).await {
                return false;
            }
            let fresh: Vec<Topic> = decision.subscribe.into_iter().filter(|t| !held.contains(t)).collect();
            held.extend(&fresh);
            match feed.plant().filter(|_| fresh.contains(&Topic::Plant)) {
                Some(snapshot) => peer.send(Message::Text(snapshot)).await,
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
