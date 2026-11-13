//! Roof overhangs, roof chimneys and block colours (ADR 20), checked against a 10 m × 8 m gable
//! house at 35° worked out by hand: its south face is face 1, 10 m wide and 4.883 m up the slope.

use serde_json::{Value, json};

use super::fixtures::MODULE;
use crate::shade::shaded_substrings;
use crate::{Misplaced, ModuleType, Place, Plane, Point, Scene, Size, Sun, Surface};

const SIZE: Size = Size {
    width: 1.134,
    height: 1.722,
};

fn house(block: &Value, rest: &Value) -> Scene {
    let mut scene = json!({
        "north": 0.0,
        "blocks": [block],
        "obstacles": [],
    });
    if let (Some(scene), Some(rest)) = (scene.as_object_mut(), rest.as_object()) {
        scene.extend(rest.clone());
    }
    serde_json::from_value(scene).unwrap()
}

fn gable(extra: &Value) -> Value {
    let mut block = json!({
        "x": 0.0, "z": 0.0, "width": 10.0, "depth": 8.0, "eave": 3.0, "rotation": 0.0,
        "roof": { "kind": "gable", "pitch": 35.0 },
    });
    if let (Some(block), Some(extra)) = (block.as_object_mut(), extra.as_object()) {
        block.extend(extra.clone());
    }
    block
}

fn holds(corners: &[Point], point: Point) -> bool {
    corners
        .iter()
        .any(|c| c.iter().zip(point).all(|(a, b)| (a - b).abs() < 1e-6))
}

#[test]
fn a_scene_stored_before_overhangs_chimneys_and_colours_reads_and_writes_unchanged() {
    let stored = json!({
        "north": 0.0,
        "blocks": [gable(&json!({}))],
        "obstacles": [],
        "grids": [],
    });

    let scene: Scene = serde_json::from_value(stored.clone()).unwrap();

    assert_eq!(serde_json::to_value(&scene).unwrap(), stored);
    assert_eq!(scene.check_blocks(), Ok(()));
    assert_eq!(scene.check_chimneys(), Ok(()));
}

#[test]
fn the_roof_reaches_past_the_eaves_and_the_verges_while_the_walls_stay_under_it() {
    let scene = house(
        &gable(&json!({ "overhang": { "eave": 0.5, "verge": 0.3 } })),
        &json!({}),
    );
    let faces = scene.faces();
    let corners = |surface| {
        faces
            .iter()
            .filter(|f| f.surface == surface)
            .flat_map(|f| f.corners.clone())
            .collect::<Vec<_>>()
    };

    // The back eave runs 0.5 m out, 0.5 × tan 35° lower; the ridge 0.3 m past each gable.
    let low = 0.5f64.mul_add(-35f64.to_radians().tan(), 3.0);
    let ridge = 4f64.mul_add(35f64.to_radians().tan(), 3.0);
    let roofs = corners(Surface::Roof);
    assert!(holds(&roofs, [-0.3, 0.5, low]), "{roofs:?}");
    assert!(holds(&roofs, [10.3, -8.5, low]), "{roofs:?}");
    assert!(holds(&roofs, [-0.3, -4.0, ridge]), "{roofs:?}");
    let walls = corners(Surface::Wall);
    assert!(holds(&walls, [0.0, 0.0, 3.0]), "{walls:?}");
    assert!(holds(&walls, [0.0, -4.0, ridge]), "{walls:?}");
    assert!(
        walls
            .iter()
            .all(|[east, north, _]| (-0.0..=10.0).contains(east) && (-8.0..=0.0).contains(north))
    );
}

/// A small module hung on the front (south) wall 0.5 m under the eave, under a high sun.
fn wall_module_shade(scene: &Scene) -> u8 {
    let small = ModuleType {
        width: 0.4,
        height: 0.4,
        ..MODULE
    };
    shaded_substrings(
        &small,
        Plane {
            tilt: 90.0,
            azimuth: 0.0,
        },
        Place {
            centre: [5.0, -8.05, 2.5],
            landscape: false,
        },
        Sun {
            zenith: 30.0,
            azimuth: 0.0,
        },
        &scene.occluders(),
    )
}

#[test]
fn an_eave_overhang_shades_a_wall_hung_module_below_it() {
    let bare = house(&gable(&json!({})), &json!({}));
    let eaved = house(
        &gable(&json!({ "overhang": { "eave": 0.5, "verge": 0.0 } })),
        &json!({}),
    );

    assert_eq!(wall_module_shade(&bare), 0);
    assert_eq!(wall_module_shade(&eaved), MODULE.bypass_diodes);
}

/// A chimney 0.6 m square and 1.2 m tall on the south face, its centre 3 m across and 1.5 m up.
fn chimney(across: f64) -> Value {
    json!({
        "block": 0, "face": 1, "across": across, "up": 1.5, "width": 0.6, "depth": 0.6,
        "height": 1.2,
    })
}

fn gridded(chimneys: &Value, modules: &Value) -> Scene {
    house(
        &gable(&json!({})),
        &json!({
            "chimneys": chimneys,
            "grids": [{
                "block": 0, "face": 1, "moduleType": 7, "landscape": false, "setback": 0.3,
                "modules": modules,
            }],
        }),
    )
}

/// The substrings the low southern sun takes from the module in row 1, column 1: up the slope
/// from the chimney, whose cell spans 1.454 m to 2.588 m across.
fn north_of_chimney(scene: &Scene) -> u8 {
    let placed = scene.modules(|_| Some(SIZE)).unwrap();
    let module = placed.first().unwrap().module;
    shaded_substrings(
        &MODULE,
        module.plane,
        module.place.unwrap(),
        Sun {
            zenith: 75.0,
            azimuth: 0.0,
        },
        &scene.occluders(),
    )
}

#[test]
fn a_roof_chimney_shades_the_modules_north_of_it_at_low_sun() {
    let module = json!([{ "row": 1, "column": 1 }]);

    assert_eq!(north_of_chimney(&gridded(&json!([]), &module)), 0);
    assert!(north_of_chimney(&gridded(&json!([chimney(2.0)]), &module)) > 0);
    assert_eq!(
        north_of_chimney(&gridded(&json!([chimney(8.0)]), &module)),
        0
    );
}

#[test]
fn a_chimney_stands_upright_on_its_face_and_its_top_lies_level() {
    let scene = gridded(&json!([chimney(3.0)]), &json!([]));

    let faces: Vec<_> = scene
        .faces()
        .into_iter()
        .filter(|f| f.surface == Surface::Chimney)
        .collect();

    // Four sides and the top; the top 1.2 m over the roof where the chimney's back meets it.
    assert_eq!(faces.len(), 5);
    let tops: Vec<f64> = faces
        .iter()
        .flat_map(|f| f.corners.iter().map(|[.., up]| *up))
        .collect();
    let (tan, cos) = (35f64.to_radians().tan(), 35f64.to_radians().cos());
    let back = (1.5f64.mul_add(cos, 0.3)).mul_add(tan, 3.0);
    let highest = tops.iter().copied().fold(f64::MIN, f64::max);
    assert!((highest - (back + 1.2)).abs() < 1e-6, "{highest} {back}");
}

#[test]
fn modules_cannot_stand_where_a_chimney_stands() {
    let scene = gridded(&json!([chimney(2.0)]), &json!([{ "row": 0, "column": 1 }]));

    let roof = scene.roofs().into_iter().find(|r| r.face == 1).unwrap();
    let cells = roof.cells(&scene.grids[0], SIZE);

    // Row 0 spans 0.3 m to 2.022 m up the slope, column 1 1.454 m to 2.588 m across.
    assert!(!cells.iter().any(|c| (c.row, c.column) == (0, 1)));
    assert!(cells.iter().any(|c| (c.row, c.column) == (0, 3)));
    assert_eq!(
        scene.modules(|_| Some(SIZE)),
        Err(Misplaced::Setback {
            grid: 0,
            row: 0,
            column: 1
        })
    );
}

#[test]
fn a_chimney_off_its_face_or_without_a_size_is_refused() {
    let on = |value: Value| {
        house(
            &gable(&json!({})),
            &json!({ "chimneys": [chimney(3.0), value] }),
        )
    };
    let mut flat = chimney(3.0);
    flat["height"] = json!(0.0);
    let mut nowhere = chimney(3.0);
    nowhere["face"] = json!(2);

    assert_eq!(on(chimney(5.0)).check_chimneys(), Ok(()));
    assert_eq!(on(chimney(9.8)).check_chimneys(), Err(1));
    assert_eq!(on(flat).check_chimneys(), Err(1));
    assert_eq!(on(nowhere).check_chimneys(), Err(1));
}

#[test]
fn a_negative_overhang_or_a_colour_no_hex_triplet_is_refused() {
    let with = |extra: Value| house(&gable(&extra), &json!({})).check_blocks();

    assert_eq!(
        with(json!({
            "overhang": { "eave": 0.5, "verge": 0.3 },
            "roofColour": "#9c4a32", "wallColour": "#F2F0EB",
        })),
        Ok(())
    );
    assert_eq!(
        with(json!({ "overhang": { "eave": -0.1, "verge": 0.0 } })),
        Err(0)
    );
    assert_eq!(with(json!({ "roofColour": "red" })), Err(0));
    assert_eq!(with(json!({ "wallColour": "#fff" })), Err(0));
}

#[test]
fn walls_and_roofs_carry_their_blocks_colours() {
    let scene = house(
        &gable(&json!({ "roofColour": "#9c4a32", "wallColour": "#f2f0eb" })),
        &json!({}),
    );

    let faces = scene.faces();

    let colour = |surface| {
        faces
            .iter()
            .filter(|f| f.surface == surface)
            .map(|f| f.colour.as_deref())
            .collect::<Vec<_>>()
    };
    assert_eq!(colour(Surface::Roof), [Some("#9c4a32"); 2]);
    assert_eq!(colour(Surface::Wall), [Some("#f2f0eb"); 4]);
}
