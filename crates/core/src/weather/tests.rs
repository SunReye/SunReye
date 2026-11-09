//! The weather device through a fake provider, and the Open-Meteo adapter on recorded responses.

use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tokio::sync::{mpsc, watch};
use tokio::time::Instant;

use super::{Error, Provider, Slot, Weather, open_meteo};
use crate::bus::{Bus, DeviceId};
use crate::location::Location;
use crate::storage::Storage;

const DEVICE: DeviceId = DeviceId(3);
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
    }
}

/// Answers every fetch with `slots`, failing those listed in `fail`, and reports each call.
struct Fake {
    slots: Vec<Slot>,
    fail: Mutex<Vec<bool>>,
    calls: mpsc::UnboundedSender<(Instant, Location)>,
}

impl Fake {
    fn new(
        slots: Vec<Slot>,
        fail: &[bool],
    ) -> (Self, mpsc::UnboundedReceiver<(Instant, Location)>) {
        let (calls, received) = mpsc::unbounded_channel();
        let fail = Mutex::new(fail.iter().rev().copied().collect());
        (Self { slots, fail, calls }, received)
    }
}

impl Provider for Fake {
    fn fetch(&self, location: Location) -> impl Future<Output = Result<Vec<Slot>, Error>> + Send {
        self.calls.send((Instant::now(), location)).unwrap();
        let failed = self.fail.lock().unwrap().pop() == Some(true);
        std::future::ready(if failed {
            Err(Error::Fetch("offline".into()))
        } else {
            Ok(self.slots.clone())
        })
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

#[test]
fn open_meteo_reads_irradiance_temperature_and_wind_every_15_minutes() {
    let slots = open_meteo::parse(include_str!("../../fixtures/open-meteo-forecast.json")).unwrap();
    assert_eq!(slots.len(), 288);
    assert_eq!(slots.first().unwrap().target, at(1_794_178_800));
    assert_eq!(slots.last().unwrap().target, at(1_794_437_100));
    let noon = slots.iter().find(|s| s.target == at(NOON)).unwrap();
    assert_eq!(*noon, slot(NOON, 200.8));
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
         diffuse_radiation_instant,temperature_2m,wind_speed_10m\
         &wind_speed_unit=ms&timezone=auto&timeformat=unixtime&forecast_days=3"
    );
}
