//! `GET /api/energy/series`: counter rises over stored rollups, cut into plant-zone periods.
//!
//! Expected figures are worked by hand from the readings below. The recorded oracle cases run in
//! `tests/statistics_oracle.rs`, on the engine, because the deye profile maps a load counter and day
//! registers the oracle's synthetic profile does not.

use super::rollup::{add_device, clocked, finish, store};
use super::*;
use crate::rollup::Tier;
use crate::store::{CounterFill, DeviceEdit};

const DAY_PRODUCTION: &str = "day_energy";
const DAY_IMPORT: &str = "ac.daily_energy_bought";
const TOTAL_PRODUCTION: &str = "total_energy";

fn ms(instant: &str) -> i64 {
    instant.parse::<jiff::Timestamp>().expect("instant").as_millisecond()
}

/// Readings of one metric: `(instant, value)` pairs.
fn series<'a>(key: &'a str, readings: &[(&str, f64)]) -> Vec<(i64, &'a str, f64)> {
    readings.iter().map(|(at, value)| (ms(at), key, *value)).collect()
}

async fn berlin(core: &Core) {
    core.store.save_plant_time_zone("Europe/Berlin").await.expect("zone");
}

async fn energy(api: &Api, query: &str) -> Value {
    let answer = get(api, &format!("/api/energy/series?{query}")).await;
    assert_eq!(answer.status, StatusCode::OK, "{query}: {}", answer.json());
    answer.json()
}

/// `(bucket, production, import)` of each period.
fn figures(body: &Value) -> Vec<(String, f64, f64)> {
    body.as_array()
        .expect("an array")
        .iter()
        .map(|p| {
            let kwh = |key: &str| p[key].as_f64().unwrap_or_else(|| panic!("{key}: {p}"));
            (p["bucket"].as_str().expect("bucket").to_owned(), kwh("productionKwh"), kwh("importKwh"))
        })
        .collect()
}

fn day(bucket: &str, production: f64, import: f64) -> (String, f64, f64) {
    (bucket.to_owned(), production, import)
}

/// Winter, UTC+1. The day registers rise 1 → 3 → 6 over 10:00Z, 11:00Z and 12:00Z; the import register
/// 0.5 → 1.5 across the hour with no reading.
async fn a_winter_day(core: &Core) -> i64 {
    let device = add_device(core, "10.0.0.5").await;
    let mut readings = series(
        DAY_PRODUCTION,
        &[("2026-01-14T10:00:00Z", 1.0), ("2026-01-14T11:00:00Z", 3.0), ("2026-01-14T12:00:00Z", 6.0)],
    );
    readings.extend(series(DAY_IMPORT, &[("2026-01-14T10:00:00Z", 0.5), ("2026-01-14T12:00:00Z", 1.5)]));
    store(core, device, &readings).await;
    device
}

#[tokio::test]
async fn the_read_refuses_a_stranger_and_answers_a_plain_user() {
    let (core, admin) = open(&dir("energy-gate")).await;
    let user = reads::plain_user(&admin).await;
    let path = "/api/energy/series?from=2026-01-01T00:00:00Z&to=2026-01-02T00:00:00Z&bucket=day";
    let stranger = get(&admin.anonymous(), path).await;
    assert_eq!(
        (stranger.status, stranger.json()),
        (StatusCode::UNAUTHORIZED, json!({"error": "Not signed in"}))
    );
    assert_eq!(get(&user, path).await.status, StatusCode::OK);
    assert_eq!(get(&admin, path).await.status, StatusCode::OK);
    finish(core, admin).await;
}

#[tokio::test]
async fn a_day_is_the_plant_zones_day_with_empty_days_zero_filled() {
    let (core, admin) = clocked("energy-day").await;
    berlin(&core).await;
    a_winter_day(&core).await;
    let body = energy(&admin, "from=2026-01-13T23:00:00Z&to=2026-01-15T23:00:00Z&bucket=day").await;
    assert_eq!(figures(&body), [day("2026-01-14", 5.0, 1.0), day("2026-01-15", 0.0, 0.0)]);
    let busy = &body[0];
    // Nothing metered a load, so none is implied: the profile maps a load counter that never read.
    assert_eq!((busy["loadKwh"].as_f64(), busy["selfConsumption"].as_f64()), (Some(0.0), Some(1.0)));
    let idle = &body[1];
    assert_eq!(
        (idle["selfSufficiency"].clone(), idle["selfConsumption"].clone()),
        (Value::Null, Value::Null)
    );
    finish(core, admin).await;
}

#[tokio::test]
async fn an_hour_is_a_plant_local_hour() {
    let (core, admin) = clocked("energy-hour").await;
    berlin(&core).await;
    a_winter_day(&core).await;
    let body = energy(&admin, "from=2026-01-14T09:00:00Z&to=2026-01-14T13:00:00Z&bucket=hour").await;
    assert_eq!(
        figures(&body),
        [
            ("2026-01-14T10".to_owned(), 0.0, 0.0),
            ("2026-01-14T11".to_owned(), 0.0, 0.0),
            ("2026-01-14T12".to_owned(), 2.0, 0.0),
            ("2026-01-14T13".to_owned(), 3.0, 1.0),
        ]
    );
    finish(core, admin).await;
}

/// Lifetime production by day: 100, 110, 125 and 130 on the 30th and 31st of January and the 1st and 2nd
/// of February, read at noon UTC.
async fn lifetime(core: &Core, host: &str, start: f64) -> i64 {
    let device = add_device(core, host).await;
    let noon = [
        ("2026-01-30T12:00:00Z", start),
        ("2026-01-31T12:00:00Z", start + 10.0),
        ("2026-02-01T12:00:00Z", start + 25.0),
        ("2026-02-02T12:00:00Z", start + 30.0),
    ];
    store(core, device, &series(TOTAL_PRODUCTION, &noon)).await;
    device
}

#[tokio::test]
async fn months_and_years_read_the_daily_tier_and_the_open_day_counts() {
    let (core, admin) = clocked("energy-month").await;
    berlin(&core).await;
    lifetime(&core, "10.0.0.5", 100.0).await;
    let window = "from=2025-12-31T23:00:00Z&to=2026-02-28T23:00:00Z";
    let months = energy(&admin, &format!("{window}&bucket=month")).await;
    // The 30th books nothing (no predecessor); the 31st 10; the 1st 15 and the open 2nd 5.
    assert_eq!(figures(&months), [day("2026-01", 10.0, 0.0), day("2026-02", 20.0, 0.0)]);
    let years = energy(&admin, &format!("{window}&bucket=year")).await;
    assert_eq!(figures(&years), [day("2026", 30.0, 0.0)]);
    finish(core, admin).await;
}

#[tokio::test]
async fn the_plant_sums_its_members_and_a_retired_member_keeps_its_history() {
    let (core, admin) = clocked("energy-plant").await;
    berlin(&core).await;
    lifetime(&core, "10.0.0.5", 100.0).await;
    let second = lifetime(&core, "10.0.0.6", 50.0).await;
    let window = "from=2025-12-31T23:00:00Z&to=2026-02-28T23:00:00Z&bucket=month";
    let both = [day("2026-01", 20.0, 0.0), day("2026-02", 40.0, 0.0)];
    assert_eq!(figures(&energy(&admin, &format!("{window}&source=plant")).await), both);
    let retire =
        DeviceEdit { retired_at: Some(Some("2026-02-03T00:00:00Z".into())), ..DeviceEdit::default() };
    assert!(core.store.edit_device(second, &retire).await.expect("retire"));
    assert_eq!(figures(&energy(&admin, &format!("{window}&source=plant")).await), both);
    let own = energy(&admin, &format!("{window}&source={second}")).await;
    assert_eq!(figures(&own), [day("2026-01", 10.0, 0.0), day("2026-02", 20.0, 0.0)]);
    finish(core, admin).await;
}

/// A member reading lifetime production at noon UTC on the given days.
async fn member(core: &Core, host: &str, noon: &[(&str, f64)]) -> i64 {
    let device = add_device(core, host).await;
    let readings: Vec<_> = noon.iter().map(|(date, kwh)| (format!("{date}T12:00:00Z"), *kwh)).collect();
    let readings: Vec<_> = readings.iter().map(|(at, kwh)| (at.as_str(), *kwh)).collect();
    store(core, device, &series(TOTAL_PRODUCTION, &readings)).await;
    device
}

const WINTER: &str = "from=2025-12-31T23:00:00Z&to=2026-02-28T23:00:00Z&bucket=month&source=plant";

#[tokio::test]
async fn a_member_joining_inside_the_window_books_only_its_own_rises() {
    let (core, admin) = clocked("energy-plant-joins").await;
    berlin(&core).await;
    lifetime(&core, "10.0.0.5", 100.0).await;
    member(&core, "10.0.0.6", &[("2026-02-01", 5000.0), ("2026-02-02", 5001.0)]).await;
    // The first: 10 in January, 20 in February; the second: nothing on its first day, 1 on the 2nd.
    assert_eq!(
        figures(&energy(&admin, WINTER).await),
        [day("2026-01", 10.0, 0.0), day("2026-02", 21.0, 0.0)]
    );
    finish(core, admin).await;
}

#[tokio::test]
async fn a_member_that_stops_reading_lends_no_base_to_another() {
    let (core, admin) = clocked("energy-plant-stops").await;
    berlin(&core).await;
    member(&core, "10.0.0.5", &[("2026-01-01", 100.0), ("2026-01-02", 110.0)]).await;
    member(&core, "10.0.0.6", &[("2025-12-31", 50.0)]).await;
    let window = "from=2025-11-30T23:00:00Z&to=2026-01-31T23:00:00Z&bucket=month&source=plant";
    // The second's one reading and the first's first have no predecessor of their own; then 10.
    assert_eq!(figures(&energy(&admin, window).await), [day("2025-12", 0.0, 0.0), day("2026-01", 10.0, 0.0)]);
    finish(core, admin).await;
}

#[tokio::test]
async fn a_members_counter_restart_hides_no_other_members_rise() {
    let (core, admin) = clocked("energy-plant-restart").await;
    berlin(&core).await;
    let days = ["2026-01-10", "2026-01-11", "2026-01-12", "2026-01-13"];
    let restarts: Vec<_> = days.into_iter().zip([100.0, 110.0, 2.0, 7.0]).collect();
    let steady: Vec<_> = days.into_iter().zip([1000.0, 1001.0, 1002.0, 1003.0]).collect();
    member(&core, "10.0.0.5", &restarts).await;
    member(&core, "10.0.0.6", &steady).await;
    // The restarting member: 10 on the 11th, nothing on the 12th, 5 on the 13th; the steady one 1 a day.
    assert_eq!(figures(&energy(&admin, WINTER).await), [day("2026-01", 18.0, 0.0), day("2026-02", 0.0, 0.0)]);
    finish(core, admin).await;
}

#[tokio::test]
async fn a_member_retired_inside_the_window_keeps_the_rest_of_the_plant_whole() {
    let (core, admin) = clocked("energy-plant-retired-within").await;
    berlin(&core).await;
    lifetime(&core, "10.0.0.5", 100.0).await;
    let retired = member(&core, "10.0.0.6", &[("2026-01-30", 50.0), ("2026-01-31", 60.0)]).await;
    let retire =
        DeviceEdit { retired_at: Some(Some("2026-02-01T00:00:00Z".into())), ..DeviceEdit::default() };
    assert!(core.store.edit_device(retired, &retire).await.expect("retire"));
    // January: 10 from each; February: the first's 15 and 5.
    assert_eq!(
        figures(&energy(&admin, WINTER).await),
        [day("2026-01", 20.0, 0.0), day("2026-02", 20.0, 0.0)]
    );
    finish(core, admin).await;
}

#[tokio::test]
async fn an_unknown_device_and_an_empty_window_answer_what_they_hold() {
    let (core, admin) = clocked("energy-empty").await;
    berlin(&core).await;
    let nothing =
        energy(&admin, "from=2026-01-14T00:00:00Z&to=2026-01-15T00:00:00Z&bucket=day&source=999").await;
    assert_eq!(figures(&nothing), [day("2026-01-14", 0.0, 0.0)]);
    assert_eq!(
        energy(&admin, "from=2026-01-14T00:00:00Z&to=2026-01-14T00:00:00Z&bucket=day").await,
        json!([])
    );
    assert_eq!(
        energy(&admin, "from=2026-01-15T00:00:00Z&to=2026-01-14T00:00:00Z&bucket=day").await,
        json!([])
    );
    finish(core, admin).await;
}

#[tokio::test]
async fn a_malformed_request_is_the_callers_400() {
    let (core, admin) = clocked("energy-bad").await;
    for query in [
        "to=2026-01-02T00:00:00Z&bucket=day",
        "from=2026-01-01T00:00:00Z&bucket=day",
        "from=2026-01-01T00:00:00Z&to=2026-01-02T00:00:00Z",
        "from=2026-01-01T00:00:00Z&to=2026-01-02T00:00:00Z&bucket=week",
        "from=yesterday&to=2026-01-02T00:00:00Z&bucket=day",
        "from=2026-01-01T00:00:00Z&to=tomorrow&bucket=day",
    ] {
        let answer = get(&admin, &format!("/api/energy/series?{query}")).await;
        assert_eq!(answer.status, StatusCode::BAD_REQUEST, "{query}: {}", answer.json());
    }
    finish(core, admin).await;
}

#[tokio::test]
async fn a_window_wider_than_the_read_cap_is_refused_and_one_at_the_cap_is_answered() {
    let (core, admin) = clocked("energy-cap").await;
    let from = ms("2026-01-01T00:00:00Z");
    let hours = |count: i64| {
        let to = jiff::Timestamp::from_millisecond(from + count * 3_600_000).expect("instant");
        format!("from=2026-01-01T00:00:00Z&to={to}&bucket=day")
    };
    let at_cap = get(&admin, &format!("/api/energy/series?{}", hours(50_000))).await;
    assert_eq!(at_cap.status, StatusCode::OK);
    let over = get(&admin, &format!("/api/energy/series?{}", hours(50_001))).await;
    assert_eq!(over.status, StatusCode::BAD_REQUEST);
    assert_eq!(over.json()["error"], "The window holds too many hours: ask for 50000 at most");
    finish(core, admin).await;
}

const FIVE_YEARS: &str = "from=2021-01-01T00:00:00Z&to=2026-01-01T00:00:00Z";
/// 2021-01-01 to 2026-01-01: 1826 days, 2024 a leap year.
const DAYS: i64 = 1826;

/// Five years of stored counters in the UTC plant zone: hourly day registers rising 0.5 kWh an hour
/// of production, 0.25 of import and 0.125 of export, and daily lifetime counters rising 12, 6 and 3.
async fn five_years(core: &Core) -> i64 {
    core.store.save_plant_time_zone("UTC").await.expect("zone");
    let device = add_device(core, "10.0.0.5").await;
    let from = "2021-01-01T00:00:00Z".parse().expect("instant");
    let hours = |step| CounterFill { tier: Tier::Hour, from, count: DAYS * 24, step, resets_every: 24 };
    let days = |step| CounterFill { tier: Tier::Day, from, count: DAYS, step, resets_every: i64::MAX };
    let registers = [(DAY_PRODUCTION, 0.5), (DAY_IMPORT, 0.25), ("ac.daily_energy_sold", 0.125)];
    let totals = [(TOTAL_PRODUCTION, 12.0), ("ac.total_energy_bought", 6.0), ("ac.total_energy_sold", 3.0)];
    for (key, step) in registers {
        core.store.fill_counter(device, key, hours(step)).await;
    }
    for (key, step) in totals {
        core.store.fill_counter(device, key, days(step)).await;
    }
    device
}

#[tokio::test]
async fn five_years_of_hours_read_as_days_with_every_hour_booked_once() {
    let (core, admin) = clocked("energy-five-years-days").await;
    five_years(&core).await;
    let body = energy(&admin, &format!("{FIVE_YEARS}&bucket=day")).await;
    let days = figures(&body);
    assert_eq!(days.len(), usize::try_from(DAYS).expect("days"));
    assert_eq!((days[0].0.as_str(), days[days.len() - 1].0.as_str()), ("2021-01-01", "2025-12-31"));
    // 24 hours of 0.5 and of 0.25: the day registers restart at each midnight and book no more than a day.
    assert!(days.iter().all(|(_, production, import)| (*production, *import) == (12.0, 6.0)));
    assert_eq!(body[100]["exportKwh"], 3.0);
    finish(core, admin).await;
}

#[tokio::test]
async fn five_years_of_days_read_as_months_and_years() {
    let (core, admin) = clocked("energy-five-years-months").await;
    five_years(&core).await;
    let months = figures(&energy(&admin, &format!("{FIVE_YEARS}&bucket=month")).await);
    assert_eq!(months.len(), 60);
    assert_eq!(
        (months[0].clone(), months[1].clone()),
        (day("2021-01", 31.0 * 12.0, 31.0 * 6.0), day("2021-02", 28.0 * 12.0, 28.0 * 6.0))
    );
    let years = figures(&energy(&admin, &format!("{FIVE_YEARS}&bucket=year")).await);
    let expected: Vec<_> = [365.0, 365.0, 365.0, 366.0, 365.0]
        .into_iter()
        .zip(2021..)
        .map(|(days, year)| day(&year.to_string(), days * 12.0, days * 6.0))
        .collect();
    assert_eq!(years, expected);
    finish(core, admin).await;
}

/// Peak resident set of this process, KiB.
fn peak_rss_kib() -> u64 {
    let status = std::fs::read_to_string("/proc/self/status").expect("Linux only");
    let line = status.lines().find(|l| l.starts_with("VmHWM:")).expect("VmHWM");
    line.split_whitespace().nth(1).and_then(|n| n.parse().ok()).expect("kiB")
}

/// Reports, never asserts, what the five-year views cost; the bound the tests above hold is rows.
/// `cargo test -p sunreye --release --lib five_year_report -- --ignored --nocapture`.
#[tokio::test]
#[ignore = "reports a measurement: run it with --release --nocapture"]
async fn five_year_report() {
    let (core, admin) = clocked("energy-five-years-report").await;
    five_years(&core).await;
    let stored = 3 * (DAYS * 24 + DAYS);
    println!("stored rollup rows: {stored}");
    for bucket in ["day", "month", "year"] {
        let (rss, started) = (peak_rss_kib(), Instant::now());
        let body = energy(&admin, &format!("{FIVE_YEARS}&bucket={bucket}")).await;
        let took = started.elapsed();
        let grown = peak_rss_kib() - rss;
        println!(
            "bucket={bucket}: {} periods, {took:?}, peak RSS +{grown} KiB (now {} KiB)",
            body.as_array().map_or(0, Vec::len),
            peak_rss_kib()
        );
    }
    finish(core, admin).await;
}

/// 00:00:30 in Berlin on 15 August 2026: the plant day began at 2026-08-14T22:00:00Z.
const BERLIN_JUST_PAST_MIDNIGHT: &str = "2026-08-14T22:00:30Z";

/// The `statistics` frame a rollup of the minute starting at `minute_at` publishes, parsed; none for a
/// minute outside today.
async fn frame_of(core: &Core, minute_at: &str) -> Option<Value> {
    let minute = crate::samples::minute_of(ms(minute_at));
    let frame = today_frame(core, minute).await.expect("read");
    frame.map(|frame| serde_json::from_str(frame.0.as_str()).expect("json"))
}

#[tokio::test(start_paused = true)]
async fn a_rollup_of_a_minute_of_today_frames_todays_figures_and_one_of_another_day_none() {
    let core =
        crate::support::core_at(&dir("statistics-today"), BERLIN_JUST_PAST_MIDNIGHT, "Europe/Berlin").await;
    let device = add_device(&core, "10.0.0.5").await;
    store(
        &core,
        device,
        &series(
            DAY_PRODUCTION,
            &[("2026-08-14T21:59:10Z", 7.0), ("2026-08-14T22:00:00Z", 0.5), ("2026-08-14T22:00:20Z", 1.5)],
        ),
    )
    .await;
    assert_eq!(frame_of(&core, "2026-08-14T21:59:00Z").await, None, "23:59 local is yesterday");
    assert_eq!(frame_of(&core, "2026-08-15T22:00:00Z").await, None, "the next midnight is tomorrow");
    let frame = frame_of(&core, "2026-08-14T22:00:00Z").await.expect("00:00 local is today");
    let (core, admin) = signed_in(core, &Config::default()).await;
    let read = energy(&admin, "from=2026-08-14T22:00:00Z&to=2026-08-15T22:00:00Z&bucket=day").await;
    assert_eq!(frame["topic"], "statistics");
    assert_eq!(frame["data"]["type"], "today");
    assert_eq!(frame["data"]["at"], "2026-08-14T22:00:30.000Z");
    assert_eq!(frame["data"]["energy"], read[0], "today's energy as the statistics read answers it");
    assert_eq!(frame["data"]["energy"]["bucket"], "2026-08-15");
    assert!(frame["data"]["energy"]["productionKwh"].as_f64() > Some(0.0), "{frame}");
    let cost = &frame["data"]["cost"];
    assert_eq!(
        (cost["from"].clone(), cost["to"].clone()),
        (json!("2026-08-14T22:00:00.000Z"), json!("2026-08-15T22:00:00.000Z"))
    );
    assert_eq!(cost["productionKwh"], frame["data"]["energy"]["productionKwh"]);
    finish(core, admin).await;
}
