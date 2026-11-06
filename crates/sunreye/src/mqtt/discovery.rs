//! Topic names and Home Assistant discovery configs. Identity (topics, `unique_id`, `identifiers`) comes from
//! the slugs; the description (`name`, `manufacturer`, `model`) from the profile, so a profile swap relabels
//! the device Home Assistant already has.

use std::collections::BTreeMap;

use serde::Serialize;
use serde_json::{Map, Value, json};

use crate::forecast::Variant;
use crate::manifest::ManifestMetric;
use crate::profile::MetricKind;

/// The two slugs every identifying name is built from, taken verbatim.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Namespace {
    pub plant_slug: String,
    pub device_slug: String,
}

impl Namespace {
    /// `sunreye_<plant>_<device>`: every `unique_id` and the device `identifiers` share it.
    pub fn identity(&self) -> String {
        format!("sunreye_{}_{}", self.plant_slug, self.device_slug)
    }
}

/// One device's topics: `<prefix>/<plant>/<device>/…`.
#[derive(Debug, Clone)]
pub struct Topics {
    pub base: String,
}

impl Topics {
    pub fn new(prefix: &str, ns: &Namespace) -> Self {
        Self { base: format!("{prefix}/{}/{}", ns.plant_slug, ns.device_slug) }
    }

    pub fn availability(&self) -> String {
        format!("{}/status", self.base)
    }

    pub fn state(&self, metric: &ManifestMetric) -> String {
        format!("{}/{}", self.base, metric.topic)
    }

    pub fn forecast_state(&self, variant: Variant) -> String {
        format!("{}/forecast/{}", self.base, variant_name(variant))
    }

    pub fn forecast_attributes(&self, variant: Variant) -> String {
        format!("{}/attributes", self.forecast_state(variant))
    }
}

const fn variant_name(variant: Variant) -> &'static str {
    match variant {
        Variant::Raw => "raw",
        Variant::Usable => "usable",
    }
}

pub const fn forecast_object_id(variant: Variant) -> &'static str {
    match variant {
        Variant::Raw => "forecast",
        Variant::Usable => "forecast_usable",
    }
}

/// 3.x `s.replace(/[^a-zA-Z0-9_-]/g, "_")`: one `_` per UTF-16 unit.
pub fn slug(key: &str) -> String {
    key.chars()
        .flat_map(|c| {
            let kept = c.is_ascii_alphanumeric() || c == '_' || c == '-';
            let (c, n) = if kept { (c, 1) } else { ('_', c.len_utf16()) };
            std::iter::repeat_n(c, n)
        })
        .collect()
}

/// A slug as a fragment of an `entity_id`: `[a-z0-9]` runs joined by `_`.
fn entity_id_part(text: &str) -> String {
    let lower = text.to_lowercase();
    let runs: Vec<&str> = lower.split(|c: char| !(c.is_ascii_lowercase() || c.is_ascii_digit())).collect();
    runs.into_iter().filter(|run| !run.is_empty()).collect::<Vec<_>>().join("_")
}

/// The Home Assistant device every entity of one device attaches to.
#[derive(Debug, Clone, Serialize)]
pub struct HaDevice {
    identifiers: [String; 1],
    name: String,
    manufacturer: String,
    model: String,
}

impl HaDevice {
    pub fn new(ns: &Namespace, profile_id: &str, name: &str, manufacturer: &str) -> Self {
        Self {
            identifiers: [ns.identity()],
            name: name.into(),
            manufacturer: manufacturer.into(),
            model: profile_id.into(),
        }
    }
}

/// One retained discovery config.
#[derive(Debug, Clone, PartialEq)]
pub struct Announcement {
    pub topic: String,
    pub config: Value,
}

/// Everything one device's announcements are named from.
#[derive(Debug, Clone)]
pub struct Names {
    pub ns: Namespace,
    pub topics: Topics,
    discovery_prefix: String,
    device: HaDevice,
}

fn device_class(metric: &ManifestMetric) -> Option<&'static str> {
    let unit = metric.unit.as_deref()?;
    if unit == "%" {
        return (metric.role.as_deref() == Some("battery.soc")).then_some("battery");
    }
    let classes =
        [("W", "power"), ("VA", "apparent_power"), ("kWh", "energy"), ("V", "voltage"), ("A", "current")];
    let more = [("Hz", "frequency"), ("°C", "temperature")];
    classes.into_iter().chain(more).find(|(u, _)| *u == unit).map(|(_, class)| class)
}

const fn state_class(kind: MetricKind) -> Option<&'static str> {
    match kind {
        MetricKind::Cumulative => Some("total_increasing"),
        MetricKind::Measurement => Some("measurement"),
        _ => None,
    }
}

/// The Jinja that renders a published raw value as its label.
fn label_template(labels: &BTreeMap<i32, String>) -> String {
    let map: Map<String, Value> = labels.iter().map(|(k, v)| (k.to_string(), json!(v))).collect();
    format!("{{% set m = {} %}}{{{{ m[value] if value in m else value }}}}", Value::Object(map))
}

impl Names {
    pub fn new(ns: Namespace, topic_prefix: &str, discovery_prefix: &str, device: HaDevice) -> Self {
        let topics = Topics::new(topic_prefix, &ns);
        Self { ns, topics, discovery_prefix: discovery_prefix.into(), device }
    }

    fn announcement(&self, object_id: &str, config: Map<String, Value>) -> Announcement {
        let topic = format!("{}/sensor/{}/{object_id}/config", self.discovery_prefix, self.ns.identity());
        Announcement { topic, config: Value::Object(config) }
    }

    fn shared(&self, name: &str, object_id: &str, state_topic: &str) -> Map<String, Value> {
        let suggested =
            ["sunreye".to_owned(), entity_id_part(&self.ns.device_slug), entity_id_part(object_id)];
        let suggested: Vec<String> = suggested.into_iter().filter(|part| !part.is_empty()).collect();
        let mut config = Map::new();
        config.insert("name".into(), json!(name));
        config.insert("unique_id".into(), json!(format!("{}_{object_id}", self.ns.identity())));
        config.insert("default_entity_id".into(), json!(format!("sensor.{}", suggested.join("_"))));
        config.insert("state_topic".into(), json!(state_topic));
        config.insert("availability_topic".into(), json!(self.topics.availability()));
        config.insert("device".into(), json!(self.device));
        config
    }

    /// A read-only `sensor`, writable metrics included: 4.0 announces no `number` or `select` (ADR 0005).
    pub fn sensor(&self, metric: &ManifestMetric) -> Announcement {
        let object_id = slug(&metric.key);
        let mut config = self.shared(&metric.label, &object_id, &self.topics.state(metric));
        if let Some(unit) = &metric.unit {
            config.insert("unit_of_measurement".into(), json!(unit));
        }
        if let Some(labels) = &metric.enum_labels {
            config.insert("value_template".into(), json!(label_template(labels)));
            return self.announcement(&object_id, config);
        }
        if let Some(class) = device_class(metric) {
            config.insert("device_class".into(), json!(class));
        }
        if let Some(class) = state_class(metric.kind) {
            config.insert("state_class".into(), json!(class));
        }
        self.announcement(&object_id, config)
    }

    /// Today's kWh as the state, the whole forecast as JSON attributes.
    pub fn forecast(&self, variant: Variant) -> Announcement {
        let object_id = forecast_object_id(variant);
        let name = match variant {
            Variant::Raw => "Solar forecast",
            Variant::Usable => "Solar forecast (usable)",
        };
        let mut config = self.shared(name, object_id, &self.topics.forecast_state(variant));
        config.insert("json_attributes_topic".into(), json!(self.topics.forecast_attributes(variant)));
        config.insert("unit_of_measurement".into(), json!("kWh"));
        config.insert("device_class".into(), json!("energy"));
        config.insert("state_class".into(), json!("measurement"));
        self.announcement(object_id, config)
    }
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::*;
    use crate::forecast::Variant;
    use crate::mqtt::fixture::{case, cases, catalog, device, namespace, text};

    fn announced(a: &Announcement) -> Value {
        json!({"topic": a.topic, "options": {"retain": true}, "json": a.config})
    }

    fn names(input: &Value) -> Names {
        let ns = namespace(input);
        let config = &input["config"];
        let device = device(input, &ns);
        Names::new(ns, text(&config["topicPrefix"]), text(&config["haDiscoveryPrefix"]), device)
    }

    /// The case's announcement, by object id.
    fn announce(input: &Value) -> Value {
        let names = names(input);
        let object_id = text(&input["objectId"]);
        let a = match object_id {
            "forecast" => names.forecast(Variant::Raw),
            "forecast_usable" => names.forecast(Variant::Usable),
            _ => names.sensor(catalog().iter().find(|m| slug(&m.key) == object_id).expect("metric")),
        };
        announced(&a)
    }

    #[test]
    fn metric_keys_slug_per_utf16_unit_as_recorded() {
        let case = case("slug/metric-keys");
        for (key, want) in case["output"]["slugs"].as_object().expect("slugs") {
            assert_eq!(slug(key), text(want), "{key}");
        }
        assert_eq!(slug("a😀b"), "a__b", "an astral character is two UTF-16 units in 3.x");
    }

    #[test]
    fn every_topics_case_names_the_recorded_topics() {
        for case in cases("topics/").iter().filter(|c| c["input"]["prefix"].is_string()) {
            let (input, want) = (&case["input"], &case["output"]);
            let ns = namespace(input);
            let topics = Topics::new(text(&input["prefix"]), &ns);
            let metrics = catalog();
            let state: Map<String, Value> =
                metrics.iter().map(|m| (m.key.clone(), json!(topics.state(m)))).collect();
            let variants = [("raw", Variant::Raw), ("usable", Variant::Usable)];
            let got = json!({
                "base": topics.base,
                "availability": topics.availability(),
                "state": state,
                "forecastState": variants.iter().map(|(k, v)| (*k, topics.forecast_state(*v))).collect::<BTreeMap<_, _>>(),
                "forecastAttributes": variants.iter().map(|(k, v)| (*k, topics.forecast_attributes(*v))).collect::<BTreeMap<_, _>>(),
                "identityPrefix": ns.identity(),
                "forecastObjectIds": variants.iter().map(|(k, v)| (*k, forecast_object_id(*v))).collect::<BTreeMap<_, _>>(),
            });
            assert_eq!(&got, want, "{}", case["case"]);
        }
    }

    #[test]
    fn every_discovery_case_announces_the_recorded_config() {
        let all = cases("discovery/");
        assert_eq!(all.len(), 18);
        for case in all.iter().filter(|c| c["input"]["objectId"].is_string()) {
            assert_eq!(announce(&case["input"]), case["output"]["announcement"], "{}", case["case"]);
        }
        let swap = case("discovery/profile-swap");
        for side in ["before", "after"] {
            assert_eq!(announce(&swap["input"][side]), swap["output"][side], "profile swap {side}");
        }
    }

    #[test]
    fn a_former_setting_announces_as_a_read_only_sensor_without_a_state_class() {
        let input = &case("discovery/sensor-power")["input"];
        let mut metric = catalog().into_iter().find(|m| m.key == "pv.power").expect("metric");
        metric.kind = MetricKind::Setting;
        metric.writable = true;
        let config = names(input).sensor(&metric).config;
        assert_eq!(config["device_class"], "power");
        assert!(config.get("state_class").is_none());
        assert!(config.get("command_topic").is_none());
        assert!(names(input).sensor(&metric).topic.starts_with("homeassistant/sensor/"));
    }
}
