//! The live feed behind `/ws`: each decoded reading as a `metrics` frame and the plant's fold as a
//! `plant` frame, in the 3.x wire contract (`packages/contracts/src/ws/types.ts`).

use std::collections::BTreeMap;
use std::sync::Mutex;

use axum::extract::ws::Utf8Bytes;
use serde::Serialize;
use serde::ser::SerializeMap;
use serde_json::json;
use tokio::sync::{broadcast, watch};

use crate::plant::{Aggregate, Aggregates, Fold};
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

/// The plant's live members, each one's last sample and how each metric folds. A sample's buffers are
/// reused, so a poll allocates no more than the roster holds.
#[derive(Debug, Default)]
struct Members {
    ids: Vec<i64>,
    last: BTreeMap<i64, Sample>,
    aggregates: Aggregates,
}

/// `into` becomes a copy of `from`, in the buffers it already holds.
fn copy_into(into: &mut Sample, from: &Sample) {
    into.at_ms = from.at_ms;
    into.values.truncate(from.values.len());
    for (i, (key, value)) in from.values.iter().enumerate() {
        match into.values.get_mut(i) {
            Some(slot) => {
                slot.0.clone_from(key);
                slot.1 = *value;
            }
            None => into.values.push((key.clone(), *value)),
        }
    }
}

impl Default for Live {
    fn default() -> Self {
        Self { frames: broadcast::channel(RING).0, plant: watch::channel(None).0, members: Mutex::default() }
    }
}

impl Live {
    /// The plant's live members and how its metrics fold; a device that leaves takes its sample with it.
    pub fn roster(&self, ids: &[i64], aggregates: Aggregates) {
        let mut members = self.members.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        members.ids = ids.to_vec();
        members.last.retain(|id, _| ids.contains(id));
        members.aggregates = aggregates;
    }

    /// Sends `sample` on `metrics` and the plant's new fold on `plant`. Never waits.
    pub fn publish(&self, device_id: i64, sample: &Sample) {
        let plant = {
            let mut members = self.members.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
            let members = &mut *members;
            if members.ids.contains(&device_id) {
                copy_into(
                    members.last.entry(device_id).or_insert_with(|| Sample { at_ms: 0, values: Vec::new() }),
                    sample,
                );
            }
            let folded: Vec<(i64, Option<&Sample>)> =
                members.ids.iter().map(|id| (*id, members.last.get(id))).collect();
            Utf8Bytes::from(plant_frame(&folded, sample.at_ms, &members.aggregates))
        };
        if self.frames.receiver_count() > 0 {
            self.send(Topic::Metrics, metrics_frame(device_id, sample).into());
        }
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
pub fn iso(at_ms: i64) -> String {
    let at = jiff::Timestamp::from_millisecond(at_ms).unwrap_or(jiff::Timestamp::UNIX_EPOCH);
    format!("{at:.3}")
}

/// A sample's values as a JSON object, written straight from the slice. JSON has no NaN or infinity;
/// such a value is absent, never `null`.
struct Metrics<'a, K>(&'a [(K, f64)]);

impl<K: Serialize> Serialize for Metrics<'_, K> {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut map = serializer.serialize_map(None)?;
        for (key, value) in self.0.iter().filter(|(_, v)| v.is_finite()) {
            map.serialize_entry(key, value)?;
        }
        map.end()
    }
}

#[derive(Serialize)]
struct Envelope<'a, T> {
    topic: &'a str,
    data: T,
}

/// Strings, finite numbers and string-keyed maps into a `String`: serialising cannot fail.
fn frame(topic: &str, data: impl Serialize) -> String {
    serde_json::to_string(&Envelope { topic, data }).unwrap_or_default()
}

/// The device's slug on the wire: its id as a decimal string.
fn slug(device_id: i64) -> String {
    device_id.to_string()
}

/// `{"topic":"metrics","data":InverterSample}`.
pub fn metrics_frame(device_id: i64, sample: &Sample) -> String {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct InverterSample<'a> {
        time: String,
        inverter_id: String,
        metrics: Metrics<'a, String>,
    }
    frame(
        "metrics",
        InverterSample {
            time: iso(sample.at_ms),
            inverter_id: slug(device_id),
            metrics: Metrics(&sample.values),
        },
    )
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
    frame("__ack", json!({ "subscribed": subscribed, "denied": decision.denied }))
}

/// A member whose last sample is older than this is left out of the plant and named in `stale`.
const STALE_AFTER_MS: i64 = 5 * 60 * 1000;

/// `{"topic":"plant","data":PlantSample}` over the live members' last samples: each metric folded by its
/// role across the fresh members (`crate::plant`).
pub fn plant_frame(members: &[(i64, Option<&Sample>)], now_ms: i64, aggregates: &Aggregates) -> String {
    #[derive(Serialize)]
    struct PlantSample<'a> {
        time: String,
        metrics: Metrics<'a, &'a str>,
        members: Vec<String>,
        stale: Vec<String>,
    }
    let is_fresh = |sample: &Sample| now_ms - sample.at_ms <= STALE_AFTER_MS;
    let fresh: Vec<&Sample> =
        members.iter().filter_map(|(_, sample)| *sample).filter(|s| is_fresh(s)).collect();
    let stale: Vec<String> =
        members.iter().filter(|(_, sample)| !sample.is_some_and(is_fresh)).map(|(id, _)| slug(*id)).collect();
    let mut folds: Vec<(&str, Aggregate, Fold)> = Vec::new();
    for (key, value) in fresh.iter().flat_map(|s| s.values.iter()).filter(|(_, v)| v.is_finite()) {
        if let Some((_, _, fold)) = folds.iter_mut().find(|(k, _, _)| k == key) {
            fold.add(*value);
            continue;
        }
        let aggregate = aggregates.of(key, members.len());
        if aggregate != Aggregate::PerDevice {
            let mut fold = Fold::default();
            fold.add(*value);
            folds.push((key, aggregate, fold));
        }
    }
    let metrics: Vec<(&str, f64)> =
        folds.into_iter().filter_map(|(key, aggregate, fold)| Some((key, fold.value(aggregate)?))).collect();
    let newest = fresh.iter().map(|sample| sample.at_ms).max().unwrap_or(now_ms);
    let members = members.iter().map(|(id, _)| slug(*id)).collect();
    frame("plant", PlantSample { time: iso(newest), metrics: Metrics(&metrics), members, stale })
}

#[cfg(test)]
mod tests {
    use serde_json::Value;

    use super::*;
    use crate::oracle::{as_floats, oracle};
    use crate::plant::Aggregates;
    use crate::samples::Sample;

    /// 2026-08-15T10:00:00.123Z
    const AT_MS: i64 = 1_786_788_000_123;

    fn parsed(text: &str) -> Value {
        serde_json::from_str(text).expect("json")
    }

    /// `feed.next()` that fails instead of hanging when no frame was published.
    async fn next(feed: &mut Subscription) -> Frame {
        tokio::time::timeout(std::time::Duration::from_secs(5), feed.next())
            .await
            .expect("a frame within 5 s")
            .expect("the feed is open")
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
        let frame = plant_frame(&[(7, Some(&reading))], AT_MS + 1, &Aggregates::default());
        assert_eq!(
            parsed(&frame),
            parsed(
                r#"{"topic":"plant","data":{"time":"2026-08-15T10:00:00.123Z",
                    "metrics":{"pv_power":1234.5,"battery_soc":87.0},"members":["7"],"stale":[]}}"#
            )
        );
    }

    fn at_ms(value: &Value) -> i64 {
        value.as_str().expect("instant").parse::<jiff::Timestamp>().expect("RFC 3339").as_millisecond()
    }

    /// A case's device and its latest sample, if it has one.
    fn live_sample(case: &Value, slug: &str) -> (i64, Option<Sample>) {
        let sample = &case["live"]["samples"][slug];
        let values = sample["metrics"]
            .as_object()
            .map(|metrics| metrics.iter().map(|(k, v)| (k.clone(), v.as_f64().expect("value"))).collect());
        let sample = values.map(|values| Sample { at_ms: at_ms(&sample["time"]), values });
        (slug.parse().expect("id"), sample)
    }

    #[test]
    fn every_plant_case_folds_the_live_members_latest_samples_as_recorded() {
        for case in oracle("plant.ndjson") {
            let roles = case["roles"].as_object().expect("roles");
            let aggregates =
                Aggregates::of_roles(roles.iter().map(|(key, role)| (key.as_str(), role.as_str())));
            let live: Vec<(i64, Option<Sample>)> = case["members"]["live"]
                .as_array()
                .expect("members")
                .iter()
                .map(|slug| live_sample(&case, slug.as_str().expect("slug")))
                .collect();
            let members: Vec<(i64, Option<&Sample>)> = live.iter().map(|(id, s)| (*id, s.as_ref())).collect();
            let frame = plant_frame(&members, at_ms(&case["live"]["now"]), &aggregates);
            assert_eq!(
                as_floats(&parsed(&frame)["data"]),
                as_floats(&case["plant"]["live"]),
                "{}",
                case["case"]
            );
        }
    }

    #[tokio::test]
    async fn the_plant_topic_folds_each_members_last_sample_by_role() {
        let case =
            oracle("plant.ndjson").into_iter().find(|c| c["case"] == "overlapping-roles").expect("case");
        let roles = case["roles"].as_object().expect("roles");
        let live = Live::default();
        live.roster(
            &[1, 2],
            Aggregates::of_roles(roles.iter().map(|(key, role)| (key.as_str(), role.as_str()))),
        );
        let mut feed = live.subscribe();
        for slug in ["2", "1"] {
            let sample = &case["live"]["samples"][slug];
            let values = sample["metrics"]
                .as_object()
                .expect("metrics")
                .iter()
                .map(|(k, v)| (k.clone(), v.as_f64().expect("value")));
            live.publish(
                slug.parse().expect("id"),
                &Sample { at_ms: at_ms(&sample["time"]), values: values.collect() },
            );
        }
        let plant = std::iter::repeat_n((), 4)
            .map(|()| feed.frames.try_recv().expect("frame"))
            .last()
            .expect("frame");
        assert_eq!(plant.topic, Topic::Plant);
        assert_eq!(as_floats(&parsed(plant.text.as_str())["data"]), as_floats(&case["plant"]["live"]));
    }

    #[test]
    fn a_member_without_a_sample_or_older_than_five_minutes_is_stale() {
        let edge = sample(AT_MS - FIVE_MINUTES_MS, &[("pv_power", 1.0)]);
        let old = sample(AT_MS - FIVE_MINUTES_MS - 1, &[("pv_power", 2.0)]);
        let frame =
            plant_frame(&[(1, Some(&edge)), (2, Some(&old)), (3, None)], AT_MS, &Aggregates::default());
        let data = &parsed(&frame)["data"];
        assert_eq!(data["stale"], parsed(r#"["2","3"]"#));
        assert_eq!(data["time"], "2026-08-15T09:55:00.123Z", "the newest fresh sample");
    }

    #[test]
    fn a_plant_whose_only_member_is_stale_has_no_metrics_and_the_fold_time() {
        let old = sample(AT_MS - FIVE_MINUTES_MS - 1, &[("pv_power", 2.0)]);
        let frame = plant_frame(&[(4, Some(&old))], AT_MS, &Aggregates::default());
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
        live.roster(&[1, 2], Aggregates::default());
        live.publish(1, &sample(AT_MS, &[("pv_power", 1.0)]));
        live.roster(&[2], Aggregates::default());
        let mut feed = live.subscribe();
        live.publish(2, &sample(AT_MS, &[("pv_power", 2.0)]));
        assert_eq!(next(&mut feed).await.topic, Topic::Metrics);
        let plant = next(&mut feed).await;
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

    #[test]
    fn a_member_value_that_is_not_finite_adds_nothing_to_the_plant() {
        let roles =
            [("pv", Some("pv.total.power")), ("soc", Some("battery.soc")), ("dead", Some("pv.total.power"))];
        let one = sample(AT_MS, &[("pv", f64::NAN), ("soc", 80.0), ("dead", f64::NAN)]);
        let two = sample(AT_MS, &[("pv", 3.0), ("soc", f64::INFINITY), ("dead", f64::NAN)]);
        let frame = plant_frame(&[(1, Some(&one)), (2, Some(&two))], AT_MS, &Aggregates::of_roles(roles));
        assert_eq!(
            parsed(&frame)["data"]["metrics"],
            parsed(r#"{"pv":3.0,"soc":80.0}"#),
            "the other member's value alone; a metric no member has a value for is absent"
        );
    }

    #[tokio::test]
    async fn a_subscription_that_falls_behind_resumes_at_the_oldest_of_the_last_16_frames() {
        let live = Live::default();
        let mut feed = live.subscribe();
        for at_ms in 0..10 {
            live.publish(1, &sample(at_ms, &[("pv_power", 1.0)]));
        }
        let mut held = Vec::new();
        for _ in 0..16 {
            let frame = next(&mut feed).await;
            held.push((frame.topic, parsed(frame.text.as_str())["data"]["time"].clone()));
        }
        let want: Vec<(Topic, Value)> = (2..10)
            .flat_map(|ms| {
                let time = json!(format!("1970-01-01T00:00:00.00{ms}Z"));
                [(Topic::Metrics, time.clone()), (Topic::Plant, time)]
            })
            .collect();
        assert_eq!(held, want, "20 frames published unread: frames 4 to 19 are held, in order");
        // Everything published is already queued, so a further frame would be ready now.
        let past_newest = futures_util::FutureExt::now_or_never(feed.next());
        assert!(past_newest.is_none(), "nothing past the newest frame: {past_newest:?}");
    }

    #[test]
    fn a_zero_reading_is_a_value_not_a_gap() {
        let reading = sample(AT_MS, &[("battery_power", 0.0), ("pv_power", 0.0)]);
        assert_eq!(
            parsed(&metrics_frame(7, &reading))["data"]["metrics"],
            parsed(r#"{"battery_power":0.0,"pv_power":0.0}"#)
        );
        assert_eq!(
            parsed(&plant_frame(&[(7, Some(&reading))], AT_MS, &Aggregates::default()))["data"],
            parsed(
                r#"{"time":"2026-08-15T10:00:00.123Z","metrics":{"battery_power":0.0,"pv_power":0.0},
                    "members":["7"],"stale":[]}"#
            )
        );
    }
}
