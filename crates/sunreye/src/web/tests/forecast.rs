//! The forecast settings and the PV forecast, against a loopback HTTPS stand-in for Open-Meteo. Expected
//! series are the model's own output for the stand-in's payload: the model is held to the 3.x oracle.

use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicUsize, Ordering};

use tokio::io::AsyncWriteExt;

use super::correction::archive_payload;
use super::support::{acceptor, read_request};
use super::*;
use crate::forecast::{self, CorrectionModel, ForecastConfig, Irradiance, Location, Run, SimInputs, Variant};
use crate::samples::{ClosedMinute, Sample};

/// 2026-07-24T10:07:00Z: plant-local 12:07 in Berlin, inside the stand-in's series.
const NOW_MS: i64 = 1_784_887_620_000;
const HALF_HOUR_MS: i64 = 1_800_000;
pub(super) const LAT: f64 = 50.5;
pub(super) const LON: f64 = 8.25;
const TIMES: [&str; 8] = [
    "2026-07-24T11:00",
    "2026-07-24T11:15",
    "2026-07-24T11:30",
    "2026-07-24T11:45",
    "2026-07-24T12:00",
    "2026-07-24T12:15",
    "2026-07-24T12:30",
    "2026-07-24T12:45",
];
const GTI: [f64; 8] = [610.0, 655.0, 702.0, 740.0, 768.0, 790.0, 801.0, 806.0];
const TEMPERATURE: [f64; 8] = [24.0, 24.4, 24.9, 25.3, 25.8, 26.1, 26.5, 26.8];
const DNI: [f64; 8] = [700.0, 720.0, 735.0, 750.0, 760.0, 765.0, 770.0, 772.0];
const WIND: [f64; 8] = [2.0, 2.1, 2.3, 2.2, 2.5, 2.6, 2.4, 2.8];

fn payload() -> Value {
    json!({
        "utc_offset_seconds": 7200, "timezone": "Europe/Berlin",
        "minutely_15": {
            "time": TIMES, "global_tilted_irradiance_instant": GTI, "temperature_2m": TEMPERATURE,
            "direct_normal_irradiance_instant": DNI, "wind_speed_10m": WIND
        }
    })
}

fn irradiance() -> Irradiance {
    Irradiance {
        times: TIMES.iter().map(|&t| t.to_owned()).collect(),
        utc_offset_seconds: 7200,
        location: Location { latitude: LAT, longitude: LON },
        temperature: TEMPERATURE.to_vec(),
        gti: vec![GTI.to_vec()],
        dni: Some(DNI.to_vec()),
        wind_speed: Some(WIND.to_vec()),
    }
}

/// What the route answers: the model's export for the payload at `now_ms`, stamped with its staleness.
pub(super) struct Expected {
    now_ms: i64,
    fetched_ms: i64,
    stale: bool,
}

pub(super) const FRESH: Expected = Expected { now_ms: NOW_MS, fetched_ms: NOW_MS, stale: false };

fn expected(config: &ForecastConfig, sim: SimInputs, variant: Variant, at: &Expected) -> Value {
    expected_in(&zone("Europe/Berlin"), config, sim, variant, at)
}

/// [`expected`] with the learned `correction` applied.
pub(super) fn corrected(
    config: &ForecastConfig,
    sim: SimInputs,
    variant: Variant,
    at: &Expected,
    correction: Option<&CorrectionModel>,
) -> Value {
    string_corrected(config, (sim, variant), at, correction, &[])
}

/// [`corrected`] with each array's own string grid besides.
pub(super) fn string_corrected(
    config: &ForecastConfig,
    (sim, variant): (SimInputs, Variant),
    at: &Expected,
    correction: Option<&CorrectionModel>,
    array_corrections: &[Option<CorrectionModel>],
) -> Value {
    let zone = zone("Europe/Berlin");
    exported(
        config,
        variant,
        at,
        &Run { time_zone: &zone, now_ms: at.now_ms, sim, correction, array_corrections },
    )
}

fn zone(name: &str) -> jiff::tz::TimeZone {
    jiff::tz::db().get(name).expect("bundled zone")
}

fn expected_in(
    zone: &jiff::tz::TimeZone,
    config: &ForecastConfig,
    sim: SimInputs,
    variant: Variant,
    at: &Expected,
) -> Value {
    exported(
        config,
        variant,
        at,
        &Run { time_zone: zone, now_ms: at.now_ms, sim, correction: None, array_corrections: &[] },
    )
}

fn exported(config: &ForecastConfig, variant: Variant, at: &Expected, run: &Run) -> Value {
    let built = forecast::build(config, &irradiance(), "open-meteo", run).expect("forecast");
    let mut value = serde_json::to_value(built.export(variant)).expect("export");
    value["fetchedAt"] = json!(crate::live::iso(at.fetched_ms));
    value["stale"] = json!(at.stale);
    value
}

pub(super) fn model(max_output_w: Option<f64>) -> ForecastConfig {
    ForecastConfig {
        arrays: vec![forecast::PvArray {
            kwp: 6.4,
            tilt: 35.0,
            azimuth: 10.0,
            temp_coefficient: Some(-0.34),
            system_loss: None,
        }],
        temp_coefficient: -0.4,
        system_loss: 12.0,
        max_output_w,
        battery: None,
    }
}

/// Answers a forecast request with the payload and an archive request with the archive payload, or 500 while
/// failing; counts what it was asked.
pub(super) struct StandIn {
    urls: (String, String),
    pub(super) hits: Arc<AtomicUsize>,
    pub(super) failing: Arc<AtomicBool>,
    pub(super) paths: Arc<Mutex<Vec<String>>>,
}

type Seen = (Arc<AtomicUsize>, Arc<AtomicBool>, Arc<Mutex<Vec<String>>>);

async fn stand_in(ca: &Ca) -> StandIn {
    let tls = acceptor(ca.leaf("localhost"));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let port = listener.local_addr().expect("addr").port();
    let (hits, failing, paths) =
        (Arc::new(AtomicUsize::new(0)), Arc::new(AtomicBool::new(false)), Arc::default());
    let seen: Seen = (Arc::clone(&hits), Arc::clone(&failing), Arc::clone(&paths));
    tokio::spawn(async move {
        while let Ok((tcp, _)) = listener.accept().await {
            tokio::spawn(answer_one(tls.clone(), tcp, seen.clone()));
        }
    });
    let urls =
        (format!("https://localhost:{port}/v1/forecast"), format!("https://localhost:{port}/v1/archive"));
    StandIn { urls, hits, failing, paths }
}

async fn answer_one(
    tls: tokio_rustls::TlsAcceptor,
    tcp: tokio::net::TcpStream,
    (hits, failing, paths): Seen,
) {
    let Ok(mut stream) = tls.accept(tcp).await else { return };
    let Some(head) = read_request(&mut stream).await else { return };
    let head = String::from_utf8_lossy(&head).into_owned();
    let path = head.split_whitespace().nth(1).unwrap_or_default().to_owned();
    let body = if path.starts_with("/v1/archive") { archive_payload() } else { payload() }.to_string();
    paths.lock().expect("paths").push(path);
    hits.fetch_add(1, Ordering::SeqCst);
    let wire = if failing.load(Ordering::SeqCst) {
        "HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_owned()
    } else {
        format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len())
    };
    let _ = stream.write_all(wire.as_bytes()).await;
    let _ = stream.shutdown().await;
}

/// An onboarded core reading the forecast from a stand-in, its clock at `now`.
pub(super) async fn forecasting(name: &str, now: fn() -> i64) -> (Arc<Core>, Api, StandIn) {
    let ca = Ca::new("forecast test CA");
    let standin = stand_in(&ca).await;
    let core =
        Core::open_forecasting(&dir(name), vec![ca.root()], standin.urls.clone(), now).await.expect("core");
    let (core, admin) = signed_in(core, &Config::default()).await;
    // Expectations are Berlin days: save the zone first.
    let berlin = put(&admin, "/api/settings/time-zone", &json!({"timeZone": "Europe/Berlin"})).await;
    assert_eq!(berlin.status, StatusCode::OK);
    put(&admin, "/api/settings/active-profile", &json!({"id": PROFILE})).await;
    let port = unused_port().await;
    assert_eq!(put(&admin, "/api/settings/inverter", &connection(port)).await.status, StatusCode::OK);
    (core, admin, standin)
}

async fn patch(api: &Api, path: &str, body: &Value) -> Answer {
    send(api, Method::PATCH, path, Some(&body.to_string())).await
}

pub(super) async fn configure(admin: &Api, max_output_w: Option<f64>) {
    let arrays = json!({"arrays": [{"kwp": 6.4, "tilt": 35, "azimuth": 10, "tempCoefficient": -0.34, "mppt": 1}],
        "systemLoss": 12});
    assert_eq!(patch(admin, "/api/devices/1", &arrays).await.status, StatusCode::OK);
    let plant = json!({"enabled": true, "latitude": LAT, "longitude": LON,
        "forecast": {"enabled": true, "maxOutputW": max_output_w, "houseLoadW": 400}});
    assert_eq!(put(admin, "/api/settings/weather", &plant).await.status, StatusCode::OK);
}

pub(super) fn fixed_now() -> i64 {
    NOW_MS
}

#[tokio::test]
async fn weather_settings_round_trip_and_compose_the_inverter_s_arrays() {
    let (core, admin, _) = forecasting("weather-round-trip", fixed_now).await;
    let defaults = get(&admin, "/api/settings/weather").await;
    assert_eq!(
        defaults.json(),
        json!({"enabled": false, "latitude": null, "longitude": null, "label": "", "forecast": {
            "enabled": false, "provider": "open-meteo", "arrays": [], "tempCoefficient": -0.4, "systemLoss": 14.0,
            "maxOutputW": null, "battery": null, "houseLoadW": null, "smartMeterSince": null,
            "correction": {"enabled": false}}})
    );
    let pv = json!({"arrays": [{"kwp": 5, "tilt": 30, "azimuth": -90, "mppt": 2}, {"kwp": 2, "tilt": 10, "azimuth": 90}],
        "tempCoefficient": -0.3, "battery": {"usableKwh": 9.6}});
    let device = patch(&admin, "/api/devices/1", &pv).await;
    assert_eq!(device.status, StatusCode::OK, "{}", device.json());
    assert_eq!(
        (&device.json()["arrays"], &device.json()["tempCoefficient"], &device.json()["battery"]),
        (
            &json!([{"kwp": 5.0, "tilt": 30.0, "azimuth": -90.0, "mppt": 2}, {"kwp": 2.0, "tilt": 10.0, "azimuth": 90.0}]),
            &json!(-0.3),
            &json!({"usableKwh": 9.6, "maxChargeW": null, "minSoc": 10.0})
        )
    );
    let body = json!({"enabled": true, "latitude": 50.5, "longitude": 8.25, "label": "Home",
        "forecast": {"enabled": true, "maxOutputW": 6000, "smartMeterSince": "2026-03-01", "correction": {"enabled": true}}});
    let saved = put(&admin, "/api/settings/weather", &body).await;
    assert_eq!(saved.status, StatusCode::OK, "{}", saved.json());
    let want = json!({"enabled": true, "latitude": 50.5, "longitude": 8.25, "label": "Home", "forecast": {
        "enabled": true, "provider": "open-meteo",
        "arrays": [
            {"kwp": 5.0, "tilt": 30.0, "azimuth": -90.0, "deviceSlug": "1", "tempCoefficient": -0.3, "mppt": 2},
            {"kwp": 2.0, "tilt": 10.0, "azimuth": 90.0, "deviceSlug": "1", "tempCoefficient": -0.3}
        ],
        "tempCoefficient": -0.4, "systemLoss": 14.0, "maxOutputW": 6000.0,
        "battery": {"usableKwh": 9.6, "maxChargeW": null, "minSoc": 10.0},
        "houseLoadW": null, "smartMeterSince": "2026-03-01", "correction": {"enabled": true}}});
    assert_eq!(saved.json(), want);
    assert_eq!(get(&admin, "/api/settings/weather").await.json(), want);
    let cleared = put(&admin, "/api/settings/weather", &json!({"forecast": {"maxOutputW": null}})).await;
    assert_eq!(cleared.json()["forecast"]["maxOutputW"], Value::Null);
    assert_eq!(cleared.json()["label"], "Home", "what the patch does not name is kept");
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn out_of_bound_values_and_device_owned_fields_are_refused_and_nothing_is_saved() {
    let (core, admin, _) = forecasting("weather-refused", fixed_now).await;
    let before = get(&admin, "/api/settings/weather").await.json();
    for (body, error) in [
        (json!({"latitude": 91}), "latitude must be -90–90"),
        (json!({"forecast": {"houseLoadW": -1}}), "forecast.houseLoadW must be 0–10000000"),
        (
            json!({"forecast": {"arrays": []}}),
            "forecast.arrays is edited on the inverter in Settings → Devices",
        ),
        (
            json!({"forecast": {"tempCoefficient": -0.3}}),
            "forecast.tempCoefficient is edited on the inverter in Settings → Devices",
        ),
        (
            json!({"forecast": {"systemLoss": 10}}),
            "forecast.systemLoss is edited on the inverter in Settings → Devices",
        ),
        (
            json!({"forecast": {"battery": null}}),
            "forecast.battery is edited on the inverter in Settings → Devices",
        ),
    ] {
        let answer = put(&admin, "/api/settings/weather", &body).await;
        assert_eq!(
            (answer.status, answer.json()),
            (StatusCode::BAD_REQUEST, json!({"error": error})),
            "{body}"
        );
    }
    assert_eq!(get(&admin, "/api/settings/weather").await.json(), before);
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn an_array_on_a_string_the_inverter_lacks_or_shares_and_arrays_on_a_meter_are_refused() {
    let (core, admin, _) = forecasting("device-pv-refused", fixed_now).await;
    let array = |mppt| json!({"kwp": 1, "tilt": 0, "azimuth": 0, "mppt": mppt});
    for (body, error) in [
        (json!({"arrays": [array(5)]}), "arrays: mppt 5 is not a PV string this inverter reports"),
        (json!({"arrays": [array(1), array(1)]}), "arrays: two arrays on PV string 1"),
        (json!({"battery": {"usableKwh": 0}}), "battery: usableKwh must be above 0 and at most 10000"),
        (
            json!({"role": "meter", "arrays": [array(1)]}),
            "arrays: only an inverter carries PV arrays and a pack",
        ),
    ] {
        let answer = patch(&admin, "/api/devices/1", &body).await;
        assert_eq!(answer.status, StatusCode::BAD_REQUEST, "{body}");
        assert_eq!(answer.json()["error"], error, "{body}");
    }
    let device = get(&admin, "/api/devices").await.json()["devices"][0].clone();
    assert_eq!((&device["arrays"], &device["role"]), (&json!([]), &json!("inverter")));
    let pack = json!({"battery": {"usableKwh": 5, "maxChargeW": 3000, "minSoc": 20}});
    assert_eq!(patch(&admin, "/api/devices/1", &pack).await.json()["battery"]["maxChargeW"], 3000.0);
    assert_eq!(
        patch(&admin, "/api/devices/1", &json!({"battery": null})).await.json()["battery"],
        Value::Null
    );
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn an_inverter_s_physics_override_is_set_by_a_value_kept_when_absent_and_cleared_by_null() {
    let (core, admin, _) = forecasting("device-physics-override", fixed_now).await;
    let physics = |answer: Answer| {
        let device = answer.json();
        (device["tempCoefficient"].clone(), device["systemLoss"].clone())
    };
    let set = patch(&admin, "/api/devices/1", &json!({"tempCoefficient": -0.3, "systemLoss": 12})).await;
    assert_eq!(physics(set), (json!(-0.3), json!(12.0)));
    let absent = patch(&admin, "/api/devices/1", &json!({"name": "roof"})).await;
    assert_eq!(physics(absent), (json!(-0.3), json!(12.0)), "absent keeps both");
    let one = patch(&admin, "/api/devices/1", &json!({"tempCoefficient": null})).await;
    assert_eq!(physics(one), (Value::Null, json!(12.0)), "null clears only the named field");
    let other = patch(&admin, "/api/devices/1", &json!({"systemLoss": null})).await;
    assert_eq!(physics(other), (Value::Null, Value::Null));
    let plant = get(&admin, "/api/settings/weather").await.json();
    assert_eq!(
        (&plant["forecast"]["tempCoefficient"], &plant["forecast"]["systemLoss"]),
        (&json!(-0.4), &json!(14.0))
    );
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn the_forecast_answers_the_model_s_series_and_a_second_request_does_not_refetch() {
    let (core, admin, standin) = forecasting("forecast-served", fixed_now).await;
    configure(&admin, None).await;
    let raw = get(&admin, "/api/forecast").await;
    assert_eq!(raw.status, StatusCode::OK);
    assert_eq!(raw.json(), expected(&model(None), SimInputs::default(), Variant::Raw, &FRESH));
    let usable = get(&admin, "/api/forecast/usable").await;
    assert_eq!(usable.json(), expected(&model(None), SimInputs::default(), Variant::Usable, &FRESH));
    assert_eq!(standin.hits.load(Ordering::SeqCst), 1, "the second request is served from the cache");
    let path = standin.paths.lock().expect("paths")[0].clone();
    assert!(path.contains("latitude=50.5&longitude=8.25") && path.contains("tilt=35&azimuth=10"), "{path}");
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn the_feed_in_cap_clips_the_usable_view_with_the_stated_house_load() {
    let (core, admin, _) = forecasting("forecast-clipped", fixed_now).await;
    configure(&admin, Some(2500.0)).await;
    let sim = SimInputs { house_load_w: Some(400.0), ..SimInputs::default() };
    let usable = get(&admin, "/api/forecast/usable").await.json();
    assert_eq!(usable, expected(&model(Some(2500.0)), sim, Variant::Usable, &FRESH));
    assert_ne!(usable["series"], get(&admin, "/api/forecast").await.json()["series"], "the cap clips");
    drop(admin);
    core.stop().await;
}

static STALE_NOW: AtomicI64 = AtomicI64::new(NOW_MS);

fn stale_now() -> i64 {
    STALE_NOW.load(Ordering::SeqCst)
}

#[tokio::test]
async fn a_failed_refetch_keeps_the_last_irradiance_and_reports_it_stale() {
    let (core, admin, standin) = forecasting("forecast-stale", stale_now).await;
    configure(&admin, None).await;
    assert_eq!(get(&admin, "/api/forecast").await.json()["stale"], false);
    standin.failing.store(true, Ordering::SeqCst);
    STALE_NOW.store(NOW_MS + HALF_HOUR_MS - 1, Ordering::SeqCst);
    assert_eq!(get(&admin, "/api/forecast").await.json()["stale"], false, "inside 30 min: no refetch");
    assert_eq!(standin.hits.load(Ordering::SeqCst), 1);
    STALE_NOW.store(NOW_MS + HALF_HOUR_MS, Ordering::SeqCst);
    let stale = get(&admin, "/api/forecast").await.json();
    assert_eq!(standin.hits.load(Ordering::SeqCst), 2, "the cache expired");
    let want = expected(
        &model(None),
        SimInputs::default(),
        Variant::Raw,
        &Expected { now_ms: NOW_MS + HALF_HOUR_MS, fetched_ms: NOW_MS, stale: true },
    );
    assert_eq!(stale, want, "fetchedAt unchanged");
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn a_failed_first_fetch_answers_null() {
    let (core, admin, standin) = forecasting("forecast-unreachable", fixed_now).await;
    configure(&admin, None).await;
    standin.failing.store(true, Ordering::SeqCst);
    for path in ["/api/forecast", "/api/forecast/usable"] {
        let answer = get(&admin, path).await;
        assert_eq!((answer.status, answer.json()), (StatusCode::OK, Value::Null), "{path}");
    }
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn disabled_unlocated_or_arrayless_answers_null_without_a_fetch() {
    let (core, admin, standin) = forecasting("forecast-unready", fixed_now).await;
    let null = |answer: Answer| (answer.status, answer.json()) == (StatusCode::OK, Value::Null);
    let located = json!({"enabled": true, "latitude": LAT, "longitude": LON, "forecast": {"enabled": true}});
    assert_eq!(put(&admin, "/api/settings/weather", &located).await.status, StatusCode::OK);
    assert!(null(get(&admin, "/api/forecast").await), "no arrays");
    configure(&admin, None).await;
    for unready in
        [json!({"enabled": false}), json!({"forecast": {"enabled": false}}), json!({"latitude": null})]
    {
        assert_eq!(put(&admin, "/api/settings/weather", &unready).await.status, StatusCode::OK);
        assert!(null(get(&admin, "/api/forecast").await), "{unready}");
        assert!(null(get(&admin, "/api/forecast/usable").await), "{unready}");
        assert_eq!(put(&admin, "/api/settings/weather", &located).await.status, StatusCode::OK);
    }
    assert_eq!(standin.hits.load(Ordering::SeqCst), 0);
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn the_providers_list_open_meteo_with_its_capabilities() {
    let (core, admin, _) = forecasting("forecast-providers", fixed_now).await;
    assert_eq!(
        get(&admin, "/api/forecast/providers").await.json(),
        json!([{"id": "open-meteo", "label": "Open-Meteo", "capabilities": {"dni": true, "windSpeed": true}}])
    );
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn the_battery_sim_starts_from_the_live_soc_the_median_load_and_the_day_start_soc() {
    let (core, admin, _) = forecasting("forecast-sim", fixed_now).await;
    configure(&admin, Some(2500.0)).await;
    let pack = json!({"battery": {"usableKwh": 2, "minSoc": 10}});
    assert_eq!(patch(&admin, "/api/devices/1", &pack).await.status, StatusCode::OK);
    let no_load = json!({"forecast": {"houseLoadW": null}});
    assert_eq!(put(&admin, "/api/settings/weather", &no_load).await.status, StatusCode::OK);
    // 06:00Z–09:00Z; the series opens at 11:00 Berlin, 09:00Z.
    let hour = |h: i64| 1_784_851_200_000 + h * 3_600_000;
    for (h, load, soc) in [(6, 300.0, 40.0), (7, 500.0, 45.0), (8, 400.0, 50.0), (9, 400.0, 55.0)] {
        let sample = Sample {
            at_ms: hour(h),
            values: vec![("ac.ups.total_power".into(), load), ("battery.soc".into(), soc)],
        };
        let closed = ClosedMinute { minute: hour(h) / 60_000, samples: vec![sample] };
        core.store.append_minute(1, &closed).await.expect("append");
    }
    core.unstored.push(1, Sample { at_ms: NOW_MS - 5_000, values: vec![("battery.soc".into(), 95.0)] });
    let battery = forecast::Battery { usable_kwh: 2.0, max_charge_w: None, min_soc: 10.0 };
    let config = ForecastConfig { battery: Some(battery), ..model(Some(2500.0)) };
    let sim =
        SimInputs { start_soc_pct: Some(95.0), house_load_w: Some(400.0), day_start_soc_pct: Some(55.0) };
    let usable = get(&admin, "/api/forecast/usable").await.json();
    assert_eq!(usable, expected(&config, sim, Variant::Usable, &FRESH));
    drop(admin);
    core.stop().await;
}

/// 2026-07-24T22:30:00Z: 00:30 on the 25th in Berlin, 04:00 on the 25th in Kolkata, still the 24th in UTC.
const LATE_MS: i64 = 1_784_932_200_000;

fn late_now() -> i64 {
    LATE_MS
}

fn late(stale: bool) -> Expected {
    Expected { now_ms: LATE_MS, fetched_ms: LATE_MS, stale }
}

/// The 24th's slots in the series, summed.
fn today_kwh(answer: &Value) -> f64 {
    answer["todayKwh"].as_f64().expect("todayKwh")
}

#[tokio::test]
async fn the_forecast_cuts_its_days_in_the_saved_plant_zone_not_the_provider_s() {
    let (core, admin, standin) = forecasting("forecast-plant-zone", late_now).await;
    configure(&admin, None).await;
    let base = &model(None);
    // The stand-in answers `Europe/Berlin`; the saved zone decides which day is today.
    for (name, today_has_the_series) in [("UTC", true), ("Asia/Kolkata", false), ("Asia/Kathmandu", false)] {
        let saved = put(&admin, "/api/settings/time-zone", &json!({"timeZone": name})).await;
        assert_eq!(saved.status, StatusCode::OK, "{name}");
        let raw = get(&admin, "/api/forecast").await.json();
        let want = expected_in(&zone(name), base, SimInputs::default(), Variant::Raw, &late(false));
        assert_eq!(raw, want, "{name}");
        assert_eq!(today_kwh(&raw) > 0.0, today_has_the_series, "{name}");
    }
    assert_eq!(standin.hits.load(Ordering::SeqCst), 1, "a zone change does not refetch");
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn a_saved_zone_the_database_lost_cuts_utc_days_as_the_setting_reads_never_the_series_offset() {
    let (core, admin, _) = forecasting("forecast-lost-zone", late_now).await;
    configure(&admin, None).await;
    core.store.save_plant_time_zone("Gone/Zone").await.expect("write");
    let setting = get(&admin, "/api/settings/time-zone").await.json();
    assert_eq!(setting, json!({"timeZone": "UTC"}));
    let raw = get(&admin, "/api/forecast").await.json();
    let want = expected_in(&zone("UTC"), &model(None), SimInputs::default(), Variant::Raw, &late(false));
    assert_eq!(raw, want);
    assert!(today_kwh(&raw) > 0.0, "22:30 on the 24th in UTC: the series' 24th is today");
    drop(admin);
    core.stop().await;
}
