//! Free-form roofs (ADR 20): a block on a polygon footprint under faces given by their corners,
//! checked against the 10 m × 8 m gable house at 35° the four roofs already build.

use serde_json::{Value, json};

use crate::{RoofFace, Scene};

fn scene(north: f64, blocks: &Value) -> Scene {
    serde_json::from_value(json!({ "north": north, "blocks": blocks, "obstacles": [] })).unwrap()
}

fn parametric() -> Value {
    json!({
        "x": 0.0, "z": 0.0, "width": 10.0, "depth": 8.0, "eave": 3.0, "rotation": 0.0,
        "roof": { "kind": "gable", "pitch": 35.0 },
    })
}

/// A block whose free-form part is `footprint` and `faces`.
fn free(footprint: &Value, faces: &Value) -> Value {
    json!({
        "x": 0.0, "z": 0.0, "width": 0.0, "depth": 0.0, "eave": 0.0, "rotation": 0.0,
        "roof": { "kind": "flat" },
        "freeForm": { "footprint": footprint, "faces": faces },
    })
}

/// The gable's faces as free-form ones, back then front, counter-clockwise seen from above.
fn gable() -> Value {
    let ridge = 4f64.mul_add(35f64.to_radians().tan(), 3.0);
    free(
        &json!([[0.0, 0.0], [10.0, 0.0], [10.0, 8.0], [0.0, 8.0]]),
        &json!([
            [
                [0.0, 3.0, 0.0],
                [0.0, ridge, 4.0],
                [10.0, ridge, 4.0],
                [10.0, 3.0, 0.0]
            ],
            [
                [0.0, 3.0, 8.0],
                [10.0, 3.0, 8.0],
                [10.0, ridge, 4.0],
                [0.0, ridge, 4.0]
            ],
        ]),
    )
}

fn near(a: &[f64], b: &[f64]) -> bool {
    a.iter().zip(b).all(|(a, b)| (a - b).abs() < 1e-9)
}

/// The same face up to where its outline starts.
fn same(a: &RoofFace, b: &RoofFace) -> bool {
    let holds = |outline: &[[f64; 2]], p: &[f64; 2]| outline.iter().any(|q| near(q, p));
    (a.block, a.face) == (b.block, b.face)
        && (a.plane.tilt - b.plane.tilt).abs() < 1e-9
        && (a.plane.azimuth - b.plane.azimuth).abs() < 1e-9
        && near(&a.origin, &b.origin)
        && near(&a.across, &b.across)
        && near(&a.up, &b.up)
        && a.outline.len() == b.outline.len()
        && a.outline.iter().all(|p| holds(&b.outline, p))
}

#[test]
fn a_scene_with_a_free_form_roof_reads_and_writes_unchanged() {
    let stored = json!({ "north": 30.0, "blocks": [gable()], "obstacles": [], "grids": [] });

    let scene: Scene = serde_json::from_value(stored.clone()).unwrap();

    assert_eq!(serde_json::to_value(&scene).unwrap(), stored);
}

#[test]
fn a_free_form_face_has_the_plane_outline_and_frame_of_the_roof_it_copies() {
    let roofs = scene(30.0, &json!([gable()])).roofs();
    let expected = scene(30.0, &json!([parametric()])).roofs();

    assert_eq!(roofs.len(), 2);
    for (face, parametric) in roofs.iter().zip(&expected) {
        assert!(same(face, parametric), "{face:?}\n{parametric:?}");
    }
}

/// The second block, after the parametric house, with `faces` over a 10 m × 8 m footprint.
fn refused(faces: &Value) -> Result<(), usize> {
    let footprint = json!([[0.0, 0.0], [10.0, 0.0], [10.0, 8.0], [0.0, 8.0]]);
    scene(0.0, &json!([parametric(), free(&footprint, faces)])).check_blocks()
}

#[test]
fn a_free_form_roof_of_flat_faces_over_its_footprint_is_valid() {
    assert_eq!(
        scene(30.0, &json!([parametric(), gable()])).check_blocks(),
        Ok(())
    );
}

#[test]
fn a_face_whose_corners_stray_more_than_two_centimetres_off_its_plane_is_refused() {
    let lifted = |by: f64| {
        json!([[
            [0.0, 3.0, 8.0],
            [10.0, 3.0, 8.0],
            [10.0, 3.0 + by, 0.0],
            [0.0, 3.0, 0.0]
        ]])
    };

    // One corner lifted by 4h strays h from the plane through the corners' mean.
    assert_eq!(refused(&lifted(0.07)), Ok(()));
    assert_eq!(refused(&lifted(0.09)), Err(1));
}

#[test]
fn a_face_of_fewer_than_three_corners_is_refused() {
    assert_eq!(
        refused(&json!([[[0.0, 3.0, 8.0], [10.0, 3.0, 8.0]]])),
        Err(1)
    );
}

#[test]
fn a_face_that_crosses_itself_is_refused() {
    let bow_tie = json!([[
        [0.0, 3.0, 8.0],
        [10.0, 3.0, 0.0],
        [10.0, 3.0, 8.0],
        [0.0, 3.0, 0.0]
    ]]);

    assert_eq!(refused(&bow_tie), Err(1));
}

#[test]
fn a_face_listed_clockwise_from_above_faces_downward_and_is_refused() {
    let clockwise = json!([[
        [0.0, 3.0, 8.0],
        [0.0, 3.0, 0.0],
        [10.0, 3.0, 0.0],
        [10.0, 3.0, 8.0]
    ]]);

    assert_eq!(refused(&clockwise), Err(1));
}

#[test]
fn an_upright_face_is_refused() {
    let upright = json!([[
        [0.0, 3.0, 8.0],
        [10.0, 3.0, 8.0],
        [10.0, 6.0, 8.0],
        [0.0, 6.0, 8.0]
    ]]);

    assert_eq!(refused(&upright), Err(1));
}

#[test]
fn a_face_with_a_repeated_corner_or_no_area_is_refused() {
    let repeated = json!([[
        [0.0, 3.0, 8.0],
        [10.0, 3.0, 8.0],
        [10.0, 3.0, 8.0],
        [0.0, 3.0, 0.0]
    ]]);
    let in_line = json!([[[0.0, 3.0, 8.0], [5.0, 3.0, 8.0], [10.0, 3.0, 8.0]]]);

    assert_eq!(refused(&repeated), Err(1));
    assert_eq!(refused(&in_line), Err(1));
}

#[test]
fn a_face_sharing_no_area_with_the_footprint_seen_from_above_is_refused() {
    let beside = json!([[
        [11.0, 3.0, 8.0],
        [14.0, 3.0, 8.0],
        [14.0, 3.0, 0.0],
        [11.0, 3.0, 0.0]
    ]]);
    let touching = json!([[
        [10.0, 3.0, 8.0],
        [14.0, 3.0, 8.0],
        [14.0, 3.0, 0.0],
        [10.0, 3.0, 0.0]
    ]]);
    let overhanging = json!([[
        [-0.5, 3.0, 8.5],
        [10.5, 3.0, 8.5],
        [10.5, 3.0, -0.5],
        [-0.5, 3.0, -0.5]
    ]]);
    let inside = json!([[
        [2.0, 3.0, 6.0],
        [8.0, 3.0, 6.0],
        [8.0, 3.0, 2.0],
        [2.0, 3.0, 2.0]
    ]]);

    assert_eq!(refused(&beside), Err(1));
    assert_eq!(refused(&touching), Err(1));
    assert_eq!(refused(&overhanging), Ok(()));
    assert_eq!(refused(&inside), Ok(()));
}

#[test]
fn a_footprint_of_fewer_than_three_corners_or_crossing_itself_is_refused() {
    let faces = json!([[
        [0.0, 3.0, 8.0],
        [10.0, 3.0, 8.0],
        [10.0, 3.0, 0.0],
        [0.0, 3.0, 0.0]
    ]]);
    let check = |footprint: Value| scene(0.0, &json!([free(&footprint, &faces)])).check_blocks();

    assert_eq!(check(json!([[0.0, 0.0], [10.0, 8.0]])), Err(0));
    assert_eq!(
        check(json!([[0.0, 0.0], [10.0, 8.0], [10.0, 0.0], [0.0, 8.0]])),
        Err(0)
    );
}

#[test]
fn a_free_form_block_with_an_overhang_of_its_own_is_refused() {
    let mut block = gable();
    block["overhang"] = json!({ "eave": 0.5, "verge": 0.0 });

    assert_eq!(scene(0.0, &json!([block])).check_blocks(), Err(0));
}
