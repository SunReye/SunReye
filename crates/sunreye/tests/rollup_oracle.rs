//! Every case of `fixtures/oracle/rollups.ndjson`: the readings rolled up into minute, hourly and daily
//! buckets must equal what the 2.x continuous aggregates recorded.

#![allow(clippy::expect_used, reason = "helpers outside #[test] fns may panic like the tests")]

use std::path::Path;

use jiff::Timestamp;
use serde_json::Value;
use sunreye::rollup::{Bucket, Tier, rollup};

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

fn readings(series: &Value) -> Vec<(Timestamp, f64)> {
    series.as_array().expect("readings").iter().map(|r| (instant(&r[0]), number(&r[1]))).collect()
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

#[test]
fn every_oracle_case_rolls_up_to_its_recorded_tiers() {
    let cases = cases();
    assert_eq!(cases.len(), 11);
    for case in &cases {
        let name = case["case"].as_str().expect("name");
        let tiers = case["tiers"].as_object().expect("tiers");
        assert_eq!(tiers.len(), case["readings"].as_object().expect("readings").len(), "{name}");
        for (metric, recorded) in tiers {
            let input = readings(&case["readings"][metric]);
            for (tier, key) in [(Tier::Minute, "minute"), (Tier::Hour, "hour"), (Tier::Day, "day")] {
                assert_eq!(rollup(tier, &input), buckets(&recorded[key]), "{name} {metric} {key}");
            }
        }
    }
}
