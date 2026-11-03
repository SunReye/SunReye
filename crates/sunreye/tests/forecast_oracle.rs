//! Every case of `fixtures/oracle/forecast.ndjson`: solar geometry, the per-array power model and the
//! assembled forecast, exported raw and usable, must equal what the 3.x forecast produced.

#![allow(clippy::expect_used, reason = "helpers outside #[test] fns may panic like the tests")]

use std::path::Path;

use jiff::tz::TimeZone;
use serde_json::Value;
use sunreye::forecast::{
    CorrectionCell, CorrectionModel, Run, Variant, build, cos_aoi, pv_power_w, sun_position,
};

/// Relative, absolute below 1. Measured bit-identical (`x86_64` glibc); the margin covers a libm whose
/// `sin`/`exp`/`atan2` round an ulp off V8's, carried through sums over 192 slots.
const TOLERANCE: f64 = 1e-12;

fn cases(producer: &str) -> Vec<Value> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/oracle/forecast.ndjson");
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

/// Every mismatch between `got` and `want`, by JSON path: numbers within [`TOLERANCE`], all else equal.
fn diff(path: &str, got: &Value, want: &Value, out: &mut Vec<String>) {
    match (got, want) {
        (Value::Number(g), Value::Number(w)) => {
            let (g, w) = (g.as_f64().expect("f64"), w.as_f64().expect("f64"));
            if !close(g, w) {
                out.push(format!("{path}: {g} != {w}"));
            }
        }
        (Value::Object(g), Value::Object(w)) => {
            let keys = |m: &serde_json::Map<String, Value>| m.keys().cloned().collect::<Vec<_>>();
            if keys(g) != keys(w) {
                out.push(format!("{path}: keys {:?} != {:?}", keys(g), keys(w)));
                return;
            }
            for (key, value) in w {
                diff(&format!("{path}.{key}"), &g[key], value, out);
            }
        }
        (Value::Array(g), Value::Array(w)) if g.len() == w.len() => {
            for (i, (g, w)) in g.iter().zip(w).enumerate() {
                diff(&format!("{path}[{i}]"), g, w, out);
            }
        }
        _ if got == want => {}
        _ => out.push(format!("{path}: {got} != {want}")),
    }
}

fn zone(name: &str) -> TimeZone {
    let tzif = std::fs::read(Path::new("/usr/share/zoneinfo").join(name)).expect("zoneinfo");
    TimeZone::tzif(name, &tzif).expect("tzif")
}

fn correction(cells: &Value) -> CorrectionModel {
    let mut model = CorrectionModel::default();
    for (key, cell) in cells.as_object().expect("model") {
        let (month, hour) = key.split_once(':').expect("month:hour");
        let cell = CorrectionCell { ratio: number(&cell["ratio"]), weight: number(&cell["weight"]) };
        model.set(month.parse().expect("month"), hour.parse().expect("hour"), cell);
    }
    model
}

#[test]
fn every_geometry_case_places_the_sun_as_recorded() {
    let cases = cases("sunPosition");
    assert_eq!(cases.len(), 5);
    for case in &cases {
        let (name, input, output) = (&case["case"], &case["input"], &case["output"]);
        let at_ms = input["atMs"].as_i64().expect("atMs");
        let sun = sun_position(number(&input["latitude"]), number(&input["longitude"]), at_ms);
        assert!(close(sun.elevation_deg, number(&output["sun"]["elevationDeg"])), "{name}");
        assert!(close(sun.azimuth_deg, number(&output["sun"]["azimuthDeg"])), "{name}");
        let planes = input["planes"].as_array().expect("planes");
        for (plane, want) in planes.iter().zip(output["cosAoi"].as_array().expect("cosAoi")) {
            let got = cos_aoi(sun, number(&plane["tilt"]), number(&plane["azimuth"]));
            assert!(close(got, number(want)), "{name} {plane}: {got} != {want}");
        }
    }
}

#[test]
fn every_power_case_yields_the_recorded_watts() {
    let cases = cases("pvPowerW");
    assert_eq!(cases.len(), 14);
    for case in &cases {
        let input = &case["input"];
        let sample = serde_json::from_value(input["sample"].clone()).expect("sample");
        let got = pv_power_w(
            &sample,
            number(&input["kwp"]),
            number(&input["tempCoefficient"]),
            number(&input["systemLoss"]),
        );
        let want = number(&case["output"]["watts"]);
        assert!(close(got, want), "{}: {got} != {want}", case["case"]);
    }
}

#[test]
fn every_forecast_case_exports_the_recorded_raw_and_usable_views() {
    let cases = cases("buildSolarForecast");
    assert_eq!(cases.len(), 16);
    let mut mismatches = Vec::new();
    for case in &cases {
        let input = &case["input"];
        let config = serde_json::from_value(input["config"].clone()).expect("config");
        let data = serde_json::from_value(input["data"].clone()).expect("data");
        let sim = input.get("sim").map(|sim| serde_json::from_value(sim.clone()).expect("sim"));
        // 3.x reads an absent `sim` as every input absent.
        let model = input.get("correction").map(correction);
        let time_zone = zone(input["timeZone"].as_str().expect("timeZone"));
        let run = Run {
            time_zone: &time_zone,
            now_ms: input["nowMs"].as_i64().expect("nowMs"),
            sim: sim.unwrap_or_default(),
            correction: model.as_ref(),
        };
        let forecast =
            build(&config, &data, input["provider"].as_str().expect("provider"), &run).expect("forecast");
        for (variant, key) in [(Variant::Raw, "raw"), (Variant::Usable, "usable")] {
            let got = serde_json::to_value(forecast.export(variant)).expect("export");
            diff(&format!("{} {key}", case["case"]), &got, &case["output"][key], &mut mismatches);
        }
    }
    assert!(mismatches.is_empty(), "{}", mismatches.join("\n"));
}
