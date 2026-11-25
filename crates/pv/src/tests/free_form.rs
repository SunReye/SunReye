//! Free-form roofs (ADR 20): a block on a polygon footprint under faces given by their corners,
//! checked against the 10 m × 8 m gable house at 35° the four roofs already build.

use serde_json::{Value, json};

use super::fixtures::{MODULE, shaded_substrings};
use crate::{
    Misplaced, ModuleType, Occluder, Place, Plane, Point, RoofFace, Scene, Size, Sun, Surface,
};

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

const SIZE: Size = Size {
    width: 1.134,
    height: 1.722,
};

/// A level L-shaped roof at 3 m over its footprint. Across runs along x and up along −z from
/// z = 10, so the arms are 0 m to 4 m across and 6 m to 10 m up; the notch between is free.
fn ell(rest: &Value) -> Scene {
    let block = free(
        &json!([
            [0.0, 0.0],
            [10.0, 0.0],
            [10.0, 4.0],
            [4.0, 4.0],
            [4.0, 10.0],
            [0.0, 10.0]
        ]),
        &json!([[
            [0.0, 3.0, 0.0],
            [0.0, 3.0, 10.0],
            [4.0, 3.0, 10.0],
            [4.0, 3.0, 4.0],
            [10.0, 3.0, 4.0],
            [10.0, 3.0, 0.0],
        ]]),
    );
    let mut scene = json!({ "north": 0.0, "blocks": [block], "obstacles": [] });
    if let (Some(scene), Some(rest)) = (scene.as_object_mut(), rest.as_object()) {
        scene.extend(rest.clone());
    }
    serde_json::from_value(scene).unwrap()
}

fn laid(modules: &Value) -> Result<usize, Misplaced> {
    let grids = json!([{
        "block": 0, "face": 0, "moduleType": 7, "landscape": false, "setback": 0.3,
        "modules": modules,
    }]);
    let sized = |id| (id == 7).then_some(SIZE);
    ell(&json!({ "grids": grids }))
        .modules(sized)
        .map(|placed| placed.len())
}

fn portrait(across: f64, up: f64) -> Value {
    json!({ "across": across, "up": up, "landscape": false })
}

#[test]
fn modules_lie_on_both_arms_of_a_non_convex_face_and_not_across_its_notch() {
    let arms = json!([portrait(1.0, 1.0), portrait(7.0, 7.0)]);

    assert_eq!(laid(&arms), Ok(2));
    assert_eq!(
        laid(&json!([portrait(3.5, 4.0)])),
        Err(Misplaced::Setback { grid: 0, module: 0 })
    );
}

#[test]
fn a_module_whose_corners_all_lie_on_the_face_but_which_spans_a_notch_is_refused() {
    // A square face with a notch from its top edge down to (5, 6), across and up.
    let block = free(
        &json!([[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0]]),
        &json!([[
            [0.0, 3.0, 10.0],
            [10.0, 3.0, 10.0],
            [10.0, 3.0, 0.0],
            [6.0, 3.0, 0.0],
            [5.0, 3.0, 4.0],
            [4.0, 3.0, 0.0],
            [0.0, 3.0, 0.0],
        ]]),
    );
    let module = |up: f64| {
        json!({
            "north": 0.0, "blocks": [block], "obstacles": [],
            "grids": [{
                "block": 0, "face": 0, "moduleType": 7, "landscape": true, "setback": 0.1,
                "modules": [{ "across": 4.14, "up": up, "landscape": true }],
            }],
        })
    };
    let placed = |up| {
        let scene: Scene = serde_json::from_value(module(up)).unwrap();
        scene
            .modules(|id| (id == 7).then_some(SIZE))
            .map(|p| p.len())
    };

    assert_eq!(placed(1.0), Ok(1));
    assert_eq!(placed(7.4), Err(Misplaced::Setback { grid: 0, module: 0 }));
}

#[test]
fn roof_chimneys_and_roof_windows_stand_on_a_non_convex_face_but_not_across_its_notch() {
    let chimney = |across: f64, up: f64| {
        json!({ "chimneys": [{
            "block": 0, "face": 0, "across": across, "up": up, "width": 0.6, "depth": 0.6,
            "height": 1.2,
        }] })
    };
    let window = |across: f64, up: f64| {
        json!({ "roofWindows": [{
            "block": 0, "face": 0, "across": across, "up": up, "width": 0.78, "length": 1.18,
        }] })
    };

    assert_eq!(ell(&chimney(2.0, 2.0)).check_chimneys(), Ok(()));
    assert_eq!(ell(&chimney(4.1, 5.0)).check_chimneys(), Err(0));
    assert!(ell(&window(8.0, 8.0)).panes().is_ok());
    assert_eq!(ell(&window(4.1, 5.0)).panes(), Err(0));
}

/// The L-shaped roof listed from a corner a fan of triangles would wrongly close over the notch.
fn ell_from_its_far_corner() -> Scene {
    let block = free(
        &json!([
            [0.0, 0.0],
            [10.0, 0.0],
            [10.0, 4.0],
            [4.0, 4.0],
            [4.0, 10.0],
            [0.0, 10.0]
        ]),
        &json!([[
            [0.0, 3.0, 10.0],
            [4.0, 3.0, 10.0],
            [4.0, 3.0, 4.0],
            [10.0, 3.0, 4.0],
            [10.0, 3.0, 0.0],
            [0.0, 3.0, 0.0],
        ]]),
    );
    scene(0.0, &json!([block]))
}

/// How many substrings of a small level module on the ground at `east` and `north` the scene
/// shades under a high southern sun.
fn ground_shade(scene: &Scene, east: f64, north: f64) -> u8 {
    let small = ModuleType {
        width: 0.4,
        height: 0.4,
        ..MODULE
    };
    shaded_substrings(
        &small,
        Plane {
            tilt: 0.0,
            azimuth: 0.0,
        },
        Place {
            centre: [east, north, 0.1],
            landscape: false,
        },
        Sun {
            zenith: 5.0,
            azimuth: 0.0,
        },
        &scene.occluders(),
    )
}

#[test]
fn a_non_convex_face_shades_under_itself_and_not_under_its_notch() {
    let scene = ell_from_its_far_corner();

    assert_eq!(ground_shade(&scene, 2.0, -2.0), MODULE.bypass_diodes);
    assert_eq!(ground_shade(&scene, 7.0, -4.6), 0);
}

fn surfaces(scene: &Scene, surface: Surface) -> Vec<Vec<Point>> {
    let faces = scene.faces().into_iter().filter(|f| f.surface == surface);
    faces.map(|f| f.corners).collect()
}

#[test]
fn the_walls_reach_up_to_the_faces_as_the_gable_it_copies_does() {
    let walls = surfaces(&scene(30.0, &json!([gable()])), Surface::Wall);
    let expected = surfaces(&scene(30.0, &json!([parametric()])), Surface::Wall);

    assert_eq!(walls.len(), expected.len());
    for (wall, parametric) in walls.iter().zip(&expected) {
        assert_eq!(wall.len(), parametric.len(), "{wall:?}\n{parametric:?}");
        assert!(
            wall.iter().zip(parametric).all(|(a, b)| near(a, b)),
            "{wall:?}\n{parametric:?}"
        );
    }
}

#[test]
fn a_wall_steps_where_the_faces_over_it_step_and_stands_nowhere_without_one() {
    // A level roof at 3 m over x 0 to 6 and at 5 m over x 6 to 10; nothing over x 10 to 12.
    let level = |from: f64, to: f64, height: f64| {
        json!([
            [from, height, 4.0],
            [to, height, 4.0],
            [to, height, 0.0],
            [from, height, 0.0]
        ])
    };
    let block = free(
        &json!([[0.0, 0.0], [12.0, 0.0], [12.0, 4.0], [0.0, 4.0]]),
        &json!([level(0.0, 6.0, 3.0), level(6.0, 10.0, 5.0)]),
    );

    let walls = surfaces(&scene(0.0, &json!([block])), Surface::Wall);

    // The back wall along z = 0, from x = 0 to 12, seen in the shading frame (north = −z).
    let back = walls.first().unwrap();
    let expected: [Point; 7] = [
        [0.0, 0.0, 0.0],
        [12.0, 0.0, 0.0],
        [10.0, 0.0, 0.0],
        [10.0, 0.0, 5.0],
        [6.0, 0.0, 5.0],
        [6.0, 0.0, 3.0],
        [0.0, 0.0, 3.0],
    ];
    assert_eq!(back.len(), expected.len(), "{back:?}");
    assert!(
        back.iter().zip(&expected).all(|(a, b)| near(a, b)),
        "{back:?}"
    );
}

#[test]
fn an_open_free_form_block_stands_a_post_at_each_footprint_corner_up_to_the_faces() {
    let mut block = gable();
    block["open"] = json!(true);

    let posts = scene(0.0, &json!([block.clone()])).solids();

    let tops: Vec<(Point, f64)> = posts
        .iter()
        .filter_map(|solid| match *solid {
            Occluder::Cylinder { base, height, .. } => Some((base, height)),
            Occluder::Triangle(_) | Occluder::Sphere { .. } | Occluder::Cone { .. } => None,
        })
        .collect();
    assert_eq!(tops.len(), 4);
    assert!(
        tops.iter().all(|(_, height)| (height - 3.0).abs() < 1e-9),
        "{tops:?}"
    );
    assert!(near(&tops[2].0, &[10.0, -8.0, 0.0]), "{tops:?}");
    assert_eq!(
        surfaces(&scene(0.0, &json!([block])), Surface::Wall),
        Vec::<Vec<Point>>::new()
    );
}

#[test]
fn a_wall_opening_or_an_equipment_marker_on_a_free_form_block_is_refused() {
    // Its unused corner, size and eave would hold both.
    let mut block = gable();
    for (key, value) in [("width", 10.0), ("depth", 8.0), ("eave", 3.0)] {
        block[key] = json!(value);
    }
    let with = |rest: &Value| {
        let mut scene = json!({ "north": 0.0, "blocks": [block.clone()], "obstacles": [] });
        if let (Some(scene), Some(rest)) = (scene.as_object_mut(), rest.as_object()) {
            scene.extend(rest.clone());
        }
        serde_json::from_value::<Scene>(scene).unwrap()
    };
    let opening = with(&json!({ "openings": [{
        "kind": "window", "block": 0, "wall": "front", "along": 2.0, "width": 1.0,
        "height": 1.2, "sill": 0.9,
    }] }));
    let marker = with(&json!({ "equipment": [{
        "device": 1, "kind": "inverter", "block": 0, "wall": "front", "along": 2.0,
        "inside": false,
    }] }));

    assert_eq!(opening.fitted(), Err(0));
    assert_eq!(marker.mounts(), Err(0));
}

#[test]
fn a_level_face_keeps_its_frame_whichever_corner_its_corners_start_from() {
    let one = ell(&json!({ "north": 30.0 })).roofs();
    let other = {
        let mut scene = ell_from_its_far_corner();
        scene.north = 30.0;
        scene.roofs()
    };

    assert!(same(&one[0], &other[0]), "{:?}\n{:?}", one[0], other[0]);
    assert!(near(
        &one[0].across,
        &[30f64.to_radians().cos(), -30f64.to_radians().sin(), 0.0]
    ));
}

#[test]
fn a_face_bent_within_the_tolerance_does_not_shade_its_own_modules() {
    // One eave corner 7 cm up: 1.75 cm off the plane, inside the tolerance.
    let block = free(
        &json!([[0.0, 0.0], [10.0, 0.0], [10.0, 8.0], [0.0, 8.0]]),
        &json!([[
            [0.0, 3.0, 8.0],
            [10.0, 3.0, 8.0],
            [10.0, 3.07, 0.0],
            [0.0, 3.0, 0.0]
        ]]),
    );
    let scene = scene(0.0, &json!([block]));
    let face = scene.roofs().remove(0);
    let occluders = scene.occluders();
    let small = ModuleType {
        width: 0.4,
        height: 0.4,
        ..MODULE
    };

    // Half a metre in from each corner, and the middle, on the face's plane.
    let mean = face
        .outline
        .iter()
        .fold([0.0, 0.0], |[u, v], [pu, pv]| [u + pu / 4.0, v + pv / 4.0]);
    let spots = face.outline.iter().map(|&[u, v]| {
        let (du, dv) = (mean[0] - u, mean[1] - v);
        let length = du.hypot(dv);
        [(du / length).mul_add(0.5, u), (dv / length).mul_add(0.5, v)]
    });
    for spot in spots.chain([mean]) {
        let place = Place {
            centre: face.point(spot),
            landscape: false,
        };
        for zenith in [10.0, 40.0, 70.0] {
            let sun = Sun {
                zenith,
                azimuth: 0.0,
            };
            let shade = shaded_substrings(&small, face.plane, place, sun, &occluders);
            assert_eq!(shade, 0, "{place:?} under {zenith}°");
        }
    }
}

/// A traced block (ADR 20): the 4 m square at height 0 split by the line from (0, 0) to (4, 4),
/// its two faces naming their points.
fn traced(points: &Value, lines: &Value, faces: &Value, loops: &Value, footprint: &Value) -> Value {
    json!({
        "x": 0.0, "z": 0.0, "width": 0.0, "depth": 0.0, "eave": 0.0, "rotation": 0.0,
        "roof": { "kind": "flat" },
        "freeForm": {
            "footprint": footprint,
            "faces": faces,
            "traced": { "points": points, "lines": lines, "faces": loops },
        },
    })
}

fn square() -> Value {
    traced(
        &json!([
            [0.0, 0.0, 0.0],
            [0.0, 0.0, 4.0],
            [4.0, 0.0, 4.0],
            [4.0, 0.0, 0.0]
        ]),
        &json!([[0, 1], [1, 2], [2, 3], [3, 0], [0, 2]]),
        &json!([
            [[0.0, 0.0, 0.0], [0.0, 0.0, 4.0], [4.0, 0.0, 4.0]],
            [[0.0, 0.0, 0.0], [4.0, 0.0, 4.0], [4.0, 0.0, 0.0]],
        ]),
        &json!([[0, 1, 2], [0, 2, 3]]),
        &json!([[0.0, 0.0], [0.0, 4.0], [4.0, 4.0], [4.0, 0.0]]),
    )
}

#[test]
fn a_traced_roof_reads_and_writes_unchanged() {
    let stored = json!({ "north": 0.0, "blocks": [square()], "obstacles": [], "grids": [] });

    let scene: Scene = serde_json::from_value(stored.clone()).unwrap();

    assert_eq!(serde_json::to_value(&scene).unwrap(), stored);
    assert_eq!(scene.check_blocks(), Ok(()));
}

#[test]
fn a_traced_face_whose_corners_are_not_its_points_is_refused() {
    let mut block = square();
    block["freeForm"]["traced"]["faces"] = json!([[0, 1, 2], [0, 1, 3]]);

    assert_eq!(scene(0.0, &json!([block])).check_blocks(), Err(0));
}

#[test]
fn a_traced_line_or_face_naming_no_point_is_refused() {
    let mut line = square();
    line["freeForm"]["traced"]["lines"] = json!([[0, 9]]);
    let mut same = square();
    same["freeForm"]["traced"]["lines"] = json!([[1, 1]]);
    let mut set = square();
    set["freeForm"]["traced"]["set"] = json!([4]);
    let mut count = square();
    count["freeForm"]["traced"]["faces"] = json!([[0, 1, 2]]);

    for block in [line, same, set, count] {
        assert_eq!(
            scene(0.0, &json!([block])).check_blocks(),
            Err(0),
            "{block}"
        );
    }
}

#[test]
fn a_roof_being_traced_has_no_footprint_until_its_lines_close() {
    let open = traced(
        &json!([[0.0, 0.0, 0.0], [0.0, 0.0, 4.0], [4.0, 0.0, 4.0]]),
        &json!([[0, 1], [1, 2]]),
        &json!([]),
        &json!([]),
        &json!([]),
    );
    let untraced = free(&json!([]), &json!([]));

    assert_eq!(scene(0.0, &json!([open])).check_blocks(), Ok(()));
    assert_eq!(scene(0.0, &json!([untraced])).check_blocks(), Err(0));
    assert_eq!(
        surfaces(&scene(0.0, &json!([open])), Surface::Wall).len(),
        0
    );
}

/// A traced 4 m square, one face, whose corner (4, 4) stands at `height` and the rest at 3 m.
fn raised(height: f64) -> Value {
    let points = json!([
        [0.0, 3.0, 0.0],
        [0.0, 3.0, 4.0],
        [4.0, height, 4.0],
        [4.0, 3.0, 0.0]
    ]);
    traced(
        &points,
        &json!([[0, 1], [1, 2], [2, 3], [3, 0]]),
        &json!([points]),
        &json!([[0, 1, 2, 3]]),
        &json!([[0.0, 0.0], [0.0, 4.0], [4.0, 4.0], [4.0, 0.0]]),
    )
}

#[test]
fn a_bent_traced_face_is_kept_but_a_bent_face_entered_by_its_corners_is_refused() {
    let bent = raised(4.0);
    let entered = free(&bent["freeForm"]["footprint"], &bent["freeForm"]["faces"]);

    assert_eq!(scene(0.0, &json!([bent])).check_blocks(), Ok(()));
    assert_eq!(scene(0.0, &json!([entered])).check_blocks(), Err(0));
}

#[test]
fn a_module_grid_on_a_bent_traced_face_is_refused() {
    let grids = json!([{
        "block": 0, "face": 0, "moduleType": 7, "landscape": false, "setback": 0.0,
        "modules": [portrait(0.5, 0.5)],
    }]);
    let sized = |id| (id == 7).then_some(SIZE);
    let laid = |block: Value| {
        let stored = json!({ "north": 0.0, "blocks": [block], "obstacles": [], "grids": grids });
        serde_json::from_value::<Scene>(stored)
            .unwrap()
            .modules(sized)
            .map(|placed| placed.len())
    };

    assert_eq!(laid(raised(3.0)), Ok(1));
    assert_eq!(laid(raised(4.0)), Err(Misplaced::Face { grid: 0 }));
}

#[test]
fn a_traced_roof_keeps_the_points_the_person_made_eaves_and_ridges() {
    let mut block = square();
    block["freeForm"]["traced"]["eaves"] = json!([0, 1]);
    block["freeForm"]["traced"]["ridges"] = json!([2]);
    let stored = json!({ "north": 0.0, "blocks": [block], "obstacles": [], "grids": [] });

    let read: Scene = serde_json::from_value(stored.clone()).unwrap();

    assert_eq!(serde_json::to_value(&read).unwrap(), stored);
    assert_eq!(read.check_blocks(), Ok(()));

    for field in ["eaves", "ridges"] {
        let mut stray = square();
        stray["freeForm"]["traced"][field] = json!([4]);
        assert_eq!(scene(0.0, &json!([stray])).check_blocks(), Err(0));
    }
}

#[test]
fn a_bent_traced_face_offers_no_free_roof_to_fill() {
    let grids = json!([{
        "block": 0, "face": 0, "moduleType": 7, "landscape": false, "setback": 0.0, "modules": [],
    }]);
    let sized = |id| (id == 7).then_some(SIZE);
    let free = |block: Value| {
        let stored = json!({ "north": 0.0, "blocks": [block], "obstacles": [], "grids": grids });
        serde_json::from_value::<Scene>(stored)
            .unwrap()
            .fill(0, sized, crate::FillRules::default())
            .len()
    };

    assert!(free(raised(3.0)) > 0);
    assert_eq!(free(raised(4.0)), 0);
}

#[test]
fn existing_pv_stays_on_a_bent_traced_face() {
    // In the middle of the face, which a bent face's outline still holds.
    let field =
        json!([{ "block": 0, "face": 0, "across": 2.0, "up": 2.0, "width": 1.0, "length": 1.0 }]);
    let on = |block: Value| {
        let stored =
            json!({ "north": 0.0, "blocks": [block], "obstacles": [], "existingPv": field });
        serde_json::from_value::<Scene>(stored)
            .unwrap()
            .existing_fields()
            .map(|f| f.len())
    };

    assert_eq!(on(raised(3.0)), Ok(1));
    assert_eq!(on(raised(4.0)), Ok(1));
}

/// A level traced rectangle, 10 m by 6 m at 3 m, turned 15° from the scene's axes.
fn turned_flat() -> Scene {
    let (cos, sin) = (15f64.to_radians().cos(), 15f64.to_radians().sin());
    let corners: Vec<[f64; 2]> = [[0.0, 0.0], [10.0, 0.0], [10.0, 6.0], [0.0, 6.0]]
        .iter()
        .map(|&[x, z]: &[f64; 2]| [x.mul_add(cos, -z * sin), x.mul_add(sin, z * cos)])
        .collect();
    let faces: Vec<[f64; 3]> = corners.iter().rev().map(|&[x, z]| [x, 3.0, z]).collect();
    scene(0.0, &json!([free(&json!(corners), &json!([faces]))]))
}

#[test]
fn a_level_traced_face_lays_its_rows_along_its_longest_edge() {
    let face = turned_flat().roofs().remove(0);
    let (cos, sin) = (15f64.to_radians().cos(), 15f64.to_radians().sin());

    // The long edge runs along x turned 15° toward z, which is south: east and a little south.
    assert!(near(&face.across, &[cos, -sin, 0.0]), "{:?}", face.across);
    // Its outline is the rectangle itself, 10 m across and 6 m up.
    let extent = |axis: usize| face.outline.iter().map(|p| p[axis]).fold(0.0, f64::max);
    assert!((extent(0) - 10.0).abs() < 1e-9 && (extent(1) - 6.0).abs() < 1e-9);
}

#[test]
fn a_pitched_traced_face_lays_its_rows_along_its_eave_not_its_longest_edge() {
    // One face 4 m along its eave at z = 8 and 8 m back to z = 0, rising 30°, turned 15°.
    let (cos, sin) = (15f64.to_radians().cos(), 15f64.to_radians().sin());
    let turn = |[x, z]: [f64; 2]| [x.mul_add(cos, -z * sin), x.mul_add(sin, z * cos)];
    let corners: Vec<[f64; 2]> = [[0.0, 8.0], [4.0, 8.0], [4.0, 0.0], [0.0, 0.0]]
        .into_iter()
        .map(turn)
        .collect();
    let ridge = 8f64.mul_add(30f64.to_radians().tan(), 3.0);
    let face: Vec<[f64; 3]> = corners
        .iter()
        .zip([3.0, 3.0, ridge, ridge])
        .map(|(&[x, z], y)| [x, y, z])
        .collect();
    let scene = scene(0.0, &json!([free(&json!(corners), &json!([face]))]));

    let roof = scene.roofs().remove(0);

    assert!(near(&roof.across, &[cos, -sin, 0.0]), "{:?}", roof.across);
    assert!((roof.plane.tilt - 30.0).abs() < 1e-9);
}
