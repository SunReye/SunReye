//! The plant device through the bus and storage, over a grid meter (device 2), the Deye's PV and
//! battery (device 1) and a heat pump meter (device 3).

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use sunreye_profile::Unit;
use tokio::sync::broadcast;

use super::{DEVICE, Plant};
use crate::bus::{Bus, DeviceId, Reading};
use crate::storage::{Aggregate, Storage, Tier};
use crate::topology::{Claim, PointDraft, Topologies};

/// 2026-06-21 00:00 UTC, an hour boundary.
const T0: u64 = 1_782_000_000;

fn at(seconds: u64) -> SystemTime {
    UNIX_EPOCH + Duration::from_secs(T0 + seconds)
}

fn draft(name: &str, parent: Option<usize>, device: u32, role: &str) -> PointDraft {
    PointDraft {
        id: None,
        name: name.to_owned(),
        parent,
        claims: vec![Claim {
            device,
            role: role.to_owned(),
        }],
    }
}

struct Site {
    _dir: tempfile::TempDir,
    bus: Bus,
    storage: Storage,
    topologies: Topologies,
    _plant: Plant,
    readings: broadcast::Receiver<Reading>,
}

/// Inside a Tokio runtime.
fn site() -> Site {
    let dir = tempfile::tempdir().unwrap();
    let bus = Bus::default();
    let storage = Storage::open(&dir.path().join("core.sqlite"), UNIX_EPOCH, "UTC", &bus).unwrap();
    let topologies = Topologies::new(storage.database());
    let plant = Plant::spawn(topologies.clone(), storage.declarer(), &bus);
    let readings = bus.subscribe();
    Site {
        _dir: dir,
        bus,
        storage,
        topologies,
        _plant: plant,
        readings,
    }
}

impl Site {
    /// Sets the points applying from `from` seconds after `T0`; returns their ids.
    async fn topology(&self, from: u64, points: Vec<PointDraft>) -> Vec<u32> {
        let version = self
            .topologies
            .change(at(from), points, &[1, 2, 3], at(0))
            .await
            .unwrap();
        version.points.iter().map(|p| p.id).collect()
    }

    /// Publishes the house's readings `seconds` after `T0`: 1200 W bought, 3000 W of PV, 800 W into
    /// the battery and 1500 W to the heat pump.
    fn measure(&self, seconds: u64) {
        let readings = [
            (2, "grid.power", 1200.0),
            (1, "pv.power", 3000.0),
            (1, "battery.power", 800.0),
            (3, "load.power", 1500.0),
        ];
        for (device, role, value) in readings {
            self.bus.publish(Reading {
                device: DeviceId(device),
                series: self.bus.intern(role, None),
                value,
                unit: Some(Unit::Watt),
                time: at(seconds),
            });
        }
    }

    /// Waits for the plant to publish `value` as `series` at `seconds` after `T0`.
    async fn published(&mut self, series: &str, value: f64, seconds: u64) {
        let wanted = crate::bus::Series::parse(series).unwrap();
        let bus = self.bus.clone();
        let matches = move |reading: &Reading| {
            reading.device == DEVICE
                && reading.time == at(seconds)
                && bus.series(reading.series) == Some(wanted.clone())
                && (reading.value - value).abs() < 1e-9
        };
        tokio::time::timeout(Duration::from_secs(5), async {
            while !matches(&self.readings.recv().await.unwrap()) {}
        })
        .await
        .unwrap_or_else(|_| panic!("the plant never published {series} = {value}"));
    }
}

fn house() -> Vec<PointDraft> {
    vec![
        draft("Grid", None, 2, "grid.power"),
        draft("PV", Some(0), 1, "pv.power"),
        draft("Battery", Some(0), 1, "battery.power"),
        draft("Heat pump", Some(0), 3, "load.power"),
    ]
}

#[tokio::test]
async fn the_plant_publishes_the_house_load_and_each_points_own_consumption() {
    let mut site = site();
    let ids = site.topology(0, house()).await;

    site.measure(0);

    // 1200 + 3000 − 800 W used: 1900 W the grid point leaves unmeasured, 1500 W the heat pump.
    site.published("load.power", 3400.0, 0).await;
    site.published(&format!("point.power[{}]", ids[0]), 1900.0, 0)
        .await;
    site.published(&format!("point.power[{}]", ids[3]), 1500.0, 0)
        .await;
}

#[tokio::test]
async fn a_topology_change_applies_from_its_date() {
    let mut site = site();
    let mut before = house();
    before.pop();
    let first = site.topology(0, before).await;
    let mut after = house();
    for (point, id) in after.iter_mut().zip(&first) {
        point.id = Some(*id);
    }
    site.topology(3600, after).await;

    // Without the heat pump's point, its 1500 W is the grid point's own.
    site.measure(0);
    site.published(&format!("point.power[{}]", first[0]), 3400.0, 0)
        .await;
    site.measure(3600);
    site.published(&format!("point.power[{}]", first[0]), 1900.0, 3600)
        .await;
}

#[tokio::test]
async fn the_plants_aggregates_are_stored_and_rolled_up() {
    let mut site = site();
    site.topology(0, house()).await;

    // Every 10 s for an hour, and once into the next, so the hour closes.
    for seconds in (0..=3600).step_by(10) {
        site.measure(seconds);
        site.published("load.power", 3400.0, seconds).await;
        // Paced by storage, so the readings never outrun the bus it hears them on.
        site.storage.problems().await.unwrap();
    }

    let load = site.bus.intern("load.power", None);
    // Storage hears the bus on its own task: asked until the readings at 3600 s close the hour.
    let ask = || {
        site.storage
            .rollups(DEVICE, load, Tier::Hour, at(0)..at(3600))
    };
    let rollup = tokio::time::timeout(Duration::from_secs(5), async {
        let mut rollups = ask().await.unwrap();
        while rollups.is_empty() {
            tokio::task::yield_now().await;
            rollups = ask().await.unwrap();
        }
        rollups
    })
    .await
    .unwrap();
    let [rollup] = rollup[..] else {
        panic!("{rollup:?}");
    };
    // 3400 W held for the whole hour: 3400 Wh.
    let Aggregate::Measurement { mean, integral, .. } = rollup.aggregate else {
        panic!("{rollup:?}");
    };
    assert_eq!((mean, integral), (3400.0, 3400.0));
}
