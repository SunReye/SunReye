//! `/ws`: the live feed, multiplexed over one socket in the 3.x contract.

use std::sync::Arc;

use axum::extract::State;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::response::Response;

use crate::live::{
    ClientFrame, Frame, Subscription, Topic, ack_frame, parse_client_frame, resolve_subscribe,
    resolve_unsubscribe,
};
use crate::run::Core;

/// A client frame is a short topic list; anything longer is refused by the socket.
const MAX_CLIENT_MESSAGE: usize = 16 * 1024;

pub async fn upgrade(State(core): State<Arc<Core>>, upgrade: WebSocketUpgrade) -> Response {
    let subscription = core.live.subscribe();
    upgrade
        .max_message_size(MAX_CLIENT_MESSAGE)
        .max_frame_size(MAX_CLIENT_MESSAGE)
        .on_upgrade(move |socket| serve(socket, subscription))
}

/// Until the client leaves, a send fails or the core stops.
async fn serve(mut socket: WebSocket, mut feed: Subscription) {
    let mut held: Vec<Topic> = Vec::new();
    loop {
        let step = tokio::select! {
            incoming = socket.recv() => Step::Client(incoming),
            frame = feed.next() => Step::Feed(frame),
        };
        let open = match step {
            Step::Client(Some(Ok(Message::Text(text)))) => answer(&mut socket, &feed, &mut held, &text).await,
            Step::Client(Some(Ok(Message::Close(_)) | Err(_)) | None) => false,
            Step::Client(Some(Ok(_))) => true,
            Step::Feed(frame) => forward(&mut socket, &held, frame).await,
        };
        if !open {
            return;
        }
    }
}

enum Step {
    Client(Option<Result<Message, axum::Error>>),
    Feed(Option<Frame>),
}

/// Sends a frame on a held topic; closes the socket once the feed is gone.
async fn forward(socket: &mut WebSocket, held: &[Topic], frame: Option<Frame>) -> bool {
    match frame {
        Some(frame) if held.contains(&frame.topic) => socket.send(Message::Text(frame.text)).await.is_ok(),
        Some(_) => true,
        None => {
            drop(socket.send(Message::Close(None)).await);
            false
        }
    }
}

/// Applies one client frame; `false` once the socket refuses a write. A malformed frame is ignored.
async fn answer(socket: &mut WebSocket, feed: &Subscription, held: &mut Vec<Topic>, text: &str) -> bool {
    match parse_client_frame(text) {
        Some(ClientFrame::Sub(topics)) => {
            let decision = resolve_subscribe(&topics);
            if socket.send(Message::Text(ack_frame(&decision).into())).await.is_err() {
                return false;
            }
            let fresh: Vec<Topic> = decision.subscribe.into_iter().filter(|t| !held.contains(t)).collect();
            held.extend(&fresh);
            match feed.plant().filter(|_| fresh.contains(&Topic::Plant)) {
                Some(snapshot) => socket.send(Message::Text(snapshot)).await.is_ok(),
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
