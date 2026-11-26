//! One layout version per date it applies from (ADR 17).

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use super::{Datasheet, Draft, Inverters, Layouts, StringDraft, Types, Wiring};
use crate::bus::{Bus, DeviceId};
use crate::storage::Storage;

fn day(n: u64) -> SystemTime {
    UNIX_EPOCH + Duration::from_secs(1_793_491_200 + n * 86_400)
}

struct Plant {
    _dir: tempfile::TempDir,
    _storage: Storage,
    layouts: Layouts,
    module_type: u32,
}

async fn plant() -> Plant {
    let dir = tempfile::tempdir().unwrap();
    let storage = Storage::open(
        &dir.path().join("core.sqlite"),
        UNIX_EPOCH,
        "UTC",
        &Bus::default(),
    )
    .unwrap();
    let profile = include_str!("../../../../../profiles/deye-sg05lp3.json");
    let profile = sunreye_profile::Profile::load(profile).unwrap();
    let inverters: Inverters =
        std::iter::once((DeviceId(1), std::sync::Arc::new(profile))).collect();
    let layouts = Layouts::new(storage.database(), inverters);
    let module_type = layouts
        .add_module_type(Datasheet {
            name: "Owner 400".into(),
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
        _storage: storage,
        layouts,
        module_type,
    }
}

impl Plant {
    fn string(&self, id: Option<u32>, input: u32, modules: u16) -> StringDraft {
        StringDraft {
            id,
            wiring: Wiring {
                name: format!("input {input}"),
                module_type: self.module_type,
                device: 1,
                input,
                modules,
                optimized: 0,
                tilt: 35.0,
                azimuth: 0.0,
                loss: 2.0,
            },
        }
    }
}

#[tokio::test]
async fn a_change_from_a_date_that_has_a_version_replaces_it() {
    let plant = plant().await;
    let first = plant
        .layouts
        .change(
            day(1),
            Draft::new(vec![plant.string(None, 1, 16)], None),
            day(1),
        )
        .await
        .unwrap();
    let kept = first.strings[0].id;

    let second = plant
        .layouts
        .change(
            day(1),
            Draft::new(
                vec![plant.string(Some(kept), 1, 14), plant.string(None, 2, 10)],
                None,
            ),
            day(2),
        )
        .await
        .unwrap();

    let versions = plant.layouts.versions().await.unwrap();
    assert_eq!(versions, vec![second.clone()]);
    assert_eq!(second.strings[0].id, kept);
    assert!(
        second.strings[1].id > kept,
        "a fresh id: {:?}",
        second.strings
    );
}

#[tokio::test]
async fn a_change_equal_to_the_version_in_force_stores_nothing() {
    let plant = plant().await;
    let first = plant
        .layouts
        .change(
            day(1),
            Draft::new(vec![plant.string(None, 1, 16)], None),
            day(1),
        )
        .await
        .unwrap();
    let kept = first.strings[0].id;
    let mut changes = plant.layouts.changes();
    changes.mark_unchanged();

    let same = plant
        .layouts
        .change(
            day(3),
            Draft::new(vec![plant.string(Some(kept), 1, 16)], None),
            day(3),
        )
        .await
        .unwrap();

    assert_eq!(same, first);
    assert_eq!(plant.layouts.versions().await.unwrap(), vec![first]);
    assert!(!changes.has_changed().unwrap(), "no change is announced");
}

/// A plane a scene derives may differ in its last bits from one an older build derived.
#[tokio::test]
async fn a_plane_within_rounding_of_the_version_in_force_stores_nothing() {
    let plant = plant().await;
    let first = plant
        .layouts
        .change(
            day(1),
            Draft::new(vec![plant.string(None, 1, 16)], None),
            day(1),
        )
        .await
        .unwrap();
    let mut same = plant.string(Some(first.strings[0].id), 1, 16);
    same.wiring.azimuth = 15.0_f64.mul_add(1e-15, same.wiring.azimuth);
    same.wiring.tilt -= 1e-13;

    plant
        .layouts
        .change(day(1), Draft::new(vec![same], None), day(2))
        .await
        .unwrap();

    assert_eq!(plant.layouts.versions().await.unwrap(), vec![first]);
}

/// A two-input 6 kW inverter's datasheet, made up where the ticket is silent.
fn inverter_type() -> sunreye_pv::InverterType {
    sunreye_pv::InverterType {
        maker: "Maker".into(),
        model: "X6".into(),
        maker_country: None,
        made_in: None,
        max_input_voltage: 600.0,
        ac_rating: 6000.0,
        efficiency: 97.5,
        inputs: vec![sunreye_pv::MpptInput {
            max_current: 16.0,
            min_voltage: 120.0,
            max_voltage: 550.0,
            start_voltage: 150.0,
        }],
    }
}

/// The type is read whole before the profile, which declares no efficiency (ADR 27).
#[tokio::test]
async fn a_devices_limits_come_from_its_inverter_type_else_its_profile() {
    let plant = plant().await;
    let inverters = plant.layouts.inverters();
    let types = Types {
        inverter_types: [(1, inverter_type()), (2, inverter_type())].into(),
        battery_types: std::collections::BTreeMap::new(),
    };
    let from_type = super::Limits {
        max_input_voltage: 600.0,
        ac_rating: Some(6000.0),
        efficiency: Some(97.5),
        inputs: vec![sunreye_pv::MpptLimits {
            max_current: 16.0,
            min_voltage: 120.0,
            max_voltage: 550.0,
            start_voltage: 150.0,
        }],
    };

    assert_eq!(
        inverters.limits(DeviceId(1), Some(&types)),
        Some(from_type.clone())
    );
    // A device without a profile is planned from its type alone.
    assert_eq!(inverters.limits(DeviceId(2), Some(&types)), Some(from_type));
    let profiled = inverters.limits(DeviceId(1), None).unwrap();
    assert_eq!(
        (
            profiled.max_input_voltage,
            profiled.ac_rating,
            profiled.efficiency
        ),
        (800.0, Some(20_000.0), None)
    );
    assert_eq!(profiled.inputs.len(), 2);
    assert_eq!(inverters.limits(DeviceId(2), None), None);
}
