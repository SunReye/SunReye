//! The weather device through a fake provider, and the Open-Meteo adapter on recorded responses.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use sunreye_profile::RoleKind;
use tokio::sync::watch;
use tokio::time::Instant;

use super::fake::{Fake, FakeArchive};
use super::{Detail, Error, Past, Slot, Weather, open_meteo};
use crate::bus::{Bus, DeviceId};
use crate::location::Location;
use crate::storage::Storage;

const DEVICE: DeviceId = DeviceId(3);

mod backfill;
/// 2026-11-09 11:00 UTC.
const NOON: u64 = 1_794_222_000;

fn at(seconds: u64) -> SystemTime {
    UNIX_EPOCH + Duration::from_secs(seconds)
}

const BERLIN: Location = Location {
    latitude: 52.516_3,
    longitude: 13.377_7,
};

fn slot(target: u64, ghi: f64) -> Slot {
    Slot {
        target: at(target),
        ghi,
        dni: 167.9,
        dhi: 141.8,
        temperature: 2.3,
        wind: Some(1.58),
        detail: Detail::default(),
    }
}

#[tokio::test]
async fn a_refresh_stores_each_quantity_as_a_forecast_from_the_rounded_location() {
    let dir = tempfile::tempdir().unwrap();
    let bus = Bus::default();
    let storage =
        Storage::open(&dir.path().join("history.sqlite"), UNIX_EPOCH, "UTC", &bus).unwrap();
    let (fake, mut calls) = Fake::new(vec![slot(NOON, 200.8), slot(NOON + 900, 210.0)], &[]);
    let weather = Weather::new(fake, DEVICE, &bus);

    weather.refresh(&storage, BERLIN, at(NOON)).await.unwrap();

    let (_, sent) = calls.recv().await.unwrap();
    assert_eq!(
        sent,
        Location {
            latitude: 52.52,
            longitude: 13.38
        }
    );
    let read = async |role: &str| -> Vec<(u64, f64)> {
        let series = bus.intern(role, None);
        storage
            .forecasts(DEVICE, series, at(NOON), at(NOON + 3600))
            .await
            .unwrap()
            .into_iter()
            .map(|f| {
                let seconds = f.target.duration_since(UNIX_EPOCH).unwrap().as_secs();
                (seconds, (f.value * 1e6).round() / 1e6)
            })
            .collect()
    };
    assert_eq!(
        read("weather.ghi").await,
        [(NOON, 200.8), (NOON + 900, 210.0)]
    );
    assert_eq!(
        read("weather.dni").await,
        [(NOON, 167.9), (NOON + 900, 167.9)]
    );
    assert_eq!(
        read("weather.dhi").await,
        [(NOON, 141.8), (NOON + 900, 141.8)]
    );
    assert_eq!(
        read("weather.temperature").await,
        [(NOON, 2.3), (NOON + 900, 2.3)]
    );
    assert_eq!(
        read("weather.wind").await,
        [(NOON, 1.58), (NOON + 900, 1.58)]
    );
}

/// What the refresh below stores, by seconds after noon.
const STORED: [(&str, &[(u64, f64)]); 11] = [
    ("weather.code", &[(0, 61.0), (900, 61.0)]),
    ("weather.precipitation", &[(0, 1.23), (900, 1.2)]),
    ("weather.snowfall", &[(0, 0.0), (900, 0.0)]),
    ("weather.visibility", &[(0, 8400.0)]),
    ("weather.humidity", &[(0, 93.0), (900, 93.0)]),
    ("weather.wind_direction", &[(0, 250.0), (900, 250.0)]),
    ("weather.gusts", &[(0, 5.4), (900, 5.4)]),
    ("weather.apparent_temperature", &[(0, -0.4), (900, -0.4)]),
    ("weather.sunshine", &[(0, 413.0)]),
    ("weather.cloud_cover", &[(0, 100.0)]),
    ("weather.snow_depth", &[(0, 0.03)]),
];

#[tokio::test]
async fn a_refresh_stores_the_weather_in_its_steps_and_hourly_quantities_at_whole_hours() {
    let dir = tempfile::tempdir().unwrap();
    let bus = Bus::default();
    let storage =
        Storage::open(&dir.path().join("history.sqlite"), UNIX_EPOCH, "UTC", &bus).unwrap();
    let hour = Detail {
        precipitation: Some(1.234),
        sunshine: Some(412.6),
        cloud_cover: Some(100.0),
        snow_depth: Some(0.0304),
        ..drizzle()
    };
    // The quarter hour has no visibility, and no hour of sunshine ends in it.
    let quarter = Detail {
        visibility: None,
        sunshine: None,
        ..drizzle()
    };
    let (fake, _calls) = Fake::new(
        vec![
            Slot {
                detail: hour,
                ..slot(NOON, 200.8)
            },
            Slot {
                detail: quarter,
                ..slot(NOON + 900, 210.0)
            },
        ],
        &[],
    );
    let weather = Weather::new(fake, DEVICE, &bus);

    weather.refresh(&storage, BERLIN, at(NOON)).await.unwrap();

    for (role, values) in STORED {
        let read: Vec<_> = forecast(&storage, &bus, role)
            .await
            .into_iter()
            .map(|(seconds, value)| (seconds - NOON, value))
            .collect();
        assert_eq!(read, values, "{role}");
    }
}

/// The forecast of `role` over the hour from noon, by target in seconds, rounded to 1e-6.
async fn forecast(storage: &Storage, bus: &Bus, role: &str) -> Vec<(u64, f64)> {
    let series = bus.intern(role, None);
    storage
        .forecasts(DEVICE, series, at(NOON), at(NOON + 3600))
        .await
        .unwrap()
        .into_iter()
        .map(|f| {
            let seconds = f.target.duration_since(UNIX_EPOCH).unwrap().as_secs();
            (seconds, (f.value * 1e6).round() / 1e6)
        })
        .collect()
}

#[tokio::test(start_paused = true)]
async fn without_a_location_nothing_is_fetched() {
    let dir = tempfile::tempdir().unwrap();
    let bus = Bus::default();
    let storage =
        Storage::open(&dir.path().join("history.sqlite"), UNIX_EPOCH, "UTC", &bus).unwrap();
    let (fake, mut calls) = Fake::new(vec![slot(NOON, 200.8)], &[]);
    let weather = Weather::new(fake, DEVICE, &bus);
    let (_location, unset) = watch::channel(None);

    tokio::select! {
        () = weather.run(&storage, unset, || at(NOON)) => panic!("the device stopped"),
        () = tokio::time::sleep(Duration::from_hours(3)) => {}
    }
    drop(weather);
    assert!(calls.recv().await.is_none());
}

#[tokio::test(start_paused = true)]
async fn it_fetches_on_start_and_hourly_and_a_failed_fetch_does_not_stop_it() {
    let dir = tempfile::tempdir().unwrap();
    let bus = Bus::default();
    let storage =
        Storage::open(&dir.path().join("history.sqlite"), UNIX_EPOCH, "UTC", &bus).unwrap();
    let (fake, mut calls) = Fake::new(vec![slot(NOON, 200.8)], &[true]);
    let weather = Weather::new(fake, DEVICE, &bus);
    let (_location, berlin) = watch::channel(Some(BERLIN));
    let start = Instant::now();

    let mut seen = Vec::new();
    tokio::select! {
        () = weather.run(&storage, berlin, || at(NOON)) => panic!("the device stopped"),
        () = async {
            while seen.len() < 3 {
                seen.push(calls.recv().await.unwrap().0 - start);
            }
        } => {}
    }
    let hour = Duration::from_secs(3600);
    assert_eq!(seen, [Duration::ZERO, hour, 2 * hour]);
}

#[tokio::test(start_paused = true)]
async fn a_location_set_or_changed_is_fetched_at_once_and_hourly_from_then() {
    let dir = tempfile::tempdir().unwrap();
    let bus = Bus::default();
    let storage =
        Storage::open(&dir.path().join("history.sqlite"), UNIX_EPOCH, "UTC", &bus).unwrap();
    let (fake, mut calls) = Fake::new(vec![slot(NOON, 200.8)], &[]);
    let weather = Weather::new(fake, DEVICE, &bus);
    let (location, watched) = watch::channel(None);
    let start = Instant::now();
    let minutes = |m| Duration::from_mins(m);
    let hamburg = Location {
        latitude: 53.55,
        longitude: 10.0,
    };

    let mut seen = Vec::new();
    tokio::select! {
        () = weather.run(&storage, watched, || at(NOON)) => panic!("the device stopped"),
        () = async {
            tokio::time::sleep(minutes(10)).await;
            location.send_replace(Some(BERLIN));
            seen.push(calls.recv().await.unwrap());
            tokio::time::sleep(minutes(20)).await;
            location.send_replace(Some(hamburg));
            seen.push(calls.recv().await.unwrap());
            seen.push(calls.recv().await.unwrap());
        } => {}
    }
    let seen: Vec<_> = seen.into_iter().map(|(at, l)| (at - start, l)).collect();
    let berlin = BERLIN.rounded();
    assert_eq!(
        seen,
        [
            (minutes(10), berlin),
            (minutes(30), hamburg),
            (minutes(90), hamburg)
        ]
    );
}

#[tokio::test(start_paused = true)]
async fn each_stored_forecast_announces_its_issue_and_a_failed_fetch_none() {
    let dir = tempfile::tempdir().unwrap();
    let bus = Bus::default();
    let storage =
        Storage::open(&dir.path().join("history.sqlite"), UNIX_EPOCH, "UTC", &bus).unwrap();
    let (fake, _calls) = Fake::new(vec![slot(NOON, 200.8)], &[true, false]);
    let weather = Weather::new(fake, DEVICE, &bus);
    let mut issues = weather.issues();
    let (_location, berlin) = watch::channel(Some(BERLIN));
    let start = Instant::now();

    let announced = tokio::select! {
        () = weather.run(&storage, berlin, || at(NOON)) => panic!("the device stopped"),
        changed = issues.changed() => {
            changed.unwrap();
            (Instant::now() - start, *issues.borrow())
        }
    };

    assert_eq!(announced, (Duration::from_hours(1), Some(at(NOON))));
}

#[test]
fn open_meteo_reads_irradiance_temperature_and_wind_every_15_minutes() {
    let slots = open_meteo::parse(include_str!("../../fixtures/open-meteo-forecast.json")).unwrap();
    assert_eq!(slots.len(), 288);
    assert_eq!(slots.first().unwrap().target, at(1_794_178_800));
    assert_eq!(slots.last().unwrap().target, at(1_794_437_100));
    let noon = slots.iter().find(|s| s.target == at(NOON)).unwrap();
    assert_eq!(
        *noon,
        Slot {
            target: at(NOON),
            ghi: 232.7,
            dni: 242.0,
            dhi: 147.8,
            temperature: 2.5,
            wind: Some(1.72),
            detail: Detail {
                code: Some(3.0),
                precipitation: Some(0.0),
                snowfall: Some(0.0),
                visibility: Some(24_920.0),
                humidity: Some(82.0),
                wind_direction: Some(126.0),
                gusts: Some(4.2),
                apparent_temperature: Some(-0.6),
                // The quarters to noon: 275.94, 307.04, 900 and 900 s.
                sunshine: Some(2_382.98),
                cloud_cover: Some(87.0),
                snow_depth: Some(0.0),
            },
        }
    );
}

#[test]
fn open_meteo_drops_a_slot_missing_a_value_and_keeps_one_missing_only_wind() {
    let body = r#"{"minutely_15":{
        "time":[1794222000,1794222900],
        "shortwave_radiation_instant":[200.8,null],
        "direct_normal_irradiance_instant":[167.9,160.0],
        "diffuse_radiation_instant":[141.8,140.0],
        "temperature_2m":[2.3,2.4],
        "wind_speed_10m":[null,1.0]}}"#;
    let slots = open_meteo::parse(body).unwrap();
    assert_eq!(
        slots,
        [Slot {
            wind: None,
            ..slot(NOON, 200.8)
        }]
    );
}

/// Light rain under a closed sky at 2026-11-09 11:00 UTC.
fn drizzle() -> Detail {
    Detail {
        code: Some(61.0),
        precipitation: Some(1.2),
        snowfall: Some(0.0),
        visibility: Some(8400.0),
        humidity: Some(93.0),
        wind_direction: Some(250.0),
        gusts: Some(5.4),
        apparent_temperature: Some(-0.4),
        sunshine: Some(0.0),
        cloud_cover: None,
        snow_depth: None,
    }
}

#[test]
fn open_meteo_reads_the_weather_in_rates_per_hour_and_hourly_quantities_at_whole_hours() {
    let body = r#"{"minutely_15":{
        "time":[1794222000,1794222900],
        "shortwave_radiation_instant":[200.8,200.8],
        "direct_normal_irradiance_instant":[167.9,167.9],
        "diffuse_radiation_instant":[141.8,141.8],
        "temperature_2m":[2.3,2.3],
        "wind_speed_10m":[1.58,1.58],
        "weather_code":[61,61],
        "precipitation":[0.3,0.3],
        "snowfall":[0.0,0.0],
        "visibility":[8400.0,null],
        "relative_humidity_2m":[93,93],
        "wind_direction_10m":[250,250],
        "wind_gusts_10m":[5.4,5.4],
        "apparent_temperature":[-0.4,-0.4],
        "sunshine_duration":[0.0,0.0]},
      "hourly":{"time":[1794218400,1794222000],"cloud_cover":[90,100],"snow_depth":[0.02,0.03]}}"#;
    let slots = open_meteo::parse(body).unwrap();
    // The answer starts at noon: no hour of sunshine ends in it.
    let hour = Detail {
        sunshine: None,
        cloud_cover: Some(100.0),
        snow_depth: Some(0.03),
        ..drizzle()
    };
    let quarter = Detail {
        visibility: None,
        sunshine: None,
        ..drizzle()
    };
    assert_eq!(
        slots,
        [
            Slot {
                detail: hour,
                ..slot(NOON, 200.8)
            },
            Slot {
                detail: quarter,
                ..slot(NOON + 900, 200.8)
            }
        ]
    );
}

/// A forecast answer of quarters from 10:15 UTC with these seconds of sunshine in each.
fn sunny(sunshine: &[Option<f64>]) -> String {
    let n = sunshine.len();
    let time: Vec<u64> = (0..n as u64).map(|i| NOON - 2700 + i * 900).collect();
    serde_json::json!({"minutely_15": {
        "time": time,
        "shortwave_radiation_instant": vec![200.8; n],
        "direct_normal_irradiance_instant": vec![167.9; n],
        "diffuse_radiation_instant": vec![141.8; n],
        "temperature_2m": vec![2.3; n],
        "wind_speed_10m": vec![1.58; n],
        "sunshine_duration": sunshine,
    }})
    .to_string()
}

#[test]
fn open_meteo_sums_sunshine_into_the_hour_its_quarters_end_in() {
    let quarters = [100.0, 200.0, 300.0, 400.0, 900.0, 900.0, 900.0, 50.0].map(Some);
    let slots = open_meteo::parse(&sunny(&quarters)).unwrap();
    let sunshine: Vec<_> = slots
        .iter()
        .filter_map(|s| {
            let after = s.target.duration_since(at(NOON)).ok()?;
            Some((after.as_secs(), s.detail.sunshine?))
        })
        .collect();
    // Each value is of the quarter before it, as the archive's is of the hour before it.
    assert_eq!(sunshine, [(0, 1000.0), (3600, 2750.0)]);
}

#[test]
fn an_hour_missing_a_quarter_of_sunshine_has_none() {
    let quarters = [Some(100.0), None, Some(300.0), Some(400.0)];
    let slots = open_meteo::parse(&sunny(&quarters)).unwrap();
    assert!(slots.iter().all(|s| s.detail.sunshine.is_none()));
}

#[test]
fn the_archive_reads_the_weather_hourly_without_visibility() {
    let body = r#"{"hourly":{
        "time":[1794222000],
        "shortwave_radiation_instant":[200.8],
        "direct_normal_irradiance_instant":[167.9],
        "diffuse_radiation_instant":[141.8],
        "temperature_2m":[2.3],
        "wind_speed_10m":[1.58],
        "weather_code":[61],
        "precipitation":[1.2],
        "snowfall":[0.0],
        "relative_humidity_2m":[93],
        "wind_direction_10m":[250],
        "wind_gusts_10m":[5.4],
        "apparent_temperature":[-0.4],
        "sunshine_duration":[null],
        "cloud_cover":[100],
        "snow_depth":[0.03]}}"#;
    let slots = open_meteo::parse_archive(body).unwrap();
    let detail = Detail {
        visibility: None,
        sunshine: None,
        cloud_cover: Some(100.0),
        snow_depth: Some(0.03),
        ..drizzle()
    };
    assert_eq!(
        slots,
        [Slot {
            detail,
            ..slot(NOON, 200.8)
        }]
    );
}

#[test]
fn open_meteo_refuses_a_body_without_its_series() {
    assert!(matches!(open_meteo::parse("{}"), Err(Error::Format)));
}

#[test]
fn open_meteo_asks_for_today_and_two_more_days_at_15_minutes_at_the_rounded_location() {
    assert_eq!(
        open_meteo::url(BERLIN),
        "https://api.open-meteo.com/v1/forecast?latitude=52.52&longitude=13.38\
         &minutely_15=shortwave_radiation_instant,direct_normal_irradiance_instant,\
         diffuse_radiation_instant,temperature_2m,wind_speed_10m,weather_code,precipitation,\
         snowfall,visibility,relative_humidity_2m,wind_direction_10m,wind_gusts_10m,\
         apparent_temperature,sunshine_duration&hourly=cloud_cover,snow_depth\
         &wind_speed_unit=ms&timezone=auto&timeformat=unixtime&forecast_days=3"
    );
}

#[test]
fn the_archive_reads_irradiance_temperature_and_wind_every_hour() {
    let slots =
        open_meteo::parse_archive(include_str!("../../fixtures/open-meteo-archive.json")).unwrap();
    assert_eq!(slots.len(), 48);
    // 2026-06-20 00:00 UTC to 2026-06-21 23:00 UTC.
    assert_eq!(slots.first().unwrap().target, at(1_781_913_600));
    assert_eq!(slots.last().unwrap().target, at(1_782_082_800));
    let noon = slots
        .iter()
        .find(|s| s.target == at(1_782_039_600))
        .unwrap();
    assert_eq!(
        *noon,
        Slot {
            target: at(1_782_039_600),
            ghi: 495.1,
            dni: 153.1,
            dhi: 362.7,
            temperature: 24.3,
            wind: Some(1.52),
            detail: Detail {
                code: Some(3.0),
                precipitation: Some(0.0),
                snowfall: Some(0.0),
                visibility: None,
                humidity: Some(77.0),
                wind_direction: Some(297.0),
                gusts: Some(6.5),
                apparent_temperature: Some(27.4),
                sunshine: Some(2_746.97),
                cloud_cover: Some(98.0),
                snow_depth: Some(0.0),
            },
        }
    );
}

#[test]
fn the_archive_asks_for_whole_utc_days_hourly_at_the_rounded_location() {
    let from = jiff::civil::date(2026, 6, 20);
    let to = jiff::civil::date(2026, 6, 21);
    assert_eq!(
        open_meteo::archive_url(BERLIN, from, to),
        "https://archive-api.open-meteo.com/v1/archive?latitude=52.52&longitude=13.38\
         &start_date=2026-06-20&end_date=2026-06-21\
         &hourly=shortwave_radiation_instant,direct_normal_irradiance_instant,\
         diffuse_radiation_instant,temperature_2m,wind_speed_10m,weather_code,precipitation,\
         snowfall,relative_humidity_2m,wind_direction_10m,wind_gusts_10m,apparent_temperature,\
         sunshine_duration,cloud_cover,snow_depth\
         &wind_speed_unit=ms&timezone=GMT&timeformat=unixtime"
    );
}

/// An archive hour of 2026-06-21 at `hour` UTC.
fn past(hour: u64, ghi: f64) -> Slot {
    Slot {
        target: at(1_781_996_400 + hour * 3600),
        ghi,
        dni: 153.1,
        dhi: 362.5,
        temperature: 24.3,
        wind: Some(1.52),
        detail: Detail::default(),
    }
}

#[tokio::test]
async fn archive_weather_is_stored_as_history_and_read_back_hourly() {
    let dir = tempfile::tempdir().unwrap();
    let bus = Bus::default();
    let storage =
        Storage::open(&dir.path().join("history.sqlite"), UNIX_EPOCH, "UTC", &bus).unwrap();
    // 13:00 has not settled.
    let slots = vec![past(11, 495.1), past(12, 674.1), past(14, 400.0)];
    let (archive, mut calls) = FakeArchive::new(slots.clone());
    let weather = Past::new(archive, DEVICE, &bus);
    let day = jiff::civil::date(2026, 6, 21);

    weather.fetch(&storage, BERLIN, day, day).await.unwrap();

    let (_, sent, from, to) = calls.recv().await.unwrap();
    assert_eq!((sent, from, to), (BERLIN.rounded(), day, day));
    let ghi = storage
        .history(
            DEVICE,
            bus.intern("weather.ghi", None),
            past(0, 0.0).target,
            past(24, 0.0).target,
        )
        .await
        .unwrap();
    let values: Vec<_> = ghi.iter().map(|p| (p.time, p.value)).collect();
    assert_eq!(
        values,
        [
            (past(11, 0.0).target, Some(495.1)),
            (past(12, 0.0).target, Some(674.1)),
            (past(13, 0.0).target, None),
            (past(14, 0.0).target, Some(400.0)),
            (past(15, 0.0).target, None),
        ]
    );
    let read = super::archived(
        &storage.reader(),
        DEVICE,
        past(0, 0.0).target,
        past(24, 0.0).target,
    )
    .await
    .unwrap();
    assert_eq!(read, slots);
}

/// In ADR 23's units; the code is a status, so rollups never average it, and the archive has no
/// visibility.
#[tokio::test]
async fn archive_weather_is_catalogued_with_its_kinds_and_units() {
    let dir = tempfile::tempdir().unwrap();
    let bus = Bus::default();
    let storage =
        Storage::open(&dir.path().join("history.sqlite"), UNIX_EPOCH, "UTC", &bus).unwrap();
    let (archive, _calls) = FakeArchive::new(vec![past(11, 495.1)]);
    let day = jiff::civil::date(2026, 6, 21);

    Past::new(archive, DEVICE, &bus)
        .fetch(&storage, BERLIN, day, day)
        .await
        .unwrap();

    let catalog: Vec<(String, Option<RoleKind>, Option<String>)> = storage
        .reader()
        .catalog()
        .await
        .unwrap()
        .into_iter()
        .map(|c| (c.series, c.kind, c.unit))
        .collect();
    let measured = |series: &str, unit: &str| {
        (
            series.to_owned(),
            Some(RoleKind::Measurement),
            Some(unit.to_owned()),
        )
    };
    assert_eq!(
        catalog,
        [
            measured("weather.apparent_temperature", "°C"),
            measured("weather.cloud_cover", "%"),
            ("weather.code".to_owned(), Some(RoleKind::Status), None),
            measured("weather.dhi", "W/m²"),
            measured("weather.dni", "W/m²"),
            measured("weather.ghi", "W/m²"),
            measured("weather.gusts", "m/s"),
            measured("weather.humidity", "%"),
            measured("weather.precipitation", "mm/h"),
            measured("weather.snow_depth", "m"),
            measured("weather.snowfall", "cm/h"),
            measured("weather.sunshine", "s"),
            measured("weather.temperature", "°C"),
            measured("weather.wind", "m/s"),
            measured("weather.wind_direction", "°"),
        ]
    );
}

#[tokio::test]
async fn archive_weather_stores_each_quantity_it_has_as_history() {
    let dir = tempfile::tempdir().unwrap();
    let bus = Bus::default();
    let storage =
        Storage::open(&dir.path().join("history.sqlite"), UNIX_EPOCH, "UTC", &bus).unwrap();
    let wet = Detail {
        visibility: None,
        cloud_cover: Some(100.0),
        snow_depth: Some(0.03),
        ..drizzle()
    };
    // 12:00 lacks its gusts.
    let slots = vec![
        Slot {
            detail: wet,
            ..past(11, 495.1)
        },
        Slot {
            detail: Detail { gusts: None, ..wet },
            ..past(12, 674.1)
        },
    ];
    let (archive, _calls) = FakeArchive::new(slots);
    let day = jiff::civil::date(2026, 6, 21);

    Past::new(archive, DEVICE, &bus)
        .fetch(&storage, BERLIN, day, day)
        .await
        .unwrap();

    let read = async |role: &str| history(&storage, &bus, role).await;
    assert_eq!(read("weather.code").await, [(11, Some(61.0)), (13, None)]);
    assert_eq!(read("weather.gusts").await, [(11, Some(5.4)), (12, None)]);
    assert_eq!(
        read("weather.cloud_cover").await,
        [(11, Some(100.0)), (13, None)]
    );
    assert_eq!(
        read("weather.snow_depth").await,
        [(11, Some(0.03)), (13, None)]
    );
    assert_eq!(
        read("weather.precipitation").await,
        [(11, Some(1.2)), (13, None)]
    );
    assert_eq!(read("weather.visibility").await, Vec::new());
}

/// The history of `role` on 2026-06-21, by UTC hour.
async fn history(storage: &Storage, bus: &Bus, role: &str) -> Vec<(u64, Option<f64>)> {
    let day = past(0, 0.0).target;
    storage
        .history(DEVICE, bus.intern(role, None), day, past(24, 0.0).target)
        .await
        .unwrap()
        .into_iter()
        .map(|p| {
            let hour = p.time.duration_since(day).unwrap();
            (hour.as_secs() / 3600, p.value)
        })
        .collect()
}
