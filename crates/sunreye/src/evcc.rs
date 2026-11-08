//! The `evcc` state topic's payload in the 3.x wire contract (`packages/contracts/src/evcc/types.ts`), and the
//! fold of EVCC's MQTT topics into it (`fixtures/oracle/evcc.ndjson`). EVCC is consume-only (ADR 0005): the
//! ingest reads, nothing writes back.

use std::collections::BTreeMap;

use serde::Serialize;
use utoipa::ToSchema;

/// Where a loadpoint's live charge power comes from.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum ChargePowerSource {
    #[default]
    Measured,
    Estimated,
    Feedforward,
}

/// One loadpoint as the dashboard renders it; an unknown figure is `None`, not zero.
#[derive(Debug, Clone, Default, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct EvccLoadpoint {
    /// 1-based, as in EVCC's topics.
    pub index: u32,
    #[schema(required = true)]
    pub title: Option<String>,
    /// `off`, `pv`, `minpv` or `now`.
    #[schema(required = true)]
    pub mode: Option<String>,
    /// W, as EVCC last reported it.
    pub charge_power: f64,
    /// W, the estimator's view between EVCC's publishes.
    pub charge_power_live: f64,
    pub charge_power_source: ChargePowerSource,
    pub charging: bool,
    pub connected: bool,
    #[schema(required = true)]
    pub vehicle_soc: Option<f64>,
    /// km.
    #[schema(required = true)]
    pub vehicle_range: Option<f64>,
    #[schema(required = true)]
    pub vehicle_title: Option<String>,
    #[schema(required = true)]
    pub vehicle_name: Option<String>,
    /// Wh added this session.
    #[schema(required = true)]
    pub session_energy: Option<f64>,
    /// Wh still needed to reach the limit.
    #[schema(required = true)]
    pub charge_remaining_energy: Option<f64>,
    #[schema(required = true)]
    pub limit_soc: Option<f64>,
    /// The limit EVCC charges to, in %; `0` or `None` is no limit.
    #[schema(required = true)]
    pub effective_limit_soc: Option<f64>,
    #[schema(required = true)]
    pub vehicle_limit_soc: Option<f64>,
    /// EVCC is draining the house battery into the car.
    pub battery_boost: bool,
    #[schema(required = true)]
    pub battery_boost_limit: Option<f64>,
    #[schema(required = true)]
    pub vehicle_capacity_kwh: Option<f64>,
    #[schema(required = true)]
    pub phases_active: Option<u8>,
}

/// What the `evcc` topic retains.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct EvccState {
    /// The broker is connected and EVCC reports itself online.
    pub reachable: bool,
    pub loadpoints: Vec<EvccLoadpoint>,
    /// Draw the EV off the house-load node.
    pub subtract_from_home: bool,
}

/// A coerced leaf payload.
#[derive(Debug, Clone, PartialEq)]
enum Value {
    Null,
    Bool(bool),
    Number(f64),
    Text(String),
}

/// JavaScript's `Number(text)` for a trimmed, non-empty `text`: decimal with an exponent, or `0x`/`0o`/`0b`
/// integers; `NaN` and `Infinity` are not numbers here.
#[allow(clippy::cast_precision_loss, reason = "Number() rounds a long literal to the nearest double too")]
fn number(text: &str) -> Option<f64> {
    let radix = |prefix: [&str; 2], radix| {
        prefix.iter().find_map(|p| text.strip_prefix(p)).map(|digits| (digits, radix))
    };
    let prefixed =
        radix(["0x", "0X"], 16).or_else(|| radix(["0o", "0O"], 8)).or_else(|| radix(["0b", "0B"], 2));
    if let Some((digits, radix)) = prefixed {
        return u64::from_str_radix(digits, radix)
            .ok()
            .filter(|_| !digits.starts_with('+'))
            .map(|n| n as f64);
    }
    let decimal = text.chars().all(|c| c.is_ascii_digit() || matches!(c, '.' | 'e' | 'E' | '+' | '-'));
    decimal.then(|| text.parse::<f64>().ok()).flatten()
}

/// A payload as 3.x's `coercePayload` reads it: `null` and blank are null, `true`/`false` booleans, a
/// number per `Number()`, anything else its trimmed text.
fn coerce(raw: &str) -> Value {
    match raw.trim() {
        "" | "null" => Value::Null,
        "true" => Value::Bool(true),
        "false" => Value::Bool(false),
        text => number(text).map_or_else(|| Value::Text(text.to_owned()), Value::Number),
    }
}

/// `<root>/<section>/<id>/<key…>`: the id and the possibly nested key. A count topic, a bare id and a `/set`
/// command echo are none.
fn section_topic<'a>(root: &str, section: &str, topic: &'a str) -> Option<(&'a str, &'a str)> {
    let rest = topic.strip_prefix(root)?.strip_prefix('/')?.strip_prefix(section)?.strip_prefix('/')?;
    let (id, key) = rest.split_once('/')?;
    let echo = key == "set" || key.ends_with("/set");
    (!id.is_empty() && !echo).then_some((id, key))
}

/// A loadpoint's 1-based index, `Number()` of its segment, and key.
fn loadpoint_topic<'a>(root: &str, topic: &'a str) -> Option<(u32, &'a str)> {
    let (id, key) = section_topic(root, "loadpoints", topic)?;
    let index = number(id.trim())?;
    let whole = index.fract() == 0.0 && (1.0..=f64::from(u32::MAX)).contains(&index);
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss, reason = "a whole number in range")]
    whole.then_some((index as u32, key))
}

/// A vehicle's EVCC config name and key.
fn vehicle_topic<'a>(root: &str, topic: &'a str) -> Option<(&'a str, &'a str)> {
    section_topic(root, "vehicles", topic)
}

/// One entity's leaves by key.
type Leaves = BTreeMap<String, Value>;

/// EVCC's retained leaf topics folded into [`EvccState`]. It only reads: nothing here can name a `/set` topic.
#[derive(Debug)]
pub struct Ingest {
    root: String,
    subtract_from_home: bool,
    connected: bool,
    /// `<root>/status`, trimmed; `None` until seen.
    status: Option<String>,
    /// A loadpoint stays listed until the ingest stops, even once its leaves are deleted.
    loadpoints: BTreeMap<u32, Leaves>,
    /// By config name; a loadpoint names its vehicle, the vehicle carries the capacity.
    vehicles: BTreeMap<String, Leaves>,
}

/// Records a leaf. An empty payload, MQTT's "topic deleted", reads as null like a cleared one.
fn store<K: Ord>(entities: &mut BTreeMap<K, Leaves>, id: K, key: &str, payload: &str) {
    entities.entry(id).or_default().insert(key.to_owned(), coerce(payload));
}

fn num(leaves: &Leaves, key: &str) -> Option<f64> {
    match leaves.get(key) {
        Some(Value::Number(n)) => Some(*n),
        _ => None,
    }
}

fn text(leaves: &Leaves, key: &str) -> Option<String> {
    match leaves.get(key) {
        Some(Value::Text(s)) => Some(s.clone()),
        _ => None,
    }
}

fn flag(leaves: &Leaves, key: &str) -> bool {
    leaves.get(key) == Some(&Value::Bool(true))
}

impl Ingest {
    pub fn new(root: &str, subtract_from_home: bool) -> Self {
        Self {
            root: root.to_owned(),
            subtract_from_home,
            connected: false,
            status: None,
            loadpoints: BTreeMap::new(),
            vehicles: BTreeMap::new(),
        }
    }

    /// The filters to subscribe to, as 3.x subscribed them.
    pub fn subscriptions(&self) -> Vec<String> {
        let root = &self.root;
        vec![format!("{root}/status"), format!("{root}/loadpoints/#"), format!("{root}/vehicles/#")]
    }

    pub fn connected(&mut self) {
        self.connected = true;
    }

    /// The broker connection dropped: unreachable, the last values kept.
    pub fn dropped(&mut self) {
        self.connected = false;
    }

    pub fn message(&mut self, topic: &str, payload: &[u8]) {
        let payload = String::from_utf8_lossy(payload);
        if topic.strip_prefix(self.root.as_str()) == Some("/status") {
            self.status = Some(payload.trim().to_owned());
        } else if let Some((index, key)) = loadpoint_topic(&self.root, topic) {
            store(&mut self.loadpoints, index, key, &payload);
        } else if let Some((name, key)) = vehicle_topic(&self.root, topic) {
            store(&mut self.vehicles, name.to_owned(), key, &payload);
        }
    }

    pub fn state(&self) -> EvccState {
        EvccState {
            reachable: self.connected && self.status.as_deref() == Some("online"),
            loadpoints: self
                .loadpoints
                .iter()
                .map(|(index, leaves)| self.loadpoint(*index, leaves))
                .collect(),
            subtract_from_home: self.subtract_from_home,
        }
    }

    fn loadpoint(&self, index: u32, leaves: &Leaves) -> EvccLoadpoint {
        let charge_power = num(leaves, "chargePower").unwrap_or(0.0);
        let vehicle_name = text(leaves, "vehicleName");
        let capacity = vehicle_name.as_ref().and_then(|name| num(self.vehicles.get(name)?, "capacity"));
        EvccLoadpoint {
            index,
            title: text(leaves, "title"),
            mode: text(leaves, "mode"),
            charge_power,
            charge_power_live: charge_power,
            charge_power_source: ChargePowerSource::Measured,
            charging: flag(leaves, "charging"),
            connected: flag(leaves, "connected"),
            vehicle_soc: num(leaves, "vehicleSoc"),
            vehicle_range: num(leaves, "vehicleRange"),
            vehicle_title: text(leaves, "vehicleTitle").or_else(|| vehicle_name.clone()),
            vehicle_name,
            session_energy: num(leaves, "sessionEnergy"),
            charge_remaining_energy: num(leaves, "chargeRemainingEnergy"),
            limit_soc: num(leaves, "limitSoc"),
            effective_limit_soc: num(leaves, "effectiveLimitSoc"),
            vehicle_limit_soc: num(leaves, "vehicleLimitSoc"),
            battery_boost: flag(leaves, "batteryBoost"),
            battery_boost_limit: num(leaves, "batteryBoostLimit"),
            vehicle_capacity_kwh: capacity.filter(|kwh| *kwh > 0.0),
            phases_active: num(leaves, "phasesActive").and_then(phases),
        }
    }
}

/// A phase count EVCC reports: a whole number up to 255.
fn phases(n: f64) -> Option<u8> {
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss, reason = "a whole number in range")]
    (n.fract() == 0.0 && (0.0..=255.0).contains(&n)).then_some(n as u8)
}

#[cfg(test)]
mod tests {
    use serde_json::{Value as Json, json};

    use super::*;
    use crate::oracle::{as_floats, oracle};

    fn case(name: &str) -> Json {
        oracle("evcc.ndjson").into_iter().find(|case| case["case"] == name).expect("case")
    }

    fn text(value: &Json) -> &str {
        value.as_str().expect("string")
    }

    #[test]
    fn the_topic_grammar_matches_the_oracle() {
        for name in ["topic/default-root", "topic/custom-root"] {
            let case = case(name);
            let root = text(&case["input"]["root"]);
            for want in case["output"].as_array().expect("output") {
                let topic = text(&want["topic"]);
                let got = json!({
                    "topic": topic,
                    "loadpoint": loadpoint_topic(root, topic).map(|(index, key)| json!({"index": index, "key": key})),
                    "vehicle": vehicle_topic(root, topic).map(|(name, key)| json!({"name": name, "key": key})),
                });
                assert_eq!(got, *want, "{name}");
            }
        }
    }

    #[test]
    fn payload_coercion_matches_the_oracle() {
        for want in case("payload/coercion")["output"].as_array().expect("output") {
            let got = match coerce(text(&want["raw"])) {
                Value::Null => Json::Null,
                Value::Bool(b) => json!(b),
                Value::Number(n) => json!(n),
                Value::Text(s) => json!(s),
            };
            assert_eq!(as_floats(&got), as_floats(&want["value"]), "{}", want["raw"]);
        }
    }

    /// The cases whose `chargePowerLive` and `chargePowerSource` are the estimator's (#561): a live figure that
    /// keeps its last anchor, or a load step attributed to the charger.
    const ESTIMATOR_CASES: [&str; 4] = [
        "fold/loadpoint-vanishing",
        "fold/charge-power-boundaries",
        "fold/subtract-estimates-3-phase",
        "fold/subtract-clamps-at-max-current",
    ];

    fn without_estimate(state: &Json) -> Json {
        let mut state = state.clone();
        for loadpoint in state["loadpoints"].as_array_mut().into_iter().flatten() {
            let fields = loadpoint.as_object_mut().expect("loadpoint");
            fields.remove("chargePowerLive");
            fields.remove("chargePowerSource");
        }
        state
    }

    /// Runs `case`'s steps through an ingest built as the core builds one: what it subscribes to, and its state
    /// after each step. A `load` sample feeds the estimator only, which is not built yet.
    fn run(case: &Json) -> (Json, Vec<Json>) {
        let input = &case["input"];
        let config: crate::settings::EvccConfig =
            serde_json::from_value(input["config"].clone()).expect("config");
        let broker = config.connection_id.map(|_| "mqtt://broker");
        let root = input["rowTopicRoot"].as_str().unwrap_or(&config.topic_root).to_owned();
        let mut ingest = config.ready(broker).then(|| Ingest::new(&root, config.subtract_from_home));
        let subscribed = json!(ingest.as_ref().map(Ingest::subscriptions).unwrap_or_default());
        let mut states = Vec::new();
        for step in input["steps"].as_array().expect("steps") {
            if let Some(ingest) = ingest.as_mut() {
                apply(ingest, step);
            }
            states.push(serde_json::to_value(ingest.as_ref().map(Ingest::state)).expect("state"));
        }
        (subscribed, states)
    }

    fn apply(ingest: &mut Ingest, step: &Json) {
        match text(&step["do"]) {
            "connect" => ingest.connected(),
            "drop" => ingest.dropped(),
            "message" => ingest.message(text(&step["topic"]), text(&step["payload"]).as_bytes()),
            _ => {}
        }
    }

    /// Each step's state, the estimator's fields left out when `masked`.
    fn compared(states: &[Json], masked: bool) -> Vec<Json> {
        let states = states.iter().map(as_floats);
        if masked { states.map(|state| without_estimate(&state)).collect() } else { states.collect() }
    }

    #[test]
    fn every_fold_case_subscribes_and_folds_as_the_oracle_and_publishes_nothing() {
        let cases: Vec<Json> = oracle("evcc.ndjson")
            .into_iter()
            .filter(|case| text(&case["case"]).starts_with("fold/"))
            .collect();
        assert_eq!(cases.len(), 17);
        for case in cases {
            let name = text(&case["case"]);
            let (subscribed, states) = run(&case);
            assert_eq!(subscribed, case["output"]["subscribed"], "{name}");
            assert_eq!(case["output"]["published"], json!([]), "{name}");
            let masked = ESTIMATOR_CASES.contains(&name);
            let want: Vec<Json> = case["output"]["steps"]
                .as_array()
                .expect("steps")
                .iter()
                .map(|step| step["state"].clone())
                .collect();
            assert_eq!(compared(&states, masked), compared(&want, masked), "{name}");
        }
    }

    #[test]
    fn the_live_charge_power_mirrors_the_measured_one_until_the_estimator_lands() {
        let states = ESTIMATOR_CASES.into_iter().flat_map(|name| run(&case(name)).1);
        let loadpoints: Vec<Json> =
            states.flat_map(|state| state["loadpoints"].as_array().cloned().unwrap_or_default()).collect();
        assert_ne!(loadpoints.len(), 0);
        for loadpoint in loadpoints {
            assert_eq!(loadpoint["chargePowerLive"], loadpoint["chargePower"], "{loadpoint}");
            assert_eq!(loadpoint["chargePowerSource"], "measured", "{loadpoint}");
        }
    }
}
