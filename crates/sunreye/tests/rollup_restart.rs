//! Every case of `fixtures/oracle/rollups.ndjson` replayed into a file store that is closed and opened
//! again around every append, each minute appended twice: the stored minute, hourly and daily buckets
//! must equal what the 2.x continuous aggregates recorded, and every reading must read back once.

#![allow(clippy::expect_used, reason = "helpers outside #[test] fns may panic like the tests")]

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use jiff::Timestamp;
use serde_json::Value;
use sunreye::modbus::Transport;
use sunreye::rollup::{Bucket, Tier};
use sunreye::samples::{ClosedMinute, MINUTE_MS, Sample, minute_of};
use sunreye::store::{NewConnection, NewDevice, Store};

const DAY_MS: i64 = 24 * 60 * MINUTE_MS;

fn cases() -> Vec<Value> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/oracle/rollups.ndjson");
    std::fs::read_to_string(path)
        .expect("fixture")
        .lines()
        .map(|line| serde_json::from_str(line).expect("case"))
        .collect()
}

fn instant(value: &Value) -> Timestamp {
    value.as_str().expect("instant").parse().expect("RFC 3339")
}

fn number(value: &Value) -> f64 {
    value.as_f64().expect("number")
}

fn buckets(series: &Value) -> Vec<Bucket> {
    series
        .as_array()
        .expect("buckets")
        .iter()
        .map(|b| Bucket {
            start: instant(&b["time"]),
            avg: number(&b["avg"]),
            max: number(&b["max"]),
            min: number(&b["min"]),
        })
        .collect()
}

/// The case's readings as polls: one sample per instant, holding every metric read then.
fn samples(case: &Value) -> Vec<Sample> {
    let mut by_instant: BTreeMap<i64, Vec<(String, f64)>> = BTreeMap::new();
    for (metric, series) in case["readings"].as_object().expect("readings") {
        for reading in series.as_array().expect("series") {
            let at_ms = instant(&reading[0]).as_millisecond();
            by_instant.entry(at_ms).or_default().push((metric.clone(), number(&reading[1])));
        }
    }
    by_instant.into_iter().map(|(at_ms, values)| Sample { at_ms, values }).collect()
}

fn minutes(samples: Vec<Sample>) -> Vec<ClosedMinute> {
    let mut out: Vec<ClosedMinute> = Vec::new();
    for sample in samples {
        let minute = minute_of(sample.at_ms);
        match out.last_mut() {
            Some(open) if open.minute == minute => open.samples.push(sample),
            _ => out.push(ClosedMinute { minute, samples: vec![sample] }),
        }
    }
    out
}

fn scratch(name: &str) -> PathBuf {
    let dir =
        Path::new(env!("CARGO_TARGET_TMPDIR")).join(format!("rollup-restart-{name}-{}", std::process::id()));
    drop(std::fs::remove_dir_all(&dir));
    dir
}

async fn seed(dir: &Path) -> i64 {
    let store = Store::open(dir).await.expect("open");
    let connection =
        NewConnection { transport: Transport::Tcp, host: "10.0.0.5".into(), port: 502, logger_serial: None };
    let connection = store.add_connection(&connection).await.expect("connection");
    let device = NewDevice { connection_id: connection, profile_id: "deye-sg01hp3".into(), unit_id: 1 };
    let device = store.add_device(&device).await.expect("device");
    store.close().await;
    device
}

/// Appends `minute` to a store opened for it alone, as a core restarted around it would.
async fn append_across_a_restart(dir: &Path, device: i64, minute: &ClosedMinute) {
    let store = Store::open(dir).await.expect("open");
    store.append_minute(device, minute).await.expect("append");
    store.close().await;
}

fn sorted(samples: Vec<Sample>) -> Vec<Sample> {
    samples
        .into_iter()
        .map(|mut sample| {
            sample.values.sort_by(|a, b| a.0.cmp(&b.0));
            sample
        })
        .collect()
}

async fn assert_recorded_tiers(store: &Store, device: i64, case: &Value) {
    let name = &case["case"];
    for (metric, recorded) in case["tiers"].as_object().expect("tiers") {
        for (tier, key) in [(Tier::Minute, "minute"), (Tier::Hour, "hour"), (Tier::Day, "day")] {
            let got = store.buckets(tier, device, metric).await.expect("buckets");
            assert_eq!(got, buckets(&recorded[key]), "{name} {metric} {key}");
        }
    }
}

#[tokio::test]
async fn a_restart_around_every_minute_and_each_minute_appended_twice_change_no_bucket() {
    for case in cases() {
        let name = case["case"].as_str().expect("name");
        let dir = scratch(name);
        let device = seed(&dir).await;
        let polled = samples(&case);
        let last_ms = polled.last().expect("readings").at_ms;
        for minute in minutes(polled.clone()) {
            append_across_a_restart(&dir, device, &minute).await;
            append_across_a_restart(&dir, device, &minute).await;
        }
        // The next day's first poll, reading nothing, closes the last hour and day.
        let next_day = (last_ms.div_euclid(DAY_MS) + 1) * DAY_MS;
        let closing = ClosedMinute {
            minute: minute_of(next_day),
            samples: vec![Sample { at_ms: next_day, values: Vec::new() }],
        };
        append_across_a_restart(&dir, device, &closing).await;

        let store = Store::open(&dir).await.expect("open");
        let stored = store.readings(device, 0, next_day).await.expect("readings");
        assert_eq!(sorted(stored), sorted(polled), "{name}: every reading reads back once");
        assert_recorded_tiers(&store, device, &case).await;
        store.close().await;
        drop(std::fs::remove_dir_all(&dir));
    }
}

fn at(instant: &str) -> i64 {
    instant.parse::<Timestamp>().expect("instant").as_millisecond()
}

fn polled(readings: &[(&str, f64)]) -> ClosedMinute {
    let samples: Vec<Sample> = readings
        .iter()
        .map(|(instant, value)| Sample { at_ms: at(instant), values: vec![("power".into(), *value)] })
        .collect();
    ClosedMinute { minute: minute_of(samples[0].at_ms), samples }
}

#[tokio::test]
async fn a_minute_split_across_a_restart_rolls_up_as_one() {
    let dir = scratch("split-minute");
    let device = seed(&dir).await;
    append_across_a_restart(&dir, device, &polled(&[("2026-05-10T12:00:00Z", 0.0)])).await;
    let rest = polled(&[("2026-05-10T12:00:20Z", 30.0), ("2026-05-10T12:00:40Z", 60.0)]);
    append_across_a_restart(&dir, device, &rest).await;
    append_across_a_restart(&dir, device, &rest).await;
    append_across_a_restart(&dir, device, &polled(&[("2026-05-10T13:00:00Z", 30.0)])).await;

    let store = Store::open(&dir).await.expect("open");
    let bucket =
        |start: &str, avg, max, min| Bucket { start: start.parse().expect("instant"), avg, max, min };
    let minutes = store.buckets(Tier::Minute, device, "power").await.expect("buckets");
    // 0, 30 and 60, 20 s each.
    assert_eq!(minutes[0], bucket("2026-05-10T12:00:00Z", 30.0, 60.0, 0.0));
    // 0 and 30 for 20 s each, then 60 to 13:00: (0·20 + 30·20 + 60·3560) / 3600.
    let hours = store.buckets(Tier::Hour, device, "power").await.expect("buckets");
    assert_eq!(hours, [bucket("2026-05-10T12:00:00Z", 59.5, 60.0, 0.0)]);
    assert_eq!(store.readings(device, 0, i64::MAX).await.expect("readings").len(), 4);
    store.close().await;
    drop(std::fs::remove_dir_all(&dir));
}
