//! The official Deye profiles, converted from v4, decode v4's oracle cases.
//!
//! v4's cases are register patterns (zeros, a ramp, all ones, the sign bit, an absent block, a
//! split double word) replayed through each profile's register map, not captures of a device. Only
//! the owner's SG05LP3 has a capture (`crates/core/fixtures/capture`), replayed by the core.

use std::collections::BTreeMap;

use crate::{Field, Framing, Inverter, Mppt, Profile, Registers, Source, Step};
use serde_json::Value;

/// v4's oracle corpus, one line per profile: battery flows negated to ADR 4's charging-positive
/// sign, day counters left out, and on the SG05LP3 range register 636, which v4 read but left
/// unmapped, added as the signed inverter output power.
const V4_CASES: &str = include_str!("deye-v4-cases.ndjson");

/// Each profile, its battery current bound, its PV inputs' current and minimum MPPT voltage, and its
/// rated AC output, from Deye's datasheets (cited in `profiles/deye/`).
const PROFILES: [(&str, f64, [f64; 2], f64, f64); 11] = [
    (
        include_str!("../../../../profiles/deye-sg05lp3.json"),
        350.0,
        [36.0, 36.0],
        160.0,
        20_000.0,
    ),
    (
        include_str!("../../../../profiles/deye-sun5k-sg05lp3.json"),
        120.0,
        [20.0, 20.0],
        200.0,
        5000.0,
    ),
    (
        include_str!("../../../../profiles/deye-sun6k-sg05lp3.json"),
        135.0,
        [20.0, 20.0],
        200.0,
        6000.0,
    ),
    (
        include_str!("../../../../profiles/deye-sun8k-sg05lp3.json"),
        190.0,
        [26.0, 26.0],
        200.0,
        8000.0,
    ),
    (
        include_str!("../../../../profiles/deye-sun10k-sg05lp3.json"),
        210.0,
        [26.0, 26.0],
        200.0,
        10_000.0,
    ),
    (
        include_str!("../../../../profiles/deye-sun12k-sg05lp3.json"),
        240.0,
        [26.0, 26.0],
        200.0,
        12_000.0,
    ),
    (
        include_str!("../../../../profiles/deye-sun14k-sg05lp3.json"),
        260.0,
        [36.0, 36.0],
        160.0,
        14_000.0,
    ),
    (
        include_str!("../../../../profiles/deye-sun15k-sg05lp3.json"),
        280.0,
        [36.0, 36.0],
        160.0,
        15_000.0,
    ),
    (
        include_str!("../../../../profiles/deye-sun16k-sg05lp3.json"),
        300.0,
        [36.0, 36.0],
        160.0,
        16_000.0,
    ),
    (
        include_str!("../../../../profiles/deye-sun18k-sg05lp3.json"),
        330.0,
        [36.0, 36.0],
        160.0,
        18_000.0,
    ),
    (
        include_str!("../../../../profiles/deye-sun20k-sg05lp3.json"),
        350.0,
        [36.0, 36.0],
        160.0,
        20_000.0,
    ),
];

fn profiles() -> impl Iterator<Item = Profile> {
    PROFILES
        .iter()
        .map(|(json, ..)| Profile::load(json).unwrap())
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
            let id = entry["profile"].as_str().unwrap().to_owned();
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
    for ((_, _, amps, min_voltage, ac), profile) in PROFILES.iter().zip(profiles()) {
        let input = |max_current| Mppt {
            max_current,
            min_voltage: *min_voltage,
            max_voltage: 650.0,
            start_voltage: 160.0,
        };
        assert_eq!(
            profile.inverter(),
            Some(&Inverter {
                max_input_voltage: 800.0,
                ac_rating: Some(*ac),
                mppt: vec![input(amps[0]), input(amps[1])],
            }),
            "{}",
            profile.id
        );
    }
}

#[test]
fn every_profile_decodes_each_v4_case_to_v4s_readings() {
    let mut cases = cases();
    for profile in profiles() {
        let cases = cases.remove(&profile.id).unwrap();
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
    let family = Profile::load(PROFILES[0].0).unwrap();
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
    for ((_, current, ..), profile) in PROFILES.iter().zip(profiles()) {
        let settings = [
            ("battery.max_charge_current", 108, *current),
            ("battery.max_discharge_current", 109, *current),
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

/// Registers 0 and 20 to 21 of a low-voltage three-phase hybrid rated `watts`.
fn low_voltage_hybrid(watts: u32) -> Registers {
    let tenths = watts * 10;
    let mut registers = Registers::default();
    registers.answer(0, &[0x0500]);
    registers.answer(
        20,
        &[
            u16::try_from(tenths & 0xFFFF).unwrap(),
            u16::try_from(tenths >> 16).unwrap(),
        ],
    );
    registers
}

#[test]
fn a_model_is_identified_by_its_rated_power_and_the_family_by_its_device_type() {
    for watts in [
        5000, 6000, 8000, 10_000, 12_000, 14_000, 15_000, 16_000, 18_000, 20_000,
    ] {
        let device = low_voltage_hybrid(watts);
        let identified: Vec<String> = profiles()
            .filter(|p| p.identifies(&device))
            .map(|p| p.id)
            .collect();
        let model = format!("deye-sun{}k-sg05lp3", watts / 1000);
        assert_eq!(identified, ["deye-sg05lp3".to_owned(), model], "{watts} W");
    }
}
