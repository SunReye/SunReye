//! The binary polls the simulator, is stopped and started again, and every stored reading is read back.

#![allow(clippy::expect_used, reason = "helpers outside #[test] fns may panic like the tests")]

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use sunreye::modbus::Transport;
use sunreye::store::{NewConnection, NewDevice, Sample, Store};
use sunreye_sim::{FC_READ_HOLDING, Framing, Simulator, profile_case};

const BIN: &str = env!("CARGO_BIN_EXE_sunreye");
const PROFILE: &str = "deye-sg01hp3";

fn oracle() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/oracle")
}

fn data_dir(name: &str) -> PathBuf {
    let dir = Path::new(env!("CARGO_TARGET_TMPDIR")).join(name);
    drop(std::fs::remove_dir_all(&dir));
    dir
}

fn start(dir: &Path) -> Child {
    Command::new(BIN)
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

async fn wait_for_requests(sim: &Simulator, at_least: usize) {
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
    survives_a_restart(Transport::Tcp, Framing::Tcp).await;
}

#[tokio::test]
async fn polled_readings_survive_a_restart_over_rtu_over_tcp() {
    survives_a_restart(Transport::RtuOverTcp, Framing::RtuOverTcp).await;
}

async fn seed(dir: &Path, transport: Transport, port: u16) {
    let store = Store::open(dir).await.expect("open store");
    store.set_setting("poll.interval_ms", "100").await.expect("interval");
    let connection = store
        .add_connection(&NewConnection { transport, host: "127.0.0.1".into(), port })
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

/// Runs the core until the simulator has seen `requests` more requests, stops it and reads the store.
async fn run_for(dir: &Path, sim: &Simulator, requests: usize) -> Vec<Sample> {
    let child = start(dir);
    wait_for_requests(sim, sim.requests().len() + requests).await;
    stop(child);
    stored(dir).await
}

async fn survives_a_restart(transport: Transport, framing: Framing) {
    let case = profile_case(&oracle(), PROFILE, "ramp").expect("fixture case");
    let sim = Simulator::start_with(framing, case.registers.clone(), &[1]).await.expect("simulator");
    let dir = data_dir(transport.as_str());
    seed(&dir, transport, sim.addr.port()).await;

    let first = run_for(&dir, &sim, 60).await;
    assert!(first.len() >= 3, "{} samples after the first run", first.len());
    let second = run_for(&dir, &sim, 60).await;

    assert!(second.len() > first.len(), "the second run appends");
    assert_eq!(second[..first.len()], first[..], "every reading of the first run reads back unchanged");
    assert_oracle_readings(&second, &case.readings);
    assert!(sim.requests().iter().all(|r| r.function == FC_READ_HOLDING), "the core sent nothing but reads");
    drop(std::fs::remove_dir_all(&dir));
}
