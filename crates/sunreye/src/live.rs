//! The live feed behind `/ws`: each decoded reading as a `metrics` frame and the plant's fold as a
//! `plant` frame, in the 3.x wire contract (`packages/contracts/src/ws/types.ts`).

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use axum::extract::ws::Utf8Bytes;
use serde::Serialize;
use serde::ser::SerializeMap;
use serde_json::json;

use crate::evcc::EvccState;
use crate::events::{Bus, Changed};
use crate::plant::{Aggregate, Aggregates, Fold};
use crate::samples::Sample;

/// One reading as its `metrics` frame, serialised once for every connection.
#[derive(Debug, Clone)]
pub struct MetricsFrame(pub Utf8Bytes);

/// The plant's fold as its `plant` frame, serialised once for every connection.
#[derive(Debug, Clone)]
pub struct PlantFrame(pub Utf8Bytes);

/// Folds each reading into the plant and publishes both on the bus.
#[derive(Debug, Default)]
pub struct Live {
    bus: Arc<Bus>,
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

impl Live {
    pub fn new(bus: Arc<Bus>) -> Self {
        Self { bus, members: Mutex::default() }
    }

    /// The plant's live members and how its metrics fold; a device that leaves takes its sample with it.
    pub fn roster(&self, ids: &[i64], aggregates: Aggregates) {
        let mut members = self.members.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        members.ids = ids.to_vec();
        members.last.retain(|id, _| ids.contains(id));
        members.aggregates = aggregates;
    }

    /// Publishes `sample` on `metrics`, then the plant's new fold on `plant`. Never waits.
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
            plant_frame(&folded, sample.at_ms, &members.aggregates)
        };
        self.bus.metrics.publish(MetricsFrame(metrics_frame(device_id, sample).into()));
        self.bus.plant.publish(PlantFrame(plant.into()));
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

/// `{"topic":"events","data":{"changed":"settings"}}`: re-read what changed.
pub fn events_frame(changed: Changed) -> String {
    frame("events", json!({ "changed": changed }))
}

/// `{"topic":"evcc","data":EvccState}`.
pub fn evcc_frame(state: &EvccState) -> String {
    frame("evcc", state)
}

/// The topics the core publishes. `statistics`, `logs` and `automations` are 3.x topics it does not,
/// so a subscribe to them is denied by name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Topic {
    Metrics,
    Plant,
    Evcc,
    Events,
}

/// Who may hold a topic: the access of its REST read in `route-access.txt`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Access {
    /// A session, or a stranger while the kiosk view is on.
    Kiosk,
    /// A session only: it names what an admin just changed.
    Session,
}

#[cfg(test)]
impl Access {
    /// The word `route-access.txt` uses.
    pub(crate) const fn word(self) -> &'static str {
        match self {
            Self::Kiosk => "kiosk",
            Self::Session => "session",
        }
    }
}

impl Topic {
    #[cfg(test)]
    pub(crate) const ALL: [Self; 4] = [Self::Metrics, Self::Plant, Self::Evcc, Self::Events];

    pub(crate) const fn access(self) -> Access {
        match self {
            Self::Metrics | Self::Plant | Self::Evcc => Access::Kiosk,
            Self::Events => Access::Session,
        }
    }

    fn named(name: &str) -> Option<Self> {
        match name {
            "metrics" => Some(Self::Metrics),
            "plant" => Some(Self::Plant),
            "evcc" => Some(Self::Evcc),
            "events" => Some(Self::Events),
            _ => None,
        }
    }

    pub(crate) const fn name(self) -> &'static str {
        match self {
            Self::Metrics => "metrics",
            Self::Plant => "plant",
            Self::Evcc => "evcc",
            Self::Events => "events",
        }
    }
}

/// One client frame, its topic entries unchecked: a non-topic entry is denied by name, not dropped.
#[derive(Debug)]
pub enum ClientFrame {
    Sub(Vec<serde_json::Value>),
    Unsub(Vec<serde_json::Value>),
}

/// Entries read from one frame; only a hostile client names more topics than the core publishes.
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

/// `session` is false for a stranger on the kiosk view.
pub fn resolve_subscribe(topics: &[serde_json::Value], session: bool) -> Decision {
    let mut decision = Decision::default();
    let mut seen = std::collections::BTreeSet::new();
    for entry in topics {
        let name = entry_name(entry);
        if !seen.insert(name.clone()) {
            continue;
        }
        match entry.as_str().and_then(Topic::named).filter(|topic| session || topic.access() == Access::Kiosk)
        {
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
    use crate::evcc::{ChargePowerSource, EvccLoadpoint};
    use crate::oracle::{as_floats, oracle};
    use crate::plant::Aggregates;
    use crate::samples::Sample;

    /// 2026-08-15T10:00:00.123Z
    const AT_MS: i64 = 1_786_788_000_123;

    fn parsed(text: &str) -> Value {
        serde_json::from_str(text).expect("json")
    }

    /// The plant's last fold, parsed.
    fn plant_of(bus: &Bus) -> Value {
        let frame = bus.plant.subscribe().borrow().clone().expect("a plant fold");
        parsed(frame.0.as_str())
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

    #[test]
    fn the_plant_topic_folds_each_members_last_sample_by_role() {
        let case =
            oracle("plant.ndjson").into_iter().find(|c| c["case"] == "overlapping-roles").expect("case");
        let roles = case["roles"].as_object().expect("roles");
        let bus = Arc::new(Bus::default());
        let live = Live::new(Arc::clone(&bus));
        live.roster(
            &[1, 2],
            Aggregates::of_roles(roles.iter().map(|(key, role)| (key.as_str(), role.as_str()))),
        );
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
        assert_eq!(as_floats(&plant_of(&bus)["data"]), as_floats(&case["plant"]["live"]));
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
        parsed(&ack_frame(&resolve_subscribe(&topics, true)))
    }

    #[test]
    fn the_core_grants_the_topics_it_publishes_and_denies_the_rest_by_name() {
        let ack = ack_for(
            r#"{"t":"sub","topics":["metrics","plant","evcc","events","statistics","logs","automations","nope"]}"#,
        );
        assert_eq!(
            ack,
            parsed(
                r#"{"topic":"__ack","data":{"subscribed":["metrics","plant","evcc","events"],
                    "denied":["statistics","logs","automations","nope"]}}"#
            )
        );
    }

    #[test]
    fn a_stranger_is_denied_events_by_name_and_keeps_the_dashboard_topics() {
        let Some(ClientFrame::Sub(topics)) =
            parse_client_frame(r#"{"t":"sub","topics":["metrics","events","evcc"]}"#)
        else {
            panic!("a sub frame")
        };
        let stranger = resolve_subscribe(&topics, false);
        assert_eq!(stranger.subscribe, [Topic::Metrics, Topic::Evcc]);
        assert_eq!(stranger.denied, ["events"]);
        assert_eq!(resolve_subscribe(&topics, true).subscribe, [Topic::Metrics, Topic::Events, Topic::Evcc]);
    }

    #[test]
    fn an_events_frame_names_what_changed() {
        for (changed, name) in
            [(Changed::Settings, "settings"), (Changed::Devices, "devices"), (Changed::Archive, "archive")]
        {
            assert_eq!(
                parsed(&events_frame(changed)),
                parsed(&format!(r#"{{"topic":"events","data":{{"changed":"{name}"}}}}"#))
            );
        }
    }

    #[test]
    fn an_evcc_frame_is_the_3x_evcc_state() {
        let state = EvccState {
            reachable: true,
            loadpoints: vec![EvccLoadpoint {
                index: 1,
                title: Some("Carport".into()),
                charge_power: 4200.0,
                charge_power_live: 4180.5,
                charge_power_source: ChargePowerSource::Estimated,
                charging: true,
                connected: true,
                vehicle_soc: Some(55.0),
                effective_limit_soc: Some(80.0),
                phases_active: Some(3),
                ..EvccLoadpoint::default()
            }],
            subtract_from_home: true,
        };
        assert_eq!(
            parsed(&evcc_frame(&state)),
            parsed(
                r#"{"topic":"evcc","data":{"reachable":true,"subtractFromHome":true,"loadpoints":[{
                    "index":1,"title":"Carport","mode":null,"chargePower":4200.0,"chargePowerLive":4180.5,
                    "chargePowerSource":"estimated","charging":true,"connected":true,"vehicleSoc":55.0,
                    "vehicleRange":null,"vehicleTitle":null,"vehicleName":null,"sessionEnergy":null,
                    "chargeRemainingEnergy":null,"limitSoc":null,"effectiveLimitSoc":80.0,
                    "vehicleLimitSoc":null,"batteryBoost":false,"batteryBoostLimit":null,
                    "vehicleCapacityKwh":null,"phasesActive":3}]}}"#
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

    #[tokio::test(start_paused = true)]
    async fn a_reading_is_published_on_metrics_then_folded_into_plant() {
        let bus = Arc::new(Bus::default());
        let live = Live::new(Arc::clone(&bus));
        live.roster(&[7], Aggregates::default());
        let mut metrics = bus.metrics.subscribe();
        let reading = sample(AT_MS, &[("pv_power", 1234.5)]);
        live.publish(7, &reading);
        let frame = metrics.next().await.expect("a metrics frame");
        assert_eq!(parsed(frame.0.as_str()), parsed(&metrics_frame(7, &reading)));
        assert_eq!(
            plant_of(&bus),
            parsed(&plant_frame(&[(7, Some(&reading))], AT_MS, &Aggregates::default()))
        );
    }

    #[test]
    fn a_device_off_the_roster_leaves_the_plant() {
        let bus = Arc::new(Bus::default());
        let live = Live::new(Arc::clone(&bus));
        live.roster(&[1, 2], Aggregates::default());
        live.publish(1, &sample(AT_MS, &[("pv_power", 1.0)]));
        live.roster(&[2], Aggregates::default());
        live.publish(2, &sample(AT_MS, &[("pv_power", 2.0)]));
        assert_eq!(
            plant_of(&bus)["data"],
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
