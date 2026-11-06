//! `/api/weather`: the current conditions with the forecast, against the loopback stand-in for Open-Meteo.
//! The reading's numbers are the stand-in's payload; the forecast is the model's own output for its
//! irradiance, the model held to the 3.x oracle.

use std::sync::atomic::{AtomicI64, Ordering};

use super::forecast::{LAT, LON, NOW_MS, configure, fixed_now, forecasting, irradiance, model, zone};
use super::*;
use crate::forecast::{self, Run, SimInputs};

const QUARTER_HOUR_MS: i64 = 900_000;

/// Open-Meteo's answer for `path`: the daily row is dated `day`, else the asked `start_date`.
pub(super) fn conditions_payload(path: &str, day: Option<String>) -> Value {
    let asked = path.split_once("start_date=").map(|(_, rest)| rest.split('&').next().unwrap_or_default());
    let time: Vec<String> = day.or(asked.map(str::to_owned)).into_iter().collect();
    json!({
        "current": {"temperature_2m": 18.4, "weather_code": 61},
        "current_units": {"temperature_2m": "°C"},
        "daily": {"time": time, "shortwave_radiation_sum": [12.5]}
    })
}

fn reading(label: &str) -> Value {
    json!({"temperature": 18.4, "unit": "°C", "code": 61, "condition": "Rain", "icon": "rain",
        "solarRadiationSum": 12.5, "label": label})
}

/// 3.x's `SolarForecast`: the usable view, its metadata and the raw view.
fn solar_forecast() -> Value {
    let berlin = zone("Europe/Berlin");
    let run = Run {
        time_zone: &berlin,
        now_ms: NOW_MS,
        sim: SimInputs::default(),
        correction: None,
        array_corrections: &[],
    };
    let built = forecast::build(&model(None), &irradiance(), "open-meteo", &run).expect("forecast");
    let mut value = serde_json::to_value(&built.usable).expect("usable");
    value["provider"] = json!("open-meteo");
    value["stepMinutes"] = json!(built.step_minutes);
    value["utcOffsetSeconds"] = json!(7200);
    value["timeZone"] = json!("Europe/Berlin");
    value["raw"] = serde_json::to_value(&built.raw).expect("raw");
    value
}

fn conditions_hits(paths: &[String]) -> usize {
    paths.iter().filter(|p| p.contains("current=")).count()
}

#[tokio::test]
async fn the_weather_answers_the_reading_with_the_forecast_and_a_second_request_does_not_refetch() {
    let (core, admin, standin) = forecasting("weather-served", fixed_now).await;
    configure(&admin, None).await;
    assert_eq!(put(&admin, "/api/settings/weather", &json!({"label": "Home"})).await.status, StatusCode::OK);
    let answer = get(&admin, "/api/weather").await;
    assert_eq!(answer.status, StatusCode::OK);
    let mut want = reading("Home");
    want["forecast"] = solar_forecast();
    assert_eq!(answer.json(), want);
    assert_eq!(get(&admin, "/api/weather").await.json(), want);
    let paths = standin.paths.lock().expect("paths").clone();
    assert_eq!((conditions_hits(&paths), paths.len()), (1, 2), "{paths:?}");
    let asked = paths.iter().find(|p| p.contains("current=")).expect("conditions request");
    assert!(
        asked.contains(&format!("latitude={LAT}&longitude={LON}"))
            && asked.contains("current=temperature_2m,weather_code&daily=shortwave_radiation_sum")
            && asked.contains("&timezone=Europe%2FBerlin&"),
        "{asked}"
    );
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn the_weather_without_the_forecast_answers_the_reading_with_a_null_forecast() {
    let (core, admin, standin) = forecasting("weather-no-forecast", fixed_now).await;
    let located = json!({"enabled": true, "latitude": LAT, "longitude": LON});
    assert_eq!(put(&admin, "/api/settings/weather", &located).await.status, StatusCode::OK);
    let mut want = reading("");
    want["forecast"] = Value::Null;
    assert_eq!(get(&admin, "/api/weather").await.json(), want);
    assert_eq!(standin.hits.load(Ordering::SeqCst), 1, "no irradiance fetched");
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn disabled_or_unlocated_weather_answers_null_without_a_fetch() {
    let (core, admin, standin) = forecasting("weather-unready", fixed_now).await;
    let null = |answer: Answer| (answer.status, answer.json()) == (StatusCode::OK, Value::Null);
    assert!(null(get(&admin, "/api/weather").await), "defaults");
    let located = json!({"enabled": true, "latitude": LAT, "longitude": LON});
    for unready in [json!({"enabled": false}), json!({"latitude": null}), json!({"longitude": null})] {
        assert_eq!(put(&admin, "/api/settings/weather", &located).await.status, StatusCode::OK);
        assert_eq!(put(&admin, "/api/settings/weather", &unready).await.status, StatusCode::OK);
        assert!(null(get(&admin, "/api/weather").await), "{unready}");
    }
    assert_eq!(standin.hits.load(Ordering::SeqCst), 0);
    drop(admin);
    core.stop().await;
}

static CLOCK: AtomicI64 = AtomicI64::new(NOW_MS);

fn clock() -> i64 {
    CLOCK.load(Ordering::SeqCst)
}

#[tokio::test]
async fn a_failed_refetch_keeps_the_last_reading_and_a_failed_first_fetch_answers_null() {
    let (core, admin, standin) = forecasting("weather-kept", clock).await;
    let located = json!({"enabled": true, "latitude": LAT, "longitude": LON});
    assert_eq!(put(&admin, "/api/settings/weather", &located).await.status, StatusCode::OK);
    let first = get(&admin, "/api/weather").await.json();
    standin.failing.store(true, Ordering::SeqCst);
    CLOCK.store(NOW_MS + QUARTER_HOUR_MS - 1, Ordering::SeqCst);
    assert_eq!(get(&admin, "/api/weather").await.json(), first);
    assert_eq!(standin.hits.load(Ordering::SeqCst), 1, "inside 15 min: no refetch");
    CLOCK.store(NOW_MS + QUARTER_HOUR_MS, Ordering::SeqCst);
    assert_eq!(get(&admin, "/api/weather").await.json(), first, "the last reading is kept");
    assert_eq!(standin.hits.load(Ordering::SeqCst), 2, "the cache expired");
    let elsewhere = json!({"latitude": LAT + 1.0});
    assert_eq!(put(&admin, "/api/settings/weather", &elsewhere).await.status, StatusCode::OK);
    let answer = get(&admin, "/api/weather").await;
    assert_eq!((answer.status, answer.json()), (StatusCode::OK, Value::Null), "another place keeps nothing");
    drop(admin);
    core.stop().await;
}

/// 2026-07-24 23:50 Europe/Berlin (21:50 UTC).
const BERLIN_23_50_MS: i64 = 1_784_929_800_000;
/// 2026-07-25 00:00 Europe/Berlin, the plant day boundary; still 2026-07-24 in UTC.
const BERLIN_MIDNIGHT_MS: i64 = 1_784_930_400_000;

static MIDNIGHT_CLOCK: AtomicI64 = AtomicI64::new(BERLIN_23_50_MS);

fn midnight_clock() -> i64 {
    MIDNIGHT_CLOCK.load(Ordering::SeqCst)
}

#[tokio::test]
async fn a_reading_from_the_previous_plant_day_refetches_and_serves_no_radiation_sum_until_a_fetch_lands() {
    let (core, admin, standin) = forecasting("weather-midnight", midnight_clock).await;
    let located = json!({"enabled": true, "latitude": LAT, "longitude": LON});
    assert_eq!(put(&admin, "/api/settings/weather", &located).await.status, StatusCode::OK);
    let hits = || standin.hits.load(Ordering::SeqCst);
    let first = get(&admin, "/api/weather").await.json();
    assert_eq!(first["solarRadiationSum"], 12.5);
    standin.failing.store(true, Ordering::SeqCst);
    MIDNIGHT_CLOCK.store(BERLIN_MIDNIGHT_MS - 1, Ordering::SeqCst);
    assert_eq!(
        (get(&admin, "/api/weather").await.json(), hits()),
        (first.clone(), 1),
        "same day, inside 15 min"
    );
    let mut yesterdays = first.clone();
    yesterdays["solarRadiationSum"] = Value::Null;
    for (at, fetches) in [(BERLIN_MIDNIGHT_MS, 2), (BERLIN_MIDNIGHT_MS + 4 * 60_000, 3)] {
        MIDNIGHT_CLOCK.store(at, Ordering::SeqCst);
        assert_eq!((get(&admin, "/api/weather").await.json(), hits()), (yesterdays.clone(), fetches), "{at}");
    }
    standin.failing.store(false, Ordering::SeqCst);
    MIDNIGHT_CLOCK.store(BERLIN_MIDNIGHT_MS + 5 * 60_000, Ordering::SeqCst);
    assert_eq!((get(&admin, "/api/weather").await.json(), hits()), (first, 4), "a fetch landed");
    drop(admin);
    core.stop().await;
}

/// 2026-07-24 23:30 UTC, 01:30 Berlin on 07-25.
const UTC_23_30_MS: i64 = 1_784_935_800_000;
/// 2026-07-25 00:00 UTC.
const UTC_MIDNIGHT_MS: i64 = 1_784_937_600_000;

static UTC_CLOCK: AtomicI64 = AtomicI64::new(BERLIN_23_50_MS);

fn utc_clock() -> i64 {
    UTC_CLOCK.load(Ordering::SeqCst)
}

fn last_conditions_request(standin: &super::forecast::StandIn) -> String {
    let paths = standin.paths.lock().expect("paths");
    paths.iter().rev().find(|p| p.contains("current=")).expect("conditions request").clone()
}

#[tokio::test]
async fn the_radiation_sum_is_asked_for_and_expires_on_the_plant_day_not_the_location_s() {
    let (core, admin, standin) = forecasting("weather-plant-zone", utc_clock).await;
    let utc = put(&admin, "/api/settings/time-zone", &json!({"timeZone": "UTC"})).await;
    assert_eq!(utc.status, StatusCode::OK);
    let located = json!({"enabled": true, "latitude": LAT, "longitude": LON});
    assert_eq!(put(&admin, "/api/settings/weather", &located).await.status, StatusCode::OK);
    let hits = || standin.hits.load(Ordering::SeqCst);
    let first = get(&admin, "/api/weather").await.json();
    let asked = last_conditions_request(&standin);
    assert!(asked.contains("&timezone=UTC&"), "{asked}");
    standin.failing.store(true, Ordering::SeqCst);
    UTC_CLOCK.store(UTC_23_30_MS, Ordering::SeqCst);
    assert_eq!(
        (get(&admin, "/api/weather").await.json(), hits()),
        (first.clone(), 2),
        "past Berlin midnight, still the UTC day the sum was asked for"
    );
    let mut yesterdays = first;
    yesterdays["solarRadiationSum"] = Value::Null;
    UTC_CLOCK.store(UTC_MIDNIGHT_MS, Ordering::SeqCst);
    assert_eq!((get(&admin, "/api/weather").await.json(), hits()), (yesterdays, 3), "UTC midnight");
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn a_plant_zone_changed_after_the_fetch_refetches_in_the_new_zone_and_drops_the_old_sum() {
    let (core, admin, standin) = forecasting("weather-zone-changed", fixed_now).await;
    let located = json!({"enabled": true, "latitude": LAT, "longitude": LON});
    assert_eq!(put(&admin, "/api/settings/weather", &located).await.status, StatusCode::OK);
    let mut other_day = get(&admin, "/api/weather").await.json();
    standin.failing.store(true, Ordering::SeqCst);
    // 2026-07-24 in both zones: the same date, another day.
    let tokyo = put(&admin, "/api/settings/time-zone", &json!({"timeZone": "Asia/Tokyo"})).await;
    assert_eq!(tokyo.status, StatusCode::OK);
    other_day["solarRadiationSum"] = Value::Null;
    assert_eq!(get(&admin, "/api/weather").await.json(), other_day);
    assert_eq!(standin.hits.load(Ordering::SeqCst), 2);
    let asked = last_conditions_request(&standin);
    assert!(asked.contains("&timezone=Asia%2FTokyo&"), "{asked}");
    drop(admin);
    core.stop().await;
}

static OTHER_DATE_CLOCK: AtomicI64 = AtomicI64::new(NOW_MS);

fn other_date_clock() -> i64 {
    OTHER_DATE_CLOCK.load(Ordering::SeqCst)
}

#[tokio::test]
async fn a_daily_row_dated_another_day_serves_no_radiation_sum_and_keeps_the_conditions() {
    let (core, admin, standin) = forecasting("weather-other-date", other_date_clock).await;
    let located = json!({"enabled": true, "latitude": LAT, "longitude": LON});
    assert_eq!(put(&admin, "/api/settings/weather", &located).await.status, StatusCode::OK);
    let mut want = reading("");
    want["solarRadiationSum"] = Value::Null;
    want["forecast"] = Value::Null;
    for other in ["2026-07-23", "2026-07-25"] {
        *standin.day.lock().expect("day") = Some(other.into());
        OTHER_DATE_CLOCK.fetch_add(QUARTER_HOUR_MS, Ordering::SeqCst);
        assert_eq!(get(&admin, "/api/weather").await.json(), want, "{other}");
    }
    assert_eq!(standin.hits.load(Ordering::SeqCst), 2);
    drop(admin);
    core.stop().await;
}

static PLANT_DAY_CLOCK: AtomicI64 = AtomicI64::new(BERLIN_MIDNIGHT_MS);

fn plant_day_clock() -> i64 {
    PLANT_DAY_CLOCK.load(Ordering::SeqCst)
}

#[tokio::test]
async fn the_conditions_request_pins_the_plant_day_not_the_utc_day() {
    let (core, admin, standin) = forecasting("weather-pinned-day", plant_day_clock).await;
    let located = json!({"enabled": true, "latitude": LAT, "longitude": LON});
    assert_eq!(put(&admin, "/api/settings/weather", &located).await.status, StatusCode::OK);
    assert_eq!(get(&admin, "/api/weather").await.json()["solarRadiationSum"], 12.5);
    let asked = last_conditions_request(&standin);
    assert!(
        asked.contains("&start_date=2026-07-25&end_date=2026-07-25") && !asked.contains("forecast_days"),
        "{asked}"
    );
    drop(admin);
    core.stop().await;
}

static BACKWARD_CLOCK: AtomicI64 = AtomicI64::new(NOW_MS);

fn backward_clock() -> i64 {
    BACKWARD_CLOCK.load(Ordering::SeqCst)
}

#[tokio::test]
async fn a_wall_clock_stepped_back_before_the_fetch_refetches() {
    let (core, admin, standin) = forecasting("weather-clock-back", backward_clock).await;
    let located = json!({"enabled": true, "latitude": LAT, "longitude": LON});
    assert_eq!(put(&admin, "/api/settings/weather", &located).await.status, StatusCode::OK);
    get(&admin, "/api/weather").await;
    BACKWARD_CLOCK.store(NOW_MS, Ordering::SeqCst);
    get(&admin, "/api/weather").await;
    assert_eq!(standin.hits.load(Ordering::SeqCst), 1, "fetched at now");
    BACKWARD_CLOCK.store(NOW_MS - 1, Ordering::SeqCst);
    get(&admin, "/api/weather").await;
    assert_eq!(standin.hits.load(Ordering::SeqCst), 2, "fetched in the future");
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn saving_an_inverter_s_arrays_changes_the_next_forecast_series() {
    let (core, admin, _) = forecasting("weather-device-arrays", fixed_now).await;
    configure(&admin, None).await;
    let before = get(&admin, "/api/forecast").await.json();
    let doubled =
        json!({"arrays": [{"kwp": 12.8, "tilt": 35, "azimuth": 10, "tempCoefficient": -0.34, "mppt": 1}]});
    assert_eq!(super::forecast::patch(&admin, "/api/devices/1", &doubled).await.status, StatusCode::OK);
    let after = get(&admin, "/api/forecast").await.json();
    let watts = |answer: &Value, i: usize| answer["series"][i]["watts"].as_f64().expect("watts");
    assert!(watts(&before, 4) > 0.0);
    assert!(
        (watts(&after, 4) - 2.0 * watts(&before, 4)).abs() < 1e-6,
        "{} vs {}",
        watts(&after, 4),
        watts(&before, 4)
    );
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn an_out_of_bound_array_through_the_device_route_is_a_400_and_saves_nothing() {
    let (core, admin, _) = forecasting("weather-device-bounds", fixed_now).await;
    configure(&admin, None).await;
    let array = |kwp: f64, tilt: f64, azimuth: f64| json!({"arrays": [{"kwp": kwp, "tilt": tilt, "azimuth": azimuth}]});
    for (body, error) in [
        (array(0.0, 30.0, 0.0), "arrays: kwp must be above 0 and at most 100000"),
        (array(100_000.5, 30.0, 0.0), "arrays: kwp must be above 0 and at most 100000"),
        (array(1.0, -0.5, 0.0), "arrays: tilt must be 0–90"),
        (array(1.0, 90.5, 0.0), "arrays: tilt must be 0–90"),
        (array(1.0, 30.0, 180.5), "arrays: azimuth must be -180–180"),
        (json!({"systemLoss": 90.5}), "arrays: systemLoss must be 0–90"),
        (json!({"tempCoefficient": -2.5}), "arrays: tempCoefficient must be -2–0"),
        (json!({"arrays": vec![json!({"kwp": 1, "tilt": 0, "azimuth": 0}); 9]}), "arrays: at most 8 arrays"),
    ] {
        let answer = super::forecast::patch(&admin, "/api/devices/1", &body).await;
        assert_eq!(
            (answer.status, &answer.json()["error"]),
            (StatusCode::BAD_REQUEST, &json!(error)),
            "{body}"
        );
    }
    let arrays = &get(&admin, "/api/settings/weather").await.json()["forecast"]["arrays"];
    assert_eq!(arrays[0]["kwp"], 6.4);
    assert_eq!(arrays.as_array().map(Vec::len), Some(1));
    drop(admin);
    core.stop().await;
}
