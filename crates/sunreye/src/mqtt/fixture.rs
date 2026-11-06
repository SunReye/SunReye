//! The MQTT oracle (`fixtures/oracle/mqtt.ndjson`) as the export's inputs.

use serde_json::Value;

use super::discovery::{HaDevice, Namespace};
use crate::manifest::ManifestMetric;
use crate::oracle::oracle;

pub fn cases(prefix: &str) -> Vec<Value> {
    oracle("mqtt.ndjson")
        .into_iter()
        .filter(|case| case["case"].as_str().is_some_and(|name| name.starts_with(prefix)))
        .collect()
}

pub fn case(name: &str) -> Value {
    oracle("mqtt.ndjson").into_iter().find(|case| case["case"] == name).expect("case")
}

pub fn catalog() -> Vec<ManifestMetric> {
    serde_json::from_value(case("catalog/main")["metrics"].clone()).expect("metrics")
}

pub fn text(value: &Value) -> &str {
    value.as_str().expect("string")
}

pub fn namespace(input: &Value) -> Namespace {
    let ns = &input["namespace"];
    Namespace { plant_slug: text(&ns["plantSlug"]).into(), device_slug: text(&ns["deviceSlug"]).into() }
}

/// The input's profile, or the catalog's when the case names none.
pub fn device(input: &Value, ns: &Namespace) -> HaDevice {
    let catalog = case("catalog/main");
    let profile = if input["profile"].is_object() { &input["profile"] } else { &catalog["profile"] };
    HaDevice::new(ns, text(&profile["id"]), text(&profile["name"]), text(&profile["manufacturer"]))
}
