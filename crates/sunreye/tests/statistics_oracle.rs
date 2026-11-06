//! Every case of `fixtures/oracle/statistics.ndjson`: the readings of `rollups.ndjson` rolled up, their counter
//! deltas chained and cut into periods must equal what the 2.x read path recorded.
//!
//! The recorded figures are floats summed in SQL's order; ours differ in the last digits, so they are
//! compared to 1e-9.

#![allow(clippy::expect_used, reason = "helpers outside #[test] fns may panic like the tests")]

use std::collections::BTreeMap;
use std::path::Path;

use jiff::Timestamp;
use jiff::tz::TimeZone;
use serde_json::{Value, json};
use sunreye::rollup::{Bucket, Tier, rollup};
use sunreye::statistics::{
    Cut, Period, Roles, Totals, View, energy_series, meters_load, rises, sources, totals_by_bucket,
};

fn lines(file: &str) -> Vec<Value> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/oracle").join(file);
    std::fs::read_to_string(path)
        .expect("fixture")
        .lines()
        .map(|line| serde_json::from_str(line).expect("case"))
        .collect()
}

fn instant(value: &Value) -> Timestamp {
    value.as_str().expect("instant").parse().expect("RFC 3339")
}

fn same(got: &Value, want: &Value, at: &str) {
    match (got, want) {
        (Value::Number(a), Value::Number(b)) => {
            let (a, b) = (a.as_f64().expect("number"), b.as_f64().expect("number"));
            assert!((a - b).abs() < 1e-9, "{at}: {a} != {b}");
        }
        (Value::Object(a), Value::Object(b)) => {
            assert_eq!(a.keys().collect::<Vec<_>>(), b.keys().collect::<Vec<_>>(), "{at}");
            for (key, value) in a {
                same(value, &b[key], &format!("{at}.{key}"));
            }
        }
        (Value::Array(a), Value::Array(b)) => {
            assert_eq!(a.len(), b.len(), "{at}: {got} != {want}");
            for (i, (a, b)) in a.iter().zip(b).enumerate() {
                same(a, b, &format!("{at}[{i}]"));
            }
        }
        _ => assert_eq!(got, want, "{at}"),
    }
}

struct Case {
    name: String,
    zone: TimeZone,
    roles: Roles,
    window: (Timestamp, Timestamp),
    month_window: (Timestamp, Timestamp),
    /// Each metric's readings, from `rollups.ndjson`.
    readings: BTreeMap<String, Vec<(Timestamp, f64)>>,
    recorded: Value,
}

fn cases() -> Vec<Case> {
    let inputs = lines("rollups.ndjson");
    lines("statistics.ndjson")
        .into_iter()
        .map(|recorded| {
            let name = recorded["case"].as_str().expect("case").to_owned();
            let input = inputs.iter().find(|c| c["case"] == name).expect("rollup case");
            let span = |value: &Value| (instant(&value["from"]), instant(&value["to"]));
            Case {
                zone: TimeZone::get(recorded["timeZone"].as_str().expect("zone")).expect("zone"),
                roles: recorded["roles"]
                    .as_object()
                    .expect("roles")
                    .iter()
                    .map(|(role, key)| (role.clone(), key.as_str().expect("key").to_owned()))
                    .collect(),
                window: span(&recorded["window"]),
                month_window: span(&recorded["monthWindow"]),
                readings: input["readings"]
                    .as_object()
                    .expect("readings")
                    .iter()
                    .map(|(key, series)| {
                        let series = series.as_array().expect("series");
                        (
                            key.clone(),
                            series.iter().map(|r| (instant(&r[0]), r[1].as_f64().expect("value"))).collect(),
                        )
                    })
                    .collect(),
                name,
                recorded,
            }
        })
        .collect()
}

impl Case {
    /// Per-bucket rises of every energy source, over `window`, read from `view`'s tier.
    fn buckets(&self, view: View, window: (Timestamp, Timestamp)) -> BTreeMap<Timestamp, Totals> {
        let tier = match view {
            View::Hour => Tier::Hour,
            View::Day => Tier::Day,
        };
        let mut by_field = Vec::new();
        for source in sources(&self.roles, view) {
            let all = rollup(tier, self.readings.get(&source.key).map_or(&[][..], Vec::as_slice));
            let before = all.iter().rev().find(|b| b.start < window.0);
            let within: Vec<Bucket> =
                all.iter().copied().filter(|b| (window.0..window.1).contains(&b.start)).collect();
            by_field.push((source.field, rises(&source, view, &self.zone, before, &within)));
        }
        totals_by_bucket(by_field)
    }

    fn periods(&self, view: View, period: Period, window: (Timestamp, Timestamp)) -> Value {
        let buckets = self.buckets(view, window);
        let cut = Cut { period, zone: &self.zone, from: window.0, to: window.1 };
        let series = energy_series(&cut, &buckets, !meters_load(&self.roles));
        serde_json::to_value(series).expect("json")
    }
}

#[test]
fn every_oracle_case_has_its_roles_and_all_eleven_run() {
    assert_eq!(cases().len(), 11);
}

#[test]
fn the_rise_of_each_hour_is_the_recorded_hourly_energy() {
    for case in cases() {
        let implied = !meters_load(&case.roles);
        let hours: Vec<Value> = case
            .buckets(View::Hour, case.window)
            .into_iter()
            .map(|(start, totals)| {
                let t = if implied { totals.with_implied_load() } else { totals };
                json!({
                    "time": start.strftime("%Y-%m-%dT%H:%M:%S%.3fZ").to_string(),
                    "import": t.import, "export": t.export, "load": t.load, "production": t.production,
                    "batteryDischarge": t.battery_discharge, "batteryCharge": t.battery_charge,
                })
            })
            .collect();
        same(&Value::Array(hours), &case.recorded["hourly"], &format!("{} hourly", case.name));
    }
}

#[test]
fn days_cut_from_the_daily_tier_are_the_recorded_daily_figures() {
    for case in cases() {
        let got = case.periods(View::Day, Period::Day, case.window);
        same(&got, &case.recorded["daily"], &format!("{} daily", case.name));
    }
}

#[test]
fn days_cut_in_the_plant_zone_from_hourly_buckets_are_the_recorded_local_days() {
    for case in cases() {
        let got = case.periods(View::Hour, Period::Day, case.window);
        same(&got, &case.recorded["dailyLocal"], &format!("{} dailyLocal", case.name));
    }
}

#[test]
fn months_and_years_are_the_recorded_monthly_and_yearly_figures() {
    for case in cases() {
        let months = case.periods(View::Day, Period::Month, case.month_window);
        same(&months, &case.recorded["monthly"], &format!("{} monthly", case.name));
        let years = case.periods(View::Day, Period::Year, case.month_window);
        same(&years, &case.recorded["yearly"], &format!("{} yearly", case.name));
    }
}
