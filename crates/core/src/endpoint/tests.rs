//! An endpoint task over `sim`, observed on the bus.

use std::sync::Arc;
use std::time::{Duration, SystemTime};

use sunreye_profile::{Profile, Unit};
use tokio::sync::broadcast::Receiver;
use tokio::time::Instant;

use super::{Device, backoff, spawn};
use crate::bus::{Bus, DeviceId, Reading};
use crate::transport::{Capture, Endpoint, Exchange};

/// Three quantities in one block: registers 500 to 502.
const PROFILE: &str = r#"{
    "schema": 1, "id": "case", "name": "case", "manufacturer": "test", "version": "1.0.0",
    "requires": ["modbus", "u16", "i16"],
    "quantities": [
        { "key": "pv1", "role": "pv.mppt.power", "index": 1, "register": 500, "type": "u16" },
        { "key": "battery", "role": "battery.power", "register": 501, "type": "i16" },
        { "key": "temp", "role": "extra.radiator_temp", "register": 502, "type": "u16", "scale": 0.1 }
    ]
}"#;

fn unhex(hex: &str) -> Vec<u8> {
    (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap())
        .collect()
}

/// Unit 1 answers registers 500 to 502 with 1234, -1000 and 25.
fn one_cycle() -> Vec<Exchange> {
    vec![
        Exchange::Request(unhex("000100000006010301f40003")),
        Exchange::Reply(vec![unhex("00010000000901030604d2fc180019")]),
    ]
}

fn device() -> Device {
    Device {
        id: DeviceId(7),
        unit: 1,
        profile: Arc::new(Profile::load(PROFILE).unwrap()),
    }
}

type Seen = (u32, String, Option<u32>, f64, Option<Unit>);

fn seen(bus: &Bus, reading: Reading) -> Seen {
    let series = bus.series(reading.series).unwrap();
    (
        reading.device.0,
        series.role,
        series.index,
        reading.value,
        reading.unit,
    )
}

/// The next poll cycle's readings: one per quantity.
async fn cycle(readings: &mut Receiver<Reading>) -> Vec<Reading> {
    let mut got = Vec::new();
    for _ in 0..3 {
        got.push(readings.recv().await.unwrap());
    }
    got
}

fn first_cycle() -> Vec<Seen> {
    vec![
        (7, "pv.mppt.power".into(), Some(1), 1234.0, Some(Unit::Watt)),
        (7, "battery.power".into(), None, -1000.0, Some(Unit::Watt)),
        (7, "extra.radiator_temp".into(), None, 2.5, None),
    ]
}

#[tokio::test(start_paused = true)]
async fn one_poll_cycle_publishes_typed_readings() {
    let bus = Bus::default();
    let mut readings = bus.subscribe();
    let before = SystemTime::now();
    let capture = Capture {
        exchanges: one_cycle(),
    };
    let _task = spawn(Endpoint::Sim(capture), vec![device()], bus.clone());
    let got = cycle(&mut readings).await;
    assert!(
        got.iter()
            .all(|r| r.time >= before && r.time <= SystemTime::now())
    );
    let got: Vec<Seen> = got.into_iter().map(|r| seen(&bus, r)).collect();
    assert_eq!(got, first_cycle());
}

#[tokio::test(start_paused = true)]
async fn an_error_backs_off_and_the_last_good_value_reports_its_age() {
    let bus = Bus::default();
    let mut readings = bus.subscribe();
    // The second cycle's request goes unanswered and times out 3 s later, at 8 s.
    let mut exchanges = one_cycle();
    exchanges.push(Exchange::Request(unhex("000200000006010301f40003")));
    let start = Instant::now();
    let task = spawn(
        Endpoint::Sim(Capture { exchanges }),
        vec![device()],
        bus.clone(),
    );
    cycle(&mut readings).await;

    tokio::time::sleep_until(start + Duration::from_secs(12)).await;
    let latest: Vec<(Seen, Duration)> = task
        .latest()
        .into_iter()
        .map(|(reading, age)| (seen(&bus, reading), age))
        .collect();
    let twelve = Duration::from_secs(12);
    assert_eq!(
        latest,
        first_cycle()
            .into_iter()
            .map(|s| (s, twelve))
            .collect::<Vec<_>>()
    );

    // The backoff runs from the failure at 8 s; a fresh connection replays the capture again.
    let again = cycle(&mut readings).await;
    assert_eq!(start.elapsed(), Duration::from_secs(13));
    assert_eq!(
        again.into_iter().map(|r| seen(&bus, r)).collect::<Vec<_>>(),
        first_cycle()
    );
    assert!(task.latest().iter().all(|(_, age)| age.is_zero()));
}

#[test]
fn backoff_starts_at_the_cadence_and_doubles_to_a_minute() {
    let waits: Vec<u64> = [1, 2, 3, 4, 5, 6, 40]
        .into_iter()
        .map(|failures| backoff(failures).as_secs())
        .collect();
    assert_eq!(waits, [5, 10, 20, 40, 60, 60, 60]);
}
