//! The official Deye profiles, the SG05LP3 and SG01HP3 ranges converted from v4, decode v4's
//! oracle cases.
//!
//! v4's cases are register patterns (zeros, a ramp, all ones, the sign bit, an absent block, a
//! split double word) replayed through each profile's register map, not captures of a device. Only
//! the owner's SG05LP3 has a capture (`crates/core/fixtures/capture`), replayed by the core; no
//! SG01HP3 has one.

use std::collections::BTreeMap;

use crate::{
    Field, Framing, Inverter, Mppt, Profile, Registers, RoleKind, Source, Step, StorageClass,
};
use serde_json::Value;

/// v4's oracle corpus, one line per profile: battery flows negated to ADR 4's charging-positive
/// sign, day counters and the settings registers a declared setting reads back left out, and on
/// the SG05LP3 range register 636, which v4 read but left unmapped, added as the signed inverter
/// output power.
const V4_CASES: &str = include_str!("deye-v4-cases.ndjson");

const LP3: &str = include_str!("../../../../profiles/deye-sg05lp3.json");
const HP3: &str = include_str!("../../../../profiles/deye-sg01hp3.json");

/// A family's base or variant and what Deye's datasheet (cited in `profiles/deye/`) and v4 say of
/// its model.
/// A family's file and one of its variants, or its base.
type Member = (&'static str, Option<&'static str>);

struct Model {
    json: &'static str,
    variant: Option<&'static str>,
    /// Amperes: the bound of the battery current settings.
    current: f64,
    inverter: Inverter,
}

const fn input(max_current: f64, min_voltage: f64, max_voltage: f64, start_voltage: f64) -> Mppt {
    Mppt {
        max_current,
        min_voltage,
        max_voltage,
        start_voltage,
    }
}

/// An SG05LP3: 800 V, an MPPT window up to 650 V, starting at 160 V.
fn low_voltage((json, variant): Member, current: f64, amps: [f64; 2], min: f64, ac: f64) -> Model {
    Model {
        json,
        variant,
        current,
        inverter: Inverter {
            max_input_voltage: 800.0,
            ac_rating: Some(ac),
            mppt: amps.map(|a| input(a, min, 650.0, 160.0)).to_vec(),
        },
    }
}

/// An SG01HP3: 1000 V, an MPPT window of 150 to 850 V, starting at 180 V.
fn high_voltage((json, variant): Member, current: f64, amps: [f64; 2], ac: f64) -> Model {
    Model {
        json,
        variant,
        current,
        inverter: Inverter {
            max_input_voltage: 1000.0,
            ac_rating: Some(ac),
            mppt: amps.map(|a| input(a, 150.0, 850.0, 180.0)).to_vec(),
        },
    }
}

/// Each SG05LP3 profile: its battery current, its inputs' current, its MPPT window's floor and its
/// AC rating.
const LOW_VOLTAGE: [(Member, f64, [f64; 2], f64, f64); 11] = [
    ((LP3, None), 350.0, [36.0, 36.0], 160.0, 20_000.0),
    ((LP3, Some("5k")), 120.0, [20.0, 20.0], 200.0, 5000.0),
    ((LP3, Some("6k")), 135.0, [20.0, 20.0], 200.0, 6000.0),
    ((LP3, Some("8k")), 190.0, [26.0, 26.0], 200.0, 8000.0),
    ((LP3, Some("10k")), 210.0, [26.0, 26.0], 200.0, 10_000.0),
    ((LP3, Some("12k")), 240.0, [26.0, 26.0], 200.0, 12_000.0),
    ((LP3, Some("14k")), 260.0, [36.0, 36.0], 160.0, 14_000.0),
    ((LP3, Some("15k")), 280.0, [36.0, 36.0], 160.0, 15_000.0),
    ((LP3, Some("16k")), 300.0, [36.0, 36.0], 160.0, 16_000.0),
    ((LP3, Some("18k")), 330.0, [36.0, 36.0], 160.0, 18_000.0),
    ((LP3, Some("20k")), 350.0, [36.0, 36.0], 160.0, 20_000.0),
];

/// Each SG01HP3 profile: its battery current, its inputs' current and its AC rating.
const HIGH_VOLTAGE: [(Member, f64, [f64; 2], f64); 9] = [
    ((HP3, None), 50.0, [26.0, 26.0], 25_000.0),
    ((HP3, Some("5k")), 30.0, [20.0, 20.0], 5000.0),
    ((HP3, Some("6k")), 30.0, [20.0, 20.0], 6000.0),
    ((HP3, Some("8k")), 37.0, [20.0, 20.0], 8000.0),
    ((HP3, Some("10k")), 37.0, [20.0, 20.0], 10_000.0),
    ((HP3, Some("12k")), 37.0, [26.0, 20.0], 12_000.0),
    ((HP3, Some("15k")), 37.0, [26.0, 20.0], 15_000.0),
    ((HP3, Some("20k")), 50.0, [26.0, 26.0], 20_000.0),
    ((HP3, Some("25k")), 50.0, [26.0, 26.0], 25_000.0),
];

fn models() -> Vec<Model> {
    let low = LOW_VOLTAGE
        .iter()
        .map(|&(member, current, amps, min, ac)| low_voltage(member, current, amps, min, ac));
    let high = HIGH_VOLTAGE
        .iter()
        .map(|&(member, current, amps, ac)| high_voltage(member, current, amps, ac));
    low.chain(high).collect()
}

fn profile(model: &Model) -> Profile {
    let family = Profile::load(model.json).unwrap();
    family.resolve(model.variant).clone()
}

fn profiles() -> impl Iterator<Item = Profile> {
    models().iter().map(profile).collect::<Vec<_>>().into_iter()
}

/// A base by its id, a variant by its family's and its own: how v4's cases are keyed.
fn label(profile: &Profile) -> String {
    profile
        .variant()
        .map_or_else(|| profile.id.clone(), |v| format!("{}/{v}", profile.id))
}

fn answered(case: &Value) -> Registers {
    let mut registers = Registers::default();
    for run in case["runs"].as_array().unwrap() {
        let words: Vec<u16> = run["words"]
            .as_array()
            .unwrap()
            .iter()
            .map(|w| u16::try_from(w.as_u64().unwrap()).unwrap())
            .collect();
        registers.answer(
            u16::try_from(run["start"].as_u64().unwrap()).unwrap(),
            &words,
        );
    }
    registers
}

fn cases() -> BTreeMap<String, Vec<Value>> {
    V4_CASES
        .lines()
        .map(|line| {
            let mut entry: Value = serde_json::from_str(line).unwrap();
            let family = entry["profile"].as_str().unwrap();
            let id = entry["variant"]
                .as_str()
                .map_or_else(|| family.to_owned(), |v| format!("{family}/{v}"));
            (id, serde_json::from_value(entry["cases"].take()).unwrap())
        })
        .collect()
}

#[test]
fn every_profile_loads_as_deye_without_a_warning() {
    for profile in profiles() {
        assert_eq!(profile.manufacturer, "Deye", "{}", profile.id);
        assert_eq!(profile.warnings(), [] as [String; 0], "{}", profile.id);
    }
}

#[test]
fn every_profile_declares_its_mppt_inputs_and_ac_rating_from_the_datasheet() {
    for model in models() {
        let profile = profile(&model);
        assert_eq!(profile.inverter(), Some(&model.inverter), "{}", profile.id);
    }
}

#[test]
fn every_profile_decodes_each_v4_case_to_v4s_readings() {
    let mut cases = cases();
    for profile in profiles() {
        let cases = cases.remove(&label(&profile)).unwrap();
        assert_eq!(cases.len(), 6, "{}", profile.id);
        let mut values = vec![None; profile.quantities().len()];
        for case in cases {
            profile.decode(&answered(&case), &mut values);
            let got: BTreeMap<String, Option<f64>> = profile
                .quantities()
                .iter()
                .map(|q| q.key.clone())
                .zip(values.iter().copied())
                .collect();
            let want: BTreeMap<String, Option<f64>> = case["readings"]
                .as_object()
                .unwrap()
                .iter()
                .map(|(k, v)| (k.clone(), v.as_f64()))
                .collect();
            assert_eq!(got, want, "{} {}", profile.id, case["name"]);
        }
    }
    assert_eq!(cases, BTreeMap::new(), "cases without a profile");
}

#[test]
fn every_register_is_read_exactly_once_on_every_framing() {
    let mut answered_once = Registers::default();
    for profile in profiles() {
        for framing in [Framing::Tcp, Framing::RtuOverTcp, Framing::SolarmanV5] {
            let plan = profile.read_plan(framing.gap_tolerance());
            for pair in plan.windows(2) {
                assert!(
                    u32::from(pair[0].start) + u32::from(pair[0].count) <= u32::from(pair[1].start),
                    "{} {framing:?}",
                    profile.id
                );
            }
            answered_once.clear();
            for block in &plan {
                assert!(block.count <= 120);
                answered_once.answer(block.start, &vec![1; usize::from(block.count)]);
            }
            let mut values = vec![None; profile.quantities().len()];
            profile.decode(&answered_once, &mut values);
            assert!(
                values.iter().all(Option::is_some),
                "{} {framing:?} leaves a quantity unread",
                profile.id
            );
        }
    }
}

#[test]
fn the_inputs_of_inverter_power_share_one_block() {
    let family = profile(&models()[0]);
    let plan = family.read_plan(0);
    let block = plan.iter().find(|b| b.grouped).unwrap();
    assert_eq!(
        (block.start, block.count),
        (590, 86),
        "battery 590 to the last PV power at 675"
    );
}

#[test]
fn every_profiles_settings_write_with_function_16_and_read_back_their_own_register() {
    for model in models() {
        let profile = profile(&model);
        let settings = [
            ("battery.max_charge_current", 108, model.current),
            ("battery.max_discharge_current", 109, model.current),
            ("battery.grid_charge", 130, 1.0),
            ("work_mode", 142, 2.0),
        ];
        for (key, register, max) in settings {
            let setting = profile.setting(key).unwrap();
            assert_eq!(setting.recipe(), [Step::Write { register }], "{key}");
            let whole = Field {
                register,
                mask: 0xFFFF,
            };
            assert_eq!(setting.read_back(), Some(Source::Register(whole)), "{key}");
            assert!(
                setting.encode(max).is_some() && setting.encode(max + 1.0).is_none(),
                "{} {key}",
                profile.id
            );
            assert!(
                !setting.verified(),
                "{} {key} is not checked on hardware",
                profile.id
            );
        }
    }
}

/// Registers 0 and 20 to 21 of a three-phase hybrid of device type `kind` rated `watts`.
fn hybrid(kind: u16, watts: u32) -> Registers {
    let tenths = watts * 10;
    let mut registers = Registers::default();
    registers.answer(0, &[kind]);
    registers.answer(
        20,
        &[
            u16::try_from(tenths & 0xFFFF).unwrap(),
            u16::try_from(tenths >> 16).unwrap(),
        ],
    );
    registers
}

/// What each family identifies the device as: its id and variant.
fn identified(device: &Registers) -> Vec<(String, Option<String>)> {
    [LP3, HP3]
        .into_iter()
        .filter_map(|json| {
            let family = Profile::load(json).unwrap();
            let found = family.identify(device)?;
            Some((found.id.clone(), found.variant().map(str::to_owned)))
        })
        .collect()
}

#[test]
fn a_model_is_identified_by_its_rated_power_and_the_family_by_its_device_type() {
    for watts in [
        5000, 6000, 8000, 10_000, 12_000, 14_000, 15_000, 16_000, 18_000, 20_000,
    ] {
        let device = hybrid(0x0500, watts);
        let model = format!("{}k", watts / 1000);
        assert_eq!(
            identified(&device),
            [("deye-sg05lp3".to_owned(), Some(model))],
            "{watts} W"
        );
    }
}

/// Deye's protocol gives the high-voltage range two device types: 6 to 15 kW, and 20 kW up.
#[test]
fn a_high_voltage_model_is_identified_by_its_rated_power_under_either_device_type() {
    for kind in [0x0600, 0x0601] {
        for watts in [5000, 6000, 8000, 10_000, 12_000, 15_000, 20_000, 25_000] {
            let device = hybrid(kind, watts);
            let model = format!("{}k", watts / 1000);
            assert_eq!(
                identified(&device),
                [("deye-sg01hp3".to_owned(), Some(model))],
                "{kind:#x} {watts} W"
            );
        }
    }
}

#[test]
fn a_rating_no_variant_declares_is_read_as_the_familys_base() {
    assert_eq!(
        identified(&hybrid(0x0500, 13_000)),
        [("deye-sg05lp3".to_owned(), None)]
    );
    assert_eq!(
        identified(&hybrid(0x0601, 30_000)),
        [("deye-sg01hp3".to_owned(), None)]
    );
}

#[test]
fn settings_registers_are_held_values_and_extras_repeating_a_role_are_kept_live_only() {
    let repeats = [
        "extra.grid_import_power",
        "extra.grid_export_power",
        "extra.battery_charge_power",
        "extra.battery_discharge_power",
        "extra.ac_total_internal_power",
    ];
    for profile in profiles() {
        for q in profile.quantities() {
            let held =
                q.role.starts_with("extra.settings_") || q.role.starts_with("extra.timeofuse_");
            assert_eq!(
                q.kind() == RoleKind::Held,
                held,
                "{} {}",
                profile.id,
                q.key
            );
            let live = repeats.contains(&q.role.as_str());
            assert_eq!(
                q.storage() == StorageClass::Live,
                live,
                "{} {}",
                profile.id,
                q.key
            );
        }
    }
}
