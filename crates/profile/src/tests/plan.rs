//! v4's TypeScript planner cases, run natively. The WASM build runs the same file (packages/sdk).

use crate::{Block, Framing, Profile};
use serde_json::{Value, json};

const CASES: &str = include_str!("plan-cases.json");

/// A case's quantities: listed, or one u16 per register of each `[start, count]` span.
fn quantities(case: &Value) -> Value {
    let Some(spans) = case.get("spans") else {
        return case["quantities"].clone();
    };
    let mut out = Vec::new();
    for span in spans.as_array().unwrap() {
        let (start, count) = (span[0].as_u64().unwrap(), span[1].as_u64().unwrap());
        for register in start..start + count {
            out.push(json!({ "key": format!("r{register}"), "role": "extra.r", "register": register, "type": "u16" }));
        }
    }
    Value::Array(out)
}

fn profile(quantities: &Value) -> Profile {
    let doc = json!({
        "schema": 1, "id": "case", "name": "case", "manufacturer": "test", "version": "1.0.0",
        "requires": super::all(), "quantities": quantities,
    });
    Profile::load(&doc.to_string()).unwrap()
}

#[test]
fn every_v4_planner_case_plans_the_recorded_blocks() {
    let cases: Vec<Value> = serde_json::from_str(CASES).unwrap();
    assert_eq!(cases.len(), 16);
    for case in cases {
        let profile = profile(&quantities(&case));
        let got = case.get("split").map_or_else(
            || profile.read_plan(u16::try_from(case["gap"].as_u64().unwrap()).unwrap()),
            |block| profile.split(serde_json::from_value::<Block>(block.clone()).unwrap()),
        );
        let want: Vec<Block> = serde_json::from_value(case["plan"].clone()).unwrap();
        assert_eq!(got, want, "{}", case["name"]);
    }
}

#[test]
fn only_the_solarman_framing_tolerates_gaps() {
    assert_eq!(Framing::Tcp.gap_tolerance(), 0);
    assert_eq!(Framing::RtuOverTcp.gap_tolerance(), 0);
    assert_eq!(Framing::SolarmanV5.gap_tolerance(), 32);
}
