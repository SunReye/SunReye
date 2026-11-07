//! The plant day rolls once at local midnight: plain, either side of a DST change in Berlin, Lord Howe's
//! half-hour shifts and Santiago's skipped midnight. Each sweep starts a core at 23:59:59 local and advances
//! its paused clock across midnight. Instants and day lengths are worked by hand from the zone rules.

use super::forecast::{
    QUARTER_HOUR_MS, StandIn, answer_once, configure_settings, elapse, forecasting, landed, until,
};
use super::rollup::store;
use super::*;

/// The deye profile's day production register.
const DAY_PRODUCTION: &str = "day_energy";

/// One stand-in slot's power: 6.4 kWp at 500 W/m² and 25 °C ambient, cells at 25 + 500 · 25/800 = 40.625 °C,
/// derated by 1 − 0.0034 · 15.625 and by the 12 % system loss: 2666.4 W, so 2.6664 kWh an hour.
const KWH_PER_HOUR: f64 = 2.6664;

struct Midnight {
    zone: &'static str,
    /// 23:59:59 local, as a UTC instant.
    last_second: &'static str,
    /// The plant day ending and the one starting, and their lengths in hours.
    ending: (&'static str, f64),
    starting: (&'static str, f64),
}

fn ms(instant: &str) -> i64 {
    instant.parse::<jiff::Timestamp>().expect("instant").as_millisecond()
}

/// Constant 15-minute irradiance labelled in UTC, 26 hours either side of `midnight_ms`: both plant days whole.
fn series(midnight_ms: i64) -> Value {
    let from = midnight_ms - 26 * 3_600_000;
    let times: Vec<String> = (0..208)
        .map(|i| {
            let at = jiff::Timestamp::from_millisecond(from + i * 900_000).expect("instant");
            at.strftime("%Y-%m-%dT%H:%M").to_string()
        })
        .collect();
    let n = times.len();
    json!({
        "utc_offset_seconds": 0, "timezone": "GMT",
        "minutely_15": {"time": times, "global_tilted_irradiance_instant": vec![500.0; n],
            "temperature_2m": vec![25.0; n]}
    })
}

fn kwh(answer: &Value, field: &str) -> f64 {
    answer[field].as_f64().unwrap_or_else(|| panic!("{field}: {answer}"))
}

fn assert_hours(answer: &Value, field: &str, hours: f64, when: &str) {
    let got = kwh(answer, field);
    assert!((got - hours * KWH_PER_HOUR).abs() < 1e-6, "{when}: {field} {got}, want {hours} h");
}

async fn radiation_sum(admin: &Api) -> Value {
    get(admin, "/api/weather").await.json()["solarRadiationSum"].clone()
}

/// Whether the conditions were asked for `date`'s sum.
fn asked_for(standin: &StandIn, date: &str) -> bool {
    let date = format!("&start_date={date}&end_date={date}");
    standin.conditions_paths().iter().any(|path| path.contains(&date))
}

/// Production per plant day of the two around `midnight_ms`.
async fn production(admin: &Api, midnight_ms: i64) -> Vec<(String, f64)> {
    let window = format!(
        "from={}&to={}&bucket=day",
        crate::live::iso(midnight_ms - 20 * 3_600_000),
        crate::live::iso(midnight_ms + 20 * 3_600_000)
    );
    let days = get(admin, &format!("/api/energy/series?{window}")).await.json();
    let days = days.as_array().unwrap_or_else(|| panic!("{days}"));
    days.iter().map(|d| (d["bucket"].as_str().expect("bucket").to_owned(), kwh(d, "productionKwh"))).collect()
}

/// A core at `day`'s last second with its forecast and weather landed and the day register read.
async fn last_second(name: &str, day: &Midnight) -> (Arc<Core>, Api, StandIn) {
    let (core, admin, standin) = forecasting(name, day.last_second).await;
    *standin.series.lock().expect("series") = Some(series(ms(day.last_second) + 1000));
    let zone = put(&admin, "/api/settings/time-zone", &json!({"timeZone": day.zone})).await;
    assert_eq!(zone.status, StatusCode::OK);
    configure_settings(&admin, None).await;
    let before = landed(&admin, "/api/forecast").await;
    assert_hours(&before, "todayKwh", day.ending.1, "23:59:59");
    assert_hours(&before, "tomorrowKwh", day.starting.1, "23:59:59");
    answer_once(&admin, "/api/weather", |answer| answer["solarRadiationSum"] == 12.5).await;
    let asked = standin.conditions_paths();
    assert!(asked_for(&standin, day.ending.0) && !asked_for(&standin, day.starting.0), "{asked:?}");
    let now = core.now_ms();
    store(&core, 1, &[(now - 1_799_000, DAY_PRODUCTION, 2.0), (now, DAY_PRODUCTION, 5.0)]).await;
    (core, admin, standin)
}

/// The forecast's today and the weather sum at `when`, against `day`'s length in hours.
async fn serves(admin: &Api, (_, hours): (&str, f64), sum: &Value, when: &str) {
    assert_hours(&get(admin, "/api/forecast").await.json(), "todayKwh", hours, when);
    assert_eq!(&radiation_sum(admin).await, sum, "{when}");
}

/// Production per plant day once the day register restarted at `midnight_ms`.
async fn restarted(core: &Core, admin: &Api, midnight_ms: i64) -> Vec<(String, f64)> {
    let readings = [(midnight_ms, DAY_PRODUCTION, 0.5), (midnight_ms + 1_800_000, DAY_PRODUCTION, 1.5)];
    store(core, 1, &readings).await;
    production(admin, midnight_ms).await
}

/// The next refresh asks for the new day's sum and serves it.
async fn next_refresh(admin: &Api, standin: &StandIn, date: &str) {
    elapse(QUARTER_HOUR_MS).await;
    until("asked for the new day", || asked_for(standin, date)).await;
    answer_once(admin, "/api/weather", |answer| answer["solarRadiationSum"] == 12.5).await;
}

/// The weather sum, the forecast's today and the statistics day each roll once, at midnight.
async fn sweep(name: &str, day: &Midnight) {
    let (core, admin, standin) = last_second(name, day).await;
    elapse(999).await;
    serves(&admin, day.ending, &json!(12.5), "23:59:59.999").await;
    elapse(1).await;
    let midnight_ms = core.now_ms();
    serves(&admin, day.starting, &Value::Null, "midnight: yesterday's sum").await;
    let want = [(day.ending.0.to_owned(), 3.0), (day.starting.0.to_owned(), 1.0)];
    assert_eq!(restarted(&core, &admin, midnight_ms).await, want);
    next_refresh(&admin, &standin, day.starting.0).await;
    drop(admin);
    core.stop().await;
}

#[tokio::test(start_paused = true)]
async fn a_summer_midnight_in_berlin() {
    let day = Midnight {
        zone: "Europe/Berlin",
        last_second: "2026-07-24T21:59:59Z",
        ending: ("2026-07-24", 24.0),
        starting: ("2026-07-25", 24.0),
    };
    sweep("midnight-berlin-summer", &day).await;
}

#[tokio::test(start_paused = true)]
async fn the_midnight_into_berlin_s_23_hour_spring_day() {
    let day = Midnight {
        zone: "Europe/Berlin",
        last_second: "2026-03-28T22:59:59Z",
        ending: ("2026-03-28", 24.0),
        starting: ("2026-03-29", 23.0),
    };
    sweep("midnight-berlin-into-spring", &day).await;
}

#[tokio::test(start_paused = true)]
async fn the_midnight_out_of_berlin_s_23_hour_spring_day() {
    let day = Midnight {
        zone: "Europe/Berlin",
        last_second: "2026-03-29T21:59:59Z",
        ending: ("2026-03-29", 23.0),
        starting: ("2026-03-30", 24.0),
    };
    sweep("midnight-berlin-out-of-spring", &day).await;
}

#[tokio::test(start_paused = true)]
async fn the_midnight_into_berlin_s_25_hour_autumn_day() {
    let day = Midnight {
        zone: "Europe/Berlin",
        last_second: "2026-10-24T21:59:59Z",
        ending: ("2026-10-24", 24.0),
        starting: ("2026-10-25", 25.0),
    };
    sweep("midnight-berlin-into-autumn", &day).await;
}

#[tokio::test(start_paused = true)]
async fn the_midnight_out_of_berlin_s_25_hour_autumn_day() {
    let day = Midnight {
        zone: "Europe/Berlin",
        last_second: "2026-10-25T22:59:59Z",
        ending: ("2026-10-25", 25.0),
        starting: ("2026-10-26", 24.0),
    };
    sweep("midnight-berlin-out-of-autumn", &day).await;
}

/// Lord Howe turns back half an hour at 02:00 on 2026-04-05.
#[tokio::test(start_paused = true)]
async fn the_midnight_into_lord_howe_s_24_and_a_half_hour_day() {
    let day = Midnight {
        zone: "Australia/Lord_Howe",
        last_second: "2026-04-04T12:59:59Z",
        ending: ("2026-04-04", 24.0),
        starting: ("2026-04-05", 24.5),
    };
    sweep("midnight-lord-howe-into-autumn", &day).await;
}

/// Lord Howe skips 02:00–02:30 on 2026-10-04.
#[tokio::test(start_paused = true)]
async fn the_midnight_out_of_lord_howe_s_23_and_a_half_hour_day() {
    let day = Midnight {
        zone: "Australia/Lord_Howe",
        last_second: "2026-10-04T12:59:59Z",
        ending: ("2026-10-04", 23.5),
        starting: ("2026-10-05", 24.0),
    };
    sweep("midnight-lord-howe-out-of-spring", &day).await;
}

/// Santiago has no midnight on 2026-09-06: 23:59:59 on the 5th is followed by 01:00 on the 6th.
#[tokio::test(start_paused = true)]
async fn santiago_s_skipped_midnight_starts_a_23_hour_day() {
    let day = Midnight {
        zone: "America/Santiago",
        last_second: "2026-09-06T03:59:59Z",
        ending: ("2026-09-05", 24.0),
        starting: ("2026-09-06", 23.0),
    };
    sweep("midnight-santiago-gap", &day).await;
}
