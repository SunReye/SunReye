//! Every case of `fixtures/oracle/forecast-string-correction.ndjson`: a string's hours folded into its array's
//! correction, and the forecast scaled by the string and inverter grids, must equal what the reference rule
//! produced.

#![allow(clippy::expect_used, reason = "helpers outside #[test] fns may panic like the tests")]

use std::path::Path;

use serde_json::{Value, json};
use sunreye::forecast::{
    CorrectionCell, CorrectionModel, Observation, Run, SimInputs, StringObservation, build,
};

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

fn cases(producer: &str) -> Vec<Value> {
    let path =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/oracle/forecast-string-correction.ndjson");
    std::fs::read_to_string(path)
        .expect("fixture")
        .lines()
        .map(|line| serde_json::from_str::<Value>(line).expect("case"))
        .filter(|case| case["producer"] == producer)
        .collect()
}

#[test]
fn every_string_case_folds_into_the_recorded_model() {
    let cases = cases("learnString");
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

#[test]
fn every_apply_case_scales_each_array_by_its_string_grid_else_the_inverters() {
    let cases = cases("applyStringCorrection");
    assert_eq!(cases.len(), 5);
    let mut mismatches = Vec::new();
    for case in &cases {
        let (name, input) = (case["case"].as_str().expect("case"), &case["input"]);
        let config = serde_json::from_value(input["config"].clone()).expect("config");
        let data = serde_json::from_value(input["data"].clone()).expect("data");
        let inverter = input.get("correction").map(model);
        let strings: Vec<Option<CorrectionModel>> = input["arrayCorrections"]
            .as_array()
            .expect("arrayCorrections")
            .iter()
            .map(|cells| (!cells.is_null()).then(|| model(cells)))
            .collect();
        let time_zone = jiff::tz::db().get(input["timeZone"].as_str().expect("timeZone")).expect("zone");
        let run = Run {
            time_zone: &time_zone,
            now_ms: 0,
            sim: SimInputs::default(),
            correction: inverter.as_ref(),
            array_corrections: &strings,
        };
        let got = build(&config, &data, "open-meteo", &run).expect("forecast").raw.series;
        let want = case["output"]["series"].as_array().expect("series");
        if got.len() != want.len() {
            mismatches.push(format!("{name}: {} slots != {}", got.len(), want.len()));
            continue;
        }
        for (point, w) in got.iter().zip(want) {
            let want_w = number(&w["watts"]);
            if point.time != w["time"].as_str().expect("time") || !close(point.watts, want_w) {
                mismatches.push(format!("{name} {}: {} != {w}", point.time, point.watts));
            }
        }
    }
    assert!(mismatches.is_empty(), "{}", mismatches.join("\n"));
}
