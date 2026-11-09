//! The 3.x and v4 learner cases as oracles. Both files are copied verbatim from
//! `SunReye-v3/fixtures/oracle/` (identical in v4's `SunReye/fixtures/oracle/`):
//! `forecast-correction.ndjson` records 3.x `learn` and `correctionFactor`
//! (`apps/server/src/forecast/forecast-correction.ts`), `forecast-string-correction.ndjson` the
//! v4 rule a string learns by (`crates/sunreye/src/forecast/correction.rs`, `learn_string`).
//!
//! Not ported: the export-cap cases, since feed-in curtailment waits for the EMS stage (ADR 17);
//! the skill cases, which nothing in v5 reports; the `apply/*` cases, which run 3.x's kWp-array
//! model.

use serde_json::{Map, Value};

use super::{Cell, Grid, Hour};

/// Relative, absolute below 1: the decay is `2^(-1/30)` from `pow`, and V8's may round an ulp
/// apart.
const TOLERANCE: f64 = 1e-12;
const NOT_PORTED: [&str; 4] = [
    "learn/export-cap",
    "learn/export-cap-above-saturation",
    "string/export-cap",
    "string/export-cap-above-saturation",
];

fn cases(file: &str, producer: &str) -> Vec<Value> {
    let path = format!("{}/fixtures/oracle/{file}", env!("CARGO_MANIFEST_DIR"));
    std::fs::read_to_string(path)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str::<Value>(line).unwrap())
        .filter(|case| case["producer"] == producer)
        .filter(|case| !NOT_PORTED.contains(&case["case"].as_str().unwrap()))
        .collect()
}

fn number(value: &Value) -> f64 {
    value.as_f64().unwrap()
}

fn close(got: f64, want: f64) -> bool {
    (got - want).abs() <= TOLERANCE * got.abs().max(want.abs()).max(1.0)
}

fn grid(cells: &Value) -> Grid {
    let mut grid = Grid::default();
    for (key, cell) in cells.as_object().unwrap() {
        let (month, hour) = key.split_once(':').unwrap();
        let cell = Cell {
            ratio: number(&cell["ratio"]),
            weight: number(&cell["weight"]),
        };
        grid.set(month.parse().unwrap(), hour.parse().unwrap(), cell);
    }
    grid
}

/// `YYYY-MM-DDTHH:mm`: the cell is the label's month and hour.
fn slot(value: &Value) -> (u8, u8) {
    let label = value["localTime"].as_str().unwrap();
    (label[5..7].parse().unwrap(), label[11..13].parse().unwrap())
}

/// Every mismatch between the learned `grid`, the cells it `touched` and the case's output.
fn mismatches(name: &str, grid: &Grid, touched: &[(u8, u8)], want: &Value) -> Vec<String> {
    let key = |(month, hour): (u8, u8)| format!("{month}:{hour}");
    let mut out = Vec::new();
    let got_touched: Vec<String> = touched.iter().copied().map(key).collect();
    let want_touched: Vec<String> = want["touched"]
        .as_array()
        .unwrap()
        .iter()
        .map(|k| k.as_str().unwrap().to_owned())
        .collect();
    if got_touched != want_touched {
        out.push(format!(
            "{name}: touched {got_touched:?} != {want_touched:?}"
        ));
    }
    let want_cells: &Map<String, Value> = want["model"].as_object().unwrap();
    let cells: Vec<(u8, u8, Cell)> = grid.cells().collect();
    if cells.len() != want_cells.len() {
        out.push(format!(
            "{name}: {} cells != {}",
            cells.len(),
            want_cells.len()
        ));
    }
    for (month, hour, cell) in cells {
        let k = key((month, hour));
        let (Some(w), Some(f)) = (want_cells.get(&k), want["factors"].get(&k)) else {
            out.push(format!("{name}: unexpected cell {k}"));
            continue;
        };
        let pairs = [
            (cell.ratio, number(&w["ratio"])),
            (cell.weight, number(&w["weight"])),
            (grid.factor(month, hour), number(f)),
        ];
        if !pairs.iter().all(|&(g, w)| close(g, w)) {
            out.push(format!("{name}.{k}: {pairs:?}"));
        }
    }
    out
}

/// A 3.x case learns the whole inverter: its hours are the inverter's own, as when an input
/// learns against `pv.power`.
#[test]
fn every_3x_case_folds_into_the_recorded_grid() {
    let cases = cases("forecast-correction.ndjson", "learn");
    assert_eq!(cases.len(), 13);
    let mut out = Vec::new();
    for case in &cases {
        let input = &case["input"];
        let mut learned = grid(&input["model"]);
        let hours: Vec<Hour> = input["observations"]
            .as_array()
            .unwrap()
            .iter()
            .map(|o| {
                let (month, hour) = slot(o);
                Hour {
                    month,
                    hour,
                    modelled: number(&o["expectedW"]),
                    measured: number(&o["actualW"]),
                    inverter_modelled: number(&o["expectedW"]),
                    inverter_measured: Some(number(&o["actualW"])),
                }
            })
            .collect();
        let nameplate = number(&input["nameplateW"]);
        let touched = learned.learn(&hours, nameplate, nameplate);
        out.extend(mismatches(
            case["case"].as_str().unwrap(),
            &learned,
            &touched,
            &case["output"],
        ));
    }
    assert!(out.is_empty(), "{}", out.join("\n"));
}

#[test]
fn every_v4_string_case_folds_into_the_recorded_grid() {
    let cases = cases("forecast-string-correction.ndjson", "learnString");
    assert_eq!(cases.len(), 11);
    let mut out = Vec::new();
    for case in &cases {
        let input = &case["input"];
        let mut learned = grid(&input["model"]);
        let hours: Vec<Hour> = input["observations"]
            .as_array()
            .unwrap()
            .iter()
            .map(|o| {
                let (month, hour) = slot(o);
                Hour {
                    month,
                    hour,
                    modelled: number(&o["expectedW"]),
                    measured: number(&o["actualW"]),
                    inverter_modelled: number(&o["inverterExpectedW"]),
                    inverter_measured: o.get("inverterActualW").map(number),
                }
            })
            .collect();
        let touched = learned.learn(
            &hours,
            number(&input["arrayNameplateW"]),
            number(&input["inverterNameplateW"]),
        );
        out.extend(mismatches(
            case["case"].as_str().unwrap(),
            &learned,
            &touched,
            &case["output"],
        ));
    }
    assert!(out.is_empty(), "{}", out.join("\n"));
}

#[test]
fn every_3x_factor_case_applies_the_recorded_factor() {
    let cases = cases("forecast-correction.ndjson", "correctionFactor");
    assert_eq!(cases.len(), 8);
    for case in &cases {
        let input = &case["input"];
        let month = u8::try_from(input["month"].as_u64().unwrap()).unwrap();
        let hour = u8::try_from(input["hour"].as_u64().unwrap()).unwrap();
        let got = grid(&input["model"]).factor(month, hour);
        let want = number(&case["output"]["factor"]);
        assert!(close(got, want), "{}: {got} != {want}", case["case"]);
    }
}
