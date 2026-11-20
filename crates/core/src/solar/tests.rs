//! The solar forecast from stored weather and the layout, against pvlib 0.16.1's run of the
//! owner's layout (`crates/pv/fixtures/estimate.csv`, the 2026-06-21 11:00 UTC row).

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use sunreye_profile::{RoleKind, Unit};
use sunreye_pv::{Block, GridModule, ModuleGrid, Obstacle, Overhang, Roof, Scene, Spot};
use tokio::sync::watch;

use super::SolarForecast;
use crate::bus::{Bus, DeviceId};
use crate::correction::{Cell as Learned, Grid};
use crate::layout::{Datasheet, Inverters, Layouts, StringDraft, Wiring};
use crate::location::Location;
use crate::profiles::{Catalogue, Chosen};
use crate::storage::{Issue, Keep, Policy, Storage};

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
            keep: Keep::Ahead,
        };
        storage
            .forecast(WEATHER, bus.intern(role, None), issue)
            .await
            .unwrap();
    }
}

/// Berlin, the owner's Deye as device 1, and the fixture's noon weather at `targets`.
async fn plant(targets: &[u64]) -> Plant {
    plant_of(targets, None).await
}

/// [`plant`] with the Deye family's `variant`, or its base.
async fn plant_of(targets: &[u64], variant: Option<&str>) -> Plant {
    plant_with(targets, "deye-sg05lp3", variant).await
}

/// [`plant`] with the bundled `family`'s `variant`, or its base, as device 1.
async fn plant_with(targets: &[u64], family: &str, variant: Option<&str>) -> Plant {
    let dir = tempfile::tempdir().unwrap();
    let bus = Bus::default();
    let storage = Storage::open(
        &dir.path().join("core.sqlite"),
        UNIX_EPOCH,
        "Europe/Berlin",
        &bus,
    )
    .unwrap();
    store_weather(&storage, &bus, targets).await;
    let chosen = Chosen::new(family, variant);
    let deye = Catalogue::bundled().unwrap().resolve(&chosen).unwrap();
    let inverters: Inverters = std::iter::once((INVERTER, deye)).collect();
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
        .refresh(&plant.storage, &HashMap::new(), BERLIN, at(NOON - HOUR))
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

/// A clock reads sub-seconds; the issue still covers its own hour from its first second (ADR 15).
#[tokio::test]
async fn an_issue_mid_hour_covers_its_hour_from_the_top() {
    let plant = plant(&[NOON, NOON + 900]).await;
    plant
        .layouts
        .change(at(0), vec![plant.string(None, 1, 0.0, 16)], None, at(0))
        .await
        .unwrap();
    let forecast = SolarForecast::new(plant.layouts.clone(), WEATHER, &plant.bus);

    let issued = at(NOON + 41 * 60) + Duration::from_millis(400);
    forecast
        .refresh(&plant.storage, &HashMap::new(), BERLIN, issued)
        .await
        .unwrap();

    let power = plant.forecast("pv.power", None, &[NOON, NOON + 900]).await;
    assert!(power.iter().all(|w| *w > 0.0), "{power:?}");
}

/// A series storage refuses, here one stored in another step, loses its forecast alone.
#[tokio::test]
async fn a_refused_series_leaves_the_others_forecast() {
    let plant = plant(&[NOON]).await;
    let layout = plant
        .layouts
        .change(
            at(0),
            vec![
                plant.string(None, 1, 0.0, 16),
                plant.string(None, 2, 0.0, 14),
            ],
            None,
            at(0),
        )
        .await
        .unwrap();
    let first = plant.bus.intern("pv.mppt.power", Some(1));
    let other = Policy::new(
        RoleKind::Measurement,
        Some(Unit::Watt),
        2.0,
        Duration::from_secs(10),
    );
    plant.storage.declare(INVERTER, first, other).await.unwrap();
    let forecast = SolarForecast::new(plant.layouts.clone(), WEATHER, &plant.bus);

    forecast
        .refresh(&plant.storage, &HashMap::new(), BERLIN, at(NOON - HOUR))
        .await
        .unwrap();

    assert!(plant.forecast("pv.mppt.power", Some(1), &[NOON]).await[0].is_nan());
    let id = layout.strings[1].id;
    for (role, index) in [
        ("pv.mppt.power", Some(2)),
        ("pv.power", None),
        ("pv.string.power", Some(id)),
    ] {
        let value = plant.forecast(role, index, &[NOON]).await[0];
        assert!(value > 0.0, "{role} {index:?}: {value}");
    }
}

/// The SG01HP3 stores its inputs' power in 10 W steps, and its total in theirs: each series is
/// forecast in the step its profile stores it in, since its history and forecast share one.
#[tokio::test]
async fn each_series_is_forecast_in_the_step_its_profile_stores_it_in() {
    let plant = plant_with(&[NOON], "deye-sg01hp3", None).await;
    let layout = plant
        .layouts
        .change(
            at(0),
            vec![
                plant.string(None, 1, 0.0, 16),
                plant.string(None, 2, 0.0, 14),
            ],
            None,
            at(0),
        )
        .await
        .unwrap();
    // As the device declares them on start, before any forecast.
    let profile = plant.layouts.inverters().profile(INVERTER).unwrap();
    for q in profile
        .quantities()
        .iter()
        .filter(|q| q.role.starts_with("pv."))
    {
        let cadence = q.cadence(crate::endpoint::CADENCE);
        let policy = Policy::new(q.kind(), q.unit(), q.step(), cadence);
        let series = plant.bus.intern(&q.role, q.index);
        plant
            .storage
            .declare(INVERTER, series, policy)
            .await
            .unwrap();
    }
    let forecast = SolarForecast::new(plant.layouts.clone(), WEATHER, &plant.bus);

    forecast
        .refresh(&plant.storage, &HashMap::new(), BERLIN, at(NOON - HOUR))
        .await
        .unwrap();

    for (role, index) in [
        ("pv.mppt.power", Some(1)),
        ("pv.mppt.power", Some(2)),
        ("pv.power", None),
    ] {
        let value = plant.forecast(role, index, &[NOON]).await[0];
        assert!(
            value > 0.0 && value % 10.0 == 0.0,
            "{role} {index:?}: {value}"
        );
    }
    let id = layout.strings[0].id;
    let string = plant.forecast("pv.string.power", Some(id), &[NOON]).await[0];
    assert!(string > 0.0, "string: {string}");
}

/// The inverter is capped at its variant's AC rating (ADR 5, 17): the SUN-5K's 5 kW, not the
/// family's 20 kW.
#[tokio::test]
async fn the_inverter_forecast_is_capped_at_its_variants_ac_rating() {
    let plant = plant_of(&[NOON], Some("5k")).await;
    plant
        .layouts
        .change(
            at(0),
            vec![
                plant.string(None, 1, 180.0, 16),
                plant.string(None, 2, 180.0, 14),
            ],
            None,
            at(0),
        )
        .await
        .unwrap();
    let forecast = SolarForecast::new(plant.layouts.clone(), WEATHER, &plant.bus);

    forecast
        .refresh(&plant.storage, &HashMap::new(), BERLIN, at(NOON - HOUR))
        .await
        .unwrap();

    let inverter = plant.forecast("pv.power", None, &[NOON]).await[0];
    assert_near(inverter, 5000.0, "inverter");
}

/// The forecast of input 1, input 2 and the inverter at noon, for 16 and 14 modules facing one
/// way on the Deye family's `variant` with `grids` learned.
async fn two_inputs(variant: Option<&str>, grids: &HashMap<(DeviceId, u32), Grid>) -> [f64; 3] {
    let plant = plant_of(&[NOON], variant).await;
    plant
        .layouts
        .change(
            at(0),
            vec![
                plant.string(None, 1, 0.0, 16),
                plant.string(None, 2, 0.0, 14),
            ],
            None,
            at(0),
        )
        .await
        .unwrap();
    let forecast = SolarForecast::new(plant.layouts.clone(), WEATHER, &plant.bus);
    forecast
        .refresh(&plant.storage, grids, BERLIN, at(NOON - HOUR))
        .await
        .unwrap();
    let mut values = [0.0; 3];
    for (value, (role, index)) in values.iter_mut().zip([
        ("pv.mppt.power", Some(1)),
        ("pv.mppt.power", Some(2)),
        ("pv.power", None),
    ]) {
        *value = plant.forecast(role, index, &[NOON]).await[0];
    }
    values
}

/// A capped inverter's inputs are scaled with it (ADR 17), keeping their shares, so they still
/// sum to it. The family's 20 kW base caps nothing, so it gives the shares.
#[tokio::test]
async fn a_capped_inverters_inputs_keep_their_shares_and_sum_to_its_ac_rating() {
    let [first, second, uncapped] = two_inputs(None, &HashMap::new()).await;
    assert!(uncapped > 10_000.0, "{uncapped}");

    let [capped_first, capped_second, inverter] = two_inputs(Some("5k"), &HashMap::new()).await;

    assert_near(inverter, 5000.0, "inverter");
    assert_near(capped_first, first * 5000.0 / uncapped, "input 1");
    assert_near(capped_second, second * 5000.0 / uncapped, "input 2");
}

/// A string alone on its input is forecast as its input, capped or not.
#[tokio::test]
async fn a_capped_inputs_string_is_scaled_with_it() {
    let plant = plant_of(&[NOON], Some("5k")).await;
    let layout = plant
        .layouts
        .change(at(0), vec![plant.string(None, 1, 0.0, 16)], None, at(0))
        .await
        .unwrap();
    let forecast = SolarForecast::new(plant.layouts.clone(), WEATHER, &plant.bus);

    forecast
        .refresh(&plant.storage, &HashMap::new(), BERLIN, at(NOON - HOUR))
        .await
        .unwrap();

    let id = layout.strings[0].id;
    let string = plant.forecast("pv.string.power", Some(id), &[NOON]).await[0];
    assert_near(string, 5000.0, "string");
}

/// The cap follows the learned factors: an input's factor moves its share of the capped total,
/// not the total.
#[tokio::test]
async fn the_ac_rating_caps_the_corrected_inputs() {
    let [first, second, _] = two_inputs(None, &HashMap::new()).await;
    // Noon UTC is 13:00 in Berlin's summer; 1 + (0.8 − 1) × 5 / (5 + 5) = 0.9.
    let mut grid = Grid::default();
    grid.set(
        6,
        13,
        Learned {
            ratio: 0.8,
            weight: 5.0,
        },
    );
    let grids: HashMap<_, _> = [((INVERTER, 1), grid)].into();

    let [capped_first, capped_second, inverter] = two_inputs(Some("5k"), &grids).await;

    let corrected = 0.9 * first;
    let share = 5000.0 / (corrected + second);
    assert_near(inverter, 5000.0, "inverter");
    assert_near(capped_first, corrected * share, "input 1");
    assert_near(capped_second, second * share, "input 2");
}

#[tokio::test]
async fn each_inputs_learned_factor_scales_it_and_its_strings_at_the_plant_local_hour() {
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
    // Noon UTC is 13:00 in Berlin's summer. Ratio 1.5 over 5 hours shrinks to
    // 1 + 0.5 × 5 / (5 + 5) = 1.25; the UTC hour's 0.5 would give 0.75.
    let mut grid = Grid::default();
    grid.set(
        6,
        13,
        Learned {
            ratio: 1.5,
            weight: 5.0,
        },
    );
    grid.set(
        6,
        11,
        Learned {
            ratio: 0.5,
            weight: 5.0,
        },
    );
    let learned = HashMap::from([((INVERTER, 1), grid)]);
    let forecast = SolarForecast::new(plant.layouts.clone(), WEATHER, &plant.bus);

    forecast
        .refresh(&plant.storage, &learned, BERLIN, at(NOON - HOUR))
        .await
        .unwrap();

    let string = async |i: usize| {
        let id = layout.strings[i].id;
        plant.forecast("pv.string.power", Some(id), &[NOON]).await[0]
    };
    let input = async |n| plant.forecast("pv.mppt.power", Some(n), &[NOON]).await[0];
    // pvlib's 5713.54 W, 2725.72 W and 8439.27 W × 1.25; input 2 learned nothing.
    assert_near(string(0).await, 7141.93, "south");
    assert_near(string(1).await, 3407.15, "north");
    assert_near(input(1).await, 10_549.09, "input 1");
    assert_near(string(2).await, 5005.27, "second south");
    assert_near(input(2).await, 5005.27, "input 2");
    // 10549.09 + 5005.27.
    let inverter = plant.forecast("pv.power", None, &[NOON]).await[0];
    assert_near(inverter, 15_554.36, "inverter");
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
        .refresh(&plant.storage, &HashMap::new(), BERLIN, at(NOON - HOUR))
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
        .refresh(&plant.storage, &HashMap::new(), BERLIN, at(NOON - HOUR))
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
        (0..8).map(move |column| GridModule {
            spot: Spot::Cell { row, column },
            string: Some(column / 4),
            optimized: false,
            order: None,
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
            open: false,
            overhang: Overhang::default(),
            roof_colour: None,
            wall_colour: None,
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
        car_places: vec![],
        chimneys: vec![],
        surfaces: vec![],
        fences: vec![],
        openings: vec![],
        roof_windows: vec![],
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
        .refresh(&plant.storage, &HashMap::new(), BERLIN, at(NOON - HOUR))
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

/// Issue times a second apart from an hour before noon, one per call, counted in `calls`.
fn ticking(calls: Arc<AtomicU64>) -> impl Fn() -> SystemTime + Sync {
    move || at(NOON - HOUR + calls.fetch_add(1, Ordering::Relaxed))
}

/// Waits until `calls` reaches `count`: each issue reads the clock once.
async fn issued(calls: &AtomicU64, count: u64) {
    let wait = async {
        while calls.load(Ordering::Relaxed) < count {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    };
    tokio::time::timeout(Duration::from_secs(10), wait)
        .await
        .unwrap();
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
    let learned = HashMap::new();

    let calls = Arc::new(AtomicU64::new(0));

    let check = async {
        issued(&calls, 1).await;
        weather.send_replace(Some(at(NOON - HOUR)));
        issued(&calls, 2).await;
        let kept = plant.string(Some(layout.strings[0].id), 2, 0.0, 16);
        plant
            .layouts
            .change(at(0), vec![kept], None, at(0))
            .await
            .unwrap();
        issued(&calls, 3).await;
    };
    tokio::select! {
        () = forecast.run((&plant.storage, &learned), berlin, issues, ticking(Arc::clone(&calls))) => panic!("it stopped"),
        () = check => {}
    }
}

/// Counts each turn the I/O thread gives it, forever.
async fn count(turns: Arc<AtomicU64>) {
    loop {
        turns.fetch_add(1, Ordering::Relaxed);
        tokio::task::yield_now().await;
    }
}

#[tokio::test]
async fn the_model_leaves_the_io_thread_free_while_it_runs() {
    // ADR 2: on the one I/O thread a model run would stall polling and every request.
    let plant = plant(&[NOON]).await;
    plant
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
    let versions = plant.layouts.versions().await.unwrap();
    let noon = sunreye_pv::Weather {
        unix: i64::try_from(NOON).unwrap(),
        ghi: 880.0,
        dni: 800.0,
        dhi: 150.0,
        temperature: 25.0,
        wind: Some(3.0),
    };
    let weather = (0..200).map(|_| (at(NOON), noon)).collect();
    let turns = Arc::new(AtomicU64::new(0));
    let spinning = tokio::spawn(count(Arc::clone(&turns)));

    let modelled = super::estimates(&plant.layouts, &versions, BERLIN, weather)
        .await
        .unwrap();
    spinning.abort();

    assert_eq!(modelled.len(), 200);
    let ran = turns.load(Ordering::Relaxed);
    // Inline, the model let the other task run 17 times; off the thread, hundreds of thousands.
    assert!(
        ran > 1_000,
        "the I/O thread ran {ran} other polls during the model"
    );
}
