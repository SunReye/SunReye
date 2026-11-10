//! An endpoint task over `sim`, observed on the bus.

use std::sync::Arc;
use std::time::{Duration, SystemTime};

use sunreye_profile::{Framing, Profile, Unit};
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
        framing: Framing::Tcp,
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
        Endpoint::Sim(Capture {
            framing: Framing::Tcp,
            exchanges,
        }),
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

/// Registers 500, 501 and 520: one block across the gap at Solarman's tolerance of 32.
const GAPPED: &str = r#"{
    "schema": 1, "id": "case", "name": "case", "manufacturer": "test", "version": "1.0.0",
    "requires": ["modbus", "u16", "i16"],
    "quantities": [
        { "key": "pv1", "role": "pv.mppt.power", "index": 1, "register": 500, "type": "u16" },
        { "key": "battery", "role": "battery.power", "register": 501, "type": "i16" },
        { "key": "pv2", "role": "pv.mppt.power", "index": 2, "register": 520, "type": "u16" }
    ]
}"#;

/// The Modbus RTU CRC16, written out from its definition: reflected, polynomial 0xA001.
fn crc16(bytes: &[u8]) -> [u8; 2] {
    let mut crc: u16 = 0xffff;
    for byte in bytes {
        crc ^= u16::from(*byte);
        for _ in 0..8 {
            crc = if crc & 1 == 1 {
                (crc >> 1) ^ 0xa001
            } else {
                crc >> 1
            };
        }
    }
    crc.to_le_bytes()
}

/// A V5 frame from the logger `0xbce20a25`: a request (15-byte business field) or a reply (14).
fn v5(request: bool, seq: u8, payload: &[u8]) -> Vec<u8> {
    let (control, business) = if request {
        (0x4510_u16, 15)
    } else {
        (0x1510, 14)
    };
    let serial = if request && seq == 0 {
        [0; 4]
    } else {
        [0x25, 0x0a, 0xe2, 0xbc]
    };
    let mut frame = vec![0xa5];
    frame.extend_from_slice(
        &u16::try_from(business + payload.len())
            .unwrap()
            .to_le_bytes(),
    );
    frame.extend_from_slice(&control.to_le_bytes());
    frame.extend_from_slice(&[seq, 0]);
    frame.extend_from_slice(&serial);
    frame.push(if request { 2 } else { 1 });
    frame.resize(frame.len() + business - 1, 0);
    frame.extend_from_slice(payload);
    let sum = frame[1..].iter().fold(0_u8, |sum, b| sum.wrapping_add(*b));
    frame.extend_from_slice(&[sum, 0x15]);
    frame
}

/// An RTU frame of unit 1 with its CRC.
fn rtu(pdu: &[u8]) -> Vec<u8> {
    let mut frame = vec![1];
    frame.extend_from_slice(pdu);
    let crc = crc16(&frame);
    frame.extend_from_slice(&crc);
    frame
}

fn read(seq: u8, start: u16, count: u8, reply: &[u8]) -> [Exchange; 2] {
    let [s0, s1] = start.to_be_bytes();
    [
        Exchange::Request(v5(true, seq, &rtu(&[3, s0, s1, 0, count]))),
        Exchange::Reply(vec![v5(false, seq, &rtu(reply))]),
    ]
}

#[tokio::test(start_paused = true)]
async fn a_merged_block_refused_with_exception_2_is_split_and_stays_split() {
    let mut exchanges = vec![
        Exchange::Request(v5(true, 0, &rtu(&[3, 0, 3, 0, 6]))),
        Exchange::Reply(vec![v5(false, 0, &[6, 0])]),
    ];
    exchanges.extend(read(1, 500, 21, &[0x83, 2]));
    exchanges.extend(read(2, 500, 2, &[3, 4, 0x04, 0xd2, 0xfc, 0x18]));
    exchanges.extend(read(3, 520, 1, &[3, 2, 0, 7]));
    exchanges.extend(read(4, 500, 2, &[3, 4, 0x04, 0xd2, 0xfc, 0x18]));
    exchanges.extend(read(5, 520, 1, &[3, 2, 0, 8]));
    let capture = Capture {
        framing: Framing::SolarmanV5,
        exchanges,
    };
    let device = Device {
        profile: Arc::new(Profile::load(GAPPED).unwrap()),
        ..device()
    };
    let bus = Bus::default();
    let mut readings = bus.subscribe();
    let _task = spawn(Endpoint::Sim(capture), vec![device], bus.clone());
    let values = async |readings: &mut Receiver<Reading>| {
        cycle(readings)
            .await
            .iter()
            .map(|r| r.value)
            .collect::<Vec<_>>()
    };
    let two = async { (values(&mut readings).await, values(&mut readings).await) };
    let (first, second) = tokio::time::timeout(Duration::from_secs(60), two)
        .await
        .expect("two cycles within a minute");
    assert_eq!(first, [1234.0, -1000.0, 7.0]);
    assert_eq!(second, [1234.0, -1000.0, 8.0]);
}

/// A SunSpec profile's one quantity: the first register of a vendor model 64000.
const SUNSPEC: &str = r#"{
    "schema": 1, "id": "sunspec-case", "name": "case", "manufacturer": "test", "version": "1.0.0",
    "requires": ["sunspec", "u16"],
    "quantities": [
        { "key": "x", "role": "extra.x", "model": [64000], "register": 2, "type": "u16" }
    ]
}"#;

/// The chain is discovered at connect: `SunS` at 40001, a common model of 4 registers and model
/// 64000 of 1, then the end model. At Solarman's tolerance both models fold into one block across
/// the header between them; the device refuses it with exception 2, and each model is read apart
/// from then on.
#[tokio::test(start_paused = true)]
async fn a_sunspec_chain_is_discovered_at_connect_and_a_refused_merge_split() {
    let mut exchanges = vec![
        Exchange::Request(v5(true, 0, &rtu(&[3, 0, 3, 0, 6]))),
        Exchange::Reply(vec![v5(false, 0, &[6, 0])]),
    ];
    exchanges.extend(read(1, 40000, 2, &[3, 4, 0x53, 0x75, 0x6e, 0x53]));
    exchanges.extend(read(2, 40002, 2, &[3, 4, 0, 1, 0, 4]));
    exchanges.extend(read(3, 40008, 2, &[3, 4, 0xfa, 0, 0, 1]));
    exchanges.extend(read(4, 40011, 2, &[3, 4, 0xff, 0xff, 0, 0]));
    exchanges.extend(read(5, 40004, 7, &[0x83, 2]));
    exchanges.extend(read(6, 40004, 4, &[3, 8, 0, 0, 0, 0, 0, 0, 0, 0]));
    exchanges.extend(read(7, 40010, 1, &[3, 2, 0, 42]));
    exchanges.extend(read(8, 40004, 4, &[3, 8, 0, 0, 0, 0, 0, 0, 0, 0]));
    exchanges.extend(read(9, 40010, 1, &[3, 2, 0, 43]));
    let capture = Capture {
        framing: Framing::SolarmanV5,
        exchanges,
    };
    let device = Device {
        profile: Arc::new(Profile::load(SUNSPEC).unwrap()),
        ..device()
    };
    let bus = Bus::default();
    let mut readings = bus.subscribe();
    let _task = spawn(Endpoint::Sim(capture), vec![device], bus.clone());

    let two = async {
        [
            readings.recv().await.unwrap(),
            readings.recv().await.unwrap(),
        ]
    };
    let got = tokio::time::timeout(Duration::from_secs(60), two)
        .await
        .expect("two cycles within a minute");

    assert_eq!(got.map(|r| r.value), [42.0, 43.0]);
}

#[test]
fn backoff_starts_at_the_cadence_and_doubles_to_a_minute() {
    let waits: Vec<u64> = [1, 2, 3, 4, 5, 6, 40]
        .into_iter()
        .map(|failures| backoff(failures).as_secs())
        .collect();
    assert_eq!(waits, [5, 10, 20, 40, 60, 60, 60]);
}

/// The owner's plant (#623, #624) is polled read-only: a cycle of the bundled Deye profile sends
/// only function 3, through the gateway and through the Solarman stick, whose probe is a read too.
#[tokio::test]
async fn polling_the_bundled_deye_profile_sends_only_reads() {
    use crate::transport::fake;
    let profile = crate::profiles::Catalogue::bundled()
        .unwrap()
        .get("deye-sg05lp3")
        .unwrap();
    for (mut fake, probes) in [
        (fake::serve().await, 0),
        (fake::serve_rtu().await, 0),
        (fake::serve_solarman().await, 1),
    ] {
        let endpoint = fake.endpoint();
        let requests = profile.read_plan(endpoint.framing().gap_tolerance()).len() + probes;
        let device = Device {
            id: DeviceId(1),
            unit: 0,
            profile: Arc::clone(&profile),
        };
        let _task = spawn(endpoint, vec![device], Bus::default());
        let mut functions = Vec::new();
        for _ in 0..requests {
            functions.push(fake.reads.recv().await.unwrap().function);
        }
        assert_eq!(functions, vec![3; requests]);
        assert!(
            fake.writes.try_recv().is_err(),
            "a poll wrote to the device"
        );
    }
}

/// Register 500 every cycle, register 600 in a poll group every second cycle.
const GROUPED: &str = r#"{
    "schema": 1, "id": "grouped", "name": "case", "manufacturer": "test", "version": "1.0.0",
    "requires": ["modbus", "u16", "poll-group"], "pollGroups": { "slow": 10 },
    "quantities": [
        { "key": "fast", "role": "extra.fast", "register": 500, "type": "u16" },
        { "key": "slow", "role": "extra.slow", "register": 600, "type": "u16", "pollGroup": "slow" }
    ]
}"#;

/// Modbus TCP transaction `tx` reading one register at `start`, answered with `value`.
fn single(tx: u16, start: u16, value: u16) -> [Exchange; 2] {
    let [t0, t1] = tx.to_be_bytes();
    let [s0, s1] = start.to_be_bytes();
    let [v0, v1] = value.to_be_bytes();
    [
        Exchange::Request(vec![t0, t1, 0, 0, 0, 6, 1, 3, s0, s1, 0, 1]),
        Exchange::Reply(vec![vec![t0, t1, 0, 0, 0, 5, 1, 3, 2, v0, v1]]),
    ]
}

#[tokio::test(start_paused = true)]
async fn a_poll_group_is_read_at_its_own_cadence_and_its_readings_say_so() {
    let bus = Bus::default();
    let mut readings = bus.subscribe();
    let exchanges = [
        single(1, 500, 1),
        single(2, 600, 2),
        single(3, 500, 3),
        single(4, 500, 4),
        single(5, 600, 5),
    ]
    .concat();
    let device = Device {
        id: DeviceId(7),
        unit: 1,
        profile: Arc::new(Profile::load(GROUPED).unwrap()),
    };
    let _task = spawn(
        Endpoint::Sim(Capture {
            framing: Framing::Tcp,
            exchanges,
        }),
        vec![device],
        bus.clone(),
    );

    let mut got = Vec::new();
    for _ in 0..5 {
        let reading = readings.recv().await.unwrap();
        got.push((
            bus.series(reading.series).unwrap().role,
            reading.value,
            reading.cadence.as_secs(),
        ));
    }

    let seen = |role: &str, value, cadence| (role.to_owned(), value, cadence);
    assert_eq!(
        got,
        [
            seen("extra.fast", 1.0, 5),
            seen("extra.slow", 2.0, 10),
            seen("extra.fast", 3.0, 5),
            seen("extra.fast", 4.0, 5),
            seen("extra.slow", 5.0, 10),
        ]
    );
}
