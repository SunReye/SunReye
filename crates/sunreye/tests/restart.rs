//! The binary polls the simulator, is stopped and started again, and every stored reading is read back.

#![allow(clippy::expect_used, reason = "helpers outside #[test] fns may panic like the tests")]

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use sunreye::store::{NewConnection, NewDevice, Sample, Store};
use sunreye_sim::{FC_READ_HOLDING, Simulator, profile_case};

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
async fn polled_readings_survive_a_restart() {
    let case = profile_case(&oracle(), PROFILE, "ramp").expect("fixture case");
    let sim = Simulator::start(case.registers.clone(), &[1]).await.expect("simulator");
    let dir = data_dir("restart");

    let store = Store::open(&dir).await.expect("open store");
    store.set_setting("poll.interval_ms", "100").await.expect("interval");
    let connection = store
        .add_connection(&NewConnection {
            transport: "tcp".into(),
            host: "127.0.0.1".into(),
            port: sim.addr.port(),
        })
        .await
        .expect("connection");
    store
        .add_device(&NewDevice { connection_id: connection, profile_id: PROFILE.into(), unit_id: 1 })
        .await
        .expect("device");
    store.close().await;

    let child = start(&dir);
    wait_for_requests(&sim, 60).await;
    stop(child);
    let first = stored(&dir).await;
    assert!(first.len() >= 3, "{} samples after the first run", first.len());

    let seen = sim.requests().len();
    let child = start(&dir);
    wait_for_requests(&sim, seen + 60).await;
    stop(child);
    let second = stored(&dir).await;

    assert!(second.len() > first.len(), "the second run appends");
    assert_eq!(second[..first.len()], first[..], "every reading of the first run reads back unchanged");
    let expected: Vec<(String, f64)> = case.readings.iter().map(|(k, v)| (k.clone(), *v)).collect();
    for sample in &second {
        let mut got = sample.values.clone();
        got.sort_by(|a, b| a.0.cmp(&b.0));
        assert_eq!(got, expected, "a stored sample is the oracle's decoded readings");
    }
    assert!(sim.requests().iter().all(|r| r.function == FC_READ_HOLDING), "the core sent nothing but reads");
    drop(std::fs::remove_dir_all(&dir));
}
