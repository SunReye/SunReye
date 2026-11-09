//! The learner through storage, on the recorded Open-Meteo archive answer for Berlin on
//! 2026-06-20 and 21 (`fixtures/open-meteo-archive.json`). The modelled hours come from the solar
//! forecast run on the same weather, so measured and modelled agree to its 1 W step.

use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use jiff::tz::TimeZone;
use sunreye_profile::{Profile, RoleKind, Unit};
use tokio::sync::watch;
use tokio::time::Instant;

use super::Learner;
use crate::bus::{Bus, DeviceId};
use crate::layout::{Datasheet, Inverters, Layouts, StringDraft, Wiring};
use crate::location::Location;
use crate::solar::SolarForecast;
use crate::storage::{ChangePoint, Issue, Policy, Storage};
use crate::weather::fake::FakeArchive;
use crate::weather::{self, Slot};

const INVERTER: DeviceId = DeviceId(1);
const WEATHER: DeviceId = DeviceId(3);
const HOUR: u64 = 3600;
const DAY: u64 = 24 * HOUR;
/// 2026-06-20 00:00 UTC, the archive's first hour.
const FIRST: u64 = 1_781_913_600;
/// 2026-06-24 12:00 UTC: 2026-06-21 is the last settled day.
const NOW: u64 = FIRST + 4 * DAY + 12 * HOUR;
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

fn berlin() -> TimeZone {
    TimeZone::get("Europe/Berlin").unwrap()
}

fn archive() -> Vec<Slot> {
    weather::parse_archive(include_str!("../../fixtures/open-meteo-archive.json")).unwrap()
}

/// One quantity of a slot.
type Value = fn(&Slot) -> f64;

struct Plant {
    _dir: tempfile::TempDir,
    bus: Bus,
    storage: Storage,
    layouts: Layouts,
}

/// Berlin, the owner's Deye as device 1 with 16 modules of 400 Wp facing south on input 1.
async fn plant() -> Plant {
    let dir = tempfile::tempdir().unwrap();
    let bus = Bus::default();
    let storage = Storage::open(&dir.path().join("core.sqlite"), UNIX_EPOCH, "UTC", &bus).unwrap();
    let deye = Profile::load(include_str!("../../../../profiles/deye-sg05lp3.json")).unwrap();
    let inverters: Inverters = std::iter::once((INVERTER, Arc::new(deye))).collect();
    let layouts = Layouts::new(storage.database(), inverters);
    let module_type = layouts
        .add_module_type(Datasheet {
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
        })
        .await
        .unwrap()
        .id;
    let string = StringDraft {
        id: None,
        wiring: Wiring {
            name: "south".into(),
            module_type,
            device: INVERTER.0,
            input: 1,
            modules: 16,
            optimized: 0,
            tilt: 35.0,
            azimuth: 0.0,
            loss: 2.0,
        },
    };
    layouts
        .change(at(0), vec![string], None, at(0))
        .await
        .unwrap();
    Plant {
        _dir: dir,
        bus,
        storage,
        layouts,
    }
}

impl Plant {
    /// The solar forecast of `role` on the archive's weather, by hour, in watts.
    async fn modelled(&self, role: &str, index: Option<u32>) -> BTreeMap<u64, f64> {
        let slots = archive();
        let quantities: [(&str, Value); 4] = [
            ("weather.ghi", |s| s.ghi),
            ("weather.dni", |s| s.dni),
            ("weather.dhi", |s| s.dhi),
            ("weather.temperature", |s| s.temperature),
        ];
        for (name, value) in quantities {
            let issue = Issue {
                issued: at(FIRST - DAY),
                step: 0.1,
                values: slots.iter().map(|s| (s.target, value(s))).collect(),
            };
            let series = self.bus.intern(name, None);
            self.storage.forecast(WEATHER, series, issue).await.unwrap();
        }
        let issue = Issue {
            issued: at(FIRST - DAY),
            step: 0.01,
            values: slots.iter().map(|s| (s.target, s.wind.unwrap())).collect(),
        };
        let wind = self.bus.intern("weather.wind", None);
        self.storage.forecast(WEATHER, wind, issue).await.unwrap();
        SolarForecast::new(self.layouts.clone(), WEATHER, &self.bus)
            .refresh(&self.storage, &HashMap::new(), BERLIN, at(FIRST))
            .await
            .unwrap();
        let series = self.bus.intern(role, index);
        let forecasts = self
            .storage
            .forecasts(INVERTER, series, at(FIRST), at(FIRST + 2 * DAY))
            .await
            .unwrap();
        forecasts
            .into_iter()
            .map(|f| (seconds(f.target), f.value))
            .collect()
    }

    /// Stores hourly means of `role` at `index` in the forecast's 1 W step: `measured` of each hour's modelled mean, the mean
    /// of the model at the hour's start and end.
    async fn measure(
        &self,
        role: &str,
        index: Option<u32>,
        modelled: &BTreeMap<u64, f64>,
        measured: impl Fn(f64) -> f64,
    ) {
        let series = self.bus.intern(role, index);
        let policy = Policy::new(
            RoleKind::Measurement,
            Some(Unit::Watt),
            1.0,
            Duration::from_secs(10),
        );
        self.storage
            .declare(INVERTER, series, policy)
            .await
            .unwrap();
        let mut points: Vec<ChangePoint> = hourly(modelled)
            .map(|(hour, mean)| ChangePoint {
                time: at(hour),
                value: Some(measured(mean)),
            })
            .collect();
        let end = at(FIRST + 2 * DAY - HOUR);
        points.push(ChangePoint {
            time: end,
            value: None,
        });
        self.storage
            .replace(
                INVERTER,
                series,
                at(FIRST)..end + Duration::from_secs(1),
                points,
            )
            .await
            .unwrap();
        // Hours are rolled up once the clock has passed them.
        self.storage.tick(at(NOW)).await.unwrap();
    }

    fn learner(&self, archive: FakeArchive) -> Learner<FakeArchive> {
        Learner::new(
            archive,
            WEATHER,
            self.layouts.clone(),
            &self.storage,
            &self.bus,
        )
    }
}

/// Each hour's start and its modelled mean, the mean of the model at its start and end.
fn hourly(modelled: &BTreeMap<u64, f64>) -> impl Iterator<Item = (u64, f64)> + '_ {
    modelled.iter().filter_map(|(&hour, &start)| {
        Some((hour, f64::midpoint(start, *modelled.get(&(hour + HOUR))?)))
    })
}

/// The plant-local hours of the cells learned for input 1, each with its ratio and weight.
async fn learned(learner: &Learner<FakeArchive>) -> Vec<(u8, u8, f64, f64)> {
    learner
        .grid(INVERTER, 1)
        .await
        .unwrap()
        .cells()
        .map(|(month, hour, cell)| (month, hour, cell.ratio, cell.weight))
        .collect()
}

#[tokio::test]
async fn an_input_learns_its_measured_share_of_the_model_by_plant_local_hour() {
    let plant = plant().await;
    let modelled = plant.modelled("pv.mppt.power", Some(1)).await;
    plant
        .measure("pv.mppt.power", Some(1), &modelled, |w| 0.8 * w)
        .await;
    // Ignored while the input is measured.
    plant
        .measure("pv.power", None, &modelled, |w| 0.5 * w)
        .await;
    let (archive, _calls) = FakeArchive::new(archive());
    let learner = plant.learner(archive);

    learner
        .learn(&plant.storage, BERLIN, &berlin(), at(NOW))
        .await
        .unwrap();

    let cells = learned(&learner).await;
    let hours: Vec<u8> = cells.iter().map(|c| c.1).collect();
    // From 06:00 to 19:00 Berlin summer time; earlier and later the model is under 3 % of
    // 6.4 kWp, and at noon over 85 %.
    assert!(hours.contains(&6) && hours.contains(&19), "{hours:?}");
    assert!(!hours.contains(&3) && !hours.contains(&22), "{hours:?}");
    let two_days = 1.0 + (-1.0f64 / 30.0).exp2();
    for (month, hour, ratio, weight) in cells {
        assert_eq!(month, 6);
        assert!((ratio - 0.8).abs() < 1e-2, "{hour}: {ratio}");
        assert!(
            (weight - 1.0).abs() < 1e-9 || (weight - two_days).abs() < 1e-9,
            "{hour}: {weight}"
        );
    }
}

#[tokio::test]
async fn an_input_without_its_own_power_learns_against_the_inverters() {
    let plant = plant().await;
    let modelled = plant.modelled("pv.power", None).await;
    plant
        .measure("pv.power", None, &modelled, |w| 0.7 * w)
        .await;
    let (archive, _calls) = FakeArchive::new(archive());
    let learner = plant.learner(archive);

    learner
        .learn(&plant.storage, BERLIN, &berlin(), at(NOW))
        .await
        .unwrap();

    let cells = learned(&learner).await;
    assert_ne!(cells, []);
    for (_, hour, ratio, _) in cells {
        assert!((ratio - 0.7).abs() < 1e-2, "{hour}: {ratio}");
    }
}

#[tokio::test]
async fn hours_with_the_inverter_at_its_ac_limit_are_skipped() {
    const LIMIT: f64 = 2000.0;
    let plant = plant().await;
    let modelled = plant.modelled("pv.mppt.power", Some(1)).await;
    plant
        .measure("pv.mppt.power", Some(1), &modelled, |w| 0.8 * w)
        .await;
    plant
        .measure("pv.power", None, &modelled, |w| (0.8 * w).min(LIMIT))
        .await;
    let (archive, _calls) = FakeArchive::new(archive());
    let learner = plant.learner(archive);

    learner
        .learn(&plant.storage, BERLIN, &berlin(), at(NOW))
        .await
        .unwrap();

    let local = |hour: u64| {
        let time = jiff::Timestamp::from_second(i64::try_from(hour).unwrap()).unwrap();
        u8::try_from(time.to_zoned(berlin()).hour()).unwrap()
    };
    // Each local hour's days: clipped, or clearly under the limit; none near the limit or 85 % of
    // nameplate, where either rule may skip it.
    let mut days: BTreeMap<u8, Vec<Option<bool>>> = BTreeMap::new();
    for (hour, mean) in hourly(&modelled) {
        let clipped = 0.8 * mean >= LIMIT && mean < 5000.0;
        let known = clipped || (300.0..2000.0).contains(&mean);
        days.entry(local(hour))
            .or_default()
            .push(known.then_some(clipped));
    }
    let weights: BTreeMap<u8, f64> = learned(&learner).await.iter().map(|c| (c.1, c.3)).collect();
    let mut checked = (0, 0);
    for (hour, days) in days {
        let Some(days) = days.into_iter().collect::<Option<Vec<bool>>>() else {
            continue;
        };
        match days.iter().filter(|clipped| !**clipped).count() {
            0 => {
                checked.0 += 1;
                assert!(!weights.contains_key(&hour), "{hour} learned");
            }
            1 => {
                checked.1 += 1;
                assert_eq!(weights.get(&hour), Some(&1.0), "{hour}: one day clipped");
            }
            _ => {}
        }
    }
    assert!(checked.0 > 0 && checked.1 > 0, "{checked:?}");
}

#[tokio::test]
async fn a_learned_day_is_not_fetched_again_and_an_unsettled_one_is_retried() {
    let plant = plant().await;
    let modelled = plant.modelled("pv.mppt.power", Some(1)).await;
    plant
        .measure("pv.mppt.power", Some(1), &modelled, |w| 0.8 * w)
        .await;
    let (archive, mut calls) = FakeArchive::new(archive());
    let learner = plant.learner(archive);
    let day = |d: u64| {
        let time = jiff::Timestamp::from_second(i64::try_from(FIRST + d * DAY).unwrap()).unwrap();
        time.to_zoned(TimeZone::UTC).date()
    };
    let learn = async |now: u64| {
        learner
            .learn(&plant.storage, BERLIN, &berlin(), at(now))
            .await
            .unwrap();
    };

    learn(NOW).await;
    learn(NOW).await;
    learn(NOW + DAY).await;
    learn(NOW + DAY).await;

    let mut asked = Vec::new();
    while let Ok((_, _, from, to)) = calls.try_recv() {
        asked.push((from, to));
    }
    // The first run reaches 90 days back; 2026-06-22 has no archive weather yet.
    let back = day(1).checked_sub(jiff::Span::new().days(90)).unwrap();
    assert_eq!(asked, [(back, day(1)), (day(2), day(2)), (day(2), day(2))]);
}

#[tokio::test(start_paused = true)]
async fn it_learns_once_the_plant_has_a_location_and_twice_a_day_from_then() {
    let plant = plant().await;
    let (archive, mut calls) = FakeArchive::new(Vec::new());
    let learner = plant.learner(archive);
    let (location, watched) = watch::channel(None);
    let (_zone, zone) = watch::channel(berlin());
    let start = Instant::now();
    let clock = move || at(NOW) + (Instant::now() - start);

    let mut seen = Vec::new();
    tokio::select! {
        () = learner.run(&plant.storage, watched, zone, clock) => panic!("the learner stopped"),
        () = async {
            tokio::time::sleep(Duration::from_hours(13)).await;
            location.send_replace(Some(BERLIN));
            for _ in 0..3 {
                seen.push(calls.recv().await.unwrap().0 - start);
            }
        } => {}
    }

    assert_eq!(
        seen,
        [
            Duration::from_hours(13),
            Duration::from_hours(25),
            Duration::from_hours(37)
        ]
    );
}
