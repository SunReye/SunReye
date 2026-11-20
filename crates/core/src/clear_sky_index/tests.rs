//! The clear-sky index through storage, over Berlin on 2026-06-20. Clear-sky watts come from the
//! solar forecast run on clear-sky weather stored at each quarter's midpoint, and the readings
//! are a share of them, so the index is that share to the forecast's 1 W step.

use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use sunreye_profile::{Profile, RoleKind, Unit};
use sunreye_pv as pv;

use super::ClearSkyIndex;
use crate::bus::{Bus, DeviceId, Series};
use crate::correction::{Cell, Grid};
use crate::layout::{Datasheet, Inverters, Layouts, StringDraft, Wiring};
use crate::location::Location;
use crate::solar::SolarForecast;
use crate::storage::{ChangePoint, Issue, Keep, Policy, Storage};

const FIRST_INVERTER: DeviceId = DeviceId(1);
const SECOND_INVERTER: DeviceId = DeviceId(2);
const WEATHER: DeviceId = DeviceId(3);
const QUARTER: u64 = 900;
const HOUR: u64 = 3600;
const DAY: u64 = 24 * HOUR;
/// 2026-06-20 00:00 UTC.
const FIRST: u64 = 1_781_913_600;
/// The next midnight: the day has closed.
const NOW: u64 = FIRST + DAY;
const BERLIN: Location = Location {
    latitude: 52.52,
    longitude: 13.38,
};

fn at(seconds: u64) -> SystemTime {
    UNIX_EPOCH + Duration::from_secs(seconds)
}

fn seconds(time: SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH).unwrap().as_secs()
}

fn quarters(from: u64, to: u64) -> impl Iterator<Item = u64> {
    (from..to).step_by(usize::try_from(QUARTER).unwrap())
}

/// The sun's elevation at a quarter's midpoint, in degrees.
fn elevation(quarter: u64) -> f64 {
    let location = pv::Location {
        latitude: BERLIN.latitude,
        longitude: BERLIN.longitude,
    };
    90.0 - pv::sun_position(i64::try_from(quarter + QUARTER / 2).unwrap(), location).zenith
}

/// The Deye family, declaring an AC `rating` in place of its 20 kW when given.
fn deye(rating: Option<f64>) -> Profile {
    let mut family: serde_json::Value =
        serde_json::from_str(include_str!("../../../../profiles/deye-sg05lp3.json")).unwrap();
    if let Some(rating) = rating {
        family["inverter"]["acRating"] = rating.into();
        family["variants"] = serde_json::json!([]);
    }
    Profile::load(&family.to_string()).unwrap()
}

/// One quantity of the weather.
type Quantity = fn(&pv::Weather) -> f64;

struct Plant {
    _dir: tempfile::TempDir,
    bus: Bus,
    storage: Storage,
    layouts: Layouts,
}

fn datasheet() -> Datasheet {
    Datasheet {
        name: "fixture".into(),
        pmax: 400.0,
        vmp: 34.0,
        imp: 11.76,
        voc: 41.0,
        isc: 12.5,
        power_coefficient: -0.35,
        voltage_coefficient: -0.27,
        current_coefficient: 0.05,
        width: 1.134,
        height: 1.722,
        bypass_diodes: 3,
    }
}

/// Berlin, with 16 modules of 400 Wp facing south on input 1 of each inverter given, each with
/// the AC rating given.
async fn plant(inverters: &[(DeviceId, Option<f64>)]) -> Plant {
    let dir = tempfile::tempdir().unwrap();
    let bus = Bus::default();
    let storage = Storage::open(&dir.path().join("core.sqlite"), UNIX_EPOCH, "UTC", &bus).unwrap();
    let profiles: Inverters = inverters
        .iter()
        .map(|&(device, rating)| (device, Arc::new(deye(rating))))
        .collect();
    let layouts = Layouts::new(storage.database(), profiles);
    let module_type = layouts.add_module_type(datasheet()).await.unwrap().id;
    let strings = inverters
        .iter()
        .map(|&(device, _)| StringDraft {
            id: None,
            wiring: Wiring {
                name: format!("south {}", device.0),
                module_type,
                device: device.0,
                input: 1,
                modules: 16,
                optimized: 0,
                tilt: 35.0,
                azimuth: 0.0,
                loss: 2.0,
            },
        })
        .collect();
    layouts.change(at(0), strings, None, at(0)).await.unwrap();
    Plant {
        _dir: dir,
        bus,
        storage,
        layouts,
    }
}

/// The clear-sky watts of an unrated inverter's input 1, by quarter start: the solar forecast
/// on clear-sky weather at each quarter's midpoint.
async fn clear_sky() -> BTreeMap<u64, f64> {
    let plant = plant(&[(FIRST_INVERTER, None)]).await;
    let location = pv::Location {
        latitude: BERLIN.latitude,
        longitude: BERLIN.longitude,
    };
    let skies: Vec<(u64, pv::Weather)> = quarters(FIRST, NOW)
        .map(|q| {
            let mid = q + QUARTER / 2;
            (
                mid,
                pv::clear_weather(i64::try_from(mid).unwrap(), location),
            )
        })
        .collect();
    let quantities: [(&str, Quantity); 4] = [
        ("weather.ghi", |w| w.ghi),
        ("weather.dni", |w| w.dni),
        ("weather.dhi", |w| w.dhi),
        ("weather.temperature", |w| w.temperature),
    ];
    for (name, value) in quantities {
        let issue = Issue {
            issued: at(FIRST - DAY),
            step: 0.001,
            values: skies.iter().map(|(t, w)| (at(*t), value(w))).collect(),
            keep: Keep::Ahead,
        };
        let series = plant.bus.intern(name, None);
        plant
            .storage
            .forecast(WEATHER, series, issue)
            .await
            .unwrap();
    }
    SolarForecast::new(plant.layouts.clone(), WEATHER, &plant.bus)
        .refresh(&plant.storage, &HashMap::new(), BERLIN, at(FIRST))
        .await
        .unwrap();
    let series = plant.bus.intern("pv.mppt.power", Some(1));
    plant
        .storage
        .forecasts(FIRST_INVERTER, series, at(FIRST), at(NOW))
        .await
        .unwrap()
        .into_iter()
        .map(|f| (seconds(f.target) - QUARTER / 2, f.value))
        .collect()
}

impl Plant {
    /// Stores `values` of a device's series as held from each quarter's start, through the day.
    async fn store(
        &self,
        device: DeviceId,
        (role, index): (&str, Option<u32>),
        step: f64,
        values: impl Iterator<Item = (u64, f64)>,
    ) {
        let series = self.bus.intern(role, index);
        let policy = Policy::new(
            RoleKind::Measurement,
            Some(Unit::Watt),
            step,
            Duration::from_secs(10),
        );
        self.storage.declare(device, series, policy).await.unwrap();
        let mut points: Vec<ChangePoint> = values
            .map(|(time, value)| ChangePoint {
                time: at(time),
                value: Some(value),
            })
            .collect();
        points.push(ChangePoint {
            time: at(NOW),
            value: None,
        });
        self.storage
            .replace(device, series, at(FIRST)..at(NOW + 1), points)
            .await
            .unwrap();
        self.storage.tick(at(NOW)).await.unwrap();
    }

    /// Stores `share` of `clear` as the input's and its inverter's power.
    async fn measure(
        &self,
        device: DeviceId,
        clear: &BTreeMap<u64, f64>,
        share: impl Fn(f64) -> f64 + Sync,
    ) {
        for key in [("pv.mppt.power", Some(1)), ("pv.power", None)] {
            self.store(
                device,
                key,
                1.0,
                clear.iter().map(|(&q, &w)| (q, share(w).round())),
            )
            .await;
        }
    }

    fn index(&self) -> ClearSkyIndex {
        ClearSkyIndex::new(self.layouts.clone(), WEATHER, &self.storage, &self.bus)
    }

    async fn catch_up(&self, grids: &HashMap<(DeviceId, u32), Grid>, now: u64) {
        self.index()
            .catch_up(&self.storage, grids, BERLIN, at(now))
            .await
            .unwrap();
    }

    /// The stored index held at each quarter's start.
    async fn stored(&self) -> BTreeMap<u64, Option<f64>> {
        let series = Series {
            role: "weather.clearness".into(),
            index: None,
        };
        let points = self
            .storage
            .reader()
            .history(WEATHER, &series, at(FIRST), at(NOW + DAY))
            .await
            .unwrap();
        quarters(FIRST, NOW)
            .map(|q| {
                let held = points.iter().rev().find(|p| p.time <= at(q));
                (q, held.and_then(|p| p.value))
            })
            .collect()
    }
}

/// The quarters a clear-sky input makes over 1 kW in.
fn bright(clear: &BTreeMap<u64, f64>) -> Vec<u64> {
    clear
        .iter()
        .filter(|(_, w)| **w > 1000.0)
        .map(|(q, _)| *q)
        .collect()
}

#[tokio::test]
async fn a_clear_day_is_about_one_and_the_night_is_null() {
    let clear = clear_sky().await;
    let plant = plant(&[(FIRST_INVERTER, None)]).await;
    plant.measure(FIRST_INVERTER, &clear, |w| w).await;

    plant.catch_up(&HashMap::new(), NOW).await;

    let stored = plant.stored().await;
    let bright = bright(&clear);
    assert!(bright.len() > 30, "{bright:?}");
    for q in &bright {
        let index = stored[q].unwrap_or_else(|| panic!("{q}: null"));
        assert!((index - 1.0).abs() < 0.01, "{q}: {index}");
    }
    for (q, index) in stored {
        if elevation(q) < 5.0 {
            assert_eq!(index, None, "{q}: sun at {}°", elevation(q));
        }
    }
}

#[tokio::test]
async fn an_overcast_day_is_well_under_one() {
    let clear = clear_sky().await;
    let plant = plant(&[(FIRST_INVERTER, None)]).await;
    plant.measure(FIRST_INVERTER, &clear, |w| 0.2 * w).await;

    plant.catch_up(&HashMap::new(), NOW).await;

    let stored = plant.stored().await;
    for q in bright(&clear) {
        let index = stored[&q].unwrap();
        assert!((index - 0.2).abs() < 0.01, "{q}: {index}");
    }
}

#[tokio::test]
async fn each_inputs_correction_scales_its_clear_sky() {
    let clear = clear_sky().await;
    let plant = plant(&[(FIRST_INVERTER, None)]).await;
    plant.measure(FIRST_INVERTER, &clear, |w| 0.8 * w).await;
    // Learned from so many hours that its factor is its ratio.
    let mut grid = Grid::default();
    for hour in 0..24 {
        let cell = Cell {
            ratio: 0.8,
            weight: 1e9,
        };
        grid.set(6, hour, cell);
    }
    let grids = HashMap::from([((FIRST_INVERTER, 1), grid)]);

    plant.catch_up(&grids, NOW).await;

    let stored = plant.stored().await;
    for q in bright(&clear) {
        let index = stored[&q].unwrap();
        assert!((index - 1.0).abs() < 0.01, "{q}: {index}");
    }
}

#[tokio::test]
async fn an_inverter_at_its_ac_limit_leaves_both_sums() {
    const RATING: f64 = 3000.0;
    let clear = clear_sky().await;
    let plant = plant(&[(FIRST_INVERTER, Some(RATING)), (SECOND_INVERTER, None)]).await;
    plant
        .measure(FIRST_INVERTER, &clear, |w| w.min(RATING))
        .await;
    plant.measure(SECOND_INVERTER, &clear, |w| 0.6 * w).await;

    plant.catch_up(&HashMap::new(), NOW).await;

    let stored = plant.stored().await;
    let clipped: Vec<u64> = clear
        .iter()
        .filter(|(_, w)| **w > RATING * 1.05)
        .map(|(q, _)| *q)
        .collect();
    assert!(clipped.len() > 10, "{clipped:?}");
    for q in clipped {
        let index = stored[&q].unwrap();
        assert!((index - 0.6).abs() < 0.01, "{q}: {index}");
    }
    // Short of its limit, both inverters count.
    let below: Vec<u64> = clear
        .iter()
        .filter(|(_, w)| (1000.0..2500.0).contains(*w))
        .map(|(q, _)| *q)
        .collect();
    assert!(below.len() > 2, "{below:?}");
    for q in below {
        let index = stored[&q].unwrap();
        assert!((index - 0.8).abs() < 0.01, "{q}: {index}");
    }
}

#[tokio::test]
async fn an_inverter_without_its_inputs_power_counts_by_its_own() {
    let clear = clear_sky().await;
    let plant = plant(&[(FIRST_INVERTER, None)]).await;
    plant
        .store(
            FIRST_INVERTER,
            ("pv.power", None),
            1.0,
            clear.iter().map(|(&q, &w)| (q, (0.7 * w).round())),
        )
        .await;

    plant.catch_up(&HashMap::new(), NOW).await;

    let stored = plant.stored().await;
    for q in bright(&clear) {
        let index = stored[&q].unwrap();
        assert!((index - 0.7).abs() < 0.01, "{q}: {index}");
    }
}

#[tokio::test]
async fn without_readings_the_index_is_null() {
    let clear = clear_sky().await;
    let plant = plant(&[(FIRST_INVERTER, None), (SECOND_INVERTER, None)]).await;
    // Only the second inverter reads, and only until noon.
    plant.measure(SECOND_INVERTER, &clear, |w| 0.5 * w).await;
    let noon = FIRST + 12 * HOUR;
    plant
        .store(
            SECOND_INVERTER,
            ("pv.mppt.power", Some(1)),
            1.0,
            clear.range(..noon).map(|(&q, &w)| (q, (0.5 * w).round())),
        )
        .await;
    let series = plant.bus.intern("pv.mppt.power", Some(1));
    let gap = vec![ChangePoint {
        time: at(noon),
        value: None,
    }];
    plant
        .storage
        .replace(SECOND_INVERTER, series, at(noon)..at(NOW + 1), gap)
        .await
        .unwrap();

    plant.catch_up(&HashMap::new(), NOW).await;

    let stored = plant.stored().await;
    for q in bright(&clear) {
        if q < noon {
            let index = stored[&q].unwrap();
            assert!((index - 0.5).abs() < 0.01, "{q}: {index}");
        } else {
            assert_eq!(stored[&q], None, "{q}");
        }
    }
}

/// Snow depth in metres, held from the day's start.
async fn snow(plant: &Plant, depth: f64) {
    plant
        .store(
            WEATHER,
            ("weather.snow_depth", None),
            0.001,
            std::iter::once((FIRST, depth)),
        )
        .await;
}

#[tokio::test]
async fn snow_covered_modules_are_null() {
    let clear = clear_sky().await;
    let plant = plant(&[(FIRST_INVERTER, None)]).await;
    plant.measure(FIRST_INVERTER, &clear, |w| 0.02 * w).await;
    snow(&plant, 0.2).await;

    plant.catch_up(&HashMap::new(), NOW).await;

    let stored = plant.stored().await;
    for q in bright(&clear) {
        assert_eq!(stored[&q], None, "{q}");
    }
}

#[tokio::test]
async fn a_dim_day_without_snow_or_snow_with_output_is_not_snow_covered() {
    let clear = clear_sky().await;
    for (share, depth) in [(0.02, 0.0), (0.5, 0.2), (0.02, 0.005)] {
        let plant = plant(&[(FIRST_INVERTER, None)]).await;
        plant.measure(FIRST_INVERTER, &clear, |w| share * w).await;
        snow(&plant, depth).await;

        plant.catch_up(&HashMap::new(), NOW).await;

        let stored = plant.stored().await;
        for q in bright(&clear) {
            let index = stored[&q].unwrap_or_else(|| panic!("{share} {depth} {q}: null"));
            assert!((index - share).abs() < 0.01, "{q}: {index}");
        }
    }
}

#[tokio::test]
async fn forecast_snow_depth_stands_in_until_the_archive_has_it() {
    let clear = clear_sky().await;
    let plant = plant(&[(FIRST_INVERTER, None)]).await;
    plant.measure(FIRST_INVERTER, &clear, |w| 0.02 * w).await;
    let issue = Issue {
        issued: at(FIRST - DAY),
        step: 0.001,
        values: (0..24).map(|h| (at(FIRST + h * HOUR), 0.2)).collect(),
        keep: Keep::Ahead,
    };
    let series = plant.bus.intern("weather.snow_depth", None);
    plant
        .storage
        .forecast(WEATHER, series, issue)
        .await
        .unwrap();

    plant.catch_up(&HashMap::new(), NOW).await;

    let stored = plant.stored().await;
    for q in bright(&clear) {
        assert_eq!(stored[&q], None, "{q}");
    }
}

#[tokio::test]
async fn a_later_run_resumes_where_the_last_one_stopped() {
    let clear = clear_sky().await;
    let plant = plant(&[(FIRST_INVERTER, None)]).await;
    plant.measure(FIRST_INVERTER, &clear, |w| 0.5 * w).await;
    let noon = FIRST + 12 * HOUR;

    plant.catch_up(&HashMap::new(), noon + 300).await;
    // Readings change after the first run: only the quarters it had not closed see it.
    plant.measure(FIRST_INVERTER, &clear, |w| 0.9 * w).await;
    plant.catch_up(&HashMap::new(), NOW).await;

    let stored = plant.stored().await;
    for q in bright(&clear) {
        let index = stored[&q].unwrap();
        let expected = if q < noon { 0.5 } else { 0.9 };
        assert!((index - expected).abs() < 0.01, "{q}: {index}");
    }
}

#[tokio::test]
async fn without_pv_history_nothing_is_stored() {
    let plant = plant(&[(FIRST_INVERTER, None)]).await;

    plant.catch_up(&HashMap::new(), NOW).await;

    assert!(plant.stored().await.values().all(Option::is_none));
}

#[tokio::test(start_paused = true)]
async fn it_computes_as_each_quarter_closes() {
    let clear = clear_sky().await;
    let plant = plant(&[(FIRST_INVERTER, None)]).await;
    plant.measure(FIRST_INVERTER, &clear, |w| 0.5 * w).await;
    let noon = FIRST + 12 * HOUR;
    let start = tokio::time::Instant::now();
    let clock = move || at(noon + 60) + start.elapsed();
    let (_location, receiver) = tokio::sync::watch::channel(Some(BERLIN));
    let index = plant.index();
    let grids: HashMap<(DeviceId, u32), Grid> = HashMap::new();
    let closed = async |q: u64| loop {
        if plant.stored().await[&q].is_some() {
            return start.elapsed();
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    };

    let (before, after) = tokio::select! {
        () = index.run(&plant.storage, &grids, receiver, clock) => panic!("stopped"),
        seen = async { (closed(noon - QUARTER).await, closed(noon).await) } => seen,
    };

    assert!(before < Duration::from_mins(1), "{before:?}");
    // Closed at 12:15 and stored half a minute later: 14½ minutes in.
    assert!(
        (Duration::from_mins(14)..Duration::from_mins(16)).contains(&after),
        "{after:?}"
    );
}
