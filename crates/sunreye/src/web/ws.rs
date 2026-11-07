//! `/ws`: the live feed, multiplexed over one socket in the 3.x contract.

use std::sync::Arc;
use std::time::Duration;

use axum::Extension;
use axum::extract::State;
use axum::extract::ws::{CloseFrame, Message, Utf8Bytes, WebSocket, WebSocketUpgrade, close_code};
use axum::response::{IntoResponse, Response};
use tokio::sync::watch;
use tokio::time::{Instant, Interval, MissedTickBehavior, interval_at, sleep_until, timeout_at};
use tower_sessions::SessionStore;
use tower_sessions::cookie::time::OffsetDateTime;
use tower_sessions::session::Id;

use super::ApiError;
use super::auth::AuthSession;
use crate::evcc::EvccState;
use crate::events::{Changed, Events, SessionEnded};
use crate::live::{
    ClientFrame, MetricsFrame, PlantFrame, Topic, ack_frame, evcc_frame, events_frame, parse_client_frame,
    resolve_subscribe, resolve_unsubscribe,
};
use crate::run::Core;
use crate::store::Store;

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
    let feed = Feed {
        metrics: core.bus.metrics.subscribe(),
        plant: core.bus.plant.subscribe(),
        events: core.bus.changed.subscribe(),
        evcc: core.bus.evcc.subscribe(),
    };
    let Some(holder) = holder(&core, &auth).await else {
        return ApiError::unauthorized("Not signed in").into_response();
    };
    if core.bus.metrics.subscribers() > limits.connections || core.strangers() > limits.strangers {
        tracing::warn!(stranger = holder.is_stranger(), "live connection refused at the cap");
        return ApiError::unavailable("Too many live connections").into_response();
    }
    upgrade
        .max_message_size(MAX_CLIENT_MESSAGE)
        .max_frame_size(MAX_CLIENT_MESSAGE)
        .read_buffer_size(READ_BUFFER)
        .write_buffer_size(0)
        .on_upgrade(move |socket| serve(Peer::new(socket, limits.idle, holder), feed, limits.ping))
}

/// `None` for a session that ended since the request was authenticated.
async fn holder(core: &Core, auth: &AuthSession) -> Option<Holder> {
    let (Some(account), Some(id)) = (&auth.user, auth.session.id()) else {
        return Some(Holder::Stranger(core.watch_kiosk()));
    };
    // Bound before this read: a session that ends from here on is re-read by the socket.
    let mut bound = Bound::new(core, id, account.id);
    bound.live().await.then_some(Holder::Session(bound))
}

/// What admitted the socket.
enum Holder {
    /// No session: the kiosk view it came in on.
    Stranger(watch::Receiver<bool>),
    Session(Bound),
}

impl Holder {
    const fn is_stranger(&self) -> bool {
        matches!(self, Self::Stranger(_))
    }

    /// Resolves once a stranger's kiosk view is off, or once a session socket must re-read its session.
    async fn revoked(&mut self) -> Step {
        match self {
            Self::Stranger(kiosk) => {
                if kiosk.wait_for(|on| !on).await.is_err() {
                    std::future::pending::<()>().await;
                }
                Step::Revoked
            }
            Self::Session(bound) => {
                bound.due().await;
                Step::Recheck
            }
        }
    }
}

/// A session socket's session, its account and when the session expires.
struct Bound {
    store: Arc<Store>,
    id: Id,
    account: i64,
    ends: Events<SessionEnded>,
    /// The stored expiry the timer is armed for.
    expires: OffsetDateTime,
    at: Instant,
}

impl Bound {
    /// Due at once: nothing is read yet.
    fn new(core: &Core, id: Id, account: i64) -> Self {
        let ends = core.bus.sessions.subscribe();
        Self {
            store: Arc::clone(&core.store),
            id,
            account,
            ends,
            expires: OffsetDateTime::UNIX_EPOCH,
            at: Instant::now(),
        }
    }

    /// Once any account's session ends (a burst counts once, so a lag loses none) or the armed expiry passes.
    async fn due(&mut self) {
        let ended = async {
            if self.ends.newest().await.is_none() {
                std::future::pending::<()>().await;
            }
        };
        tokio::select! {
            () = ended => {}
            () = sleep_until(self.at) => {}
        }
    }

    /// The session is still stored, unexpired, and its account exists; re-arms the expiry. Past the armed
    /// expiry, only a later stored expiry keeps it. Fails closed on a store error.
    async fn live(&mut self) -> bool {
        let due = Instant::now() >= self.at;
        let stored = self.stored().await.unwrap_or_else(|error| {
            tracing::warn!(%error, "live session check failed; closing");
            None
        });
        let Some(expires) = stored.filter(|expires| !due || *expires > self.expires) else { return false };
        self.arm(expires);
        true
    }

    /// The stored session's expiry; `None` once the session or its account is gone.
    async fn stored(&self) -> Result<Option<OffsetDateTime>, String> {
        let Some(record) = self.store.sessions().load(&self.id).await.map_err(|e| e.to_string())? else {
            return Ok(None);
        };
        let account = self.store.account(self.account).await.map_err(|e| e.to_string())?;
        Ok(account.map(|_| record.expiry_date))
    }

    fn arm(&mut self, expires: OffsetDateTime) {
        let left = Duration::try_from(expires - OffsetDateTime::now_utc()).unwrap_or_default();
        self.expires = expires;
        self.at = Instant::now() + left;
    }
}

/// The socket, the instant it is closed unless the client speaks first, and what admitted it.
struct Peer {
    socket: WebSocket,
    idle: Duration,
    deadline: Instant,
    holder: Holder,
}

impl Peer {
    fn new(socket: WebSocket, idle: Duration, holder: Holder) -> Self {
        Self { socket, idle, deadline: Instant::now() + idle, holder }
    }

    /// Sends the close frame; always `false`, the connection is done.
    async fn close(&mut self) -> bool {
        self.send(Message::Close(None)).await;
        false
    }

    /// Re-reads the session; closes with 1008 once it ended, so the client can tell it from a drop.
    async fn recheck(&mut self) -> bool {
        let Holder::Session(bound) = &mut self.holder else { return true };
        if bound.live().await {
            return true;
        }
        let frame = CloseFrame { code: close_code::POLICY, reason: Utf8Bytes::default() };
        self.send(Message::Close(Some(frame))).await;
        false
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
    events: Events<Changed>,
    evcc: watch::Receiver<Option<EvccState>>,
}

impl Feed {
    /// Biased: a reading's `metrics` frame is published before its `plant` fold and goes out first.
    async fn next(&mut self) -> Step {
        tokio::select! {
            biased;
            frame = self.metrics.next() => Step::Metrics(frame),
            state = latest(&mut self.plant) => Step::Plant(state),
            changed = self.events.next() => Step::Events(changed),
            state = latest(&mut self.evcc) => Step::Evcc(state),
        }
    }
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

/// Biased, control first: a ready bus cannot hold back kiosk-off, a session end, the idle close or the ping.
async fn next_step(peer: &mut Peer, feed: &mut Feed, pings: &mut Interval) -> Step {
    // A new sleep already past its deadline fires only once the timer driver turns; a ready feed would go first.
    if Instant::now() >= peer.deadline {
        return Step::Idle;
    }
    tokio::select! {
        biased;
        step = peer.holder.revoked() => step,
        () = sleep_until(peer.deadline) => Step::Idle,
        _ = pings.tick() => Step::Ping,
        incoming = peer.socket.recv() => Step::Client(incoming),
        step = feed.next() => step,
    }
}

/// The state topic's next value; `None` once the topic is gone.
async fn latest<T: Clone>(topic: &mut watch::Receiver<Option<T>>) -> Option<T> {
    topic.changed().await.ok()?;
    topic.borrow_and_update().clone()
}

enum Step {
    Client(Option<Result<Message, axum::Error>>),
    Metrics(Option<MetricsFrame>),
    Plant(Option<PlantFrame>),
    Events(Option<Changed>),
    Evcc(Option<EvccState>),
    Ping,
    Idle,
    Revoked,
    Recheck,
}

/// `false` once the connection is done.
async fn take(peer: &mut Peer, feed: &mut Feed, held: &mut Vec<Topic>, step: Step) -> bool {
    match step {
        Step::Client(Some(Ok(message))) => receive(peer, feed, held, message).await,
        Step::Client(Some(Err(_)) | None) | Step::Idle => false,
        Step::Metrics(frame) => forward(peer, held, Topic::Metrics, frame.map(|frame| frame.0)).await,
        Step::Plant(frame) => forward(peer, held, Topic::Plant, frame.map(|frame| frame.0)).await,
        Step::Events(changed) => {
            forward(peer, held, Topic::Events, changed.map(|changed| events_frame(changed).into())).await
        }
        Step::Evcc(state) => {
            forward(peer, held, Topic::Evcc, state.map(|state| evcc_frame(&state).into())).await
        }
        Step::Ping => peer.send(Message::Ping(Vec::new().into())).await,
        Step::Revoked => peer.close().await,
        Step::Recheck => peer.recheck().await,
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
        None => peer.close().await,
    }
}

/// Applies one client frame; `false` once the socket refuses a write. A malformed frame is ignored.
async fn answer(peer: &mut Peer, feed: &mut Feed, held: &mut Vec<Topic>, text: &str) -> bool {
    match parse_client_frame(text) {
        Some(ClientFrame::Sub(topics)) => {
            let decision = resolve_subscribe(&topics, !peer.holder.is_stranger());
            if !peer.send(Message::Text(ack_frame(&decision).into())).await {
                return false;
            }
            let fresh: Vec<Topic> = decision.subscribe.into_iter().filter(|t| !held.contains(t)).collect();
            held.extend(&fresh);
            for snapshot in snapshots(feed, &fresh) {
                if !peer.send(Message::Text(snapshot)).await {
                    return false;
                }
            }
            true
        }
        Some(ClientFrame::Unsub(topics)) => {
            let dropped = resolve_unsubscribe(&topics);
            held.retain(|topic| !dropped.contains(topic));
            true
        }
        None => true,
    }
}

/// The last value of each state topic in `fresh`, so a new subscriber starts from the current state.
fn snapshots(feed: &mut Feed, fresh: &[Topic]) -> Vec<Utf8Bytes> {
    let mut frames = Vec::new();
    if fresh.contains(&Topic::Plant) {
        frames.extend(feed.plant.borrow_and_update().clone().map(|plant| plant.0));
    }
    if fresh.contains(&Topic::Evcc) {
        frames.extend(feed.evcc.borrow_and_update().as_ref().map(|state| evcc_frame(state).into()));
    }
    frames
}
