//! The live feed behind `/ws`: each decoded reading as a `metrics` frame and the plant's fold as a
//! `plant` frame, in the 3.x wire contract (`packages/contracts/src/ws/types.ts`).

use std::collections::BTreeMap;
use std::sync::Mutex;

use axum::extract::ws::Utf8Bytes;
use serde::Serialize;
use serde_json::json;
use tokio::sync::{broadcast, watch};

use crate::samples::Sample;

/// Frames held for the slowest connection. Sending never waits: a connection that falls further
/// behind skips to the oldest frame still held, so memory is bounded by this ring, not per connection.
const RING: usize = 16;

/// One serialised frame, shared by every connection that sends it.
#[derive(Debug, Clone)]
pub struct Frame {
    pub topic: Topic,
    pub text: Utf8Bytes,
}

/// The fan-out from the device tasks to the `/ws` connections.
#[derive(Debug)]
pub struct Live {
    frames: broadcast::Sender<Frame>,
    plant: watch::Sender<Option<Utf8Bytes>>,
    members: Mutex<Members>,
}

/// The polled devices and each one's last sample, for the plant fold.
#[derive(Debug, Default)]
struct Members {
    ids: Vec<i64>,
    last: BTreeMap<i64, Sample>,
}

impl Default for Live {
    fn default() -> Self {
        Self { frames: broadcast::channel(RING).0, plant: watch::channel(None).0, members: Mutex::default() }
    }
}

impl Live {
    /// The devices now polled; a device dropped from the roster leaves the plant with its sample.
    pub fn roster(&self, ids: &[i64]) {
        let mut members = self.members.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        members.ids = ids.to_vec();
        members.last.retain(|id, _| ids.contains(id));
    }

    /// Sends `sample` on `metrics` and the plant's new fold on `plant`. Never waits.
    pub fn publish(&self, device_id: i64, sample: &Sample) {
        let plant = {
            let mut members = self.members.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
            if members.ids.contains(&device_id) {
                members.last.insert(device_id, sample.clone());
            }
            let folded: Vec<(i64, Option<&Sample>)> =
                members.ids.iter().map(|id| (*id, members.last.get(id))).collect();
            Utf8Bytes::from(plant_frame(&folded, sample.at_ms))
        };
        self.send(Topic::Metrics, metrics_frame(device_id, sample).into());
        self.plant.send_replace(Some(plant.clone()));
        self.send(Topic::Plant, plant);
    }

    /// No connection is not an error: the frame is dropped.
    fn send(&self, topic: Topic, text: Utf8Bytes) {
        drop(self.frames.send(Frame { topic, text }));
    }

    pub fn subscribe(&self) -> Subscription {
        Subscription { frames: self.frames.subscribe(), plant: self.plant.subscribe() }
    }

    /// Open subscriptions.
    pub fn connections(&self) -> usize {
        self.frames.receiver_count()
    }
}

/// One connection's view of the feed. Holds no sender, so it ends once the core drops [`Live`].
#[derive(Debug)]
pub struct Subscription {
    frames: broadcast::Receiver<Frame>,
    plant: watch::Receiver<Option<Utf8Bytes>>,
}

impl Subscription {
    /// The next frame, skipping what a lagging connection missed; `None` once the feed is gone.
    pub async fn next(&mut self) -> Option<Frame> {
        loop {
            match self.frames.recv().await {
                Ok(frame) => return Some(frame),
                Err(broadcast::error::RecvError::Lagged(missed)) => {
                    tracing::debug!(missed, "slow live connection skipped frames");
                }
                Err(broadcast::error::RecvError::Closed) => return None,
            }
        }
    }

    /// The last plant frame, sent to a connection when it subscribes to `plant`.
    pub fn plant(&self) -> Option<Utf8Bytes> {
        self.plant.borrow().clone()
    }
}

/// `Date.prototype.toISOString`: UTC, always milliseconds.
fn iso(at_ms: i64) -> String {
    let at = jiff::Timestamp::from_millisecond(at_ms).unwrap_or(jiff::Timestamp::UNIX_EPOCH);
    format!("{at:.3}")
}

/// JSON has no NaN or infinity; such a value is absent, never `null`.
fn finite<'a>(values: impl IntoIterator<Item = &'a (String, f64)>) -> BTreeMap<&'a str, f64> {
    values.into_iter().filter(|(_, v)| v.is_finite()).map(|(k, v)| (k.as_str(), *v)).collect()
}

fn frame(topic: &str, data: &impl Serialize) -> String {
    json!({ "topic": topic, "data": data }).to_string()
}

/// The device's slug on the wire: its id.
fn slug(device_id: i64) -> String {
    device_id.to_string()
}

/// `{"topic":"metrics","data":InverterSample}`.
pub fn metrics_frame(device_id: i64, sample: &Sample) -> String {
    let data = json!({
        "time": iso(sample.at_ms),
        "inverterId": slug(device_id),
        "metrics": finite(&sample.values),
    });
    frame("metrics", &data)
}

/// The topics the core publishes. `evcc`, `statistics`, `logs` and `automations` are 3.x topics it
/// does not, so a subscribe to them is denied by name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Topic {
    Metrics,
    Plant,
}

impl Topic {
    fn named(name: &str) -> Option<Self> {
        match name {
            "metrics" => Some(Self::Metrics),
            "plant" => Some(Self::Plant),
            _ => None,
        }
    }

    const fn name(self) -> &'static str {
        match self {
            Self::Metrics => "metrics",
            Self::Plant => "plant",
        }
    }
}

/// One client frame, its topic entries unchecked: a non-topic entry is denied by name, not dropped.
#[derive(Debug)]
pub enum ClientFrame {
    Sub(Vec<serde_json::Value>),
    Unsub(Vec<serde_json::Value>),
}

/// Entries read from one frame; there are two topics, so only a hostile client sends more.
const MAX_FRAME_TOPICS: usize = 64;
/// Characters of a denied entry echoed back.
const MAX_DENIED_NAME: usize = 64;

pub fn parse_client_frame(text: &str) -> Option<ClientFrame> {
    let mut value: serde_json::Value = serde_json::from_str(text).ok()?;
    let topics = value.get_mut("topics")?.as_array_mut().map(std::mem::take)?;
    let topics = topics.into_iter().take(MAX_FRAME_TOPICS).collect();
    match value.get("t")?.as_str()? {
        "sub" => Some(ClientFrame::Sub(topics)),
        "unsub" => Some(ClientFrame::Unsub(topics)),
        _ => None,
    }
}

/// What one `sub` frame grants and refuses, in request order, each name once.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Decision {
    pub subscribe: Vec<Topic>,
    pub denied: Vec<String>,
}

fn entry_name(entry: &serde_json::Value) -> String {
    let text = entry.as_str().map_or_else(|| entry.to_string(), str::to_owned);
    text.chars().take(MAX_DENIED_NAME).collect()
}

pub fn resolve_subscribe(topics: &[serde_json::Value]) -> Decision {
    let mut decision = Decision::default();
    let mut seen = std::collections::BTreeSet::new();
    for entry in topics {
        let name = entry_name(entry);
        if !seen.insert(name.clone()) {
            continue;
        }
        match entry.as_str().and_then(Topic::named) {
            Some(topic) => decision.subscribe.push(topic),
            None => decision.denied.push(name),
        }
    }
    decision
}

/// The published topics an `unsub` names; the rest is a no-op, never an error.
pub fn resolve_unsubscribe(topics: &[serde_json::Value]) -> Vec<Topic> {
    let mut dropped = Vec::new();
    for topic in topics.iter().filter_map(|entry| entry.as_str().and_then(Topic::named)) {
        if !dropped.contains(&topic) {
            dropped.push(topic);
        }
    }
    dropped
}

/// `{"topic":"__ack","data":{"subscribed":[...],"denied":[...]}}`.
pub fn ack_frame(decision: &Decision) -> String {
    let subscribed: Vec<&str> = decision.subscribe.iter().map(|topic| topic.name()).collect();
    frame("__ack", &json!({ "subscribed": subscribed, "denied": decision.denied }))
}

/// A member whose last sample is older than this is left out of the plant and named in `stale`.
const STALE_AFTER_MS: i64 = 5 * 60 * 1000;

/// `{"topic":"plant","data":PlantSample}` over every polled device's last sample.
///
/// A plant of one member is that member. With more, a metric folds only by its role's aggregate, and
/// 4.0 profiles carry no roles yet, so every metric is per-device and the fold has none.
pub fn plant_frame(members: &[(i64, Option<&Sample>)], now_ms: i64) -> String {
    let fresh: Vec<&Sample> = members
        .iter()
        .filter_map(|(_, sample)| *sample)
        .filter(|sample| now_ms - sample.at_ms <= STALE_AFTER_MS)
        .collect();
    let stale: Vec<String> = members
        .iter()
        .filter(|(_, sample)| !sample.is_some_and(|s| now_ms - s.at_ms <= STALE_AFTER_MS))
        .map(|(id, _)| slug(*id))
        .collect();
    let metrics = match (members.len(), fresh.as_slice()) {
        (1, [sole]) => finite(&sole.values),
        _ => BTreeMap::new(),
    };
    let newest = fresh.iter().map(|sample| sample.at_ms).max().unwrap_or(now_ms);
    let data = json!({
        "time": iso(newest),
        "metrics": metrics,
        "members": members.iter().map(|(id, _)| slug(*id)).collect::<Vec<_>>(),
        "stale": stale,
    });
    frame("plant", &data)
}

#[cfg(test)]
mod tests {
    use serde_json::Value;

    use super::*;
    use crate::samples::Sample;

    /// 2026-08-15T10:00:00.123Z
    const AT_MS: i64 = 1_786_788_000_123;

    fn parsed(text: &str) -> Value {
        serde_json::from_str(text).expect("json")
    }

    fn sample(at_ms: i64, values: &[(&str, f64)]) -> Sample {
        Sample { at_ms, values: values.iter().map(|(k, v)| ((*k).to_owned(), *v)).collect() }
    }

    #[test]
    fn a_metrics_frame_is_one_device_sample_in_the_3x_shape() {
        let frame = metrics_frame(7, &sample(AT_MS, &[("pv_power", 1234.5), ("battery_soc", 87.0)]));
        assert_eq!(
            parsed(&frame),
            parsed(
                r#"{"topic":"metrics","data":{"time":"2026-08-15T10:00:00.123Z","inverterId":"7",
                    "metrics":{"pv_power":1234.5,"battery_soc":87.0}}}"#
            )
        );
    }

    const FIVE_MINUTES_MS: i64 = 300_000;

    #[test]
    fn a_plant_of_one_member_is_that_member() {
        let reading = sample(AT_MS, &[("pv_power", 1234.5), ("battery_soc", 87.0)]);
        let frame = plant_frame(&[(7, Some(&reading))], AT_MS + 1);
        assert_eq!(
            parsed(&frame),
            parsed(
                r#"{"topic":"plant","data":{"time":"2026-08-15T10:00:00.123Z",
                    "metrics":{"pv_power":1234.5,"battery_soc":87.0},"members":["7"],"stale":[]}}"#
            )
        );
    }

    #[test]
    fn two_members_fold_no_metric_while_profiles_carry_no_roles() {
        let first = sample(AT_MS - 1000, &[("pv_power", 100.0)]);
        let second = sample(AT_MS, &[("pv_power", 200.0)]);
        let frame = plant_frame(&[(1, Some(&first)), (2, Some(&second))], AT_MS);
        assert_eq!(
            parsed(&frame),
            parsed(
                r#"{"topic":"plant","data":{"time":"2026-08-15T10:00:00.123Z",
                    "metrics":{},"members":["1","2"],"stale":[]}}"#
            )
        );
    }

    #[test]
    fn a_member_without_a_sample_or_older_than_five_minutes_is_stale() {
        let edge = sample(AT_MS - FIVE_MINUTES_MS, &[("pv_power", 1.0)]);
        let old = sample(AT_MS - FIVE_MINUTES_MS - 1, &[("pv_power", 2.0)]);
        let frame = plant_frame(&[(1, Some(&edge)), (2, Some(&old)), (3, None)], AT_MS);
        let data = &parsed(&frame)["data"];
        assert_eq!(data["stale"], parsed(r#"["2","3"]"#));
        assert_eq!(data["time"], "2026-08-15T09:55:00.123Z", "the newest fresh sample");
    }

    #[test]
    fn a_plant_whose_only_member_is_stale_has_no_metrics_and_the_fold_time() {
        let old = sample(AT_MS - FIVE_MINUTES_MS - 1, &[("pv_power", 2.0)]);
        let frame = plant_frame(&[(4, Some(&old))], AT_MS);
        assert_eq!(
            parsed(&frame),
            parsed(
                r#"{"topic":"plant","data":{"time":"2026-08-15T10:00:00.123Z",
                    "metrics":{},"members":["4"],"stale":["4"]}}"#
            )
        );
    }

    fn ack_for(text: &str) -> Value {
        let Some(ClientFrame::Sub(topics)) = parse_client_frame(text) else { panic!("a sub frame: {text}") };
        parsed(&ack_frame(&resolve_subscribe(&topics)))
    }

    #[test]
    fn the_core_grants_metrics_and_plant_and_denies_the_topics_it_does_not_publish_by_name() {
        let ack = ack_for(
            r#"{"t":"sub","topics":["metrics","plant","evcc","statistics","logs","automations","nope"]}"#,
        );
        assert_eq!(
            ack,
            parsed(
                r#"{"topic":"__ack","data":{"subscribed":["metrics","plant"],
                    "denied":["evcc","statistics","logs","automations","nope"]}}"#
            )
        );
    }

    #[test]
    fn a_repeated_topic_is_answered_once_and_an_empty_sub_is_acked_empty() {
        assert_eq!(
            ack_for(r#"{"t":"sub","topics":["plant","plant","x","x"]}"#),
            parsed(r#"{"topic":"__ack","data":{"subscribed":["plant"],"denied":["x"]}}"#)
        );
        assert_eq!(
            ack_for(r#"{"t":"sub","topics":[]}"#),
            parsed(r#"{"topic":"__ack","data":{"subscribed":[],"denied":[]}}"#)
        );
    }

    #[test]
    fn an_entry_that_is_not_a_topic_name_is_denied_by_a_name_at_most_64_characters_long() {
        let long = "é".repeat(65);
        let ack = ack_for(&format!(r#"{{"t":"sub","topics":[1,null,{{"a":1}},"{long}"]}}"#));
        assert_eq!(ack["data"]["subscribed"], parsed("[]"));
        assert_eq!(
            ack["data"]["denied"],
            json!(["1", "null", r#"{"a":1}"#, "é".repeat(64)]),
            "a name is echoed so the client tells refused from idle"
        );
    }

    #[test]
    fn a_frame_names_at_most_64_topics() {
        let names: Vec<String> = (0..100).map(|i| format!("t{i}")).collect();
        let text = json!({"t": "sub", "topics": names}).to_string();
        assert_eq!(ack_for(&text)["data"]["denied"].as_array().map(Vec::len), Some(64));
    }

    #[test]
    fn unsub_names_only_the_topics_the_core_publishes() {
        let Some(ClientFrame::Unsub(topics)) =
            parse_client_frame(r#"{"t":"unsub","topics":["plant","logs",3,"plant"]}"#)
        else {
            panic!("an unsub frame")
        };
        assert_eq!(resolve_unsubscribe(&topics), [Topic::Plant]);
    }

    #[test]
    fn anything_but_a_sub_or_unsub_with_a_topic_list_is_not_a_client_frame() {
        for text in [
            "",
            "not json",
            "[]",
            "null",
            r#"{"t":"sub"}"#,
            r#"{"t":"sub","topics":"metrics"}"#,
            r#"{"t":"subscribe","topics":["metrics"]}"#,
            r#"{"topics":["metrics"]}"#,
        ] {
            assert!(parse_client_frame(text).is_none(), "{text}");
        }
    }

    #[tokio::test]
    async fn a_device_off_the_roster_leaves_the_plant() {
        let live = Live::default();
        live.roster(&[1, 2]);
        live.publish(1, &sample(AT_MS, &[("pv_power", 1.0)]));
        live.roster(&[2]);
        let mut feed = live.subscribe();
        live.publish(2, &sample(AT_MS, &[("pv_power", 2.0)]));
        let metrics = feed.next().await.expect("metrics");
        assert_eq!(metrics.topic, Topic::Metrics);
        let plant = feed.next().await.expect("plant");
        assert_eq!(
            parsed(plant.text.as_str())["data"],
            parsed(
                r#"{"time":"2026-08-15T10:00:00.123Z","metrics":{"pv_power":2.0},"members":["2"],"stale":[]}"#
            )
        );
    }

    #[test]
    fn a_value_json_cannot_carry_is_left_out_of_the_frame() {
        let frame = metrics_frame(1, &sample(0, &[("a", f64::NAN), ("b", f64::INFINITY), ("c", -0.5)]));
        assert_eq!(
            parsed(&frame),
            parsed(
                r#"{"topic":"metrics","data":{"time":"1970-01-01T00:00:00.000Z","inverterId":"1",
                    "metrics":{"c":-0.5}}}"#
            )
        );
    }
}
