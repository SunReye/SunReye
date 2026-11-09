//! The solar forecast from stored weather and the layout, against pvlib 0.16.1's run of the
//! owner's layout (`crates/pv/fixtures/estimate.csv`, the 2026-06-21 11:00 UTC row).

use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use sunreye_profile::Profile;
use sunreye_pv::{Block, Cell, ModuleGrid, Obstacle, Roof, Scene};
use tokio::sync::watch;

use super::SolarForecast;
use crate::bus::{Bus, DeviceId};
use crate::layout::{Datasheet, Inverters, Layouts, StringDraft, Wiring};
use crate::location::Location;
use crate::storage::{Issue, Storage};

const INVERTER: DeviceId = DeviceId(1);
const WEATHER: DeviceId = DeviceId(3);
/// 2026-06-21 11:00 UTC.
const NOON: u64 = 1_782_039_600;
const HOUR: u64 = 3600;
const BERLIN: Location = Location {
    latitude: 52.52,
    longitude: 13.38,
};

fn at(seconds: u64) -> SystemTime {
    UNIX_EPOCH + Duration::from_secs(seconds)
}

struct Plant {
    _dir: tempfile::TempDir,
    bus: Bus,
    storage: Storage,
    layouts: Layouts,
    module_type: u32,
}

/// The fixture's noon weather at each of `targets`.
async fn store_weather(storage: &Storage, bus: &Bus, targets: &[u64]) {
    let weather = [
        ("weather.ghi", 880.0),
        ("weather.dni", 800.0),
        ("weather.dhi", 150.0),
        ("weather.temperature", 25.0),
        ("weather.wind", 3.0),
    ];
    for (role, value) in weather {
        let issue = Issue {
            issued: at(NOON - HOUR),
            step: 0.01,
            values: targets.iter().map(|t| (at(*t), value)).collect(),
        };
        storage
            .forecast(WEATHER, bus.intern(role, None), issue)
            .await
            .unwrap();
    }
}

/// Berlin, the owner's Deye as device 1, and the fixture's noon weather at `targets`.
async fn plant(targets: &[u64]) -> Plant {
    let dir = tempfile::tempdir().unwrap();
    let bus = Bus::default();
    let storage = Storage::open(&dir.path().join("core.sqlite"), UNIX_EPOCH, "UTC", &bus).unwrap();
    store_weather(&storage, &bus, targets).await;
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
    Plant {
        _dir: dir,
        bus,
        storage,
        layouts,
        module_type,
    }
}

impl Plant {
    fn string(&self, id: Option<u32>, input: u32, azimuth: f64, modules: u16) -> StringDraft {
        StringDraft {
            id,
            wiring: Wiring {
                name: format!("{input} {azimuth}"),
                module_type: self.module_type,
                device: INVERTER.0,
                input,
                modules,
                optimized: 0,
                tilt: 35.0,
                azimuth,
                loss: 2.0,
            },
        }
    }

    /// The latest forecast of `series` at each target, in watts.
    async fn forecast(&self, role: &str, index: Option<u32>, targets: &[u64]) -> Vec<f64> {
        let series = self.bus.intern(role, index);
        let stored = self
            .storage
            .forecasts(
                INVERTER,
                series,
                at(targets[0]),
                at(targets[targets.len() - 1] + 1),
            )
            .await
            .unwrap();
        targets
            .iter()
            .map(|t| {
                stored
                    .iter()
                    .rfind(|f| f.target == at(*t))
                    .map_or(f64::NAN, |f| f.value)
            })
            .collect()
    }
}

/// Within 0.1 % of pvlib, as the sun position allows, and the 1 W storage step.
fn assert_near(actual: f64, expected: f64, what: &str) {
    assert!(
        (actual - expected).abs() <= 1e-3f64.mul_add(expected.abs(), 1.0),
        "{what}: {actual} != pvlib {expected}"
    );
}

#[tokio::test]
async fn the_owners_strings_inputs_and_inverter_are_forecast() {
    let plant = plant(&[NOON]).await;
    let layout = plant
        .layouts
        .change(
            at(0),
            vec![
                plant.string(None, 1, 0.0, 16),
                plant.string(None, 1, 180.0, 16),
                plant.string(None, 2, 0.0, 14),
            ],
            None,
            at(0),
        )
        .await
        .unwrap();
    let forecast = SolarForecast::new(plant.layouts.clone(), WEATHER, &plant.bus);

    forecast
        .refresh(&plant.storage, BERLIN, at(NOON - HOUR))
        .await
        .unwrap();

    let string = async |i: usize| {
        let id = layout.strings[i].id;
        plant.forecast("pv.string.power", Some(id), &[NOON]).await[0]
    };
    let (south, north, second) = (string(0).await, string(1).await, string(2).await);
    let input = async |n| plant.forecast("pv.mppt.power", Some(n), &[NOON]).await[0];
    // pvlib: south 5713.54 W and north 2725.72 W in parallel; second south 5005.27 W alone.
    assert_near(input(1).await, 8439.27, "input 1");
    assert_near(south, 5713.54, "south");
    assert_near(north, 2725.72, "north");
    assert_near(second, 5005.27, "second south");
    assert_near(input(2).await, 5005.27, "input 2");
    let inverter = plant.forecast("pv.power", None, &[NOON]).await[0];
    assert_near(inverter, 13_444.54, "inverter");
}

#[tokio::test]
async fn a_layout_change_applies_from_its_date() {
    let targets = [NOON, NOON + HOUR];
    let plant = plant(&targets).await;
    let before = plant
        .layouts
        .change(at(0), vec![plant.string(None, 1, 0.0, 16)], None, at(0))
        .await
        .unwrap();
    let after = plant
        .layouts
        .change(
            at(NOON + HOUR),
            vec![plant.string(None, 2, 0.0, 14)],
            None,
            at(0),
        )
        .await
        .unwrap();
    let forecast = SolarForecast::new(plant.layouts.clone(), WEATHER, &plant.bus);

    forecast
        .refresh(&plant.storage, BERLIN, at(NOON - HOUR))
        .await
        .unwrap();

    let removed = before.strings[0].id;
    let added = after.strings[0].id;
    let old = plant
        .forecast("pv.string.power", Some(removed), &targets)
        .await;
    let new = plant
        .forecast("pv.string.power", Some(added), &targets)
        .await;
    assert!(
        old[0] > 0.0 && new[0].abs() < f64::EPSILON,
        "noon: {old:?} {new:?}"
    );
    assert!(
        old[1].abs() < f64::EPSILON && new[1] > 0.0,
        "an hour on: {old:?} {new:?}"
    );
}

#[tokio::test]
async fn a_form_entered_strings_optimizers_reach_the_model() {
    let plant = plant(&[NOON]).await;
    let optimized = StringDraft {
        wiring: Wiring {
            optimized: 16,
            ..plant.string(None, 2, 0.0, 16).wiring
        },
        ..plant.string(None, 2, 0.0, 16)
    };
    let layout = plant
        .layouts
        .change(
            at(0),
            vec![plant.string(None, 1, 0.0, 16), optimized],
            None,
            at(0),
        )
        .await
        .unwrap();
    let forecast = SolarForecast::new(plant.layouts.clone(), WEATHER, &plant.bus);

    forecast
        .refresh(&plant.storage, BERLIN, at(NOON - HOUR))
        .await
        .unwrap();

    let power = async |i: usize| {
        let id = layout.strings[i].id;
        plant.forecast("pv.string.power", Some(id), &[NOON]).await[0]
    };
    let (plain, optimized) = (power(0).await, power(1).await);
    // Equal modules in one sun: each optimizer delivers its module's own peak less 1 %.
    assert_near(optimized, 0.99 * plain, "optimized");
}

/// A 10 m × 8 m gable house at 35°: on its south face, string 0 fills the left four columns
/// and string 1 the right four, behind a 15 m wall 1 m in front of the left half.
fn walled_house(module_type: u32) -> Scene {
    let cells = (0..2).flat_map(|row| {
        (0..8).map(move |column| Cell {
            row,
            column,
            string: Some(column / 4),
            optimized: false,
        })
    });
    Scene {
        north: 0.0,
        blocks: vec![Block {
            x: 0.0,
            z: 0.0,
            width: 10.0,
            depth: 8.0,
            eave: 3.0,
            rotation: 0.0,
            roof: Roof::Gable { pitch: 35.0 },
        }],
        obstacles: vec![Obstacle::Box {
            x: -3.0,
            z: 9.0,
            width: 7.9,
            depth: 0.3,
            height: 15.0,
            rotation: 0.0,
        }],
        grids: vec![ModuleGrid {
            block: 0,
            face: 1,
            module_type,
            landscape: false,
            setback: 0.3,
            modules: cells.collect(),
        }],
        equipment: vec![],
    }
}

#[tokio::test]
async fn a_saved_scene_places_the_modules_and_its_obstacles_shade_the_forecast() {
    let plant = plant(&[NOON]).await;
    // The scene decides the module counts and planes, whatever the drafts say.
    let layout = plant
        .layouts
        .change(
            at(0),
            vec![
                plant.string(None, 1, 90.0, 1),
                plant.string(None, 2, 90.0, 1),
            ],
            Some(walled_house(plant.module_type)),
            at(0),
        )
        .await
        .unwrap();
    let forecast = SolarForecast::new(plant.layouts.clone(), WEATHER, &plant.bus);

    forecast
        .refresh(&plant.storage, BERLIN, at(NOON - HOUR))
        .await
        .unwrap();

    let power = async |i: usize| {
        let id = layout.strings[i].id;
        plant.forecast("pv.string.power", Some(id), &[NOON]).await[0]
    };
    let (walled, open) = (power(0).await, power(1).await);
    assert!(open > 2000.0, "eight modules in the noon sun: {open} W");
    // Behind the wall only diffuse light is left.
    assert!(walled < 0.4 * open, "walled {walled} W, open {open} W");
}

impl Plant {
    /// Waits until the inverter's `pv.power` at noon has `count` issues; returns their times.
    async fn issues(&self, count: usize) -> Vec<SystemTime> {
        let series = self.bus.intern("pv.power", None);
        let read = async || {
            self.storage
                .forecasts(INVERTER, series, at(NOON), at(NOON + 1))
                .await
                .unwrap()
        };
        let wait = async {
            let mut stored = read().await;
            while stored.len() < count {
                tokio::time::sleep(Duration::from_millis(10)).await;
                stored = read().await;
            }
            stored
        };
        let stored = tokio::time::timeout(Duration::from_secs(10), wait)
            .await
            .unwrap();
        stored.iter().map(|f| f.issued).collect()
    }
}

/// Issue times a second apart from an hour before noon, one per call.
fn ticking() -> impl Fn() -> SystemTime + Sync {
    let calls = AtomicU64::new(0);
    move || at(NOON - HOUR + calls.fetch_add(1, Ordering::Relaxed))
}

#[tokio::test]
async fn it_issues_on_start_after_each_weather_issue_and_after_a_layout_change() {
    let plant = plant(&[NOON]).await;
    let drafts = vec![plant.string(None, 1, 0.0, 16)];
    let layout = plant
        .layouts
        .change(at(0), drafts, None, at(0))
        .await
        .unwrap();
    let forecast = SolarForecast::new(plant.layouts.clone(), WEATHER, &plant.bus);
    let (_location, berlin) = watch::channel(Some(BERLIN));
    let (weather, issues) = watch::channel(None);

    let check = async {
        assert_eq!(plant.issues(1).await, [at(NOON - HOUR)]);
        weather.send_replace(Some(at(NOON - HOUR)));
        assert_eq!(plant.issues(2).await.len(), 2);
        let kept = plant.string(Some(layout.strings[0].id), 2, 0.0, 16);
        plant
            .layouts
            .change(at(0), vec![kept], None, at(0))
            .await
            .unwrap();
        assert_eq!(plant.issues(3).await.len(), 3);
    };
    tokio::select! {
        () = forecast.run(&plant.storage, berlin, issues, ticking()) => panic!("it stopped"),
        () = check => {}
    }
}
