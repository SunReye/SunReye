//! `GET /api/history/rollup`: the stored buckets as the 3.x route answered them, with the open hour and day
//! rolled up from the readings.

use std::collections::BTreeMap;

use super::reads::{oracle, plain_user};
use super::*;
use crate::modbus::Transport;
use crate::rollup::Tier;
use crate::samples::{ClosedMinute, Sample, minute_of};
use crate::store::{NewConnection, NewDevice};
use crate::support::core_at;

const AT: &str = "2026-03-01T00:02:30Z";
const NOW: i64 = 1_772_323_350_000;
/// 2026-03-01T00:00:00Z. A reading on a minute boundary is its bucket's avg, max and min: nothing carried
/// in from an earlier reading is held for any of the minute.
const BASE: i64 = NOW - 150_000;
const MINUTE: i64 = 60_000;
const HOUR: i64 = 3_600_000;

type Point = (String, f64, f64, f64);
/// Each instant of a minute with the values read at it.
type Instants = BTreeMap<i64, Vec<(String, f64)>>;

pub(super) async fn add_device(core: &Core, host: &str) -> i64 {
    let connection =
        NewConnection { transport: Transport::Tcp, host: host.into(), port: 502, logger_serial: None };
    let connection = core.store.add_connection(&connection).await.expect("connection");
    let device = NewDevice { connection_id: connection, profile_id: PROFILE.into(), unit_id: 1 };
    core.store.add_device(&device).await.expect("device")
}

/// Stores one reading per `(at_ms, metric, value)`, a minute at a time as the poller closes them.
pub(super) async fn store(core: &Core, device: i64, readings: &[(i64, &str, f64)]) {
    let mut minutes: BTreeMap<i64, Instants> = BTreeMap::new();
    for (at_ms, key, value) in readings {
        let minute = minutes.entry(minute_of(*at_ms)).or_default();
        minute.entry(*at_ms).or_default().push(((*key).to_owned(), *value));
    }
    for (minute, instants) in minutes {
        let samples = instants.into_iter().map(|(at_ms, values)| Sample { at_ms, values }).collect();
        core.store.append_minute(device, &ClosedMinute { minute, samples }).await.expect("append");
    }
}

pub(super) async fn clocked(name: &str) -> (Arc<Core>, Api) {
    let core = core_at(&dir(name), AT, "UTC").await;
    signed_in(core, &Config::default()).await
}

pub(super) async fn finish(core: Arc<Core>, api: Api) {
    drop(api);
    core.stop().await;
}

fn points(body: &Value) -> Vec<Point> {
    let rows = body.as_array().unwrap_or_else(|| panic!("an array: {body}"));
    rows.iter()
        .map(|row| {
            let keys: Vec<&String> = row.as_object().expect("object").keys().collect();
            assert_eq!(keys.len(), 4, "time, avg, max and min only: {row}");
            let number = |key: &str| row[key].as_f64().unwrap_or_else(|| panic!("{key}: {row}"));
            (row["time"].as_str().expect("time").to_owned(), number("avg"), number("max"), number("min"))
        })
        .collect()
}

fn instant(at_ms: i64) -> String {
    jiff::Timestamp::from_millisecond(at_ms).expect("instant").strftime("%Y-%m-%dT%H:%M:%S.000Z").to_string()
}

/// The bucket of a reading taken on a minute boundary.
fn alone(at_ms: i64, value: f64) -> Point {
    (instant(minute_of(at_ms) * MINUTE), value, value, value)
}

async fn answer(api: &Api, query: impl Into<String>) -> Vec<Point> {
    let query = query.into();
    let answer = get(api, &format!("/api/history/rollup?{query}")).await;
    assert_eq!(answer.status, StatusCode::OK, "{query}: {}", answer.json());
    points(&answer.json())
}

fn recorded(case: &Value, metric: &str) -> Vec<Point> {
    recorded_in(case, metric, "minute")
}

fn recorded_in(case: &Value, metric: &str, tier: &str) -> Vec<Point> {
    points(&case["tiers"][metric][tier])
}

fn window_of(case: &Value) -> String {
    let bound = |key: &str| case["window"][key].as_str().expect("bound").to_owned();
    format!("from={}&to={}", bound("from"), bound("to"))
}

async fn stored(core: &Core, tier: Tier, device: i64, metric: &str) -> usize {
    core.store.buckets(tier, device, metric).await.expect("buckets").len()
}

fn oracle_cases() -> Vec<Value> {
    oracle("rollups.ndjson")
}

fn case(name: &str) -> Value {
    oracle_cases().into_iter().find(|c| c["case"] == name).expect("oracle case")
}

fn readings_of(case: &Value) -> Vec<(i64, String, f64)> {
    let mut readings = Vec::new();
    for (metric, series) in case["readings"].as_object().expect("readings") {
        for reading in series.as_array().expect("series") {
            let at: jiff::Timestamp = reading[0].as_str().expect("instant").parse().expect("RFC 3339");
            readings.push((at.as_millisecond(), metric.clone(), reading[1].as_f64().expect("value")));
        }
    }
    readings
}

async fn store_case(core: &Core, device: i64, case: &Value) {
    let readings = readings_of(case);
    let borrowed: Vec<(i64, &str, f64)> =
        readings.iter().map(|(at, key, v)| (*at, key.as_str(), *v)).collect();
    store(core, device, &borrowed).await;
}

#[tokio::test]
async fn the_read_refuses_a_stranger_and_answers_a_plain_user() {
    let (core, admin) = open(&dir("rollup-gate")).await;
    let user = plain_user(&admin).await;
    let path = "/api/history/rollup?metric=pv&bucket=minute";
    let stranger = get(&admin.anonymous(), path).await;
    assert_eq!(
        (stranger.status, stranger.json()),
        (StatusCode::UNAUTHORIZED, json!({"error": "Not signed in"}))
    );
    assert_eq!(get(&user, path).await.status, StatusCode::OK);
    assert_eq!(get(&admin, path).await.status, StatusCode::OK);
    finish(core, admin).await;
}

#[tokio::test(start_paused = true)]
async fn an_empty_store_and_an_unknown_metric_answer_an_empty_list() {
    let (core, admin) = clocked("rollup-empty").await;
    for bucket in ["minute", "hour", "day"] {
        let empty = get(&admin, &format!("/api/history/rollup?metric=pv&bucket={bucket}")).await;
        assert_eq!((empty.status, empty.json()), (StatusCode::OK, json!([])), "{bucket}");
    }

    let device = add_device(&core, "10.0.0.5").await;
    for bucket in ["minute", "hour", "day"] {
        assert_eq!(
            answer(&admin, format!("metric=pv&bucket={bucket}")).await,
            vec![],
            "no readings: {bucket}"
        );
    }
    store(&core, device, &[(BASE - MINUTE, "pv", 5.0)]).await;
    assert_eq!(answer(&admin, "metric=nothing&bucket=minute").await, vec![]);
    assert_eq!(answer(&admin, "metric=pv&bucket=minute").await.len(), 1);
    finish(core, admin).await;
}

/// How many of the case's recorded buckets are read from raw readings, not stored.
async fn served_as_recorded(core: &Core, admin: &Api, device: i64, case: &Value) -> usize {
    let window = window_of(case);
    let mut open = 0;
    for metric in case["tiers"].as_object().expect("tiers").keys() {
        for (tier, key) in [(Tier::Minute, "minute"), (Tier::Hour, "hour"), (Tier::Day, "day")] {
            let query = format!("metric={metric}&bucket={key}&inverterId={device}&{window}&limit=50000");
            let expected = recorded_in(case, metric, key);
            assert_eq!(answer(admin, &query).await, expected, "{} {metric} {key}", case["case"]);
            open += expected.len() - stored(core, tier, device, metric).await;
        }
    }
    open
}

#[tokio::test(start_paused = true)]
async fn every_oracle_case_is_served_as_its_recorded_tiers_with_the_last_hour_and_day_still_open() {
    let cases = oracle_cases();
    assert_eq!(cases.len(), 11);
    let (core, admin) = clocked("rollup-oracle").await;
    for (index, case) in cases.iter().enumerate() {
        let device = add_device(&core, &format!("10.0.1.{index}")).await;
        store_case(&core, device, case).await;
        let open = served_as_recorded(&core, &admin, device, case).await;
        assert!(open >= 2, "{}: the last hour and day are read from raw readings", case["case"]);
    }
    finish(core, admin).await;
}

#[tokio::test(start_paused = true)]
async fn an_omitted_bucket_reads_the_hour_tier() {
    let case = case("partial-window");
    let (core, admin) = clocked("rollup-default").await;
    let device = add_device(&core, "10.0.0.5").await;
    store_case(&core, device, &case).await;
    let hours = recorded_in(&case, "oracle.power", "hour");
    assert_eq!(hours.len(), 6);
    assert_eq!(answer(&admin, format!("metric=oracle.power&{}", window_of(&case))).await, hours);
    finish(core, admin).await;
}

#[tokio::test(start_paused = true)]
async fn a_reading_stale_across_midnight_is_carried_into_the_open_hour_and_day() {
    let case = case("stale-across-midnight");
    let (core, admin) = clocked("rollup-stale").await;
    let device = add_device(&core, "10.0.0.5").await;
    store_case(&core, device, &case).await;
    let window = window_of(&case);
    for key in ["hour", "day"] {
        let served = answer(&admin, format!("metric=oracle.power&bucket={key}&{window}")).await;
        assert_eq!(served, recorded_in(&case, "oracle.power", key), "{key}");
    }
    assert_eq!(stored(&core, Tier::Hour, device, "oracle.power").await, 2, "05:00 is open");
    assert_eq!(stored(&core, Tier::Day, device, "oracle.power").await, 1, "the 13th is open");
    finish(core, admin).await;
}

#[tokio::test(start_paused = true)]
async fn an_open_bucket_starts_inside_the_window_or_is_left_out_and_comes_last_under_a_limit() {
    let case = case("stale-across-midnight");
    let (core, admin) = clocked("rollup-open-edge").await;
    let device = add_device(&core, "10.0.0.5").await;
    store_case(&core, device, &case).await;
    let hours = recorded_in(&case, "oracle.power", "hour");
    let days = recorded_in(&case, "oracle.power", "day");
    let read = |query: &str| answer(&admin, format!("metric=oracle.power&{query}"));
    let from = "from=2026-04-12T00:00:00Z";
    assert_eq!(
        read(&format!("bucket=hour&{from}&to=2026-04-13T05:00:00Z")).await,
        hours[..2],
        "to is exclusive"
    );
    assert_eq!(read(&format!("bucket=hour&{from}&to=2026-04-13T05:00:00.001Z")).await, hours);
    assert_eq!(read("bucket=hour&from=2026-04-13T05:00:00Z&to=2026-04-14T00:00:00Z").await, hours[2..]);
    assert_eq!(read("bucket=hour&from=2026-04-13T05:00:00.001Z&to=2026-04-14T00:00:00Z").await, vec![]);
    assert_eq!(read(&format!("bucket=hour&{from}&to=2026-04-14T00:00:00Z&limit=2")).await, hours[..2]);
    assert_eq!(read(&format!("bucket=hour&{from}&to=2026-04-14T00:00:00Z&limit=3")).await, hours);
    assert_eq!(read(&format!("bucket=day&{from}&to=2026-04-13T00:00:00Z")).await, days[..1]);
    assert_eq!(read("bucket=day&from=2026-04-13T00:00:00Z&to=2026-04-14T00:00:00Z").await, days[1..]);
    assert_eq!(read(&format!("bucket=day&{from}&to=2026-04-14T00:00:00Z&limit=1")).await, days[..1]);
    finish(core, admin).await;
}

#[tokio::test(start_paused = true)]
async fn a_minute_split_and_repeated_across_a_restart_counts_each_reading_once_in_the_open_hour_and_day() {
    let (core, admin) = clocked("rollup-restart").await;
    let device = add_device(&core, "10.0.0.5").await;
    store(&core, device, &[(BASE - 50 * MINUTE, "pv", 10.0)]).await;
    // Stopped inside 00:00, started again inside it, the minute after appended twice.
    store(&core, device, &[(BASE + 30_000, "pv", 0.0)]).await;
    store(&core, device, &[(BASE + 45_000, "pv", 220.0)]).await;
    store(&core, device, &[(BASE + MINUTE, "pv", 0.0)]).await;
    store(&core, device, &[(BASE + MINUTE, "pv", 0.0)]).await;
    let read = |bucket: &str| answer(&admin, format!("metric=pv&bucket={bucket}"));
    // 10 carried in for 30 s, 0 for 15 s, 220 for 15 s, then 0: 3600 over the hour and over the day.
    assert_eq!(
        read("hour").await,
        [
            ("2026-02-28T23:00:00.000Z".into(), 10.0, 10.0, 10.0),
            ("2026-03-01T00:00:00.000Z".into(), 1.0, 220.0, 0.0)
        ]
    );
    assert_eq!(
        read("day").await,
        [
            ("2026-02-28T00:00:00.000Z".into(), 10.0, 10.0, 10.0),
            ("2026-03-01T00:00:00.000Z".into(), 3600.0 / 86_400.0, 220.0, 0.0)
        ]
    );
    finish(core, admin).await;
}

#[tokio::test(start_paused = true)]
async fn a_device_offline_longer_than_the_raw_window_keeps_its_last_hour_and_day() {
    let case = case("counter-restart");
    let (core, admin) = clocked("rollup-retained").await;
    let device = add_device(&core, "10.0.0.5").await;
    store_case(&core, device, &case).await;
    let window = window_of(&case);
    let read = |metric: &str, key: &str| answer(&admin, format!("metric={metric}&bucket={key}&{window}"));
    let total = "oracle.production.total";
    assert_eq!(stored(&core, Tier::Hour, device, total).await, 7);
    crate::retention::retain(&core.store, "2026-05-20T00:00:00Z".parse().expect("now"))
        .await
        .expect("retain");
    assert_eq!(core.store.readings(device, 0, i64::MAX).await.expect("readings"), vec![], "raw dropped");
    assert_eq!(stored(&core, Tier::Hour, device, total).await, 8);
    for metric in ["oracle.power", total] {
        for key in ["hour", "day"] {
            assert_eq!(read(metric, key).await, recorded_in(&case, metric, key), "{metric} {key}");
        }
    }
    let hours = read(total, "hour").await;
    assert_eq!(
        (hours[4].2, hours[4].3),
        (5004.0, 2.0),
        "a counter restart keeps the old high and the new low"
    );
    finish(core, admin).await;
}

#[tokio::test(start_paused = true)]
async fn the_open_day_is_rolled_up_from_its_stored_hours_and_the_open_hour() {
    let (core, admin) = clocked("rollup-open-day").await;
    let device = add_device(&core, "10.0.0.5").await;
    store(&core, device, &[(BASE, "pv", 2.0), (BASE + HOUR, "pv", 4.0), (BASE + 2 * HOUR, "pv", 8.0)]).await;
    let window = "from=2026-03-01T00:00:00Z&to=2026-03-02T00:00:00Z";
    assert_eq!(stored(&core, Tier::Hour, device, "pv").await, 2, "02:00 is open");
    // 2 and 4 an hour each, then 8 to midnight: (7200 + 14400 + 8·79200) / 86400.
    let day = ("2026-03-01T00:00:00.000Z".to_owned(), 655_200.0 / 86_400.0, 8.0, 2.0);
    assert_eq!(answer(&admin, format!("metric=pv&bucket=day&{window}")).await, [day]);
    finish(core, admin).await;
}

#[tokio::test(start_paused = true)]
async fn an_hours_window_reaches_the_open_hour() {
    let (core, admin) = clocked("rollup-open-now").await;
    let device = add_device(&core, "10.0.0.5").await;
    store(&core, device, &[(BASE - 30 * MINUTE, "pv", 4.0), (BASE + MINUTE, "pv", 0.0)]).await;
    // 4 carried in for the first minute of 00:00, then 0.
    let open = ("2026-03-01T00:00:00.000Z".to_owned(), 240.0 / 3600.0, 0.0, 0.0);
    assert_eq!(answer(&admin, "metric=pv&hours=1").await, [open]);
    assert_eq!(answer(&admin, "metric=pv&bucket=hour&hours=2").await.len(), 2);
    assert_eq!(answer(&admin, "metric=pv&bucket=day&hours=1").await.len(), 1, "today");
    assert_eq!(answer(&admin, "metric=nothing&bucket=hour").await, vec![]);
    finish(core, admin).await;
}

#[tokio::test(start_paused = true)]
async fn zero_and_negative_readings_are_buckets_not_gaps() {
    let case = case("zero-and-negative");
    let (core, admin) = clocked("rollup-zero").await;
    let device = add_device(&core, "10.0.0.5").await;
    store_case(&core, device, &case).await;
    let window = "from=2026-02-10T00:00:00Z&to=2026-02-11T00:00:00Z";
    let power = answer(&admin, format!("metric=oracle.power&bucket=minute&{window}")).await;
    assert_eq!(power, recorded(&case, "oracle.power"));
    assert_eq!((power[0].1, power[0].2, power[0].3), (0.0, 0.0, 0.0), "a zero reading is a bucket");
    assert!(power.iter().any(|p| p.1 < 0.0), "an export is negative");
    finish(core, admin).await;
}

#[tokio::test(start_paused = true)]
async fn a_window_across_midnight_utc_opens_at_from_and_closes_before_to() {
    let case = case("midnight-crossing");
    let (core, admin) = clocked("rollup-midnight").await;
    let device = add_device(&core, "10.0.0.5").await;
    store_case(&core, device, &case).await;
    let all = recorded(&case, "oracle.power");
    assert_eq!(all.len(), 4, "22:50, 23:10, 00:10, 01:00");
    let read = |window: &str| answer(&admin, format!("metric=oracle.power&bucket=minute&{window}"));

    let exact = read("from=2026-01-14T23:10:00Z&to=2026-01-15T00:10:00Z").await;
    assert_eq!(exact, all[1..2], "from is inclusive, to is exclusive");
    let across = read("from=2026-01-14T23:10:00Z&to=2026-01-15T00:10:01Z").await;
    assert_eq!(across, all[1..3]);
    let offset = read("from=2026-01-15T00:10:00%2B01:00&to=2026-01-15T01:00:01Z").await;
    assert_eq!(offset, all[1..4], "an offset in the bound is the same instant in UTC");
    let before = read("from=2026-01-14T22:50:01Z&to=2026-01-14T23:10:00Z").await;
    assert_eq!(before, vec![], "a window between two buckets is empty");
    finish(core, admin).await;
}

#[tokio::test(start_paused = true)]
async fn an_hours_window_reaches_back_from_now_and_defaults_to_a_week() {
    let readings = [
        (BASE - 169 * HOUR, "pv", 1.0),
        (BASE - 167 * HOUR, "pv", 2.0),
        (BASE - 63 * MINUTE, "pv", 3.0),
        (BASE - 57 * MINUTE, "pv", 4.0),
        (BASE - 2 * MINUTE, "pv", 0.0),
    ];
    let (core, admin) = clocked("rollup-hours").await;
    let device = add_device(&core, "10.0.0.5").await;
    store(&core, device, &readings).await;
    let at = |i: usize| alone(readings[i].0, readings[i].2);
    assert_eq!(answer(&admin, "metric=pv&bucket=minute&hours=1").await, [at(3), at(4)]);
    assert_eq!(answer(&admin, "metric=pv&bucket=minute&hours=2").await, [at(2), at(3), at(4)]);
    assert_eq!(answer(&admin, "metric=pv&bucket=minute&hours=1.5").await, [at(2), at(3), at(4)]);
    assert_eq!(answer(&admin, "metric=pv&bucket=minute").await, [at(1), at(2), at(3), at(4)], "168 h");
    assert_eq!(answer(&admin, "metric=pv&bucket=minute&hours=100000").await.len(), 5);
    for hours in ["1000000000000000", "1e300"] {
        assert_eq!(
            answer(&admin, format!("metric=pv&bucket=minute&hours={hours}")).await.len(),
            5,
            "{hours}"
        );
    }
    finish(core, admin).await;
}

#[tokio::test(start_paused = true)]
async fn a_half_specified_range_falls_back_to_hours() {
    let readings = [(BASE - 2 * HOUR, "pv", 1.0), (BASE - 30 * MINUTE, "pv", 2.0), (BASE + HOUR, "pv", 3.0)];
    let (core, admin) = clocked("rollup-half").await;
    let device = add_device(&core, "10.0.0.5").await;
    store(&core, device, &readings).await;
    let at = |i: usize| alone(readings[i].0, readings[i].2);
    let from = instant(NOW - 3 * HOUR);
    let to = instant(NOW - HOUR);
    assert_eq!(answer(&admin, format!("metric=pv&bucket=minute&from={from}&hours=1")).await, [at(1), at(2)]);
    assert_eq!(answer(&admin, format!("metric=pv&bucket=minute&to={to}&hours=1")).await, [at(1), at(2)]);
    assert_eq!(answer(&admin, format!("metric=pv&bucket=minute&from={from}&to={to}")).await, [at(0)]);
    assert_eq!(answer(&admin, "metric=pv&bucket=minute&from=&to=&hours=1").await, [at(1), at(2)]);
    assert_eq!(answer(&admin, format!("metric=pv&bucket=minute&from={from}&to={to}&hours=1")).await, [at(0)]);
    finish(core, admin).await;
}

#[tokio::test(start_paused = true)]
async fn a_limit_keeps_the_oldest_buckets_in_ascending_order() {
    let case = case("partial-window");
    let (core, admin) = clocked("rollup-limit").await;
    let device = add_device(&core, "10.0.0.5").await;
    store_case(&core, device, &case).await;
    let all = recorded(&case, "oracle.power");
    assert_eq!(all.len(), 17);
    let window = "from=2026-05-20T00:00:00Z&to=2026-05-21T00:00:00Z";
    let read =
        |limit: &str| answer(&admin, format!("metric=oracle.power&bucket=minute&{window}&limit={limit}"));
    assert_eq!(read("5").await, all[..5]);
    assert_eq!(read("1").await, all[..1]);
    assert_eq!(read("17").await, all);
    assert_eq!(read("18").await, all);
    assert_eq!(
        answer(&admin, format!("metric=oracle.power&bucket=minute&{window}")).await,
        all,
        "default 5000"
    );
    finish(core, admin).await;
}

#[tokio::test(start_paused = true)]
async fn a_query_outside_what_the_route_takes_is_a_400_in_the_error_shape() {
    let (core, admin) = clocked("rollup-refused").await;
    for query in [
        "bucket=minute",
        "metric=pv&bucket=week",
        "metric=pv&bucket=",
        "metric=pv&bucket=minute&limit=0",
        "metric=pv&bucket=minute&limit=50001",
        "metric=pv&bucket=minute&limit=-1",
        "metric=pv&bucket=minute&limit=many",
        "metric=pv&bucket=minute&limit=1.5",
        "metric=pv&bucket=minute&hours=0",
        "metric=pv&bucket=minute&hours=0.99",
        "metric=pv&bucket=minute&hours=-3",
        "metric=pv&bucket=minute&hours=soon",
        "metric=pv&bucket=minute&hours=NaN",
        "metric=pv&bucket=minute&hours=inf",
        "metric=pv&bucket=minute&from=yesterday&to=2026-03-01T00:00:00Z",
        "metric=pv&bucket=minute&from=2026-03-01T00:00:00Z&to=tomorrow",
    ] {
        let refused = get(&admin, &format!("/api/history/rollup?{query}")).await;
        assert_eq!(refused.status, StatusCode::BAD_REQUEST, "{query}");
        assert!(refused.json()["error"].as_str().is_some_and(|e| !e.is_empty()), "{query}");
    }
    for query in [
        "bucket=minute",
        "bucket=hour",
        "bucket=day",
        "limit=1",
        "limit=50000",
        "hours=1",
        "hours=1.5",
        "from=&to=",
    ] {
        let served = get(&admin, &format!("/api/history/rollup?metric=pv&{query}")).await;
        assert_eq!(served.status, StatusCode::OK, "{query}");
    }
    finish(core, admin).await;
}

#[tokio::test(start_paused = true)]
async fn source_and_inverter_id_name_one_device_by_its_decimal_id() {
    let (core, admin) = clocked("rollup-source").await;
    let first = add_device(&core, "10.0.0.5").await;
    let second = add_device(&core, "10.0.0.6").await;
    store(&core, first, &[(BASE - 2 * MINUTE, "pv", 1.0)]).await;
    store(&core, second, &[(BASE - 3 * MINUTE, "pv", 2.0)]).await;
    let one = alone(BASE - 2 * MINUTE, 1.0);
    let two = alone(BASE - 3 * MINUTE, 2.0);
    let read = |who: &str| answer(&admin, format!("metric=pv&bucket=minute&{who}"));
    assert_eq!(read("").await, vec![one.clone()], "no source: the first device, as /api/history/recent");
    let plant = get(&admin, "/api/history/rollup?metric=pv&bucket=minute&source=plant").await;
    assert_eq!(
        plant.status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "two members: pv has no role, so no plant value"
    );
    assert_eq!(read(&format!("source={first}")).await, vec![one.clone()]);
    assert_eq!(read(&format!("source={second}")).await, vec![two.clone()]);
    assert_eq!(read(&format!("inverterId={second}")).await, vec![two.clone()]);
    assert_eq!(read(&format!("source={first}&inverterId={second}")).await, [one], "source wins, as in 3.x");
    assert_eq!(read("source=&inverterId=").await.len(), 1);
    for unknown in ["source=99", "inverterId=0", "inverterId=x", "source=-1", "inverterId=1.5", "source=%201"]
    {
        assert_eq!(read(unknown).await, vec![], "{unknown}: no such device");
    }
    finish(core, admin).await;
}

#[tokio::test(start_paused = true)]
async fn a_retired_device_is_read_by_its_source_and_the_default_is_the_first_in_service() {
    let (core, admin) = clocked("rollup-retired").await;
    let first = add_device(&core, "10.0.0.5").await;
    let second = add_device(&core, "10.0.0.6").await;
    store(&core, first, &[(BASE - 2 * MINUTE, "pv", 1.0)]).await;
    store(&core, second, &[(BASE - 3 * MINUTE, "pv", 2.0)]).await;
    // The route refuses retiring the first device in service; a store edit reaches the state.
    let retire = crate::store::DeviceEdit {
        retired_at: Some(Some("2026-11-03T10:00:00.000Z".into())),
        ..Default::default()
    };
    assert!(core.store.edit_device(first, &retire).await.expect("retire"));
    let read = |who: &str| answer(&admin, format!("metric=pv&bucket=minute&{who}"));
    assert_eq!(
        read(&format!("source={first}")).await,
        vec![alone(BASE - 2 * MINUTE, 1.0)],
        "retired, still read"
    );
    assert_eq!(read("").await, vec![alone(BASE - 3 * MINUTE, 2.0)], "no source: the first in service");
    let plant = get(&admin, "/api/history/rollup?metric=pv&bucket=minute&source=plant").await;
    assert_eq!(plant.status, StatusCode::UNPROCESSABLE_ENTITY, "the retired member stays in the plant");
    finish(core, admin).await;
}

#[tokio::test(start_paused = true)]
async fn a_device_that_went_quiet_answers_an_empty_window_not_an_error() {
    let (core, admin) = clocked("rollup-offline").await;
    let device = add_device(&core, "10.0.0.5").await;
    store(&core, device, &[(BASE - 30 * HOUR, "pv", 7.0), (BASE - 29 * HOUR, "pv", 8.0)]).await;
    assert_eq!(answer(&admin, "metric=pv&bucket=minute&hours=24").await, vec![], "nothing in the last day");
    assert_eq!(answer(&admin, "metric=pv&bucket=minute&hours=48").await.len(), 2);
    finish(core, admin).await;
}
