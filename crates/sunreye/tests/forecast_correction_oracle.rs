//! Every case of `fixtures/oracle/forecast-correction.ndjson`: folding observations into the learned
//! correction, the factor it applies and the skill it reports must equal what 3.x produced.

#![allow(clippy::expect_used, reason = "helpers outside #[test] fns may panic like the tests")]

use std::path::Path;

use serde_json::{Map, Value, json};
use sunreye::forecast::{CorrectionCell, CorrectionModel, Observation, Skill};

/// Relative, absolute below 1: the decay is `2^(-1/30)` from `pow`, and V8's may round an ulp apart.
const TOLERANCE: f64 = 1e-12;

fn cases(producer: &str) -> Vec<Value> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/oracle/forecast-correction.ndjson");
    std::fs::read_to_string(path)
        .expect("fixture")
        .lines()
        .map(|line| serde_json::from_str::<Value>(line).expect("case"))
        .filter(|case| case["producer"] == producer)
        .collect()
}

fn number(value: &Value) -> f64 {
    value.as_f64().expect("number")
}

fn close(got: f64, want: f64) -> bool {
    (got - want).abs() <= TOLERANCE * got.abs().max(want.abs()).max(1.0)
}

fn slot(key: &str) -> (i8, i8) {
    let (month, hour) = key.split_once(':').expect("month:hour");
    (month.parse().expect("month"), hour.parse().expect("hour"))
}

fn model(cells: &Value) -> CorrectionModel {
    let mut model = CorrectionModel::default();
    for (key, cell) in cells.as_object().expect("model") {
        let (month, hour) = slot(key);
        model.set(
            month,
            hour,
            CorrectionCell { ratio: number(&cell["ratio"]), weight: number(&cell["weight"]) },
        );
    }
    model
}

fn skill(value: &Value) -> Skill {
    Skill {
        mae_raw: number(&value["maeRaw"]),
        mae_corrected: number(&value["maeCorrected"]),
        samples: number(&value["samples"]),
    }
}

/// `YYYY-MM-DDTHH:mm`: the cell is the label's month and hour.
fn observation(value: &Value) -> Observation {
    let label = value["localTime"].as_str().expect("localTime");
    Observation {
        month: label[5..7].parse().expect("month"),
        hour: label[11..13].parse().expect("hour"),
        expected_w: number(&value["expectedW"]),
        actual_w: number(&value["actualW"]),
    }
}

fn key((month, hour): (i8, i8)) -> String {
    format!("{month}:{hour}")
}

/// Every mismatch, by JSON path: numbers within [`TOLERANCE`], all else equal.
fn diff(path: &str, got: &Value, want: &Value, out: &mut Vec<String>) {
    match (got, want) {
        (Value::Number(g), Value::Number(w)) => {
            let (g, w) = (g.as_f64().expect("f64"), w.as_f64().expect("f64"));
            if !close(g, w) {
                out.push(format!("{path}: {g} != {w}"));
            }
        }
        (Value::Object(g), Value::Object(w)) => {
            let keys = |m: &Map<String, Value>| m.keys().cloned().collect::<Vec<_>>();
            if keys(g) != keys(w) {
                out.push(format!("{path}: keys {:?} != {:?}", keys(g), keys(w)));
                return;
            }
            for (key, value) in w {
                diff(&format!("{path}.{key}"), &g[key], value, out);
            }
        }
        _ if got == want => {}
        _ => out.push(format!("{path}: {got} != {want}")),
    }
}

#[test]
fn every_learn_case_folds_into_the_recorded_model_and_skill() {
    let cases = cases("learn");
    assert_eq!(cases.len(), 15);
    let mut mismatches = Vec::new();
    for case in &cases {
        let input = &case["input"];
        let mut learned = model(&input["model"]);
        let observations: Vec<Observation> =
            input["observations"].as_array().expect("observations").iter().map(observation).collect();
        let result = learned.learn(
            skill(&input["skill"]),
            &observations,
            number(&input["nameplateW"]),
            input.get("exportCapW").map(number),
        );
        let (mut cells, mut factors) = (Map::new(), Map::new());
        for (month, hour, cell) in learned.cells() {
            cells.insert(key((month, hour)), json!({"ratio": cell.ratio, "weight": cell.weight}));
            factors.insert(key((month, hour)), json!(learned.factor(month, hour)));
        }
        let got = json!({
            "model": cells,
            "touched": result.touched.iter().copied().map(key).collect::<Vec<_>>(),
            "skill": {"maeRaw": result.skill.mae_raw, "maeCorrected": result.skill.mae_corrected,
                "samples": result.skill.samples},
            "improvementPct": result.skill.improvement_pct(),
            "factors": factors,
        });
        diff(case["case"].as_str().expect("case"), &got, &case["output"], &mut mismatches);
    }
    assert!(mismatches.is_empty(), "{}", mismatches.join("\n"));
}

#[test]
fn every_factor_case_applies_the_recorded_factor() {
    let cases = cases("correctionFactor");
    assert_eq!(cases.len(), 8);
    for case in &cases {
        let input = &case["input"];
        let month = i8::try_from(input["month"].as_i64().expect("month")).expect("month");
        let hour = i8::try_from(input["hour"].as_i64().expect("hour")).expect("hour");
        let got = model(&input["model"]).factor(month, hour);
        let want = number(&case["output"]["factor"]);
        assert!(close(got, want), "{}: {got} != {want}", case["case"]);
    }
}

#[test]
fn every_skill_case_reports_the_recorded_improvement() {
    let cases = cases("skillImprovementPct");
    assert_eq!(cases.len(), 5);
    for case in &cases {
        let got = skill(&case["input"]["skill"]).improvement_pct();
        let want = number(&case["output"]["pct"]);
        assert!(close(got, want), "{}: {got} != {want}", case["case"]);
    }
}
