//! `/ws`: the live feed, multiplexed over one socket in the 3.x contract.

use std::sync::{Arc, Weak};
use std::task::Poll;
use std::time::Duration;

use axum::Extension;
use axum::extract::State;
use axum::extract::ws::{CloseFrame, Message, Utf8Bytes, WebSocket, WebSocketUpgrade, close_code};
use axum::response::{IntoResponse, Response};
use tokio::sync::watch;
use tokio::time::{Instant, sleep_until, timeout_at};
use tower_sessions::SessionStore;
use tower_sessions::cookie::time::OffsetDateTime;
use tower_sessions::session::Id;

use super::ApiError;
use super::auth::AuthSession;
use crate::evcc::EvccState;
use crate::events::{Changed, Events, SessionEnded};
use crate::live::{
    ClientFrame, MetricsFrame, PlantFrame, StatisticsFrame, Topic, ack_frame, evcc_frame, events_frame,
    parse_client_frame, resolve_subscribe, resolve_unsubscribe,
};
use crate::run::{Clock, Core};
use crate::store::{Store, StoreError};

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
    // Subscribed before the session read: a session that ends from here on reaches the socket.
    let feed = Feed {
        metrics: core.bus.metrics.subscribe(),
        plant: core.bus.plant.subscribe(),
        events: core.bus.changed.subscribe(),
        evcc: core.bus.evcc.subscribe(),
        statistics: core.bus.statistics.subscribe(),
        core: Arc::downgrade(&core),
    };
    let ends = core.bus.sessions.subscribe();
    let holder = match holder(&core, &auth, ends).await {
        Ok(Some(holder)) => holder,
        Ok(None) => return ApiError::unauthorized("Not signed in").into_response(),
        Err(error) => return ApiError::from(error).into_response(),
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
        .on_upgrade(move |socket| serve(Peer::new(socket, limits, holder), feed))
}

/// `None` for a session that ended since the request was authenticated.
async fn holder(
    core: &Core,
    auth: &AuthSession,
    ends: Events<SessionEnded>,
) -> Result<Option<Holder>, StoreError> {
    let (Some(account), Some(id)) = (&auth.user, auth.session.id()) else {
        return Ok(Some(Holder::Stranger(core.watch_kiosk())));
    };
    let mut bound = Bound::new(core, id, account.id, ends);
    Ok(bound.live().await?.then_some(Holder::Session(bound)))
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

    /// Resolves once a stranger's kiosk view is off, or once any account's session ended (a burst counts once,
    /// so a lag loses none).
    async fn revoked(&mut self) -> Step {
        let open = match self {
            Self::Stranger(kiosk) => kiosk.wait_for(|on| !on).await.is_ok(),
            Self::Session(bound) => bound.ends.newest().await.is_some(),
        };
        if !open {
            std::future::pending::<()>().await;
        }
        if self.is_stranger() { Step::Revoked } else { Step::Recheck }
    }

    /// When a session socket's armed expiry passes.
    const fn expiry(&self) -> Option<Instant> {
        match self {
            Self::Stranger(_) => None,
            Self::Session(bound) => Some(bound.at),
        }
    }
}

/// A session socket's session, its account and when the session expires.
struct Bound {
    store: Arc<Store>,
    clock: Clock,
    id: Id,
    account: i64,
    ends: Events<SessionEnded>,
    /// The stored expiry the timer is armed for.
    expires: OffsetDateTime,
    at: Instant,
    #[cfg(test)]
    seams: Arc<crate::run::Seams>,
}

impl Bound {
    /// Due at once: nothing is read yet.
    fn new(core: &Core, id: Id, account: i64, ends: Events<SessionEnded>) -> Self {
        Self {
            store: Arc::clone(&core.store),
            clock: core.clock(),
            id,
            account,
            ends,
            expires: OffsetDateTime::UNIX_EPOCH,
            at: Instant::now(),
            #[cfg(test)]
            seams: Arc::clone(&core.seams),
        }
    }

    /// The session is still stored, unexpired, and its account exists; re-arms the expiry. Past the armed
    /// expiry, only a later stored expiry keeps it.
    async fn live(&mut self) -> Result<bool, StoreError> {
        let due = Instant::now() >= self.at;
        let Some(expires) = self.stored().await?.filter(|expires| !due || *expires > self.expires) else {
            return Ok(false);
        };
        self.arm(expires);
        Ok(true)
    }

    /// The stored session's expiry; `None` once the session or its account is gone.
    async fn stored(&self) -> Result<Option<OffsetDateTime>, StoreError> {
        let loaded = self.store.sessions().load(&self.id).await;
        let Some(record) = loaded.map_err(|e| StoreError::Sessions(e.to_string()))? else { return Ok(None) };
        #[cfg(test)]
        crate::run::pause(&self.seams.session_read).await;
        Ok(self.store.account(self.account).await?.map(|_| record.expiry_date))
    }

    fn arm(&mut self, expires: OffsetDateTime) {
        let expires_ms = i64::try_from(expires.unix_timestamp_nanos() / 1_000_000).unwrap_or(i64::MAX);
        let left = u64::try_from(expires_ms.saturating_sub(self.clock.now_ms())).unwrap_or_default();
        self.expires = expires;
        self.at = Instant::now() + Duration::from_millis(left);
    }
}

/// When each timed control step is due.
#[derive(Debug, Clone, Copy)]
struct Deadlines {
    expiry: Option<Instant>,
    idle: Instant,
    ping: Instant,
}

impl Deadlines {
    /// The most urgent step due at `now`.
    fn due(self, now: Instant) -> Option<Step> {
        if self.expiry.is_some_and(|at| now >= at) {
            Some(Step::Recheck)
        } else if now >= self.idle {
            Some(Step::Idle)
        } else if now >= self.ping {
            Some(Step::Ping)
        } else {
            None
        }
    }

    fn earliest(self) -> Instant {
        self.expiry.map_or(self.idle, |at| at.min(self.idle)).min(self.ping)
    }

    /// Checks the clock on every poll, so a feed polled after a deadline cannot go first: a sleep past its
    /// deadline fires only once the timer driver turns. The sleep only wakes the task.
    async fn passed(self) -> Step {
        let mut wake = std::pin::pin!(sleep_until(self.earliest()));
        std::future::poll_fn(|cx| {
            let fired = wake.as_mut().poll(cx).is_ready();
            let now = if fired { Instant::now().max(self.earliest()) } else { Instant::now() };
            self.due(now).map_or(Poll::Pending, Poll::Ready)
        })
        .await
    }
}

/// The socket, its control deadlines and what admitted it.
struct Peer {
    socket: WebSocket,
    limits: Limits,
    /// Closed at this instant unless the client speaks first.
    idle_at: Instant,
    ping_at: Instant,
    holder: Holder,
}

impl Peer {
    fn new(socket: WebSocket, limits: Limits, holder: Holder) -> Self {
        let now = Instant::now();
        Self { socket, limits, idle_at: now + limits.idle, ping_at: now + limits.ping, holder }
    }

    const fn deadlines(&self) -> Deadlines {
        Deadlines { expiry: self.holder.expiry(), idle: self.idle_at, ping: self.ping_at }
    }

    /// Sends the close frame; always `false`, the connection is done.
    async fn close(&mut self) -> bool {
        self.send(Message::Close(None)).await;
        false
    }

    /// Re-reads the session; closes with 1008 once it ended, so the client can tell it from a drop. Fails closed
    /// on a store error.
    async fn recheck(&mut self) -> bool {
        let Holder::Session(bound) = &mut self.holder else { return true };
        let live = bound.live().await.unwrap_or_else(|error| {
            tracing::warn!(%error, "live session check failed; closing");
            false
        });
        if live {
            return true;
        }
        let frame = CloseFrame { code: close_code::POLICY, reason: Utf8Bytes::default() };
        self.send(Message::Close(Some(frame))).await;
        false
    }

    async fn ping(&mut self) -> bool {
        self.ping_at = Instant::now() + self.limits.ping;
        self.send(Message::Ping(Vec::new().into())).await
    }

    fn heard(&mut self) {
        self.idle_at = Instant::now() + self.limits.idle;
    }

    /// `false` once the socket refuses the write or the idle deadline passes during it.
    async fn send(&mut self, message: Message) -> bool {
        matches!(timeout_at(self.idle_at, self.socket.send(message)).await, Ok(Ok(())))
    }
}

/// One connection's view of the bus. Holds no sender, so it ends once the core drops the bus.
struct Feed {
    metrics: Events<MetricsFrame>,
    plant: watch::Receiver<Option<PlantFrame>>,
    events: Events<Changed>,
    evcc: watch::Receiver<Option<EvccState>>,
    statistics: Events<StatisticsFrame>,
    /// Weak, so a socket never keeps the core from stopping; read only for a `statistics` snapshot.
    core: Weak<Core>,
}

impl Feed {
    /// Biased: a reading's `metrics` frame is published before its `plant` fold and goes out first.
    async fn next(&mut self) -> Step {
        let (topic, frame) = tokio::select! {
            biased;
            frame = self.metrics.next() => (Topic::Metrics, frame.map(|frame| frame.0)),
            state = latest(&mut self.plant) => (Topic::Plant, state.map(|frame| frame.0)),
            changed = self.events.next() => (Topic::Events, changed.map(|changed| events_frame(changed).into())),
            state = latest(&mut self.evcc) => (Topic::Evcc, state.map(|state| evcc_frame(&state).into())),
            frame = self.statistics.next() => (Topic::Statistics, frame.map(|frame| frame.0)),
        };
        Step::Frame(topic, frame)
    }
}

/// Until the client leaves or goes silent, a send fails or the core stops.
async fn serve(mut peer: Peer, mut feed: Feed) {
    let mut held: Vec<Topic> = Vec::new();
    loop {
        let step = next_step(&mut peer, &mut feed).await;
        if !take(&mut peer, &mut feed, &mut held, step).await {
            return;
        }
    }
}

/// Biased, control first: a ready bus cannot hold back a passed deadline, kiosk-off or a session end.
async fn next_step(peer: &mut Peer, feed: &mut Feed) -> Step {
    let deadlines = peer.deadlines();
    tokio::select! {
        biased;
        step = deadlines.passed() => step,
        step = peer.holder.revoked() => step,
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
    /// A topic's next frame; `None` once the bus is gone.
    Frame(Topic, Option<Utf8Bytes>),
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
        Step::Frame(topic, frame) => forward(peer, held, topic, frame).await,
        Step::Ping => peer.ping().await,
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
            for snapshot in snapshots(feed, &fresh).await {
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

/// Today's `statistics` frame; none once the core is gone, or when the read fails.
async fn today(core: &Weak<Core>) -> Option<Utf8Bytes> {
    let core = core.upgrade()?;
    let minute = crate::samples::minute_of(core.now_ms());
    match super::today_frame(&core, minute).await {
        Ok(frame) => frame.map(|frame| frame.0),
        Err(error) => {
            tracing::warn!(%error, "today's statistics not sent");
            None
        }
    }
}

/// The current state of each state topic in `fresh`: the last value, or for `statistics` today's read.
async fn snapshots(feed: &mut Feed, fresh: &[Topic]) -> Vec<Utf8Bytes> {
    let mut frames = Vec::new();
    if fresh.contains(&Topic::Plant) {
        frames.extend(feed.plant.borrow_and_update().clone().map(|plant| plant.0));
    }
    if fresh.contains(&Topic::Evcc) {
        frames.extend(feed.evcc.borrow_and_update().as_ref().map(|state| evcc_frame(state).into()));
    }
    if fresh.contains(&Topic::Statistics) {
        frames.extend(today(&feed.core).await);
    }
    frames
}
