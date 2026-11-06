//! Every case of `fixtures/oracle/forecast-string-correction.ndjson`: a string's hours folded into its array's
//! correction must equal what the reference rule produced.

#![allow(clippy::expect_used, reason = "helpers outside #[test] fns may panic like the tests")]

use std::path::Path;

use serde_json::{Value, json};
use sunreye::forecast::{CorrectionCell, CorrectionModel, Observation, StringObservation};

/// Relative, absolute below 1: the decay is `2^(-1/30)` from `pow`, and V8's may round an ulp apart.
const TOLERANCE: f64 = 1e-12;

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

/// `YYYY-MM-DDTHH:mm`: the cell is the label's month and hour.
fn observation(value: &Value) -> StringObservation {
    let label = value["localTime"].as_str().expect("localTime");
    StringObservation {
        array: Observation {
            month: label[5..7].parse().expect("month"),
            hour: label[11..13].parse().expect("hour"),
            expected_w: number(&value["expectedW"]),
            actual_w: number(&value["actualW"]),
        },
        inverter_expected_w: number(&value["inverterExpectedW"]),
        inverter_actual_w: value.get("inverterActualW").map(number),
    }
}

fn key((month, hour): (i8, i8)) -> String {
    format!("{month}:{hour}")
}

#[test]
fn every_string_case_folds_into_the_recorded_model() {
    let path =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/oracle/forecast-string-correction.ndjson");
    let text = std::fs::read_to_string(path).expect("fixture");
    let cases: Vec<Value> = text.lines().map(|line| serde_json::from_str(line).expect("case")).collect();
    assert_eq!(cases.len(), 13);
    let mut mismatches = Vec::new();
    for case in &cases {
        let name = case["case"].as_str().expect("case");
        let input = &case["input"];
        let mut learned = model(&input["model"]);
        let observations: Vec<StringObservation> =
            input["observations"].as_array().expect("observations").iter().map(observation).collect();
        let touched = learned.learn_string(
            &observations,
            number(&input["arrayNameplateW"]),
            number(&input["inverterNameplateW"]),
            input.get("exportCapW").map(number),
        );
        let want = &case["output"];
        let got_touched: Vec<String> = touched.iter().copied().map(key).collect();
        if json!(got_touched) != want["touched"] {
            mismatches.push(format!("{name}: touched {got_touched:?} != {}", want["touched"]));
        }
        let cells: Vec<_> = learned.cells().collect();
        let want_cells = want["model"].as_object().expect("model");
        if cells.len() != want_cells.len() {
            mismatches.push(format!("{name}: {} cells != {}", cells.len(), want_cells.len()));
        }
        for (month, hour, cell) in cells {
            let k = key((month, hour));
            let (Some(w), Some(f)) = (want_cells.get(&k), want["factors"].get(&k)) else {
                mismatches.push(format!("{name}: unexpected cell {k}"));
                continue;
            };
            let pairs = [
                (cell.ratio, number(&w["ratio"])),
                (cell.weight, number(&w["weight"])),
                (learned.factor(month, hour), number(f)),
            ];
            if !pairs.iter().all(|&(g, w)| close(g, w)) {
                mismatches.push(format!("{name}.{k}: {pairs:?}"));
            }
        }
    }
    assert!(mismatches.is_empty(), "{}", mismatches.join("\n"));
}
