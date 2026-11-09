//! `sunreye capture` against a fake device, and the captures it writes replayed in `sim`.

use std::sync::Arc;

use sunreye_profile::{Framing, Profile};

use super::{CYCLES, Options, Recording, record, run};
use crate::bus::{Bus, DeviceId};
use crate::endpoint::{CADENCE, Device, TIMEOUT, spawn};
use crate::transport::{Capture, Client, Endpoint, Error, Exchange, fake};

fn deye() -> Arc<Profile> {
    crate::profiles::Catalogue::bundled()
        .unwrap()
        .get("deye-sg05lp3")
        .unwrap()
}

/// One poll cycle of the bundled Deye profile at unit 0 through `endpoint`: each series and value.
async fn one_cycle(endpoint: Endpoint) -> Vec<(String, Option<u32>, f64)> {
    let bus = Bus::default();
    let mut readings = bus.subscribe();
    let device = Device {
        id: DeviceId(1),
        unit: 0,
        profile: deye(),
    };
    let task = spawn(endpoint, vec![device], bus.clone());
    readings.recv().await.unwrap();
    // A cycle publishes under the lock `latest` takes, so the whole cycle is in.
    task.latest()
        .into_iter()
        .map(|(reading, _)| {
            let series = bus.series(reading.series).unwrap();
            (series.role, series.index, reading.value)
        })
        .collect()
}

/// The owner's plant (#623, #624) is captured read-only: through the gateway and the Solarman
/// stick, a capture sends only function 3, and replays in `sim` as the device itself polls.
#[tokio::test]
async fn a_capture_sends_only_reads_and_replays_as_the_device_polls() {
    for mut fake in [fake::serve().await, fake::serve_solarman().await] {
        let recording = record(&fake.endpoint(), 0, deye(), 1).await.unwrap();

        let framing = fake.endpoint().framing();
        let probes = usize::from(framing == Framing::SolarmanV5);
        let requests = deye().read_plan(framing.gap_tolerance()).len() + probes;
        let mut functions = Vec::new();
        while let Ok(read) = fake.reads.try_recv() {
            functions.push(read.function);
        }
        assert_eq!(functions, vec![3; requests]);
        assert!(
            fake.writes.try_recv().is_err(),
            "a capture wrote to the device"
        );

        let live = one_cycle(fake.endpoint()).await;
        assert_ne!(live, []);
        assert_eq!(one_cycle(Endpoint::Sim(recording.capture)).await, live);
    }
}

/// The guard sits on the wire, not in the caller: a write through a recording client never leaves.
#[tokio::test]
async fn a_recording_client_refuses_a_write_before_it_reaches_the_device() {
    for mut fake in [fake::serve().await, fake::serve_solarman().await] {
        let (mut client, tape) = Client::recording(&fake.endpoint(), TIMEOUT).await.unwrap();

        let refused = client.write_registers(0, 500, &[1]).await;

        assert!(matches!(refused, Err(Error::Io(_))), "{refused:?}");
        assert!(
            fake.writes.try_recv().is_err(),
            "the write reached the device"
        );
        let requests = tape
            .exchanges()
            .into_iter()
            .filter(|e| matches!(e, Exchange::Request(_)))
            .count();
        // Only the Solarman probe was sent.
        assert_eq!(
            requests,
            usize::from(fake.endpoint().framing() == Framing::SolarmanV5)
        );
    }
}

/// The published file (ADR 6): a header line, then one line per exchange in hex.
const FILE: &str = r#"{"capture":1,"profile":"deye-sg05lp3","version":"1.2.0","framing":"solarman-v5","unit":0}
{"tx":"a5"}
{"rx":["0001","ff"]}
"#;

fn recording() -> Recording {
    Recording {
        profile: "deye-sg05lp3".into(),
        version: "1.2.0".into(),
        unit: 0,
        capture: Capture {
            framing: Framing::SolarmanV5,
            exchanges: vec![
                Exchange::Request(vec![0xa5]),
                Exchange::Reply(vec![vec![0, 1], vec![0xff]]),
            ],
        },
    }
}

#[test]
fn a_recording_is_written_as_a_header_line_and_one_line_per_exchange() {
    assert_eq!(recording().to_ndjson(), FILE);
}

#[test]
fn a_capture_file_reads_back_as_its_recording() {
    assert_eq!(Recording::parse(FILE), Ok(recording()));
}

#[test]
fn a_capture_file_of_a_later_format_is_refused() {
    let later = FILE.replacen(r#""capture":1"#, r#""capture":2"#, 1);
    assert_eq!(
        Recording::parse(&later).map_err(|e| e.to_string()),
        Err("capture format 2 is not supported; this build reads format 1".into())
    );
}

fn parse(args: &[&str]) -> Result<Options, String> {
    Options::parse(args.iter().map(|&a| a.to_owned())).map_err(|e| e.to_string())
}

#[test]
fn capture_takes_an_endpoint_url_a_unit_id_and_a_bundled_profile() {
    assert_eq!(
        parse(&[
            "--endpoint",
            "modbus-tcp://10.20.0.62:502",
            "--unit=0",
            "--profile",
            "deye-sg05lp3"
        ]),
        Ok(Options {
            endpoint: Endpoint::ModbusTcp {
                host: "10.20.0.62".into(),
                port: 502
            },
            unit: 0,
            profile: "deye-sg05lp3".into(),
        })
    );
    assert_eq!(
        parse(&[
            "--endpoint=solarman-v5://stick.lan:8899",
            "--unit",
            "1",
            "--profile",
            "x"
        ])
        .map(|o| o.endpoint),
        Ok(Endpoint::SolarmanV5 {
            host: "stick.lan".into(),
            port: 8899
        })
    );
}

#[test]
fn capture_refuses_sim_and_names_what_is_missing() {
    assert_eq!(
        parse(&["--endpoint", "sim://x:1", "--unit", "0", "--profile", "x"]),
        Err(
            "--endpoint: `sim://x:1` is not modbus-tcp://host:port or solarman-v5://host:port"
                .into()
        )
    );
    assert_eq!(
        parse(&["--endpoint", "modbus-tcp://h:502", "--profile", "x"]),
        Err("--unit is required".into())
    );
    assert_eq!(
        parse(&[
            "--endpoint",
            "modbus-tcp://h:502",
            "--unit",
            "256",
            "--profile",
            "x"
        ]),
        Err("--unit: `256` is not a unit id from 0 to 255".into())
    );
}

#[tokio::test]
async fn capture_refuses_a_profile_that_is_not_bundled_before_it_connects() {
    let mut fake = fake::serve().await;
    let options = Options {
        endpoint: fake.endpoint(),
        unit: 0,
        profile: "nope".into(),
    };
    assert_eq!(
        run(options).await.map_err(|e| e.to_string()),
        Err("no bundled profile `nope`".into())
    );
    assert!(fake.reads.try_recv().is_err());
}

/// The owner's plant through its gateway at unit 0 (#641): twelve cycles, recorded read-only.
const PLANT: &str = include_str!("../../fixtures/capture/deye-sg05lp3.ndjson");

/// Expected values decoded by hand from the first cycle's replies: register 588 is `0x0020`, 590
/// is `0x0147` at scale -1, 587 is `0x148c` at scale 0.01.
#[tokio::test(start_paused = true)]
async fn the_owners_plant_replays_in_sim_cycle_after_cycle() {
    let recording = Recording::parse(PLANT).unwrap();
    assert_eq!(
        (recording.profile.as_str(), recording.unit),
        ("deye-sg05lp3", 0)
    );
    let bus = Bus::default();
    let mut readings = bus.subscribe();
    let device = Device {
        id: DeviceId(1),
        unit: recording.unit,
        profile: deye(),
    };
    let task = spawn(Endpoint::Sim(recording.capture), vec![device], bus.clone());
    readings.recv().await.unwrap();
    let first = task.latest();
    let value = |role: &str| {
        first
            .iter()
            .find(|(r, _)| bus.series(r.series).unwrap().role == role)
            .map(|(r, _)| r.value)
    };
    assert_eq!(value("battery.soc"), Some(32.0));
    assert_eq!(value("battery.power"), Some(-327.0));
    assert!((value("battery.voltage").unwrap() - 52.6).abs() < 1e-9);

    let per_cycle = first.len();
    let mut seen = 1;
    let twelve = async {
        while seen < per_cycle * CYCLES {
            readings.recv().await.unwrap();
            seen += 1;
        }
    };
    tokio::time::timeout(CADENCE * 13, twelve)
        .await
        .expect("twelve cycles at the cadence");
}

fn sunspec() -> Arc<Profile> {
    crate::profiles::Catalogue::bundled()
        .unwrap()
        .get("sunspec")
        .unwrap()
}

/// pysunspec's test inverter (`sunspec/core/test/devices/mbmap_test_inverter_2.xml` at 119b176):
/// a common model, a three-phase inverter (103) and an MPPT extension (160) of three modules.
const CONFORMING: &str = include_str!("../../../profile/src/tests/sunspec-pysunspec-inverter.json");

/// One cycle of the bundled generic SunSpec profile, recorded from a fake device holding the
/// pysunspec map at unit 1: the chain walk, then the model blocks.
const CONFORMING_CAPTURE: &str = include_str!("../../fixtures/capture/sunspec.ndjson");

/// The committed capture is a recording of the pysunspec map; `SUNREYE_UPDATE_CAPTURE=1` rewrites
/// it after a change to the profile or its plan.
#[tokio::test]
async fn the_conforming_capture_is_a_recording_of_the_pysunspec_map() {
    let dump: serde_json::Value = serde_json::from_str(CONFORMING).unwrap();
    let words: Vec<u16> = serde_json::from_value(dump["words"].clone()).unwrap();
    let start = u16::try_from(dump["start"].as_u64().unwrap()).unwrap();
    let fake = fake::serve_map("127.0.0.1", Framing::Tcp, 1, start, &words).await;

    let recorded = record(&fake.endpoint(), 1, sunspec(), 1)
        .await
        .unwrap()
        .to_ndjson();

    if std::env::var_os("SUNREYE_UPDATE_CAPTURE").is_some() {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/fixtures/capture/sunspec.ndjson"
        );
        std::fs::write(path, &recorded).unwrap();
    } else {
        assert_eq!(
            recorded, CONFORMING_CAPTURE,
            "run with SUNREYE_UPDATE_CAPTURE=1"
        );
    }
}

/// Expected values from the comments of `mbmap_test_inverter_2.xml`, each a register and its
/// scale factor: `W` 2970 at 0, `Hz` 5999 at -2, `PhVphA` 2401 at -1, `WH` 1234567 Wh at 0; per
/// module `DCA` 11 to 13 at -1, `DCV` 30011 to 30013 at -2, `DCW` 331 to 333 at 0.
#[tokio::test(start_paused = true)]
async fn the_generic_sunspec_profile_reads_a_conforming_capture() {
    let recording = Recording::parse(CONFORMING_CAPTURE).unwrap();
    assert_eq!(recording.profile, "sunspec");
    let bus = Bus::default();
    let mut readings = bus.subscribe();
    let device = Device {
        id: DeviceId(1),
        unit: recording.unit,
        profile: sunspec(),
    };
    let task = spawn(Endpoint::Sim(recording.capture), vec![device], bus.clone());
    readings.recv().await.unwrap();

    let mut got: Vec<(String, Option<u32>, f64)> = task
        .latest()
        .into_iter()
        .map(|(reading, _)| {
            let series = bus.series(reading.series).unwrap();
            (series.role, series.index, reading.value)
        })
        .collect();
    got.sort_by(|a, b| (&a.0, a.1).cmp(&(&b.0, b.1)));

    let expected: Vec<(String, Option<u32>, f64)> = [
        ("grid.frequency", None, 59.99),
        ("grid.phase.voltage", Some(1), 240.1),
        ("grid.phase.voltage", Some(2), 240.2),
        ("grid.phase.voltage", Some(3), 240.3),
        ("pv.energy.total", None, 1234.567),
        ("pv.mppt.current", Some(1), 1.1),
        ("pv.mppt.current", Some(2), 1.2),
        ("pv.mppt.current", Some(3), 1.3),
        ("pv.mppt.power", Some(1), 331.0),
        ("pv.mppt.power", Some(2), 332.0),
        ("pv.mppt.power", Some(3), 333.0),
        ("pv.mppt.voltage", Some(1), 300.11),
        ("pv.mppt.voltage", Some(2), 300.12),
        ("pv.mppt.voltage", Some(3), 300.13),
        ("pv.power", None, 2970.0),
    ]
    .into_iter()
    .map(|(role, index, value)| (role.to_owned(), index, value))
    .collect();
    assert_eq!(got, expected);
}

/// The SG05LP3 models of 14 to 20 kW read the family's register map: the owner's capture, of the
/// family profile's read plan, replays with each. The 5 to 12 kW models read two PV inputs fewer,
/// so it cannot replay with them.
#[tokio::test(start_paused = true)]
async fn the_owners_capture_replays_with_each_four_input_sg05lp3_model() {
    let catalogue = crate::profiles::Catalogue::bundled().unwrap();
    for kw in [14, 15, 16, 18, 20] {
        let profile = catalogue.get(&format!("deye-sun{kw}k-sg05lp3")).unwrap();
        let recording = Recording::parse(PLANT).unwrap();
        let bus = Bus::default();
        let mut readings = bus.subscribe();
        let device = Device {
            id: DeviceId(1),
            unit: recording.unit,
            profile,
        };
        let task = spawn(Endpoint::Sim(recording.capture), vec![device], bus.clone());
        tokio::time::timeout(CADENCE * 2, readings.recv())
            .await
            .unwrap_or_else(|_| panic!("{kw} kW reads another plan"))
            .unwrap();
        let soc = task
            .latest()
            .iter()
            .find(|(r, _)| bus.series(r.series).unwrap().role == "battery.soc")
            .map(|(r, _)| r.value);
        assert_eq!(soc, Some(32.0), "{kw} kW");
    }
}
