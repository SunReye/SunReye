//! `/api/weather`: the current conditions with the forecast, against the loopback stand-in for Open-Meteo.
//! The reading's numbers are the stand-in's payload; the forecast is the model's own output for its
//! irradiance, the model held to the 3.x oracle.

use std::sync::atomic::{AtomicI64, Ordering};
use std::time::Duration;

use super::forecast::{
    LAT, LON, MINUTE_MS, NOW_MS, QUARTER_HOUR_MS, StandIn, answer_once, configure, configure_settings,
    elapse, fixed_now, forecasting, irradiance, landed, model, until, zone,
};
use super::*;
use crate::forecast::{self, Run, SimInputs};
use crate::store::{DeviceEdit, NewDevice, Removal};
use crate::weather::{DevicePv, PvArray};

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

fn located() -> Value {
    json!({"enabled": true, "latitude": LAT, "longitude": LON})
}

/// Conditions requests so far reached `n`.
async fn conditions_asked(standin: &StandIn, n: usize) {
    until(&format!("{n} conditions requests"), || standin.conditions_paths().len() >= n).await;
}

#[tokio::test]
async fn the_weather_answers_the_reading_with_the_forecast_and_a_second_request_does_not_refetch() {
    let (core, admin, standin) = forecasting("weather-served", fixed_now).await;
    configure(&admin, None).await;
    assert_eq!(put(&admin, "/api/settings/weather", &json!({"label": "Home"})).await.status, StatusCode::OK);
    let mut want = reading("Home");
    want["forecast"] = solar_forecast();
    assert_eq!(answer_once(&admin, "/api/weather", |answer| answer["label"] == "Home").await, want);
    assert_eq!(get(&admin, "/api/weather").await.json(), want);
    let paths = standin.paths.lock().expect("paths").clone();
    assert_eq!((standin.conditions_paths().len(), paths.len()), (1, 2), "{paths:?}");
    let asked = &standin.conditions_paths()[0];
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
    assert_eq!(put(&admin, "/api/settings/weather", &located()).await.status, StatusCode::OK);
    let mut want = reading("");
    want["forecast"] = Value::Null;
    assert_eq!(landed(&admin, "/api/weather").await, want);
    assert_eq!(standin.hits.load(Ordering::SeqCst), 1, "no irradiance fetched");
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn disabled_or_unlocated_weather_answers_null_without_a_fetch() {
    let (core, admin, standin) = forecasting("weather-unready", fixed_now).await;
    let null = |answer: Answer| (answer.status, answer.json()) == (StatusCode::OK, Value::Null);
    assert!(null(get(&admin, "/api/weather").await), "defaults");
    for unready in [
        json!({"enabled": false, "latitude": LAT, "longitude": LON}),
        json!({"enabled": true, "latitude": null}),
        json!({"latitude": LAT, "longitude": null}),
    ] {
        assert_eq!(put(&admin, "/api/settings/weather", &unready).await.status, StatusCode::OK);
        assert!(null(get(&admin, "/api/weather").await), "{unready}");
    }
    assert_eq!(standin.hits.load(Ordering::SeqCst), 0);
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn a_failed_refresh_keeps_the_last_reading_and_another_place_answers_null() {
    let (core, admin, standin) = forecasting("weather-kept", fixed_now).await;
    assert_eq!(put(&admin, "/api/settings/weather", &located()).await.status, StatusCode::OK);
    let first = landed(&admin, "/api/weather").await;
    standin.failing.store(true, Ordering::SeqCst);
    assert_eq!(get(&admin, "/api/weather").await.json(), first);
    assert_eq!(standin.hits.load(Ordering::SeqCst), 1, "no refresh due");
    elapse(QUARTER_HOUR_MS).await;
    conditions_asked(&standin, 2).await;
    assert_eq!(get(&admin, "/api/weather").await.json(), first, "the last reading is kept");
    let elsewhere = json!({"latitude": LAT + 1.0});
    assert_eq!(put(&admin, "/api/settings/weather", &elsewhere).await.status, StatusCode::OK);
    let answer = get(&admin, "/api/weather").await;
    assert_eq!((answer.status, answer.json()), (StatusCode::OK, Value::Null), "another place keeps nothing");
    conditions_asked(&standin, 3).await;
    drop(admin);
    core.stop().await;
}

/// Written past every route: the store publishes, so no write path can forget the refresh. The forecast answers
/// null until irradiance for what the store now holds landed.
#[tokio::test]
async fn a_store_write_of_what_the_weather_reads_refetches_it_at_once_whatever_wrote_it() {
    let (core, admin, standin) = forecasting("weather-any-write", fixed_now).await;
    let store = &core.store;
    let mut plant = store.plant_settings().await.expect("plant").unwrap_or_default();
    (plant.enabled, plant.latitude, plant.longitude, plant.forecast_enabled) =
        (true, Some(LAT), Some(LON), true);
    store.save_plant_settings(&plant).await.expect("plant");
    conditions_asked(&standin, 1).await;
    store.save_plant_time_zone("Asia/Tokyo").await.expect("zone");
    let in_tokyo = || standin.conditions_paths().iter().any(|path| path.contains("&timezone=Asia%2FTokyo&"));
    until("asked in the new zone", in_tokyo).await;

    let array = |tilt: f64| PvArray {
        kwp: 3.2,
        tilt,
        azimuth: -90.0,
        device_slug: None,
        temp_coefficient: None,
        system_loss: None,
        mppt: None,
    };
    store
        .save_device_pv(1, &DevicePv { arrays: vec![array(35.0)], ..DevicePv::default() })
        .await
        .expect("pv");
    landed(&admin, "/api/forecast").await;
    let connection = store.connections().await.expect("connections")[0].id;
    let second = NewDevice { connection_id: connection, profile_id: PROFILE.into(), unit_id: 7 };
    let second = store.create_device(&second, None, "inverter").await.expect("device");
    store
        .save_device_pv(second, &DevicePv { arrays: vec![array(20.0)], ..DevicePv::default() })
        .await
        .expect("pv");
    landed(&admin, "/api/forecast").await;
    let retire =
        DeviceEdit { retired_at: Some(Some("2026-07-24T10:00:00.000Z".into())), ..DeviceEdit::default() };
    store.edit_device(second, &retire).await.expect("retire");
    landed(&admin, "/api/forecast").await;
    store
        .edit_device(second, &DeviceEdit { retired_at: Some(None), ..DeviceEdit::default() })
        .await
        .expect("restore");
    landed(&admin, "/api/forecast").await;
    assert_eq!(store.remove_device(second).await.expect("remove"), Removal::Removed);
    landed(&admin, "/api/forecast").await;
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
async fn a_reading_from_the_previous_plant_day_serves_no_radiation_sum_until_a_refresh_lands() {
    let (core, admin, standin) = forecasting("weather-midnight", midnight_clock).await;
    assert_eq!(put(&admin, "/api/settings/weather", &located()).await.status, StatusCode::OK);
    let first = landed(&admin, "/api/weather").await;
    assert_eq!(first["solarRadiationSum"], 12.5);
    standin.failing.store(true, Ordering::SeqCst);
    MIDNIGHT_CLOCK.store(BERLIN_MIDNIGHT_MS - 1, Ordering::SeqCst);
    assert_eq!(get(&admin, "/api/weather").await.json(), first, "the same plant day");
    let mut yesterdays = first.clone();
    yesterdays["solarRadiationSum"] = Value::Null;
    MIDNIGHT_CLOCK.store(BERLIN_MIDNIGHT_MS, Ordering::SeqCst);
    assert_eq!(get(&admin, "/api/weather").await.json(), yesterdays, "the plant day is over");
    elapse(QUARTER_HOUR_MS).await;
    conditions_asked(&standin, 2).await;
    assert_eq!(get(&admin, "/api/weather").await.json(), yesterdays, "a failed refresh");
    standin.failing.store(false, Ordering::SeqCst);
    elapse(MINUTE_MS).await;
    assert_eq!(
        answer_once(&admin, "/api/weather", |answer| *answer == first).await,
        first,
        "a refresh landed"
    );
    assert_eq!(standin.hits.load(Ordering::SeqCst), 3);
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

#[tokio::test]
async fn the_radiation_sum_is_asked_for_and_expires_on_the_plant_day_not_the_location_s() {
    let (core, admin, standin) = forecasting("weather-plant-zone", utc_clock).await;
    let utc = put(&admin, "/api/settings/time-zone", &json!({"timeZone": "UTC"})).await;
    assert_eq!(utc.status, StatusCode::OK);
    assert_eq!(put(&admin, "/api/settings/weather", &located()).await.status, StatusCode::OK);
    let first = landed(&admin, "/api/weather").await;
    let asked = standin.conditions_paths()[0].clone();
    assert!(asked.contains("&timezone=UTC&"), "{asked}");
    standin.failing.store(true, Ordering::SeqCst);
    UTC_CLOCK.store(UTC_23_30_MS, Ordering::SeqCst);
    assert_eq!(get(&admin, "/api/weather").await.json(), first, "past Berlin midnight, still the UTC day");
    let mut yesterdays = first;
    yesterdays["solarRadiationSum"] = Value::Null;
    UTC_CLOCK.store(UTC_MIDNIGHT_MS, Ordering::SeqCst);
    assert_eq!(get(&admin, "/api/weather").await.json(), yesterdays, "UTC midnight");
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn a_plant_zone_change_refreshes_at_once_in_the_new_zone_and_drops_the_old_sum() {
    let (core, admin, standin) = forecasting("weather-zone-changed", fixed_now).await;
    assert_eq!(put(&admin, "/api/settings/weather", &located()).await.status, StatusCode::OK);
    let mut other_day = landed(&admin, "/api/weather").await;
    standin.failing.store(true, Ordering::SeqCst);
    // 2026-07-24 in both zones: the same date, another day.
    let tokyo = put(&admin, "/api/settings/time-zone", &json!({"timeZone": "Asia/Tokyo"})).await;
    assert_eq!(tokyo.status, StatusCode::OK);
    other_day["solarRadiationSum"] = Value::Null;
    assert_eq!(get(&admin, "/api/weather").await.json(), other_day);
    conditions_asked(&standin, 2).await;
    let asked = standin.conditions_paths()[1].clone();
    assert!(asked.contains("&timezone=Asia%2FTokyo&"), "{asked}");
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn a_daily_row_dated_another_day_serves_no_radiation_sum_and_keeps_the_conditions() {
    let (core, admin, standin) = forecasting("weather-other-date", fixed_now).await;
    let mut want = reading("");
    want["solarRadiationSum"] = Value::Null;
    want["forecast"] = Value::Null;
    *standin.day.lock().expect("day") = Some("2026-07-23".into());
    assert_eq!(put(&admin, "/api/settings/weather", &located()).await.status, StatusCode::OK);
    assert_eq!(landed(&admin, "/api/weather").await, want, "2026-07-23");
    *standin.day.lock().expect("day") = Some("2026-07-25".into());
    elapse(QUARTER_HOUR_MS).await;
    conditions_asked(&standin, 2).await;
    assert_eq!(get(&admin, "/api/weather").await.json(), want, "2026-07-25");
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
    assert_eq!(put(&admin, "/api/settings/weather", &located()).await.status, StatusCode::OK);
    assert_eq!(landed(&admin, "/api/weather").await["solarRadiationSum"], 12.5);
    let asked = standin.conditions_paths()[0].clone();
    assert!(
        asked.contains("&start_date=2026-07-25&end_date=2026-07-25") && !asked.contains("forecast_days"),
        "{asked}"
    );
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn a_request_never_asks_open_meteo_and_a_kiosk_flood_answers_at_once() {
    let (core, admin, standin) = forecasting("weather-flood", fixed_now).await;
    let kiosk = put(&admin, "/api/settings/kiosk", &json!({"enabled": true})).await;
    assert_eq!(kiosk.status, StatusCode::OK);
    standin.hanging.store(true, Ordering::SeqCst);
    configure_settings(&admin, None).await;
    // The refresh loops' own requests, each held until its 8 s timeout.
    until("both refreshes asked", || standin.hits.load(Ordering::SeqCst) == 2).await;
    let stranger = admin.anonymous();
    let mut asked: Vec<_> = (0..20).map(|_| get(&stranger, "/api/weather")).collect();
    asked.push(get(&admin, "/api/weather"));
    let answers = tokio::time::timeout(Duration::from_secs(4), futures_util::future::join_all(asked))
        .await
        .expect("a request waited on Open-Meteo");
    for answer in answers {
        assert_eq!((answer.status, answer.json()), (StatusCode::OK, Value::Null));
    }
    for path in ["/api/forecast", "/api/forecast/usable"] {
        assert_eq!(get(&admin, path).await.json(), Value::Null, "{path}");
    }
    assert_eq!(standin.hits.load(Ordering::SeqCst), 2, "no request asked Open-Meteo");
    drop((stranger, admin));
    core.stop().await;
}

#[tokio::test]
async fn stopping_the_core_drops_a_refresh_in_flight_and_closes_the_store() {
    let (core, admin, standin) = forecasting("weather-stop", fixed_now).await;
    standin.hanging.store(true, Ordering::SeqCst);
    configure_settings(&admin, None).await;
    until("both refreshes asked", || standin.hits.load(Ordering::SeqCst) == 2).await;
    let seams = Arc::clone(&core.seams);
    drop(admin);
    tokio::time::timeout(Duration::from_secs(4), core.stop()).await.expect("stop waited on Open-Meteo");
    assert_eq!(seams.events.lock().expect("events").last(), Some(&"store closed"));
}

#[tokio::test]
async fn the_forecast_asks_for_every_panel_orientation_at_once() {
    let (core, admin, standin) = forecasting("forecast-planes-at-once", fixed_now).await;
    standin.hanging.store(true, Ordering::SeqCst);
    let east_west = json!({"arrays": [{"kwp": 3.2, "tilt": 20, "azimuth": -90, "tempCoefficient": -0.34, "mppt": 1},
        {"kwp": 3.2, "tilt": 20, "azimuth": 90, "tempCoefficient": -0.34, "mppt": 2}]});
    assert_eq!(super::forecast::patch(&admin, "/api/devices/1", &east_west).await.status, StatusCode::OK);
    let plant = json!({"enabled": true, "latitude": LAT, "longitude": LON, "forecast": {"enabled": true}});
    assert_eq!(put(&admin, "/api/settings/weather", &plant).await.status, StatusCode::OK);
    // Asked one after the other, the second plane reaches Open-Meteo only once the first timed out.
    let both_asked = until("both planes asked", || standin.forecast_paths().len() == 2);
    tokio::time::timeout(Duration::from_secs(4), both_asked)
        .await
        .unwrap_or_else(|_| panic!("asked one at a time: {:?}", standin.forecast_paths()));
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn saving_an_inverter_s_arrays_refreshes_the_forecast_series_at_once() {
    let (core, admin, standin) = forecasting("weather-device-arrays", fixed_now).await;
    configure(&admin, None).await;
    let before = get(&admin, "/api/forecast").await.json();
    let doubled =
        json!({"arrays": [{"kwp": 12.8, "tilt": 35, "azimuth": 10, "tempCoefficient": -0.34, "mppt": 1}]});
    assert_eq!(super::forecast::patch(&admin, "/api/devices/1", &doubled).await.status, StatusCode::OK);
    let watts = |answer: &Value, i: usize| answer["series"][i]["watts"].as_f64().expect("watts");
    assert!(watts(&before, 4) > 0.0);
    let after = get(&admin, "/api/forecast").await.json();
    assert!(
        (watts(&after, 4) - 2.0 * watts(&before, 4)).abs() < 1e-6,
        "{} vs {}",
        watts(&after, 4),
        watts(&before, 4)
    );
    assert_eq!(standin.forecast_paths().len(), 1, "the same planes: the irradiance is kept");
    let turned =
        json!({"arrays": [{"kwp": 6.4, "tilt": 20, "azimuth": 10, "tempCoefficient": -0.34, "mppt": 1}]});
    assert_eq!(super::forecast::patch(&admin, "/api/devices/1", &turned).await.status, StatusCode::OK);
    until("the turned plane asked", || standin.forecast_paths().len() == 2).await;
    assert!(standin.forecast_paths()[1].contains("tilt=20&azimuth=10"));
    landed(&admin, "/api/forecast").await;
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
