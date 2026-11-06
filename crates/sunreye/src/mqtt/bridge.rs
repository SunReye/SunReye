//! One device's export as a state machine: what each event puts on the wire. No socket here; the link
//! carries the result.

use std::collections::BTreeMap;
use std::sync::Arc;

use super::discovery::Names;
use super::number;
use crate::forecast::{Forecast, Variant};
use crate::manifest::ManifestMetric;
use crate::samples::Sample;

const VARIANTS: [Variant; 2] = [Variant::Raw, Variant::Usable];

/// One publish at `QoS` 0.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Publish {
    pub topic: String,
    pub payload: String,
    pub retain: bool,
}

fn retained(topic: String, payload: String) -> Publish {
    Publish { topic, payload, retain: true }
}

#[derive(Debug)]
pub struct Bridge {
    names: Names,
    metrics: Vec<ManifestMetric>,
    discovery: bool,
    online: bool,
    /// Readings from while the broker was away, latest per state topic: never more than the catalog.
    queued: BTreeMap<String, String>,
    /// Readings sent this connection, latest per state topic: a dead socket may have swallowed them.
    sent: BTreeMap<String, String>,
    /// Restored on every connect, as 3.x does.
    forecast: Option<Arc<Forecast>>,
}

impl Bridge {
    pub fn new(names: Names, metrics: Vec<ManifestMetric>, discovery: bool) -> Self {
        Self {
            names,
            metrics,
            discovery,
            online: false,
            queued: BTreeMap::new(),
            sent: BTreeMap::new(),
            forecast: None,
        }
    }

    /// The last will: the broker marks the device unavailable when the connection dies.
    pub fn will(&self) -> Publish {
        retained(self.names.topics.availability(), "offline".into())
    }

    /// Online, the discovery configs, the last forecast, then what queued while away.
    pub fn connected(&mut self) -> Vec<Publish> {
        self.online = true;
        let mut out = vec![retained(self.names.topics.availability(), "online".into())];
        if self.discovery {
            let sensors = self.metrics.iter().map(|m| self.names.sensor(m));
            let forecasts = VARIANTS.iter().map(|v| self.names.forecast(*v));
            out.extend(sensors.chain(forecasts).map(|a| retained(a.topic, a.config.to_string())));
        }
        if let Some(forecast) = &self.forecast {
            out.extend(self.forecast_publishes(forecast));
        }
        let queued = std::mem::take(&mut self.queued);
        out.extend(queued.iter().map(|(topic, payload)| retained(topic.clone(), payload.clone())));
        self.sent.extend(queued);
        out
    }

    /// Queues again what this connection sent: retained and latest per topic, so a repeat is harmless.
    pub fn dropped(&mut self) {
        self.online = false;
        self.queued.extend(std::mem::take(&mut self.sent));
    }

    /// Each catalog metric the sample carries, in catalog order; queued while offline.
    pub fn sample(&mut self, sample: &Sample) -> Vec<Publish> {
        let readings: Vec<Publish> = self
            .metrics
            .iter()
            .filter_map(|m| {
                let (_, value) = sample.values.iter().find(|(key, _)| *key == m.key)?;
                Some(retained(self.names.topics.state(m), number::state(*value)?))
            })
            .collect();
        if self.online {
            self.sent.extend(readings.iter().map(|p| (p.topic.clone(), p.payload.clone())));
            return readings;
        }
        self.queued.extend(readings.into_iter().map(|p| (p.topic, p.payload)));
        Vec::new()
    }

    /// None, a forecast that is off or unavailable, publishes nothing and keeps the last one.
    pub fn forecast(&mut self, forecast: Option<Arc<Forecast>>) -> Vec<Publish> {
        let Some(forecast) = forecast else { return Vec::new() };
        let out = if self.online { self.forecast_publishes(&forecast) } else { Vec::new() };
        self.forecast = Some(forecast);
        out
    }

    fn forecast_publishes(&self, forecast: &Forecast) -> Vec<Publish> {
        let topics = &self.names.topics;
        VARIANTS
            .iter()
            .flat_map(|variant| {
                let export = forecast.export(*variant);
                let attributes = serde_json::to_string(&export).unwrap_or_default();
                let today = number::state(export.view.today_kwh);
                let today = today.map(|kwh| retained(topics.forecast_state(*variant), kwh));
                today.into_iter().chain([retained(topics.forecast_attributes(*variant), attributes)])
            })
            .collect()
    }

    /// Offline, before a clean disconnect; nothing while already offline.
    pub fn close(&mut self) -> Vec<Publish> {
        let was_online = std::mem::replace(&mut self.online, false);
        if was_online { vec![self.will()] } else { Vec::new() }
    }

    /// Readings waiting for the broker.
    pub fn pending(&self) -> usize {
        self.queued.len()
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use serde_json::{Value, json};

    use super::*;
    use crate::forecast::{Forecast, ForecastView};
    use crate::mqtt::discovery::Names;
    use crate::mqtt::fixture::{case, cases, catalog, device, namespace, text};
    use crate::oracle::as_floats;

    fn bridge(input: &Value) -> Bridge {
        let ns = namespace(input);
        let config = &input["config"];
        let device = device(input, &ns);
        let names = Names::new(ns, text(&config["topicPrefix"]), text(&config["haDiscoveryPrefix"]), device);
        Bridge::new(names, catalog(), config["haDiscoveryEnabled"] == true)
    }

    /// The recorded forecast, rebuilt from what `forecast/connected` published.
    fn fixed_forecast() -> Arc<Forecast> {
        let connected = case("forecast/connected");
        let published = &connected["output"]["steps"][1]["published"];
        let view = |at: usize| -> ForecastView {
            serde_json::from_value(published[at]["json"].clone()).expect("view")
        };
        let raw = &published[1]["json"];
        Arc::new(Forecast {
            provider: text(&raw["provider"]).into(),
            step_minutes: raw["stepMinutes"].as_i64().expect("step"),
            utc_offset_seconds: i32::try_from(raw["utcOffsetSeconds"].as_i64().expect("offset"))
                .expect("i32"),
            raw: view(1),
            usable: view(3),
        })
    }

    fn sample(readings: &Value) -> Sample {
        let values = readings
            .as_object()
            .expect("readings")
            .iter()
            .map(|(k, v)| (k.clone(), v.as_f64().expect("number")))
            .collect();
        Sample { at_ms: 0, values }
    }

    fn wire(publishes: &[Publish]) -> Value {
        publishes
            .iter()
            .map(|p| match serde_json::from_str::<Value>(&p.payload) {
                Ok(parsed) if parsed.is_object() => {
                    json!({"topic": p.topic, "options": {"retain": p.retain}, "json": as_floats(&parsed)})
                }
                _ => json!({"topic": p.topic, "options": {"retain": p.retain}, "payload": p.payload}),
            })
            .collect()
    }

    /// The recorded step with the #317 deviation: a numeric payload at two decimals, by scaling and rounding.
    fn recorded(published: &Value) -> Value {
        let rounded = |p: &Value| match p["payload"].as_str().and_then(|text| text.parse::<f64>().ok()) {
            Some(n) => {
                json!({"topic": p["topic"], "options": p["options"], "payload": format!("{}", (n * 100.0).round() / 100.0)})
            }
            None => p.clone(),
        };
        published
            .as_array()
            .expect("published")
            .iter()
            .map(|p| {
                if p["json"].is_object() {
                    json!({"topic": p["topic"], "options": p["options"], "json": as_floats(&p["json"])})
                } else {
                    rounded(p)
                }
            })
            .collect()
    }

    fn step(bridge: &mut Bridge, step: &Value) -> Vec<Publish> {
        match text(&step["do"]) {
            "connect" => bridge.connected(),
            "drop" => {
                bridge.dropped();
                Vec::new()
            }
            "close" => bridge.close(),
            "forecast" => bridge.forecast(step["forecast"].is_string().then(fixed_forecast)),
            "sample" => bridge.sample(&sample(&step["readings"])),
            other => panic!("unknown step {other}"),
        }
    }

    #[test]
    fn every_bridge_state_and_forecast_case_publishes_the_recorded_steps() {
        let all: Vec<Value> = ["bridge/", "state/", "forecast/"].iter().flat_map(|p| cases(p)).collect();
        assert_eq!(all.len(), 14);
        for case in all {
            let mut bridge = bridge(&case["input"]);
            let output = &case["output"];
            let will = bridge.will();
            assert_eq!(
                json!({"topic": will.topic, "payload": will.payload, "qos": 0, "retain": will.retain}),
                output["will"],
                "{}",
                case["case"]
            );
            let asked = case["input"]["steps"].as_array().expect("steps");
            for (n, recorded_step) in output["steps"].as_array().expect("steps").iter().enumerate() {
                let mut recorded_step = recorded_step.clone();
                recorded_step["forecast"] = asked[n]["forecast"].clone();
                let published = step(&mut bridge, &recorded_step);
                assert_eq!(
                    wire(&published),
                    recorded(&recorded_step["published"]),
                    "{} {}",
                    case["case"],
                    recorded_step["do"]
                );
            }
        }
    }

    #[test]
    fn a_full_run_publishes_the_recorded_topics_and_no_command_topic() {
        let case = case("topics/no-command-topic");
        let mut bridge = bridge(&case["input"]);
        let readings = &cases("state/rounding-and-sign")[0]["output"]["steps"][1]["readings"];
        let mut run = bridge.connected();
        run.extend(bridge.sample(&sample(readings)));
        run.extend(bridge.forecast(Some(fixed_forecast())));
        bridge.dropped();
        run.extend(bridge.connected());
        run.extend(bridge.close());
        let topics: BTreeSet<&str> = run.iter().map(|p| p.topic.as_str()).collect();
        let want: BTreeSet<&str> =
            case["output"]["topics"].as_array().expect("topics").iter().map(text).collect();
        assert_eq!(topics, want);
        assert!(run.iter().all(|p| !p.topic.ends_with("/set") && !p.payload.contains("command_topic")));
    }

    #[test]
    fn readings_while_down_keep_only_the_latest_per_topic_and_go_out_on_reconnect() {
        let input = &case("state/offline-publishes-nothing")["input"];
        let mut bridge = bridge(input);
        bridge.connected();
        bridge.dropped();
        for n in 0..10_000 {
            let values = vec![("pv.power".to_owned(), f64::from(n)), ("battery.soc".to_owned(), 50.0)];
            assert_eq!(bridge.sample(&Sample { at_ms: 0, values }), []);
            assert!(bridge.pending() <= 2, "{}", bridge.pending());
        }
        bridge.sample(&Sample { at_ms: 0, values: vec![("grid.import".to_owned(), 1.5)] });
        let resumed = bridge.connected();
        let states: Vec<(&str, &str)> =
            resumed.iter().skip(1).map(|p| (p.topic.as_str(), p.payload.as_str())).collect();
        assert_eq!(
            states,
            [
                ("sunreye/haus-sud/inverter/battery/soc", "50"),
                ("sunreye/haus-sud/inverter/grid/import", "1.5"),
                ("sunreye/haus-sud/inverter/pv/power", "9999"),
            ]
        );
        assert_eq!(bridge.pending(), 0);
        assert!(bridge.connected().len() == 1, "a queue goes out once per connection");
    }

    #[test]
    fn a_reading_outside_the_catalog_is_not_published_or_queued() {
        let input = &case("state/offline-publishes-nothing")["input"];
        let mut bridge = bridge(input);
        let stray = Sample { at_ms: 0, values: vec![("not.in.catalog".to_owned(), 1.0)] };
        assert_eq!(bridge.sample(&stray), []);
        assert_eq!(bridge.pending(), 0);
        bridge.connected();
        assert_eq!(bridge.sample(&stray), []);
        assert!(bridge.close().len() == 1 && bridge.close().is_empty(), "offline is published once");
    }
}
