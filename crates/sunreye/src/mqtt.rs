//! The read-only MQTT and Home Assistant export, in the 3.x shapes (`fixtures/oracle/mqtt.ndjson`). Each
//! in-service device has its own connection, so each has its own will on its own availability topic.

pub mod bridge;
pub mod config;
pub mod discovery;
#[cfg(test)]
mod fixture;
pub mod link;
pub mod number;
pub mod wire;

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex, PoisonError};

use rustls::pki_types::CertificateDer;
use tokio::sync::watch;
use tokio::task::JoinSet;

use self::bridge::Bridge;
use self::config::MqttConfig;
use self::discovery::{HaDevice, Names, Namespace};
use self::link::{Dial, Feeds, Link};
use crate::forecast::Forecast;
use crate::profile::Profile;
use crate::samples::Sample;
use crate::store::DeviceRow;

/// One device's export, ready to run.
#[derive(Debug)]
pub struct Planned {
    pub device: i64,
    /// The plant forecast goes out under this device, the first in service, as 3.x put it under its one device.
    pub forecast: bool,
    pub dial: Dial,
    pub bridge: Bridge,
}

/// The exports `config` asks for: none while off.
pub fn plan(
    config: &MqttConfig,
    devices: &[DeviceRow],
    profile_of: impl Fn(&str) -> Option<Arc<Profile>>,
    roots: &[CertificateDer<'static>],
) -> Vec<Planned> {
    let Some(broker) = config.broker() else { return Vec::new() };
    if !broker.tls && config.password().is_some() {
        tracing::warn!(host = %broker.host, "MQTT password sent in cleartext: use mqtts://");
    }
    let known =
        devices.iter().filter(|d| d.in_service()).filter_map(|d| Some((d, profile_of(&d.profile_id)?)));
    known
        .enumerate()
        .map(|(n, (device, profile))| {
            let ns = Namespace { plant_slug: config.plant_slug.clone(), device_slug: device.id.to_string() };
            let client = config.client_id.clone().unwrap_or_else(|| format!("sunreye-{}", config.plant_slug));
            let ha = HaDevice::new(&ns, &profile.id, &profile.name, &profile.manufacturer);
            let names = Names::new(ns, &config.topic_prefix, &config.ha_discovery_prefix, ha);
            let metrics = crate::manifest::manifest(&profile).metrics;
            Planned {
                device: device.id,
                forecast: n == 0,
                dial: Dial {
                    broker: broker.clone(),
                    client_id: format!("{client}-{}", device.id),
                    username: config.username.clone(),
                    password: config.password().map(str::to_owned),
                    roots: roots.to_vec(),
                },
                bridge: Bridge::new(names, metrics, config.ha_discovery_enabled),
            }
        })
        .collect()
}

type Feed = watch::Sender<Option<Arc<Sample>>>;
type Tasks = (watch::Sender<bool>, JoinSet<()>);

/// The running exports and what feeds them. Feeding never waits: each device keeps its latest sample.
#[derive(Debug)]
pub struct Exports {
    samples: Mutex<BTreeMap<i64, Feed>>,
    forecast: watch::Sender<Option<Arc<Forecast>>>,
    running: tokio::sync::Mutex<Option<Tasks>>,
    /// Signalled after each restart, so the forecast goes out without waiting for its interval.
    pub restarted: tokio::sync::Notify,
}

impl Default for Exports {
    fn default() -> Self {
        Self {
            samples: Mutex::default(),
            forecast: watch::channel(None).0,
            running: tokio::sync::Mutex::default(),
            restarted: tokio::sync::Notify::new(),
        }
    }
}

impl Exports {
    pub fn sample(&self, device: i64, sample: &Sample) {
        let samples = self.samples.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(feed) = samples.get(&device) {
            feed.send_replace(Some(Arc::new(sample.clone())));
        }
    }

    /// Whether any export runs, so the forecast is only built for one.
    pub fn active(&self) -> bool {
        !self.samples.lock().unwrap_or_else(PoisonError::into_inner).is_empty()
    }

    pub fn forecast(&self, forecast: Forecast) {
        self.forecast.send_replace(Some(Arc::new(forecast)));
    }

    /// Stops the running exports, each publishing `offline`, then runs `planned`.
    pub async fn restart(&self, planned: Vec<Planned>) {
        let mut running = self.running.lock().await;
        stop(running.take()).await;
        let (stop, stopped) = watch::channel(false);
        let mut tasks = JoinSet::new();
        let mut samples = BTreeMap::new();
        for Planned { device, forecast, dial, bridge } in planned {
            let (publisher, readings) = watch::channel(None);
            samples.insert(device, publisher);
            let mut forecasts = if forecast { self.forecast.subscribe() } else { watch::channel(None).1 };
            forecasts.mark_changed();
            let feeds = Feeds { samples: readings, forecast: forecasts, stop: stopped.clone() };
            let link = Link { dial, open: link::network(), pause: link::sleep(), jitter: link::jitter };
            tasks.spawn(link::run(link, bridge, feeds));
        }
        *self.samples.lock().unwrap_or_else(PoisonError::into_inner) = samples;
        *running = Some((stop, tasks));
        self.restarted.notify_one();
    }

    pub async fn stop(&self) {
        self.samples.lock().unwrap_or_else(PoisonError::into_inner).clear();
        stop(self.running.lock().await.take()).await;
    }
}

/// How long the links get to publish `offline` before they are aborted.
const GRACE: std::time::Duration = std::time::Duration::from_secs(10);

async fn stop(running: Option<Tasks>) {
    let Some((stop, mut tasks)) = running else { return };
    stop.send_replace(true);
    let joined = async { while tasks.join_next().await.is_some() {} };
    if tokio::time::timeout(GRACE, joined).await.is_err() {
        tasks.shutdown().await;
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;
    use crate::modbus::Transport;
    use crate::profile::Bundle;

    fn row(id: i64, profile: &str, retired: bool) -> DeviceRow {
        DeviceRow {
            id,
            connection_id: 1,
            profile_id: profile.into(),
            unit_id: 1,
            name: None,
            role: "inverter".into(),
            retired_at: retired.then(|| "2026-01-01T00:00:00Z".into()),
            transport: Transport::Tcp,
            host: "h".into(),
            port: 502,
            logger_serial: None,
        }
    }

    fn config(body: serde_json::Value) -> MqttConfig {
        MqttConfig::default().patched(&serde_json::from_value(body).expect("body")).expect("valid")
    }

    #[test]
    fn every_in_service_device_with_a_known_profile_gets_a_link_and_the_first_carries_the_forecast() {
        let bundle = Bundle::official().expect("bundle");
        let devices = [
            row(1, "deye-sg05lp3", true),
            row(2, "deye-sg05lp3", false),
            row(3, "nope", false),
            row(4, "deye-sg05lp3", false),
        ];
        let on =
            config(serde_json::json!({"enabled": true, "brokerUrl": "mqtt://b", "plantSlug": "haus-sud"}));
        let planned = plan(&on, &devices, |id| bundle.profile(id).cloned(), &[]);
        let got: Vec<(i64, bool, &str)> =
            planned.iter().map(|p| (p.device, p.forecast, p.dial.client_id.as_str())).collect();
        assert_eq!(got, [(2, true, "sunreye-haus-sud-2"), (4, false, "sunreye-haus-sud-4")]);
        assert_eq!(planned[0].bridge.will().topic, "sunreye/haus-sud/2/status");

        let named = config(
            serde_json::json!({"enabled": true, "brokerUrl": "mqtt://b", "clientId": "x", "username": "u", "password": "p"}),
        );
        let planned = plan(&named, &devices, |id| bundle.profile(id).cloned(), &[]);
        assert_eq!(planned[1].dial.client_id, "x-4");
        assert_eq!(
            (planned[1].dial.username.as_deref(), planned[1].dial.password.as_deref()),
            (Some("u"), Some("p"))
        );

        let off = config(serde_json::json!({"brokerUrl": "mqtt://b"}));
        assert!(plan(&off, &devices, |id| bundle.profile(id).cloned(), &[]).is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn stopping_aborts_an_mqtt_link_that_is_still_running_after_the_grace() {
        let mut tasks = JoinSet::new();
        tasks.spawn(std::future::pending::<()>());
        let started = tokio::time::Instant::now();
        let stopping = stop(Some((watch::channel(false).0, tasks)));
        tokio::time::timeout(Duration::from_secs(60), stopping).await.expect("stopped");
        let waited = started.elapsed();
        assert!(waited >= Duration::from_secs(10) && waited < Duration::from_secs(11), "{waited:?}");
    }

    #[tokio::test]
    async fn the_latest_forecast_is_held_for_the_export_that_carries_it() {
        use crate::forecast::{ForecastView, Next15};
        let view = ForecastView {
            series: Vec::new(),
            today_kwh: 1.5,
            remaining_today_kwh: 0.0,
            tomorrow_kwh: 0.0,
            next15: Next15 { max_power_w: 0.0, avg_power_w: 0.0, energy_kwh: 0.0 },
        };
        let forecast = Forecast {
            provider: "p".into(),
            step_minutes: 60,
            utc_offset_seconds: 0,
            usable: view.clone(),
            raw: view,
        };
        let exports = Exports::default();
        assert!(!exports.active());
        exports.forecast(forecast);
        let held = exports.forecast.borrow().clone().expect("held");
        assert_eq!(held.raw.today_kwh, 1.5);
        exports.sample(1, &Sample { at_ms: 0, values: Vec::new() });
        exports.stop().await;
    }
}
