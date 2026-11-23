//! Existing PV (ADR 20), on the south face of a 10 m × 8 m gable house at 35°: face 1, 10 m across
//! and 4.883 m up the slope from (0, −8, 3).

use serde_json::{Value, json};

use crate::{Misplaced, Point, Scene, Size};

const SIZE: Size = Size {
    width: 1.134,
    height: 1.722,
};

fn sized(module_type: u32) -> Option<Size> {
    (module_type == 7).then_some(SIZE)
}

fn house(rest: &Value) -> Scene {
    let mut scene = json!({
        "north": 0.0,
        "blocks": [{
            "x": 0.0, "z": 0.0, "width": 10.0, "depth": 8.0, "eave": 3.0, "rotation": 0.0,
            "roof": { "kind": "gable", "pitch": 35.0 },
        }],
        "obstacles": [],
        "grids": [],
    });
    if let (Some(scene), Some(rest)) = (scene.as_object_mut(), rest.as_object()) {
        scene.extend(rest.clone());
    }
    serde_json::from_value(scene).unwrap()
}

/// 2 m across and 1.8 m up the slope, its centre `across` and `up` the south face.
fn existing(across: f64, up: f64) -> Value {
    json!({ "block": 0, "face": 1, "across": across, "up": up, "width": 2.0, "length": 1.8 })
}

/// 0.6 m square: 5.2 m to 5.8 m across and 1.134 m to 1.866 m up the south face.
fn chimney() -> Value {
    json!({
        "block": 0, "face": 1, "across": 5.5, "up": 1.5, "width": 0.6, "depth": 0.6,
        "height": 1.2,
    })
}

/// 0.78 m across and 1.18 m up the slope.
fn window(across: f64, up: f64) -> Value {
    json!({ "block": 0, "face": 1, "across": across, "up": up, "width": 0.78, "length": 1.18 })
}

fn grid(modules: &Value) -> Value {
    json!([{
        "block": 0, "face": 1, "moduleType": 7, "landscape": false, "setback": 0.3,
        "modules": modules,
    }])
}

fn portrait(across: f64, up: f64) -> Value {
    json!({ "across": across, "up": up, "landscape": false })
}

/// The point of the scene `across` and `up` the south face.
fn on_face(across: f64, up: f64) -> Point {
    let pitch = 35f64.to_radians();
    [
        across,
        up.mul_add(pitch.cos(), -8.0),
        up.mul_add(pitch.sin(), 3.0),
    ]
}

fn near(actual: &[f64], expected: &[f64]) {
    let close = actual.len() == expected.len()
        && actual
            .iter()
            .zip(expected)
            .all(|(a, e)| (a - e).abs() < 1e-6);
    assert!(close, "{actual:?} is not {expected:?}");
}

#[test]
fn a_scene_stored_before_existing_pv_reads_and_writes_unchanged_and_one_with_it_too() {
    let before = json!({
        "north": 0.0, "blocks": [], "obstacles": [], "grids": [],
    });
    let with = json!({
        "north": 0.0, "blocks": [], "obstacles": [], "grids": [],
        "existingPv": [existing(3.0, 2.0)],
    });

    for stored in [before, with] {
        let scene: Scene = serde_json::from_value(stored.clone()).unwrap();
        assert_eq!(serde_json::to_value(&scene).unwrap(), stored);
    }
}

#[test]
fn existing_pv_lies_on_its_face_by_its_centre_width_and_length() {
    let scene = house(&json!({ "existingPv": [existing(3.0, 2.0)] }));

    let fields = scene.existing_fields().unwrap();

    // From the lower left, counter-clockwise: 1 m either side across, 0.9 m up and down.
    let corners = [
        on_face(2.0, 1.1),
        on_face(4.0, 1.1),
        on_face(4.0, 2.9),
        on_face(2.0, 2.9),
    ];
    near(&fields[0].concat(), &corners.concat());
}

#[test]
fn existing_pv_never_shades_and_adds_no_face() {
    let bare = house(&json!({}));
    let fielded = house(&json!({ "existingPv": [existing(3.0, 2.0)] }));

    assert_eq!(fielded.occluders(), bare.occluders());
    assert_eq!(fielded.faces(), bare.faces());
}

#[test]
fn existing_pv_off_its_face_without_a_size_or_on_a_chimney_a_roof_window_or_another_is_refused() {
    let refused = |fields: Value, windows: Value| {
        house(&json!({
            "existingPv": fields, "chimneys": [chimney()], "roofWindows": windows,
        }))
        .existing_fields()
    };
    let with = |key: &str, value: f64| {
        let mut changed = existing(3.0, 2.0);
        changed[key] = json!(value);
        changed
    };

    assert_eq!(
        refused(json!([existing(2.0, 2.0), existing(8.0, 2.0)]), json!([])).map(|f| f.len()),
        Ok(2)
    );
    // Its right side past the verge; then no width, no length, and a face the block lacks.
    assert_eq!(refused(json!([existing(9.5, 2.0)]), json!([])), Err(0));
    assert_eq!(refused(json!([with("width", 0.0)]), json!([])), Err(0));
    assert_eq!(refused(json!([with("length", -1.0)]), json!([])), Err(0));
    let mut faceless = existing(3.0, 2.0);
    faceless["face"] = json!(9);
    assert_eq!(refused(json!([faceless]), json!([])), Err(0));
    // On the chimney, on a roof window, and the second on the first.
    assert_eq!(refused(json!([existing(5.0, 1.5)]), json!([])), Err(0));
    assert_eq!(
        refused(json!([existing(2.0, 2.0)]), json!([window(2.5, 2.0)])),
        Err(0)
    );
    assert_eq!(
        refused(json!([existing(2.0, 2.0), existing(3.5, 2.5)]), json!([])),
        Err(1)
    );
    // Touching none: 2 cm beside the chimney.
    assert_eq!(
        refused(json!([existing(4.18, 1.5)]), json!([])).map(|f| f.len()),
        Ok(1)
    );
}

#[test]
fn a_module_that_overlaps_existing_pv_is_refused_and_shown_not_to_fit() {
    // The field spans 2 m to 4 m across and 1.1 m to 2.9 m up.
    let scene = |modules: &Value| {
        house(&json!({ "existingPv": [existing(3.0, 2.0)], "grids": grid(modules) }))
    };
    let over = scene(&json!([portrait(0.3, 0.3), portrait(1.5, 0.5)]));
    let beside = scene(&json!([portrait(0.3, 0.3), portrait(4.0, 0.5)]));

    assert_eq!(
        over.modules(sized),
        Err(Misplaced::Existing { grid: 0, module: 1 })
    );
    assert_eq!(beside.modules(sized).map(|placed| placed.len()), Ok(2));
    assert_eq!(over.covered(sized), [(0, 1)]);
    // A ghost with its corner at 1.5 m, 0.5 m lies on the field; one at 5 m does not.
    let ghost = |across: f64| {
        let at = on_face(across + 0.567, 0.5 + 0.861);
        scene(&json!([])).lay(0, sized, [at, at]).unwrap()[0].fits
    };
    assert!(!ghost(1.5));
    assert!(ghost(5.0));
    // Each row's second, third and fourth module would lie on it: 1.454 m to 4.896 m across.
    assert_eq!(scene(&json!([])).fill(0, sized).len(), 16 - 6);
}

#[test]
fn a_roof_window_or_chimney_moved_or_placed_keeps_off_existing_pv() {
    let field = existing(3.0, 2.0);
    let glazed = house(&json!({ "existingPv": [field], "roofWindows": [window(7.5, 2.0)] }));
    let stacked = house(&json!({ "existingPv": [field], "chimneys": [chimney()] }));

    // West of each the field ends 4 m across: the window's left side stops there, and the
    // chimney's.
    let moved = glazed.glide_window(0, [-5.0, 0.0]).unwrap();
    assert!(
        (moved.across - (4.0 + 0.39)).abs() < 1e-3,
        "{}",
        moved.across
    );
    let moved = stacked.glide(0, [-3.0, 0.0]).unwrap();
    assert!(
        (moved.across - (4.0 + 0.3)).abs() < 1e-3,
        "{}",
        moved.across
    );
    // A field over the north face's middle sends a new window aside, 4 m to 6 m across.
    let north = json!({
        "block": 0, "face": 0, "across": 5.0, "up": 2.9, "width": 2.0, "length": 1.8,
    });
    let placed = house(&json!({ "existingPv": [north] }))
        .place_window(sized, [0.78, 1.18])
        .unwrap();
    assert_eq!(placed.face, 0);
    assert!(
        placed.across + 0.39 <= 4.0 || placed.across - 0.39 >= 6.0,
        "{}",
        placed.across
    );
}
