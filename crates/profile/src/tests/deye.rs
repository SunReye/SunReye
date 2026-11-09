//! The official Deye SG05LP3 profile, converted from v4, decodes v4's recorded cases.

use std::collections::BTreeMap;

use crate::{Framing, Inverter, Mppt, Profile, Registers};
use serde_json::Value;

const PROFILE: &str = include_str!("../../../../profiles/deye-sg05lp3.json");
/// v4's oracle corpus for this profile; battery flows negated to ADR 4's charging-positive sign.
const V4_CASES: &str = include_str!("deye-sg05lp3-v4-cases.json");

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

#[test]
fn it_loads() {
    let profile = Profile::load(PROFILE).unwrap();
    assert_eq!(
        (profile.id.as_str(), profile.manufacturer.as_str()),
        ("deye-sg05lp3", "Deye")
    );
}

#[test]
fn it_declares_two_mppt_inputs_from_the_sm2_datasheet() {
    let profile = Profile::load(PROFILE).unwrap();
    let input = Mppt {
        max_current: 26.0,
        min_voltage: 200.0,
        max_voltage: 650.0,
        start_voltage: 160.0,
    };
    assert_eq!(
        profile.inverter(),
        Some(&Inverter {
            max_input_voltage: 800.0,
            mppt: vec![input, input],
        })
    );
}

#[test]
fn it_decodes_every_v4_case_to_v4s_readings() {
    let profile = Profile::load(PROFILE).unwrap();
    let cases: Vec<Value> = serde_json::from_str(V4_CASES).unwrap();
    assert_eq!(cases.len(), 6);
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
        assert_eq!(got, want, "{}", case["name"]);
    }
}

#[test]
fn every_register_is_read_exactly_once_on_every_framing() {
    let profile = Profile::load(PROFILE).unwrap();
    let mut answered_once = Registers::default();
    for framing in [Framing::Tcp, Framing::RtuOverTcp, Framing::SolarmanV5] {
        let plan = profile.read_plan(framing.gap_tolerance());
        for pair in plan.windows(2) {
            assert!(
                u32::from(pair[0].start) + u32::from(pair[0].count) <= u32::from(pair[1].start),
                "{framing:?}"
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
            "{framing:?} leaves a quantity unread"
        );
    }
}

#[test]
fn the_inputs_of_inverter_power_share_one_block() {
    let profile = Profile::load(PROFILE).unwrap();
    let plan = profile.read_plan(0);
    let block = plan.iter().find(|b| b.grouped).unwrap();
    assert_eq!(
        (block.start, block.count),
        (590, 86),
        "battery 590 to the last PV power at 675"
    );
}
