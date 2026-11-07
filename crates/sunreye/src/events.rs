//! The core's in-process pub/sub: one typed field per topic, each with its payload type. Only the
//! core publishes; a subscriber holds no sender.

use tokio::sync::{broadcast, watch};

use crate::evcc::EvccState;
use crate::live::{MetricsFrame, PlantFrame};

/// Events held for the slowest subscriber. Publishing never waits: a subscriber that falls further
/// behind skips to the oldest event still held, so memory is bounded by this ring, not per subscriber.
const RING: usize = 16;

/// Owned by the core; dropping it ends every subscription.
#[derive(Debug, Default)]
pub struct Bus {
    /// Each decoded reading.
    pub metrics: Event<MetricsFrame>,
    /// The plant's last fold.
    pub plant: State<PlantFrame>,
    /// Stored state changed; a subscriber re-reads it.
    pub changed: Event<Changed>,
    /// EVCC's last state; the ingest publishes it.
    pub evcc: State<EvccState>,
}

/// What a write changed, for the `/ws` `events` topic.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Changed {
    Settings,
    Devices,
    Archive,
}

/// A topic whose payloads are hints: a subscriber hears those published after it subscribed.
#[derive(Debug)]
pub struct Event<T>(broadcast::Sender<T>);

impl<T: Clone> Default for Event<T> {
    fn default() -> Self {
        Self(broadcast::channel(RING).0)
    }
}

impl<T: Clone> Event<T> {
    /// Never waits; with no subscriber the payload is dropped.
    pub(crate) fn publish(&self, payload: T) {
        drop(self.0.send(payload));
    }

    pub fn subscribe(&self) -> Events<T> {
        Events(self.0.subscribe())
    }

    pub fn subscribers(&self) -> usize {
        self.0.receiver_count()
    }
}

#[derive(Debug)]
pub struct Events<T>(broadcast::Receiver<T>);

impl<T: Clone> Events<T> {
    /// The next payload, skipping what a lagging subscriber missed; `None` once the topic is gone.
    pub async fn next(&mut self) -> Option<T> {
        loop {
            match self.0.recv().await {
                Ok(payload) => return Some(payload),
                Err(broadcast::error::RecvError::Lagged(missed)) => {
                    tracing::debug!(missed, "slow subscriber skipped events");
                }
                Err(broadcast::error::RecvError::Closed) => return None,
            }
        }
    }
}

/// A topic that keeps its last value; a subscriber reads it on subscribing.
#[derive(Debug)]
pub struct State<T>(watch::Sender<Option<T>>);

impl<T> Default for State<T> {
    fn default() -> Self {
        Self(watch::Sender::new(None))
    }
}

impl<T> State<T> {
    pub(crate) fn publish(&self, value: T) {
        self.0.send_replace(Some(value));
    }

    pub fn subscribe(&self) -> watch::Receiver<Option<T>> {
        self.0.subscribe()
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use futures_util::FutureExt;

    use super::*;

    /// A payload whose live copies `alive` counts: each clone shares the one `Arc`.
    #[derive(Debug, Clone)]
    struct Tracked {
        seq: usize,
        _alive: Arc<()>,
    }

    fn copies(alive: &Arc<()>) -> usize {
        Arc::strong_count(alive) - 1
    }

    #[tokio::test(start_paused = true)]
    async fn a_state_topic_hands_a_late_subscriber_the_current_value() {
        let topic = State::<u32>::default();
        assert_eq!(*topic.subscribe().borrow(), None, "nothing published yet");
        topic.publish(1);
        topic.publish(2);
        assert_eq!(*topic.subscribe().borrow(), Some(2));
    }

    #[tokio::test(start_paused = true)]
    async fn an_event_topic_does_not_replay_to_a_late_subscriber() {
        let topic = Event::<u32>::default();
        topic.publish(1);
        let mut late = topic.subscribe();
        assert_eq!(late.next().now_or_never(), None, "nothing published since subscribing");
        topic.publish(2);
        assert_eq!(late.next().await, Some(2));
    }

    #[tokio::test(start_paused = true)]
    async fn a_subscriber_that_falls_behind_skips_to_the_oldest_of_the_last_16_events() {
        let alive = Arc::new(());
        let topic = Event::<Tracked>::default();
        let mut slow = topic.subscribe();
        for seq in 0..300_000 {
            topic.publish(Tracked { seq, _alive: Arc::clone(&alive) });
        }
        assert_eq!(copies(&alive), 16, "the ring holds the last 16, however far a subscriber lags");
        let resumed = slow.next().await.map(|event| event.seq);
        assert_eq!(resumed, Some(300_000 - 16));
    }

    #[tokio::test(start_paused = true)]
    async fn an_event_nobody_subscribes_to_is_not_kept() {
        let alive = Arc::new(());
        let topic = Event::<Tracked>::default();
        topic.publish(Tracked { seq: 0, _alive: Arc::clone(&alive) });
        assert_eq!(copies(&alive), 0);
    }

    #[tokio::test(start_paused = true)]
    async fn a_subscription_ends_once_its_topic_is_gone() {
        let topic = Event::<u32>::default();
        let mut events = topic.subscribe();
        topic.publish(1);
        drop(topic);
        assert_eq!(events.next().await, Some(1), "what was published before is still read");
        assert_eq!(events.next().await, None);
    }
}
