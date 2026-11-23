//! Dormers (ADR 20): a traced face lying inside another, seen from above, is a dormer's. It cuts
//! its outline out of that face's module area, carries modules of its own, and its walls shade
//! what stands beside it.

use serde_json::{Value, json};

use super::fixtures::{MODULE, shaded_substrings};
use crate::{Misplaced, Place, Scene, Size, Sun};

const SIZE: Size = Size {
    width: 1.0,
    height: 1.0,
};

/// A flat 10 m square house at 3 m with a 2 m dormer from (4, 4) to (6, 6) seen from above, its
/// flat top at `top`: faces 0, the house's, and 1, the dormer's.
fn dormered(top: f64) -> Value {
    let points = json!([
        [0.0, 3.0, 0.0],
        [0.0, 3.0, 10.0],
        [10.0, 3.0, 10.0],
        [10.0, 3.0, 0.0],
        [4.0, top, 4.0],
        [4.0, top, 6.0],
        [6.0, top, 6.0],
        [6.0, top, 4.0]
    ]);
    let corners = |list: [usize; 4]| list.map(|p| points[p].clone()).to_vec();
    json!({
        "x": 0.0, "z": 0.0, "width": 0.0, "depth": 0.0, "eave": 0.0, "rotation": 0.0,
        "roof": { "kind": "flat" },
        "freeForm": {
            "footprint": [[0.0, 0.0], [0.0, 10.0], [10.0, 10.0], [10.0, 0.0]],
            "faces": [corners([0, 1, 2, 3]), corners([4, 5, 6, 7])],
            "traced": {
                "points": points,
                "lines": [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4]],
                "faces": [[0, 1, 2, 3], [4, 5, 6, 7]],
            },
        },
    })
}

fn scene(grids: &Value) -> Scene {
    serde_json::from_value(json!({
        "north": 0.0, "blocks": [dormered(4.5)], "obstacles": [], "grids": grids,
    }))
    .unwrap()
}

fn grid(face: usize, setback: f64, modules: &[[f64; 2]]) -> Value {
    let modules: Vec<Value> = modules
        .iter()
        .map(|&[across, up]| json!({ "across": across, "up": up, "landscape": false }))
        .collect();
    json!({
        "block": 0, "face": face, "moduleType": 7, "landscape": false, "setback": setback,
        "modules": modules,
    })
}

fn laid(grids: &Value) -> Result<usize, Misplaced> {
    let sized = |id| (id == 7).then_some(SIZE);
    scene(grids).modules(sized).map(|placed| placed.len())
}

#[test]
fn a_dormer_cuts_its_outline_out_of_its_faces_module_area() {
    // The house is level: across and up run along x and z from its corner.
    assert_eq!(
        laid(&json!([grid(0, 0.0, &[[1.0, 1.0], [8.0, 8.0]])])),
        Ok(2)
    );
    assert_eq!(
        laid(&json!([grid(0, 0.0, &[[4.5, 4.5]])])),
        Err(Misplaced::Setback { grid: 0, module: 0 })
    );
    // The setback holds from the cut's edge as from the face's.
    assert_eq!(laid(&json!([grid(0, 0.0, &[[2.9, 4.5]])])), Ok(1));
    assert_eq!(
        laid(&json!([grid(0, 0.3, &[[2.9, 4.5]])])),
        Err(Misplaced::Setback { grid: 0, module: 0 })
    );
}

#[test]
fn filling_a_face_leaves_its_dormer_free() {
    let sized = |id| (id == 7).then_some(SIZE);
    let filled = scene(&json!([grid(0, 0.0, &[])])).fill(0, sized);

    assert!(filled.len() > 50, "{}", filled.len());
    assert!(
        filled.iter().all(|&[u, v]| u + 1.0 <= 4.0 + 1e-6
            || u >= 6.0 - 1e-6
            || v + 1.0 <= 4.0 + 1e-6
            || v >= 6.0 - 1e-6),
        "{filled:?}"
    );
}

#[test]
fn a_dormers_own_face_carries_modules() {
    assert_eq!(laid(&json!([grid(1, 0.0, &[[0.5, 0.5]])])), Ok(1));
}

#[test]
fn a_module_beside_a_dormer_is_shaded_by_its_wall() {
    let scene = scene(&json!([]));
    let face = scene.roofs().remove(0);
    let occluders = scene.occluders();
    // West of the dormer, its centre 1 m from the wall at x = 4.
    let place = Place {
        centre: face.point([3.0, 5.0]),
        landscape: false,
    };
    // A low sun the dormer's 1.5 m wall stands in front of, and the same sun behind the module.
    let shade = |azimuth: f64| {
        let sun = Sun {
            zenith: 70.0,
            azimuth,
        };
        shaded_substrings(&MODULE, face.plane, place, sun, &occluders)
    };

    // ADR 17's azimuth: the dormer stands east of the module.
    assert!(shade(-90.0) > 0);
    assert_eq!(shade(90.0), 0);
}

#[test]
fn a_dormer_on_a_pitched_face_cuts_the_outline_it_has_seen_from_above() {
    // A 10 m × 8 m face falling half a metre each metre toward +z, a dormer from (4, 3) to (6, 5)
    // lying on it, as one traced and not yet raised.
    let at = |x: f64, z: f64| json!([x, 0.5f64.mul_add(-z, 7.0), z]);
    let points = json!([
        at(0.0, 0.0),
        at(0.0, 8.0),
        at(10.0, 8.0),
        at(10.0, 0.0),
        at(4.0, 3.0),
        at(4.0, 5.0),
        at(6.0, 5.0),
        at(6.0, 3.0)
    ]);
    let corners = |list: [usize; 4]| list.map(|p| points[p].clone()).to_vec();
    let mut block = dormered(4.5);
    block["freeForm"]["footprint"] = json!([[0.0, 0.0], [0.0, 8.0], [10.0, 8.0], [10.0, 0.0]]);
    block["freeForm"]["faces"] = json!([corners([0, 1, 2, 3]), corners([4, 5, 6, 7])]);
    block["freeForm"]["traced"]["points"] = points;
    let scene: Scene = serde_json::from_value(json!({
        "north": 0.0, "blocks": [block], "obstacles": [], "grids": [grid(0, 0.0, &[])],
    }))
    .unwrap();
    let face = scene.roofs().remove(0);
    let sized = |id| (id == 7).then_some(SIZE);
    let filled = scene.fill(0, sized);
    // Each module's middle seen from above: x east, z south (north is 0).
    let middles: Vec<[f64; 2]> = filled
        .iter()
        .map(|&[u, v]| {
            let [east, north, _] = face.point([u + 0.5, v + 0.5]);
            [east, -north]
        })
        .collect();

    assert!(middles.len() > 40, "{}", middles.len());
    assert!(
        middles.iter().all(|&[x, z]| x <= 3.5 + 1e-6
            || x >= 6.5 - 1e-6
            || z <= 2.5 + 1e-6
            || z >= 5.5 - 1e-6),
        "{middles:?}"
    );
}

#[test]
fn a_traced_roof_with_a_dormer_is_one_the_core_saves() {
    assert_eq!(scene(&json!([])).check_blocks(), Ok(()));
}
