//! Devices behind an in-test broker holding EVCC's retained state, observed on the bus.
//!
//! The topics and units are EVCC's MQTT API, <https://docs.evcc.io/en/integrations/mqtt-api>:
//! loadpoint ids begin at 1, session energy is in Wh. The payloads were recorded in v4 from a
//! live EVCC 0.301 with one loadpoint; an unset value is an empty payload, and the mode is text.

use std::sync::Arc;
use std::time::Duration;

use sunreye_profile::{Profile, Unit};
use tokio::sync::broadcast::Receiver;

use super::spawn;
use crate::bus::{Bus, DeviceId, Reading};
use crate::endpoint::{CADENCE, Device};
use crate::mqtt::Broker;
use crate::mqtt::fake::{self, Fake};

/// EVCC's retained state for loadpoint 1, a Tesla charging at 11 kW, and loadpoint 2, empty.
const RETAINED: &[(&str, &str)] = &[
    ("evcc/loadpoints", "2"),
    ("evcc/loadpoints/1/title", "Carport"),
    ("evcc/loadpoints/1/mode", "pv"),
    ("evcc/loadpoints/1/chargePower", "11040.5"),
    ("evcc/loadpoints/1/vehicleSoc", "63"),
    ("evcc/loadpoints/1/sessionEnergy", "4500"),
    ("evcc/loadpoints/1/connected", "true"),
    ("evcc/loadpoints/1/charging", "true"),
    ("evcc/loadpoints/1/chargeCurrents/l1", "16"),
    ("evcc/loadpoints/2/chargePower", "0"),
    ("evcc/loadpoints/2/vehicleSoc", ""),
    ("evcc/loadpoints/2/sessionEnergy", "0"),
    ("evcc/loadpoints/2/connected", "false"),
    ("evcc/loadpoints/2/charging", "false"),
    ("evcc/site/gridPower", "-1200"),
];

fn evcc() -> Arc<Profile> {
    Arc::new(Profile::load(include_str!("../../../../profiles/evcc.json")).unwrap())
}

fn broker(fake: &Fake) -> Broker {
    Broker {
        host: fake.address.ip().to_string(),
        port: fake.address.port(),
        credentials: None,
    }
}

fn loadpoint(id: u32, index: u8) -> Device {
    Device {
        id: DeviceId(id),
        unit: index,
        profile: evcc(),
    }
}

async fn served() -> Fake {
    let fake = fake::serve(0).await;
    for (topic, payload) in RETAINED {
        fake.retain(topic, payload);
    }
    fake
}

type Seen = (u32, String, f64, Option<Unit>);

/// Every reading until `count` distinct (device, role) pairs were seen, latest value each, sorted.
async fn latest(bus: &Bus, readings: &mut Receiver<Reading>, count: usize) -> Vec<Seen> {
    let mut seen: Vec<Seen> = Vec::new();
    while seen.len() < count {
        let reading = readings.recv().await.unwrap();
        let role = bus.series(reading.series).unwrap().role;
        seen.retain(|(d, r, ..)| !(*d == reading.device.0 && *r == role));
        seen.push((reading.device.0, role, reading.value, reading.unit));
    }
    seen.sort_by(|a, b| (a.0, &a.1).cmp(&(b.0, &b.1)));
    seen
}

fn ev(device: u32, role: &str, value: f64, unit: Option<Unit>) -> Seen {
    (device, role.to_owned(), value, unit)
}

#[tokio::test]
async fn each_loadpoint_reads_its_own_topics_as_ev_roles() {
    let fake = served().await;
    let bus = Bus::default();
    let mut readings = bus.subscribe();
    let _subscriber = spawn(
        broker(&fake),
        "evcc",
        vec![loadpoint(7, 1), loadpoint(8, 2)],
        Vec::new(),
        bus.clone(),
    );

    let seen = latest(&bus, &mut readings, 10).await;

    assert_eq!(
        seen,
        [
            ev(7, "ev.charge.power", 11040.5, Some(Unit::Watt)),
            ev(7, "ev.charging", 1.0, None),
            ev(7, "ev.connected", 1.0, None),
            ev(7, "ev.mode", 3.0, None),
            ev(7, "ev.session.energy", 4.5, Some(Unit::KilowattHour)),
            ev(7, "ev.vehicle.soc", 63.0, Some(Unit::Percent)),
            ev(8, "ev.charge.power", 0.0, Some(Unit::Watt)),
            ev(8, "ev.charging", 0.0, None),
            ev(8, "ev.connected", 0.0, None),
            ev(8, "ev.session.energy", 0.0, Some(Unit::KilowattHour)),
        ]
    );
}

/// Every reading published so far, as (device, role, value, unit).
fn drained(bus: &Bus, readings: &mut Receiver<Reading>) -> Vec<Seen> {
    let mut seen = Vec::new();
    while let Ok(reading) = readings.try_recv() {
        let role = bus.series(reading.series).unwrap().role;
        seen.push((reading.device.0, role, reading.value, reading.unit));
    }
    seen.sort_by(|a, b| (a.0, &a.1).cmp(&(b.0, &b.1)));
    seen
}

/// Waits for a reading of `role` with `value`.
async fn until_read(bus: &Bus, readings: &mut Receiver<Reading>, role: &str, value: f64) {
    loop {
        let reading = readings.recv().await.unwrap();
        if bus.series(reading.series).unwrap().role == role
            && reading.value.to_bits() == value.to_bits()
        {
            return;
        }
    }
}

#[tokio::test]
async fn the_held_values_are_published_every_cadence_and_an_empty_payload_clears_one() {
    let fake = served().await;
    let bus = Bus::default();
    let mut readings = bus.subscribe();
    let _subscriber = spawn(
        broker(&fake),
        "evcc",
        vec![loadpoint(7, 1)],
        Vec::new(),
        bus.clone(),
    );
    until_read(&bus, &mut readings, "ev.charging", 1.0).await;

    fake.publish("evcc/loadpoints/1/vehicleSoc", "");
    fake.publish("evcc/loadpoints/1/chargePower", "7360");
    until_read(&bus, &mut readings, "ev.charge.power", 7360.0).await;
    tokio::time::pause();
    drained(&bus, &mut readings);
    tokio::time::sleep(CADENCE).await;

    assert_eq!(
        drained(&bus, &mut readings),
        [
            ev(7, "ev.charge.power", 7360.0, Some(Unit::Watt)),
            ev(7, "ev.charging", 1.0, None),
            ev(7, "ev.connected", 1.0, None),
            ev(7, "ev.mode", 3.0, None),
            ev(7, "ev.session.energy", 4.5, Some(Unit::KilowattHour)),
        ]
    );
}

#[tokio::test]
async fn nothing_is_published_while_the_broker_is_gone() {
    let fake = served().await;
    let bus = Bus::default();
    let mut readings = bus.subscribe();
    let subscriber = spawn(
        broker(&fake),
        "evcc",
        vec![loadpoint(7, 1)],
        Vec::new(),
        bus.clone(),
    );
    until_read(&bus, &mut readings, "ev.charging", 1.0).await;

    fake.shut();
    while subscriber.status().connected {
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    tokio::time::pause();
    drained(&bus, &mut readings);
    tokio::time::sleep(CADENCE * 3).await;

    assert_eq!(drained(&bus, &mut readings), []);
}
