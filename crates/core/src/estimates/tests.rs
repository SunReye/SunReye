//! Parallel-string estimates through the bus, against pvlib 0.16.1's run of the owner's layout
//! (`crates/pv/fixtures/estimate.csv`, the 2026-06-21 11:00 UTC row): south 5713.54 W and north
//! 2725.72 W in parallel on input 1, stored here as the solar forecast stores them, in 1 W steps.

use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use sunreye_profile::Profile;
use tokio::sync::broadcast;

use super::StringEstimates;
use crate::bus::{Bus, DeviceId, Reading};
use crate::layout::{Datasheet, Inverters, Layouts, StringDraft, Wiring};
use crate::storage::{Issue, Storage};

const INVERTER: DeviceId = DeviceId(1);
/// 2026-06-21 11:00 UTC.
const NOON: u64 = 1_782_039_600;

fn at(seconds: u64) -> SystemTime {
    UNIX_EPOCH + Duration::from_secs(seconds)
}

struct Plant {
    _dir: tempfile::TempDir,
    bus: Bus,
    storage: Storage,
    _estimates: StringEstimates,
    /// The ids of the south and north strings on input 1, and the south string alone on input 2.
    south: u32,
    north: u32,
    second: u32,
}

/// A 400 W module, as in the pvlib fixture.
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

/// The owner's layout on the Deye as device 1, with the estimates running.
async fn plant() -> Plant {
    let dir = tempfile::tempdir().unwrap();
    let bus = Bus::default();
    let storage = Storage::open(&dir.path().join("core.sqlite"), UNIX_EPOCH, "UTC", &bus).unwrap();
    let deye = Profile::load(include_str!("../../../../profiles/deye-sg05lp3.json")).unwrap();
    let inverters: Inverters = std::iter::once((INVERTER, Arc::new(deye))).collect();
    let layouts = Layouts::new(storage.database(), inverters);
    let module_type = layouts.add_module_type(datasheet()).await.unwrap().id;
    let string = |input, azimuth, modules| StringDraft {
        id: None,
        wiring: Wiring {
            name: format!("{input} {azimuth}"),
            module_type,
            device: INVERTER.0,
            input,
            modules,
            optimized: 0,
            tilt: 35.0,
            azimuth,
            loss: 2.0,
        },
    };
    let version = layouts
        .change(
            at(0),
            vec![string(1, 0.0, 16), string(1, 180.0, 16), string(2, 0.0, 14)],
            None,
            at(0),
        )
        .await
        .unwrap();
    let id = |i: usize| version.strings[i].id;
    let estimates = StringEstimates::spawn(layouts, storage.reader(), storage.declarer(), &bus);
    Plant {
        _dir: dir,
        bus,
        storage,
        _estimates: estimates,
        south: id(0),
        north: id(1),
        second: id(2),
    }
}

impl Plant {
    /// Stores the solar forecast of string `id` at noon, in its 1 W step: the forecast and the
    /// history of a series share it.
    async fn forecast(&self, id: u32, watts: f64) {
        let issue = Issue {
            issued: at(NOON - 3600),
            step: 1.0,
            values: vec![(at(NOON), watts)],
        };
        self.storage
            .forecast(
                INVERTER,
                self.bus.intern("pv.string.power", Some(id)),
                issue,
            )
            .await
            .unwrap();
    }

    /// Publishes the inverter's measured power of `input` at `time`.
    fn measure(&self, input: u32, watts: f64, time: u64) {
        self.bus.publish(Reading {
            device: INVERTER,
            series: self.bus.intern("pv.mppt.power", Some(input)),
            value: watts,
            unit: Some(sunreye_profile::Unit::Watt),
            time: at(time),
            cadence: crate::endpoint::CADENCE,
        });
    }
}

/// The next `pv.string.power` value of each of `ids` the bus carries.
async fn estimates(
    bus: &Bus,
    readings: &mut broadcast::Receiver<Reading>,
    ids: &[u32],
) -> Vec<f64> {
    let mut found = vec![None; ids.len()];
    tokio::time::timeout(Duration::from_secs(5), async {
        while found.iter().any(Option::is_none) {
            let reading = readings.recv().await.unwrap();
            let series = bus.series(reading.series).unwrap();
            if reading.device != INVERTER || series.role != "pv.string.power" {
                continue;
            }
            if let Some(i) = ids.iter().position(|id| series.index == Some(*id)) {
                found[i] = Some(reading.value);
            }
        }
    })
    .await
    .unwrap();
    found.into_iter().map(Option::unwrap).collect()
}

fn assert_near(actual: f64, expected: f64, what: &str) {
    assert!(
        (actual - expected).abs() <= 0.01,
        "{what}: {actual} != {expected}"
    );
}

#[tokio::test]
async fn parallel_strings_split_the_measured_power_by_modelled_current() {
    let plant = plant().await;
    plant.forecast(plant.south, 5714.0).await;
    plant.forecast(plant.north, 2726.0).await;
    let mut readings = plant.bus.subscribe();

    plant.measure(1, 6000.0, NOON);

    let split = estimates(&plant.bus, &mut readings, &[plant.south, plant.north]).await;
    // 6000 W × 5714 / (5714 + 2726), and the rest.
    assert_near(split[0], 4062.09, "south");
    assert_near(split[1], 1937.91, "north");
    assert_near(split[0] + split[1], 6000.0, "sum");
}

#[tokio::test]
async fn a_string_alone_on_its_input_is_reported_as_measured() {
    let plant = plant().await;
    let mut readings = plant.bus.subscribe();

    plant.measure(2, 4321.0, NOON);

    let alone = estimates(&plant.bus, &mut readings, &[plant.second]).await;
    assert_near(alone[0], 4321.0, "second south");
}

#[tokio::test]
async fn without_a_forecast_parallel_strings_share_equally() {
    let plant = plant().await;
    let mut readings = plant.bus.subscribe();

    plant.measure(1, 6000.0, NOON);

    let split = estimates(&plant.bus, &mut readings, &[plant.south, plant.north]).await;
    assert_near(split[0], 3000.0, "south");
    assert_near(split[1], 3000.0, "north");
}

#[tokio::test]
async fn estimates_are_stored_as_string_power_history() {
    let plant = plant().await;
    plant.forecast(plant.south, 5714.0).await;
    plant.forecast(plant.north, 2726.0).await;
    let mut readings = plant.bus.subscribe();
    plant.measure(1, 6000.0, NOON);
    estimates(&plant.bus, &mut readings, &[plant.south, plant.north]).await;

    // A reading in the next minute closes the first.
    plant.measure(1, 6000.0, NOON + 60);
    estimates(&plant.bus, &mut readings, &[plant.south, plant.north]).await;
    plant.storage.tick(at(NOON + 60)).await.unwrap();

    let series = plant.bus.intern("pv.string.power", Some(plant.north));
    let stored = plant
        .storage
        .history(INVERTER, series, at(NOON), at(NOON + 60))
        .await
        .unwrap();
    // 1937.91 W in the 1 W step.
    assert_eq!(stored.first().and_then(|p| p.value), Some(1938.0));
}
