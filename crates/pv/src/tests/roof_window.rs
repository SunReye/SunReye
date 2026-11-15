//! Roof windows (ADR 20), on the south face of a 10 m × 8 m gable house at 35°: face 1, 10 m across
//! and 4.883 m up the slope from (0, −8, 3).

use serde_json::{Value, json};

use crate::{Misplaced, Point, RoofWindow, Scene, Size};

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

/// 0.78 m across and 1.18 m up the slope, its centre `across` and `up` the south face.
fn window(across: f64, up: f64) -> Value {
    json!({ "block": 0, "face": 1, "across": across, "up": up, "width": 0.78, "length": 1.18 })
}

/// 0.6 m square: 5.2 m to 5.8 m across and 1.134 m to 1.866 m up the south face.
fn chimney() -> Value {
    json!({
        "block": 0, "face": 1, "across": 5.5, "up": 1.5, "width": 0.6, "depth": 0.6,
        "height": 1.2,
    })
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
fn a_scene_stored_before_roof_windows_reads_and_writes_unchanged_and_one_with_them_too() {
    let before = json!({
        "north": 0.0, "blocks": [], "obstacles": [], "grids": [],
    });
    let with = json!({
        "north": 0.0, "blocks": [], "obstacles": [], "grids": [],
        "roofWindows": [window(3.0, 2.0)],
    });

    for stored in [before, with] {
        let scene: Scene = serde_json::from_value(stored.clone()).unwrap();
        assert_eq!(serde_json::to_value(&scene).unwrap(), stored);
    }
}

#[test]
fn a_roof_window_lies_flush_in_its_face_by_its_centre_width_and_length() {
    let scene = house(&json!({ "roofWindows": [window(3.0, 2.0)] }));

    let panes = scene.panes().unwrap();

    // From the lower left, counter-clockwise: 0.39 m either side across, 0.59 m up and down.
    let corners = [
        on_face(2.61, 1.41),
        on_face(3.39, 1.41),
        on_face(3.39, 2.59),
        on_face(2.61, 2.59),
    ];
    near(&panes[0].concat(), &corners.concat());
}

#[test]
fn a_roof_window_never_shades_and_adds_no_face() {
    let bare = house(&json!({}));
    let glazed = house(&json!({ "roofWindows": [window(3.0, 2.0)] }));

    assert_eq!(glazed.occluders(), bare.occluders());
    assert_eq!(glazed.faces(), bare.faces());
}

#[test]
fn a_roof_window_off_its_face_without_a_size_or_on_a_chimney_or_another_is_refused() {
    let refused =
        |windows: Value| house(&json!({ "roofWindows": windows, "chimneys": [chimney()] })).panes();
    let with = |key: &str, value: f64| {
        let mut changed = window(3.0, 2.0);
        changed[key] = json!(value);
        changed
    };

    assert_eq!(
        refused(json!([window(3.0, 2.0), window(8.0, 2.0)])).map(|p| p.len()),
        Ok(2)
    );
    // Its right side past the verge; then no width, no length, and a face the block lacks.
    assert_eq!(refused(json!([window(9.7, 2.0)])), Err(0));
    assert_eq!(refused(json!([with("width", 0.0)])), Err(0));
    assert_eq!(refused(json!([with("length", -1.0)])), Err(0));
    let mut faceless = window(3.0, 2.0);
    faceless["face"] = json!(9);
    assert_eq!(refused(json!([faceless])), Err(0));
    // What the builder outlines is there all the same, but on no face.
    let outlined = |windows: Value| house(&json!({ "roofWindows": windows })).outlines();
    assert!(outlined(json!([window(9.7, 2.0)]))[0].is_some());
    let mut nowhere = window(3.0, 2.0);
    nowhere["face"] = json!(9);
    assert_eq!(outlined(json!([nowhere])), [None]);
    // On the chimney, and the second on the first.
    assert_eq!(refused(json!([window(5.0, 1.5)])), Err(0));
    assert_eq!(refused(json!([window(3.0, 2.0), window(3.5, 2.5)])), Err(1));
    // Touching neither: 2 cm beside the chimney.
    assert_eq!(refused(json!([window(4.79, 1.5)])).map(|p| p.len()), Ok(1));
}

#[test]
fn a_module_that_overlaps_a_roof_window_is_refused_and_shown_not_to_fit() {
    // The window spans 2.61 m to 3.39 m across and 1.41 m to 2.59 m up.
    let scene = |modules: &Value| {
        house(&json!({ "roofWindows": [window(3.0, 2.0)], "grids": grid(modules) }))
    };
    let over = scene(&json!([portrait(0.3, 0.3), portrait(2.0, 0.5)]));
    let beside = scene(&json!([portrait(0.3, 0.3), portrait(3.39, 0.5)]));

    assert_eq!(
        over.modules(sized),
        Err(Misplaced::Window { grid: 0, module: 1 })
    );
    assert_eq!(beside.modules(sized).map(|placed| placed.len()), Ok(2));
    assert_eq!(over.covered(sized), [(0, 1)]);
    // A ghost with its corner at 2 m, 0.5 m lies on the window; one at 4 m does not.
    let ghost = |across: f64| {
        let at = on_face(across + 0.567, 0.5 + 0.861);
        scene(&json!([])).lay(0, sized, [at, at]).unwrap()[0].fits
    };
    assert!(!ghost(2.0));
    assert!(ghost(4.0));
    // Each row's third module would lie on it: 2.608 m to 3.742 m across.
    assert_eq!(scene(&json!([])).fill(0, sized).len(), 16 - 2);
}

#[test]
fn a_strike_on_a_roof_window_lands_on_it_and_beside_it_on_none() {
    let scene = house(&json!({ "roofWindows": [window(8.0, 2.0), window(3.0, 2.0)] }));

    assert_eq!(scene.roof_window_at(on_face(3.2, 2.4)), Some(1));
    assert_eq!(scene.roof_window_at(on_face(8.0, 2.0)), Some(0));
    assert_eq!(scene.roof_window_at(on_face(4.0, 2.0)), None);
    // Over the pane, off the roof.
    let [east, north, up] = on_face(3.0, 2.0);
    assert_eq!(scene.roof_window_at([east, north, up + 1.0]), None);
}

#[test]
fn a_roof_window_glides_along_its_face_and_stops_at_its_edge_and_at_a_chimney() {
    let scene = house(&json!({ "roofWindows": [window(3.0, 2.0)], "chimneys": [chimney()] }));
    let glided = |east, north| {
        let moved = scene.glide_window(0, [east, north]).unwrap();
        [moved.across, moved.up]
    };

    // 0.82 m north, seen from above, is 1 m up the 35° slope.
    near(&glided(-1.04, 0.82), &[2.0, 3.0]);
    // Its left side stops at the verge, its upper side at the ridge 4.883 m up.
    near(&glided(-20.0, 0.0), &[0.39, 2.0]);
    let [_, up] = glided(0.0, 20.0);
    assert!((up - (4.883 - 0.59)).abs() < 1e-3, "{up}");
    // East of it the chimney starts 5.2 m across: the window's right side stops there.
    let [across, _] = glided(2.0, -0.41);
    assert!((across - (5.2 - 0.39)).abs() < 1e-3, "{across}");
    assert_eq!(scene.glide_window(1, [1.0, 0.0]), None);
}

#[test]
fn a_new_roof_window_takes_the_free_place_nearest_the_middle_of_the_first_face_with_room() {
    let place = |rest: &Value| house(rest).place_window(sized, [0.78, 1.18]);
    let at = |window: Option<RoofWindow>| {
        let window = window.unwrap();
        (window.face, window.across, window.up)
    };

    // The north face comes first: its middle across, three fifths up, on whole decimetres.
    assert_eq!(at(place(&json!({}))), (0, 5.0, 2.9));
    // A chimney there: half a metre steps to either side, the nearer first.
    let stack = json!({
        "block": 0, "face": 0, "across": 5.0, "up": 2.9, "width": 0.6, "depth": 0.6,
        "height": 1.0,
    });
    assert_eq!(at(place(&json!({ "chimneys": [stack] }))), (0, 6.0, 2.9));
    // Never on a module: a face full of them sends it to the next face.
    let mut full = house(&json!({ "grids": [{
        "block": 0, "face": 0, "moduleType": 7, "landscape": false, "setback": 0.3,
        "modules": [],
    }] }));
    for [across, up] in full.fill(0, sized) {
        full.grids[0]
            .modules
            .push(serde_json::from_value(portrait(across, up)).unwrap());
    }
    assert_eq!(at(full.place_window(sized, [0.78, 1.18])).0, 1);
}
