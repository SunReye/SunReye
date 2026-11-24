//! Auto-stringing as the builder does it (ADR 20), on the south face of a 10 m × 8 m gable house at
//! 35°: two rows of eight portrait modules, 0–7 below and 8–15 above. The module's cold peak is
//! 37.21 V and its short-circuit current 12.5 A, so a window of 230 V takes 6 in series, 270 V 7
//! and 380 V 10, and 30 A carries two strings in parallel, 15 A one.

use std::collections::HashMap;

use serde_json::{Value, json};

use super::fixtures::MODULE;
use crate::{
    InverterLimits, ModuleType, MpptLimits, Scene, Strung, Unstrung, Wiring, auto_string,
    auto_string_face,
};

/// Modules 0–15, two rows of eight, each in no string; module `wired` in string 0 where given.
fn modules(wired: Option<usize>) -> Vec<Value> {
    (0..16_u32)
        .map(|i| {
            let mut module = json!({
                "across": f64::from(i % 8).mul_add(1.154, 0.3),
                "up": f64::from(i / 8).mul_add(1.742, 0.3),
                "landscape": false,
            });
            if wired == Some(usize::try_from(i).unwrap()) {
                module["string"] = json!(0);
                module["order"] = json!(0);
            }
            module
        })
        .collect()
}

fn house(grids: &Value) -> Scene {
    serde_json::from_value(json!({
        "north": 0.0,
        "blocks": [{
            "x": 0.0, "z": 0.0, "width": 10.0, "depth": 8.0, "eave": 3.0, "rotation": 0.0,
            "roof": { "kind": "gable", "pitch": 35.0 },
        }],
        "obstacles": [],
        "grids": grids,
    }))
    .unwrap()
}

fn south(modules: &[Value]) -> Value {
    json!({ "block": 0, "face": 1, "moduleType": 7, "landscape": false, "setback": 0.3,
        "modules": modules })
}

fn types() -> HashMap<u32, ModuleType> {
    HashMap::from([(7, MODULE)])
}

/// An input whose window takes up to `volts` and whose current carries `amperes`.
const fn input(volts: f64, amperes: f64) -> MpptLimits {
    MpptLimits {
        max_current: amperes,
        min_voltage: 0.0,
        max_voltage: volts,
        start_voltage: 0.0,
    }
}

fn inverter(inputs: Vec<MpptLimits>) -> InverterLimits {
    InverterLimits {
        max_input_voltage: None,
        inputs: Some(inputs),
    }
}

/// The layout's first string, on input 1 of inverter 1.
const FIRST: Wiring = Wiring {
    module_type: 7,
    device: 1,
    input: 1,
    modules: 0,
};

/// Each new string's input and its modules in wiring order, by their position in the grid.
fn made(strung: &Strung) -> Vec<(u32, Vec<usize>)> {
    strung
        .strings
        .iter()
        .enumerate()
        .map(|(nth, wiring)| (wiring.input, run(&strung.scene, nth + 1)))
        .collect()
}

/// The modules of string `string` in their wiring order.
fn run(scene: &Scene, string: usize) -> Vec<usize> {
    let mut wired: Vec<(u32, usize)> = scene.grids[0]
        .modules
        .iter()
        .enumerate()
        .filter(|(_, m)| m.string == Some(u32::try_from(string).unwrap()))
        .map(|(at, m)| (m.order.unwrap(), at))
        .collect();
    wired.sort_unstable();
    wired.into_iter().map(|(_, at)| at).collect()
}

fn strung(scene: &Scene, inverter: &InverterLimits) -> Strung {
    auto_string_face(scene, 0, &types(), 1, inverter, &[FIRST]).unwrap()
}

#[test]
fn with_an_input_free_for_each_a_faces_modules_run_in_a_serpentine_into_as_few_even_strings() {
    let scene = house(&json!([south(&modules(None))]));
    let four = inverter(vec![input(230.0, 30.0); 4]);
    let result = strung(&scene, &four);
    // 16 modules at most 6 long: three strings of 6, 5 and 5, each alone on its input.
    assert_eq!(
        made(&result),
        vec![
            (2, vec![0, 1, 2, 3, 4, 5]),
            (3, vec![6, 7, 15, 14, 13]),
            (4, vec![12, 11, 10, 9, 8]),
        ]
    );
    assert_eq!(result.left, 0);
    assert_eq!(
        result.strings[0],
        Wiring {
            input: 2,
            modules: 6,
            ..FIRST
        }
    );
}

#[test]
fn strings_that_share_an_input_are_all_one_length_the_fewest_that_leave_no_module_over() {
    let scene = house(&json!([south(&modules(None))]));
    let result = strung(&scene, &inverter(vec![input(230.0, 30.0); 3]));
    // Three strings would be 6, 5 and 5 with two in parallel: four of four share the two inputs.
    assert_eq!(
        made(&result),
        vec![
            (2, vec![0, 1, 2, 3]),
            (2, vec![4, 5, 6, 7]),
            (3, vec![15, 14, 13, 12]),
            (3, vec![11, 10, 9, 8]),
        ]
    );
    assert_eq!(result.left, 0);
}

#[test]
fn where_no_equal_cut_holds_every_module_the_rest_stays_unwired_and_is_counted() {
    let scene = house(&json!([south(&modules(Some(3)))]));
    // 15 modules at most 7 long on one input that carries two strings: two of seven, one over.
    let result = strung(&scene, &inverter(vec![input(270.0, 30.0); 2]));
    assert_eq!(
        made(&result),
        vec![
            (2, vec![0, 1, 2, 4, 5, 6, 7]),
            (2, vec![15, 14, 13, 12, 11, 10, 9]),
        ]
    );
    assert_eq!(result.left, 1);
    // The wired module stays as it is.
    assert_eq!(run(&result.scene, 0), vec![3]);
}

#[test]
fn without_limits_the_face_is_one_string_no_free_input_no_proposal_none_unwired_nothing() {
    let scene = house(&json!([south(&modules(None))]));
    let unknown = InverterLimits {
        max_input_voltage: None,
        inputs: None,
    };
    // An inverter that lists no inputs has as many as its strings name, and one more.
    let whole = strung(&scene, &unknown);
    assert_eq!(
        made(&whole),
        vec![(
            2,
            vec![0, 1, 2, 3, 4, 5, 6, 7, 15, 14, 13, 12, 11, 10, 9, 8]
        )]
    );
    let one = inverter(vec![input(230.0, 30.0)]);
    assert_eq!(
        auto_string_face(&scene, 0, &types(), 1, &one, &[FIRST]),
        Err(Unstrung::NoFreeInput)
    );
    assert_eq!(
        auto_string_face(&whole.scene, 0, &types(), 1, &unknown, &[FIRST]),
        Err(Unstrung::Nothing)
    );
}

#[test]
fn each_free_input_is_sized_by_its_own_limits_a_short_window_takes_a_shorter_string() {
    let scene = house(&json!([south(&modules(None))]));
    let inputs = vec![input(230.0, 30.0), input(230.0, 15.0), input(380.0, 15.0)];
    let result = strung(&scene, &inverter(inputs));
    assert_eq!(
        made(&result),
        vec![
            (2, vec![0, 1, 2, 3, 4, 5]),
            (3, vec![6, 7, 15, 14, 13, 12, 11, 10, 9, 8]),
        ]
    );
    assert_eq!(result.left, 0);
}

#[test]
fn an_input_carries_no_more_strings_in_parallel_than_its_own_current_allows() {
    let scene = house(&json!([south(&modules(None))]));
    let inputs = vec![input(230.0, 30.0), input(230.0, 30.0), input(230.0, 15.0)];
    let result = strung(&scene, &inverter(inputs));
    // Four of four would put two on input 3: three of five fit, and one module stays over.
    let wired: Vec<(u32, u16)> = result
        .strings
        .iter()
        .map(|w| (w.input, w.modules))
        .collect();
    assert_eq!(wired, vec![(2, 5), (2, 5), (3, 5)]);
    assert_eq!(result.left, 1);
}

#[test]
fn the_inverters_maximum_dc_voltage_shortens_its_strings_too() {
    let scene = house(&json!([south(&modules(None))]));
    // 5 × 44.87 V = 224.4 V open in the cold under 230 V; a sixth would be 269.2 V.
    let limits = InverterLimits {
        max_input_voltage: Some(230.0),
        inputs: Some(vec![input(1000.0, 60.0); 5]),
    };
    let lengths: Vec<u16> = strung(&scene, &limits)
        .strings
        .iter()
        .map(|w| w.modules)
        .collect();
    assert_eq!(lengths, vec![4, 4, 4, 4]);
}

#[test]
fn a_whole_roof_is_strung_face_by_face_the_largest_first_on_the_inputs_left() {
    // The north face holds 4 modules, the south 16: the south is strung first and takes inputs 2
    // and 3, so the north's one string goes to input 4.
    let north = json!({ "block": 0, "face": 0, "moduleType": 7, "landscape": false,
        "setback": 0.3, "modules": modules(None)[..4] });
    let scene = house(&json!([north, south(&modules(None))]));
    let (strung, strings, left) = auto_string(
        &scene,
        &types(),
        1,
        &inverter(vec![input(380.0, 15.0); 4]),
        &[FIRST],
    );
    let wired: Vec<(u32, u16)> = strings.iter().map(|w| (w.input, w.modules)).collect();
    assert_eq!(wired, vec![(2, 8), (3, 8), (4, 4)]);
    assert_eq!(left, 0);
    let north_strings: Vec<Option<u32>> =
        strung.grids[0].modules.iter().map(|m| m.string).collect();
    assert_eq!(north_strings, vec![Some(3); 4]);
}

#[test]
fn faces_left_without_a_free_input_keep_their_modules_unwired_and_counted() {
    let north = json!({ "block": 0, "face": 0, "moduleType": 7, "landscape": false,
        "setback": 0.3, "modules": modules(None)[..4] });
    let scene = house(&json!([north, south(&modules(None))]));
    let (_, strings, left) = auto_string(
        &scene,
        &types(),
        1,
        &inverter(vec![input(1000.0, 15.0); 2]),
        &[FIRST],
    );
    assert_eq!(strings.len(), 1);
    assert_eq!(left, 4);
}
