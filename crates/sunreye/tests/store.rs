//! The SQLite store at the scale of a real install: one device-day, and what a restart keeps.

#![allow(clippy::expect_used, reason = "helpers outside #[test] fns may panic like the tests")]

use std::path::PathBuf;
use std::time::Instant;

use sunreye::samples::{ClosedMinute, MINUTE_MS, Sample};
use sunreye::store::{NewConnection, NewDevice, Store};

const FIRST_MINUTE: i64 = 29_000_000;
const METRICS: usize = 8;
const SAMPLES_PER_MINUTE: usize = 60;

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("sunreye-{name}-{}", std::process::id()));
    drop(std::fs::remove_dir_all(&dir));
    dir
}

async fn device(store: &Store) -> i64 {
    let connection = NewConnection { transport: "tcp".into(), host: "10.0.0.5".into(), port: 502 };
    let connection = store.add_connection(&connection).await.expect("connection");
    let device = NewDevice { connection_id: connection, profile_id: "deye-sg01hp3".into(), unit_id: 1 };
    store.add_device(&device).await.expect("device")
}

/// One minute of 1 s polling: every sample carries every metric.
fn minute_of_samples(minute: i64) -> ClosedMinute {
    let samples = (0..SAMPLES_PER_MINUTE)
        .map(|second| {
            let at_ms = minute * MINUTE_MS + i64::try_from(second).expect("small") * 1_000;
            let values = (0..METRICS)
                .map(|metric| {
                    (format!("metric.{metric}"), f64::from(u16::try_from(second * metric).expect("small")))
                })
                .collect();
            Sample { at_ms, values }
        })
        .collect();
    ClosedMinute { minute, samples }
}

#[tokio::test]
async fn minutes_written_before_a_close_read_back_after_reopening() {
    let dir = scratch("reopen");
    let store = Store::open(&dir).await.expect("open");
    let device = device(&store).await;
    let closed = minute_of_samples(FIRST_MINUTE);
    store.append_minute(device, &closed).await.expect("append");
    store.close().await;

    let store = Store::open(&dir).await.expect("reopen");
    let back = store.readings(device, 0, i64::MAX).await.expect("readings");
    assert_eq!(back.len(), SAMPLES_PER_MINUTE);
    assert_eq!(back[59].at_ms, FIRST_MINUTE * MINUTE_MS + 59_000);
    assert_eq!(back[59].values.len(), METRICS);
    store.close().await;
    drop(std::fs::remove_dir_all(&dir));
}

/// One simulated device-day: 1 s polling of 8 metrics, one row per minute.
/// Run `SUNREYE_SPA_DIR=crates/sunreye/spa-placeholder cargo test --release -p sunreye --test store device_day -- --nocapture` for the numbers.
#[tokio::test]
async fn a_device_day_is_1440_minute_rows() {
    let dir = scratch("device-day");
    let store = Store::open(&dir).await.expect("open");
    let device = device(&store).await;
    let started = Instant::now();
    for minute in 0..1440 {
        store.append_minute(device, &minute_of_samples(FIRST_MINUTE + minute)).await.expect("append");
    }
    let elapsed = started.elapsed();

    let from = FIRST_MINUTE * MINUTE_MS;
    let day = store.readings(device, from, from + 1440 * MINUTE_MS).await.expect("readings");
    assert_eq!(day.len(), 1440 * SAMPLES_PER_MINUTE);

    store.close().await;
    let bytes = std::fs::metadata(dir.join("sunreye.db")).expect("db file").len();
    eprintln!("device-day: insert {elapsed:?}, file {bytes} bytes");
    assert!(bytes > 0);
    drop(std::fs::remove_dir_all(&dir));
}
