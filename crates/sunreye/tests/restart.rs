//! The binary polls the simulator, is stopped and started again, and every stored reading is read back.

#![allow(clippy::expect_used, reason = "helpers outside #[test] fns may panic like the tests")]

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use jiff::Timestamp;
use sunreye::modbus::Transport;
use sunreye::rollup::{Tier, rollup};
use sunreye::store::{NewConnection, NewDevice, Sample, Store};
use sunreye_sim::{Framing, profile_case};

mod support;
use support::Sim;

const BIN: &str = env!("CARGO_BIN_EXE_sunreye");
const PROFILE: &str = "deye-sg01hp3";
/// The serial of the stick the oracle recorded.
const STICK: u32 = 3_168_930_341;

fn oracle() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/oracle")
}

fn data_dir(name: &str) -> PathBuf {
    let dir = Path::new(env!("CARGO_TARGET_TMPDIR")).join(format!("{name}-{}", std::process::id()));
    drop(std::fs::remove_dir_all(&dir));
    dir
}

fn start(dir: &Path) -> Child {
    Command::new(BIN)
        .args(["--listen", "127.0.0.1:0"])
        .arg("--data-dir")
        .arg(dir)
        .args(["--log-level", "warn"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn sunreye")
}

fn stop(mut child: Child) {
    let signalled = Command::new("kill").arg("-TERM").arg(child.id().to_string()).status().expect("kill");
    assert!(signalled.success());
    assert!(child.wait().expect("wait").success(), "SIGTERM is a clean exit");
}

async fn wait_for_requests(sim: &Sim, at_least: usize) {
    let deadline = Instant::now() + Duration::from_secs(20);
    while sim.requests().len() < at_least {
        assert!(Instant::now() < deadline, "the simulator saw {} requests", sim.requests().len());
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

async fn stored(dir: &Path) -> Vec<Sample> {
    let store = Store::open(dir).await.expect("open store");
    let device = store.devices().await.expect("devices")[0].id;
    let samples = store.readings(device, 0, i64::MAX).await.expect("readings");
    store.close().await;
    samples
}

#[tokio::test]
async fn polled_readings_survive_a_restart_over_modbus_tcp() {
    survives_a_restart(Transport::Tcp, Framing::Tcp, None).await;
}

#[tokio::test]
async fn polled_readings_survive_a_restart_over_rtu_over_tcp() {
    survives_a_restart(Transport::RtuOverTcp, Framing::RtuOverTcp, None).await;
}

#[tokio::test]
async fn polled_readings_survive_a_restart_over_solarman_v5_with_the_serial_discovered() {
    survives_a_restart(Transport::SolarmanV5, Framing::SolarmanV5(STICK), None).await;
}

#[tokio::test]
async fn polled_readings_survive_a_restart_over_solarman_v5_whatever_serial_is_configured() {
    survives_a_restart(Transport::SolarmanV5, Framing::SolarmanV5(STICK), Some(0x1122_3344)).await;
}

async fn seed(dir: &Path, transport: Transport, port: u16, logger_serial: Option<u32>) {
    let store = Store::open(dir).await.expect("open store");
    store.set_setting("poll.interval_ms", "100").await.expect("interval");
    let connection = store
        .add_connection(&NewConnection { transport, host: "127.0.0.1".into(), port, logger_serial })
        .await
        .expect("connection");
    store
        .add_device(&NewDevice { connection_id: connection, profile_id: PROFILE.into(), unit_id: 1 })
        .await
        .expect("device");
    store.close().await;
}

fn assert_oracle_readings(samples: &[Sample], readings: &BTreeMap<String, f64>) {
    let expected: Vec<(String, f64)> = readings.iter().map(|(k, v)| (k.clone(), *v)).collect();
    for sample in samples {
        let mut got = sample.values.clone();
        got.sort_by(|a, b| a.0.cmp(&b.0));
        assert_eq!(got, expected, "a stored sample is the oracle's decoded readings");
    }
}

/// Each metric's stored minute buckets are its stored readings rolled up, the restart notwithstanding.
async fn assert_minutes_rolled_up(dir: &Path, samples: &[Sample]) {
    let store = Store::open(dir).await.expect("open store");
    let device = store.devices().await.expect("devices")[0].id;
    let mut by_metric: BTreeMap<&str, Vec<(Timestamp, f64)>> = BTreeMap::new();
    for sample in samples {
        let at = Timestamp::from_millisecond(sample.at_ms).expect("instant");
        for (metric, value) in &sample.values {
            by_metric.entry(metric).or_default().push((at, *value));
        }
    }
    assert!(!by_metric.is_empty());
    for (metric, readings) in by_metric {
        let stored = store.buckets(Tier::Minute, device, metric).await.expect("buckets");
        assert_eq!(stored, rollup(Tier::Minute, &readings), "{metric}");
    }
    store.close().await;
}

/// Runs the core until the simulator has seen `requests` more requests, stops it and reads the store.
async fn run_for(dir: &Path, sim: &Sim, requests: usize) -> Vec<Sample> {
    let child = start(dir);
    wait_for_requests(sim, sim.requests().len() + requests).await;
    stop(child);
    stored(dir).await
}

async fn survives_a_restart(transport: Transport, framing: Framing, logger_serial: Option<u32>) {
    let case = profile_case(&oracle(), PROFILE, "ramp").expect("fixture case");
    let sim = Sim::start_with(framing, case.registers.clone(), &[1]).await;
    let dir = data_dir(&format!("{}-{logger_serial:?}", transport.as_str()));
    seed(&dir, transport, sim.addr.port(), logger_serial).await;

    let first = run_for(&dir, &sim, 60).await;
    assert!(first.len() >= 3, "{} samples after the first run", first.len());
    let second = run_for(&dir, &sim, 60).await;

    assert!(second.len() > first.len(), "the second run appends");
    assert_eq!(second[..first.len()], first[..], "every reading of the first run reads back unchanged");
    assert_oracle_readings(&second, &case.readings);
    assert_minutes_rolled_up(&dir, &second).await;
    drop(std::fs::remove_dir_all(&dir));
}
