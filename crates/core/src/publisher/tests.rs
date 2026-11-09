//! The publisher against an in-test broker: what it publishes, under which topics, in Home
//! Assistant's conventions.

use std::time::{Duration, SystemTime};

use serde_json::{Value, json};
use tokio::sync::{mpsc, watch};

use super::{BIRTH, Publishing, spawn};
use crate::bus::{Bus, DeviceId, Reading};
use crate::mqtt::fake::{self, Fake, Published};
use crate::mqtt::{self, Broker};
use crate::plant;

/// A publisher under `sunreye` with its own client, and what feeds it.
struct Running {
    fake: Fake,
    bus: Bus,
    devices: watch::Sender<Vec<(DeviceId, String)>>,
    _client: mqtt::Client,
    _publisher: super::Publisher,
}

async fn running(discovery: bool) -> Running {
    let fake = fake::serve(0).await;
    let broker = Broker {
        host: fake.address.ip().to_string(),
        port: fake.address.port(),
        credentials: None,
    };
    let client = mqtt::spawn(broker, vec![BIRTH.to_owned()]);
    let bus = Bus::default();
    let (devices, named) = watch::channel(Vec::new());
    let publishing = Publishing {
        root: "sunreye".to_owned(),
        discovery,
    };
    let publisher = spawn(&client, publishing, named, &bus);
    client.watch().wait_for(|s| s.connected).await.unwrap();
    Running {
        fake,
        bus,
        devices,
        _client: client,
        _publisher: publisher,
    }
}

impl Running {
    fn read(&self, device: u32, role: &str, value: f64) {
        self.read_at(device, role, value, SystemTime::now());
    }

    fn read_at(&self, device: u32, role: &str, value: f64, time: SystemTime) {
        self.bus.publish(Reading {
            device: DeviceId(device),
            series: self.bus.intern(role, None),
            value,
            unit: None,
            time,
            cadence: crate::endpoint::CADENCE,
        });
    }

    /// The first payload published on each of `topics`, within ten seconds.
    async fn first(&mut self, topics: &[&str]) -> Vec<String> {
        let published = collect(&mut self.fake.published, topics);
        tokio::time::timeout(Duration::from_secs(10), published)
            .await
            .unwrap_or_else(|_| panic!("never all published: {topics:?}"))
    }
}

async fn collect(
    published: &mut mpsc::UnboundedReceiver<Published>,
    topics: &[&str],
) -> Vec<String> {
    let mut seen: Vec<Option<String>> = vec![None; topics.len()];
    while seen.iter().any(Option::is_none) {
        let Published { topic, payload, .. } = published.recv().await.unwrap();
        let at = topics.iter().position(|t| *t == topic);
        if let Some(slot) = at.and_then(|at| seen.get_mut(at)) {
            slot.get_or_insert(payload);
        }
    }
    seen.into_iter().flatten().collect()
}

/// Home Assistant's energy dashboard, from its configuration dialog's text in
/// <https://github.com/home-assistant/frontend/blob/dev/src/translations/en.json>
/// (`ui.panel.config.energy`): a battery power sensor's "Positive values indicate discharging the
/// battery, negative values indicate charging the battery"; a grid power sensor is inverted when
/// "Positive values indicate exporting to the grid", so a standard one is positive when importing.
/// Ours (ADR 4): grid import and battery charging are positive.
#[tokio::test]
async fn plant_values_follow_home_assistants_documented_sign_convention() {
    let mut running = running(false).await;
    let plant = plant::DEVICE.0;
    // Importing 300 W, producing 4 kW and charging the battery at 2 kW.
    running.read(plant, "grid.power", 300.0);
    running.read(plant, "pv.power", 4000.0);
    running.read(plant, "battery.power", 2000.0);

    let published = running
        .first(&[
            "sunreye/plant/grid.power",
            "sunreye/plant/pv.power",
            "sunreye/plant/battery.power",
        ])
        .await;

    assert_eq!(published, ["300", "4000", "-2000"]);
}

/// A `read` token reads live values (ADR 9, 10): the publisher sends the plant's, not a device's.
#[tokio::test]
async fn only_the_plants_values_are_published() {
    let mut running = running(false).await;
    // Interned first, so a device's value would be sent after it.
    running.read(plant::DEVICE.0, "grid.power", 1500.0);
    running.read(7, "pv.power", 900.0);

    running.first(&["sunreye/plant/grid.power"]).await;
    tokio::time::sleep(Duration::from_millis(1100)).await;

    assert!(running.fake.published.try_recv().is_err());
}

#[tokio::test]
async fn a_device_is_online_while_it_reads_and_offline_once_silent_past_the_gap_threshold() {
    let mut running = running(false).await;
    running.devices.send_replace(vec![
        (DeviceId(7), "Deye".to_owned()),
        (DeviceId(8), "Carport".to_owned()),
        (DeviceId(9), "Meter".to_owned()),
    ]);
    running.read(7, "grid.power", 900.0);
    let silent = SystemTime::now() - Duration::from_secs(20);
    running.read_at(8, "ev.charge.power", 0.0, silent);

    let availability = running
        .first(&[
            "sunreye/devices/7/availability",
            "sunreye/devices/8/availability",
            "sunreye/devices/9/availability",
        ])
        .await;

    assert_eq!(availability, ["online", "offline", "offline"]);
}

#[tokio::test]
async fn without_discovery_nothing_is_sent_to_home_assistant() {
    let mut running = running(false).await;
    running
        .devices
        .send_replace(vec![(DeviceId(7), "Deye".to_owned())]);
    running.fake.publish(BIRTH, "online");

    running.first(&["sunreye/devices/7/availability"]).await;
    tokio::time::sleep(Duration::from_millis(1100)).await;

    while let Ok(published) = running.fake.published.try_recv() {
        assert!(published.topic.starts_with("sunreye/"), "{published:?}");
    }
}

const DISCOVERY: &str = "homeassistant/device/sunreye_sunreye/config";

fn power(key: &str, name: &str, role: &str) -> (String, Value) {
    sensor(key, name, role, ("power", "W"))
}

fn sensor(key: &str, name: &str, role: &str, (class, unit): (&str, &str)) -> (String, Value) {
    let component = json!({ "platform": "sensor", "unique_id": format!("sunreye_sunreye_{key}"),
        "name": name, "state_topic": format!("sunreye/plant/{role}"), "device_class": class,
        "state_class": "measurement", "unit_of_measurement": unit, "expire_after": 15 });
    (key.to_owned(), component)
}

fn connectivity(id: u32, name: &str) -> (String, Value) {
    let component = json!({ "platform": "binary_sensor",
        "unique_id": format!("sunreye_sunreye_device_{id}"), "name": name,
        "state_topic": format!("sunreye/devices/{id}/availability"),
        "device_class": "connectivity", "payload_on": "online", "payload_off": "offline",
        "expire_after": 15 });
    (format!("device_{id}"), component)
}

/// Device discovery, <https://www.home-assistant.io/integrations/mqtt/>: one message on
/// `<discovery_prefix>/device/<object_id>/config`, the prefix `homeassistant` by default, whose
/// `device` and `origin` are mandatory and whose `components` each name a `platform`. Sensor
/// options, <https://www.home-assistant.io/integrations/sensor.mqtt/>: "After expiry, the sensor's
/// state becomes `unavailable`". Units per device class,
/// <https://developers.home-assistant.io/docs/core/entity/sensor/>: `power` in W, `battery` in %,
/// `energy_storage` in kWh ("Energy stored, like the charge in a home battery").
#[tokio::test]
async fn discovery_describes_the_plants_values_and_each_devices_availability() {
    let mut running = running(true).await;
    running.first(&[DISCOVERY]).await;
    running
        .devices
        .send_replace(vec![(DeviceId(7), "Deye".to_owned())]);

    let discovery = running.first(&[DISCOVERY]).await;

    let components: serde_json::Map<String, Value> = [
        power("grid_power", "Grid power", "grid.power"),
        power("pv_power", "PV power", "pv.power"),
        power("generator_power", "Generator power", "generator.power"),
        power("battery_power", "Battery power", "battery.power"),
        power("load_power", "Load power", "load.power"),
        power("backup_power", "Backup power", "backup.power"),
        power("ev_charge_power", "EV charge power", "ev.charge.power"),
        sensor(
            "battery_soc",
            "Battery state of charge",
            "battery.soc",
            ("battery", "%"),
        ),
        sensor(
            "battery_capacity",
            "Battery capacity",
            "battery.capacity",
            ("energy_storage", "kWh"),
        ),
        connectivity(7, "Deye"),
    ]
    .into_iter()
    .collect();
    let expected = json!({
        "device": { "identifiers": ["sunreye_sunreye"], "name": "SunReye plant",
            "manufacturer": "SunReye" },
        "origin": { "name": "SunReye" },
        "components": components,
    });
    let discovery: Value = serde_json::from_str(&discovery[0]).unwrap();
    assert_eq!(discovery, expected);
}

/// "A better approach" than retaining discovery is to send it again when the MQTT integration
/// sends its birth message, by default `online` on `homeassistant/status`
/// (<https://www.home-assistant.io/integrations/mqtt/>).
#[tokio::test]
async fn discovery_is_sent_again_on_home_assistants_birth_and_when_the_devices_change() {
    let mut running = running(true).await;
    running.first(&[DISCOVERY]).await;

    running.fake.publish(BIRTH, "online");
    running.first(&[DISCOVERY]).await;
    running
        .devices
        .send_replace(vec![(DeviceId(8), "Carport".to_owned())]);
    let changed = running.first(&[DISCOVERY]).await;

    let changed: Value = serde_json::from_str(&changed[0]).unwrap();
    assert_eq!(changed["components"]["device_8"]["name"], json!("Carport"));
}
