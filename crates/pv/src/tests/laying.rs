//! Laying modules as the builder does (ADR 20 Modules), on the south face of a 10 m × 8 m gable
//! house at 35°: 10 m across and 4.883 m up the slope from (0, −8, 3), its setback 0.3 m. A
//! portrait module is 1.134 m across and 1.722 m up.

use serde_json::{Value, json};

use crate::grid::overlap;
use crate::{Alignment, FillRules, Ghost, Point, Scene, Size};

const SIZE: Size = Size {
    width: 1.134,
    height: 1.722,
};

fn sized(module_type: u32) -> Option<Size> {
    (module_type == 7).then_some(SIZE)
}

fn scene(modules: &Value, chimneys: &Value) -> Scene {
    serde_json::from_value(json!({
        "north": 0.0,
        "blocks": [{
            "x": 0.0, "z": 0.0, "width": 10.0, "depth": 8.0, "eave": 3.0, "rotation": 0.0,
            "roof": { "kind": "gable", "pitch": 35.0 },
        }],
        "obstacles": [],
        "chimneys": chimneys,
        "grids": [{
            "block": 0, "face": 1, "moduleType": 7, "landscape": false, "setback": 0.3,
            "modules": modules,
        }],
    }))
    .unwrap()
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

/// The point under a pointer that holds a portrait module's lower left corner at `across`, `up`.
fn holding(across: f64, up: f64) -> Point {
    on_face(across + 0.567, up + 0.861)
}

fn places(ghosts: &[Ghost]) -> Vec<(i64, i64, bool)> {
    let mm = |metres: f64| {
        let rounded = (metres * 1000.0).round();
        format!("{rounded}").parse().unwrap()
    };
    ghosts
        .iter()
        .map(|g| (mm(g.across), mm(g.up), g.fits))
        .collect()
}

fn tap(scene: &Scene, at: Point) -> Vec<(i64, i64, bool)> {
    places(&scene.lay(0, sized, [at, at]).unwrap())
}

#[test]
fn a_ghost_follows_the_pointer_by_its_centre_on_whole_centimetres() {
    let empty = scene(&json!([]), &json!([]));

    assert_eq!(tap(&empty, holding(1.433, 1.139)), [(1430, 1140, true)]);
    let ghost = empty.lay(0, sized, [holding(2.0, 1.0); 2]);
    assert_eq!(ghost.map(|g| g[0].landscape), Some(false));
}

#[test]
fn a_ghost_takes_its_grids_orientation() {
    let mut turned = scene(&json!([]), &json!([]));
    turned.grids[0].landscape = true;

    // The pointer holds its centre: 0.861 m across and 0.567 m up from its corner.
    let ghost = turned.lay(0, sized, [on_face(2.861, 1.567); 2]);

    let ghost = ghost.unwrap();
    assert!(ghost[0].landscape);
    assert_eq!(places(&ghost), [(2000, 1000, true)]);
}

#[test]
fn a_ghost_snaps_2_cm_off_the_nearest_module_and_in_line_with_it() {
    // The module spans 0.3 m to 1.434 m across and 0.3 m to 2.022 m up.
    let one = scene(&json!([portrait(0.3, 0.3)]), &json!([]));

    // Beside it: 2 cm right of its right edge, its lower edge in line.
    assert_eq!(tap(&one, holding(1.55, 0.42)), [(1454, 300, true)]);
    // Above it: 2 cm over its upper edge, its left edge in line.
    assert_eq!(tap(&one, holding(0.2, 2.1)), [(300, 2042, true)]);
    // Further off than 20 cm it goes on whole centimetres.
    assert_eq!(tap(&one, holding(1.801, 0.609)), [(1800, 610, true)]);
}

#[test]
fn a_ghost_shows_where_it_would_not_fit() {
    let one = scene(&json!([portrait(0.3, 0.3)]), &json!([chimney()]));

    // Over the setback, on the module, and on the chimney.
    assert_eq!(tap(&one, holding(0.1, 2.5)), [(100, 2500, false)]);
    assert_eq!(tap(&one, holding(0.8, 1.0)), [(800, 1000, false)]);
    assert_eq!(tap(&one, holding(5.0, 1.0)), [(5000, 1000, false)]);
}

/// 0.6 m square, its centre 5.5 m across and 1.5 m up: 5.2 m to 5.8 m across.
fn chimney() -> Value {
    json!({
        "block": 0, "face": 1, "across": 5.5, "up": 1.5, "width": 0.6, "depth": 0.6,
        "height": 1.2,
    })
}

#[test]
fn a_press_off_the_face_lays_nothing() {
    let empty = scene(&json!([]), &json!([]));
    let above = {
        let [east, north, up] = on_face(2.0, 2.0);
        [east, north, up + 1.0]
    };

    // Over the roof, past its verge, on the north face, and on a grid the scene lacks.
    assert_eq!(empty.lay(0, sized, [above; 2]), None);
    assert_eq!(empty.lay(0, sized, [on_face(10.5, 2.0); 2]), None);
    assert_eq!(empty.lay(0, sized, [[5.0, -2.0, 4.4]; 2]), None);
    assert_eq!(empty.lay(1, sized, [on_face(2.0, 2.0); 2]), None);
}

#[test]
fn a_drag_lays_a_row_along_it_each_module_2_cm_past_the_last() {
    let empty = scene(&json!([]), &json!([chimney()]));

    // 3 m across and a little up: the third module starts 2 × 1.154 m on.
    let across = empty.lay(0, sized, [holding(0.5, 0.5), holding(3.5, 0.9)]);
    assert_eq!(
        places(&across.unwrap()),
        [(500, 500, true), (1654, 500, true), (2808, 500, true)]
    );
    // Up the slope and back down it, 1.742 m a module.
    let up = empty.lay(0, sized, [holding(0.5, 0.5), holding(0.6, 2.3)]);
    assert_eq!(places(&up.unwrap()), [(500, 500, true), (500, 2242, true)]);
    let down = empty.lay(0, sized, [holding(0.5, 2.3), holding(0.5, 0.5)]);
    assert_eq!(
        places(&down.unwrap()),
        [(500, 2300, true), (500, 558, true)]
    );
    // Past the chimney at 5.2 m to 5.8 m: the modules it would stand on do not fit.
    let past = empty.lay(0, sized, [holding(3.0, 0.5), holding(6.6, 0.5)]);
    assert_eq!(
        places(&past.unwrap()),
        [
            (3000, 500, true),
            (4154, 500, false),
            (5308, 500, false),
            (6462, 500, true)
        ]
    );
}

#[test]
fn a_dragged_module_follows_the_pointer_snapped_like_the_ghost() {
    let two = scene(&json!([portrait(0.3, 0.3), portrait(3.0, 0.3)]), &json!([]));
    let slid = |across: f64, up: f64| {
        let ghost = two.slide(
            0,
            0,
            sized,
            [on_face(1.0, 1.0), on_face(1.0 + across, 1.0 + up)],
        );
        places(&[ghost.unwrap()])
    };

    assert_eq!(slid(1.0, 0.504), [(1300, 800, true)]);
    // 2 cm left of the other module, in line with it: where it lay itself is free.
    assert_eq!(slid(1.5, 0.1), [(1846, 300, true)]);
    assert_eq!(slid(0.01, 0.0), [(310, 300, true)]);
    // On the other module it does not fit.
    assert_eq!(slid(2.0, 0.5), [(2300, 800, false)]);
    assert_eq!(
        two.slide(0, 2, sized, [on_face(1.0, 1.0), on_face(2.0, 1.0)]),
        None
    );
}

#[test]
fn a_dragged_landscape_module_keeps_its_orientation() {
    let one = scene(
        &json!([{ "across": 0.3, "up": 0.3, "landscape": true }]),
        &json!([]),
    );

    let ghost = one
        .slide(0, 0, sized, [on_face(1.0, 1.0), on_face(2.0, 1.0)])
        .unwrap();

    assert!(ghost.landscape && ghost.fits);
    assert_eq!(places(&[ghost]), [(1300, 300, true)]);
}

#[test]
fn filling_a_face_lays_the_free_roof_row_by_row_from_the_lower_left() {
    let empty = scene(&json!([]), &json!([]));

    // 0.3 + c × 1.154 + 1.134 ≤ 9.7 and 0.3 + r × 1.742 + 1.722 ≤ 4.583: 8 across, 2 up.
    let filled = empty.fill(0, sized, FillRules::default());

    assert_eq!(filled.len(), 16);
    let mm = |[across, up]: [f64; 2]| ((across * 1000.0).round(), (up * 1000.0).round());
    assert_eq!(mm(filled[0]), (300.0, 300.0));
    assert_eq!(mm(filled[1]), (1454.0, 300.0));
    assert_eq!(mm(filled[8]), (300.0, 2042.0));
}

#[test]
fn filling_a_face_keeps_2_cm_off_its_modules_and_off_its_chimneys() {
    // The module at 0.5 m, 0.5 m lies over two cells of each row; the chimney over one.
    let taken = scene(&json!([portrait(0.5, 0.5)]), &json!([chimney()]));

    let filled = taken.fill(0, sized, FillRules::default());

    assert_eq!(filled.len(), 16 - 4 - 1);
    let mut all = taken;
    all.grids[0]
        .modules
        .extend(filled.iter().map(|[across, up]| {
            serde_json::from_value::<crate::GridModule>(portrait(*across, *up)).unwrap()
        }));
    assert_eq!(
        all.modules(|_| Some(SIZE)).map(|placed| placed.len()),
        Ok(12)
    );
    // A face filled once has no room left.
    assert_eq!(
        all.fill(0, sized, FillRules::default()),
        Vec::<[f64; 2]>::new()
    );
}

#[test]
fn the_modules_a_chimney_stands_on_are_the_covered_ones() {
    let covered = scene(
        &json!([portrait(0.3, 0.3), portrait(4.5, 0.5), { "row": 0, "column": 4 }]),
        &json!([chimney()]),
    );

    // Column 4 spans 4.916 m to 6.05 m across.
    assert_eq!(covered.covered(|_| Some(SIZE)), [(0, 1), (0, 2)]);
    assert_eq!(covered.covered(|_| None), [] as [(usize, usize); 0]);
}

#[test]
fn a_strike_inside_a_grids_setback_lands_on_the_grid() {
    let empty = scene(&json!([]), &json!([]));

    assert_eq!(empty.grid_at(on_face(5.0, 2.0)), Some(0));
    // In the setback, on the north face, and over the roof.
    assert_eq!(empty.grid_at(on_face(0.2, 2.0)), None);
    assert_eq!(empty.grid_at([5.0, -2.0, 4.4]), None);
    assert_eq!(empty.grid_at([5.0, -6.0, 9.0]), None);
}

#[test]
fn a_wider_gap_fills_fewer_columns_and_none_comes_under_2_cm() {
    let empty = scene(&json!([]), &json!([]));
    let mm = |[across, up]: [f64; 2]| ((across * 1000.0).round(), (up * 1000.0).round());

    // 0.3 + c × 1.234 + 1.134 ≤ 9.7: 7 across, 2 up.
    let wide = empty.fill(
        0,
        sized,
        FillRules {
            gap: 0.1,
            ..FillRules::default()
        },
    );
    assert_eq!(wide.len(), 14);
    assert_eq!(mm(wide[1]), (1534.0, 300.0));
    assert_eq!(mm(wide[7]), (300.0, 2122.0));

    let tight = empty.fill(
        0,
        sized,
        FillRules {
            gap: 0.0,
            ..FillRules::default()
        },
    );
    assert_eq!(tight, empty.fill(0, sized, FillRules::default()));
}

#[test]
fn a_centred_fill_shares_the_spare_roof_out_on_both_sides() {
    let empty = scene(&json!([]), &json!([]));
    let mm = |[across, up]: [f64; 2]| ((across * 1000.0).round(), (up * 1000.0).round());
    let rules = FillRules {
        alignment: Alignment::Centred,
        ..FillRules::default()
    };

    let filled = empty.fill(0, sized, rules);

    // 9.4 m across holds 8 modules in 9.212 m; 4.283 m up holds 2 in 3.464 m.
    assert_eq!(filled.len(), 16);
    assert_eq!(mm(filled[0]), (394.0, 710.0));
    assert_eq!(mm(filled[15]), (8472.0, 2452.0));
}

#[test]
fn a_keep_out_margin_holds_modules_off_a_chimney() {
    let taken = scene(&json!([]), &json!([chimney()]));
    let roofs = taken.roofs();
    let face = roofs.iter().find(|r| r.face == 1).unwrap();
    let chimney = face.chimneys[0];
    let rules = FillRules {
        keep_out: 0.5,
        ..FillRules::default()
    };

    let filled = taken.fill(0, sized, rules);

    assert!(filled.len() < taken.fill(0, sized, FillRules::default()).len());
    assert_ne!(filled.len(), 0);
    let area = |[across, up]: [f64; 2]| [[across, up], [across + 1.134, up + 1.722]];
    assert!(
        filled
            .iter()
            .all(|at| !overlap(area(*at), chimney, 0.5 - 1e-6))
    );
}

#[test]
fn fill_rules_read_from_json_and_default_to_the_builders() {
    let rules: FillRules =
        serde_json::from_value(json!({ "gap": 0.05, "alignment": "centred", "keepOut": 0.3 }))
            .unwrap();
    assert_eq!(
        rules,
        FillRules {
            gap: 0.05,
            alignment: Alignment::Centred,
            keep_out: 0.3
        }
    );
    let none: FillRules = serde_json::from_value(json!({})).unwrap();
    assert_eq!(
        none,
        FillRules {
            gap: 0.02,
            alignment: Alignment::LowerLeft,
            keep_out: 0.0
        }
    );
}

/// A gable roof traced from a building model, about 8.77 m along its eave and 12° steep: its
/// corners relative to the site, east, height and south, as tracing places them.
fn traced_gable(face: usize, landscape: bool) -> Scene {
    let points = [
        [4.527_807, 6.143, 2.099_832],
        [5.512_807, 5.313, -1.650_168],
        [-2.965_193, 5.313, -3.877_168],
        [-3.214_193, 5.523, -2.931_168],
        [-3.951_193, 6.143, -0.132_168],
        [-4.683_193, 5.527, 2.646_832],
        [-4.938_193, 5.313, 3.611_832],
        [-3.152_193, 5.313, 4.083_832],
        [1.755_807, 5.313, 5.377_832],
        [3.541_807, 5.313, 5.849_832],
    ];
    let faces = [vec![1, 2, 3, 4, 0], vec![4, 5, 6, 7, 8, 9, 0]];
    let corners = |face: &Vec<usize>| face.iter().map(|&i| points[i]).collect::<Vec<_>>();
    let footprint: Vec<[f64; 2]> = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0]
        .iter()
        .map(|&i: &usize| [points[i][0], points[i][2]])
        .collect();
    serde_json::from_value(json!({
        "north": 0.0,
        "blocks": [{
            "x": 0.0, "z": 0.0, "width": 0.0, "depth": 0.0, "eave": 0.0, "rotation": 0.0,
            "roof": { "kind": "flat" },
            "freeForm": {
                "footprint": footprint,
                "faces": faces.iter().map(corners).collect::<Vec<_>>(),
                "traced": {
                    "points": points,
                    "lines": [[0, 1], [1, 2], [2, 3], [3, 4], [0, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 0]],
                    "faces": faces,
                    "set": [3, 5],
                    "ridges": [0, 4],
                },
            },
        }],
        "obstacles": [],
        "grids": [{
            "block": 0, "face": face, "moduleType": 7, "landscape": landscape, "setback": 0.3,
            "modules": [],
        }],
    }))
    .unwrap()
}

#[test]
fn filling_a_traced_face_lays_the_modules_that_fit_inside_its_setback() {
    // Its outline is a few millimetres off square: 8.77 m along the eave, 3.965 m up the slope.
    // Portrait: 0.3 + 6 × 1.154 + 1.134 ≤ 8.47 is 7 across, 0.3 + 1.742 + 1.722 > 3.665 one row.
    // Landscape: 0.3 + 3 × 1.742 + 1.722 ≤ 8.47 is 4 across, 0.3 + 1.154 + 1.134 ≤ 3.665 two up.
    for face in 0..2 {
        for (landscape, count, rows) in [(false, 7, 1), (true, 8, 2)] {
            let scene = traced_gable(face, landscape);
            let roof = scene.roofs().remove(face);
            let [wide, high] = SIZE.laid(landscape);

            let filled = scene.fill(0, sized, FillRules::default());

            assert_eq!(filled.len(), count, "face {face}, landscape {landscape}");
            let mut ups: Vec<f64> = filled.iter().map(|[_, up]| *up).collect();
            ups.dedup_by(|a, b| (*a - *b).abs() < 1e-9);
            assert_eq!(ups.len(), rows, "rows along the eave: {filled:?}");
            for [across, up] in filled {
                let area = [[across, up], [across + wide, up + high]];
                assert_eq!(roof.clear(area, 0.3), Ok(()), "{area:?}");
            }
        }
    }
}

#[test]
fn a_traced_faces_rows_run_along_its_eave() {
    // Face 0's eave runs from its second corner to its third, level.
    let roof = traced_gable(0, false).roofs().remove(0);
    let [east, north] = [-2.965_193 - 5.512_807, -(-3.877_168 + 1.650_168)];
    let length = f64::hypot(east, north);

    let along = roof.across[0].mul_add(east, roof.across[1] * north) / length;

    assert!(along > 1.0 - 1e-6, "{:?}", roof.across);
}
