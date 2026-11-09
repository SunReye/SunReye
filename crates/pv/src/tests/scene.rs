//! Blocks, roofs and obstacles as faces and solids in the frame shading uses (ADR 20), checked
//! against corners worked out by hand.

use crate::{Block, Face, Obstacle, Occluder, Point, Roof, Scene, Surface};

fn block(roof: Roof) -> Block {
    Block {
        x: 0.0,
        z: 0.0,
        width: 10.0,
        depth: 8.0,
        eave: 3.0,
        rotation: 0.0,
        roof,
    }
}

fn scene(blocks: Vec<Block>, obstacles: Vec<Obstacle>) -> Scene {
    Scene {
        north: 0.0,
        blocks,
        obstacles,
        grids: vec![],
    }
}

fn of(faces: &[Face], surface: Surface) -> Vec<Vec<Point>> {
    faces
        .iter()
        .filter(|face| face.surface == surface)
        .map(|face| face.corners.clone())
        .collect()
}

/// Whether both polygons hold the same corners within a micrometre, in any order.
fn same(actual: &[Point], expected: &[Point]) -> bool {
    actual.len() == expected.len()
        && expected.iter().all(|e| {
            actual
                .iter()
                .any(|a| a.iter().zip(e).all(|(a, e)| (a - e).abs() < 1e-6))
        })
}

fn assert_faces(actual: &[Vec<Point>], expected: &[&[Point]]) {
    assert_eq!(actual.len(), expected.len(), "{actual:?}");
    for corners in expected {
        assert!(
            actual.iter().any(|a| same(a, corners)),
            "{corners:?} missing from {actual:?}"
        );
    }
}

#[test]
fn a_flat_roof_lies_at_the_eave_and_the_block_runs_east_and_south_from_its_corner() {
    let faces = scene(vec![block(Roof::Flat)], vec![]).faces();

    assert_faces(
        &of(&faces, Surface::Roof),
        &[&[
            [0.0, 0.0, 3.0],
            [10.0, 0.0, 3.0],
            [10.0, -8.0, 3.0],
            [0.0, -8.0, 3.0],
        ]],
    );
    assert_faces(
        &of(&faces, Surface::Wall),
        &[
            &[
                [0.0, 0.0, 0.0],
                [10.0, 0.0, 0.0],
                [10.0, 0.0, 3.0],
                [0.0, 0.0, 3.0],
            ],
            &[
                [0.0, -8.0, 0.0],
                [10.0, -8.0, 0.0],
                [10.0, -8.0, 3.0],
                [0.0, -8.0, 3.0],
            ],
            &[
                [0.0, 0.0, 0.0],
                [0.0, -8.0, 0.0],
                [0.0, -8.0, 3.0],
                [0.0, 0.0, 3.0],
            ],
            &[
                [10.0, 0.0, 0.0],
                [10.0, -8.0, 0.0],
                [10.0, -8.0, 3.0],
                [10.0, 0.0, 3.0],
            ],
        ],
    );
}

#[test]
fn a_mono_pitch_roof_rises_from_the_front_eave_to_the_back() {
    // 45°: 8 m of depth rise 8 m.
    let faces = scene(vec![block(Roof::MonoPitch { pitch: 45.0 })], vec![]).faces();

    assert_faces(
        &of(&faces, Surface::Roof),
        &[&[
            [0.0, 0.0, 11.0],
            [10.0, 0.0, 11.0],
            [10.0, -8.0, 3.0],
            [0.0, -8.0, 3.0],
        ]],
    );
    let walls = of(&faces, Surface::Wall);
    assert!(walls.iter().any(|w| same(
        w,
        &[
            [0.0, 0.0, 0.0],
            [0.0, -8.0, 0.0],
            [0.0, -8.0, 3.0],
            [0.0, 0.0, 11.0]
        ]
    )));
}

#[test]
fn a_gable_roof_has_its_ridge_along_the_width_and_two_gable_walls() {
    // 45° over half of 8 m: the ridge stands 4 m above the eave.
    let faces = scene(vec![block(Roof::Gable { pitch: 45.0 })], vec![]).faces();

    assert_faces(
        &of(&faces, Surface::Roof),
        &[
            &[
                [0.0, 0.0, 3.0],
                [10.0, 0.0, 3.0],
                [10.0, -4.0, 7.0],
                [0.0, -4.0, 7.0],
            ],
            &[
                [0.0, -8.0, 3.0],
                [10.0, -8.0, 3.0],
                [10.0, -4.0, 7.0],
                [0.0, -4.0, 7.0],
            ],
        ],
    );
    let walls = of(&faces, Surface::Wall);
    assert!(walls.iter().any(|w| same(
        w,
        &[
            [0.0, 0.0, 0.0],
            [0.0, -8.0, 0.0],
            [0.0, -8.0, 3.0],
            [0.0, -4.0, 7.0],
            [0.0, 0.0, 3.0]
        ]
    )));
}

#[test]
fn a_hip_roof_slopes_on_all_four_sides_to_a_ridge_along_the_longer_side() {
    let faces = scene(vec![block(Roof::Hip { pitch: 45.0 })], vec![]).faces();

    assert_faces(
        &of(&faces, Surface::Roof),
        &[
            &[
                [0.0, 0.0, 3.0],
                [10.0, 0.0, 3.0],
                [6.0, -4.0, 7.0],
                [4.0, -4.0, 7.0],
            ],
            &[
                [0.0, -8.0, 3.0],
                [10.0, -8.0, 3.0],
                [6.0, -4.0, 7.0],
                [4.0, -4.0, 7.0],
            ],
            &[[0.0, 0.0, 3.0], [0.0, -8.0, 3.0], [4.0, -4.0, 7.0]],
            &[[10.0, 0.0, 3.0], [10.0, -8.0, 3.0], [6.0, -4.0, 7.0]],
        ],
    );
    assert_eq!(of(&faces, Surface::Wall).len(), 4);
}

#[test]
fn a_hip_roof_on_a_deep_block_runs_its_ridge_along_the_depth() {
    let deep = Block {
        width: 8.0,
        depth: 10.0,
        ..block(Roof::Hip { pitch: 45.0 })
    };
    let faces = scene(vec![deep], vec![]).faces();

    assert!(
        of(&faces, Surface::Roof)
            .iter()
            .any(|r| same(r, &[[0.0, 0.0, 3.0], [8.0, 0.0, 3.0], [4.0, -4.0, 7.0]]))
    );
}

#[test]
fn a_block_turns_clockwise_about_its_corner() {
    let turned = Block {
        x: 2.0,
        z: 0.0,
        rotation: 90.0,
        ..block(Roof::Flat)
    };
    let faces = scene(vec![turned], vec![]).faces();

    // The width now runs south from the corner, the depth west.
    assert_faces(
        &of(&faces, Surface::Roof),
        &[&[
            [2.0, 0.0, 3.0],
            [2.0, -10.0, 3.0],
            [-6.0, -10.0, 3.0],
            [-6.0, 0.0, 3.0],
        ]],
    );
}

#[test]
fn the_compass_turns_the_whole_scene_to_true_north() {
    // The scene's forward axis points east: its width runs south.
    let east = Scene {
        north: 90.0,
        ..scene(vec![block(Roof::Flat)], vec![])
    };

    assert_faces(
        &of(&east.faces(), Surface::Roof),
        &[&[
            [0.0, 0.0, 3.0],
            [0.0, -10.0, 3.0],
            [-8.0, -10.0, 3.0],
            [-8.0, 0.0, 3.0],
        ]],
    );
}

#[test]
fn a_box_obstacle_has_four_walls_and_a_top() {
    let wall = Obstacle::Box {
        x: 0.0,
        z: 5.0,
        width: 4.0,
        depth: 0.5,
        height: 2.0,
        rotation: 0.0,
    };
    let faces = scene(vec![], vec![wall]).faces();

    let obstacles = of(&faces, Surface::Obstacle);
    assert_eq!(obstacles.len(), 5);
    assert!(obstacles.iter().any(|o| same(
        o,
        &[
            [0.0, -5.0, 2.0],
            [4.0, -5.0, 2.0],
            [4.0, -5.5, 2.0],
            [0.0, -5.5, 2.0]
        ]
    )));
}

#[test]
fn a_chimney_is_an_upright_cylinder_and_a_tree_a_trunk_under_a_crown() {
    let chimney = Obstacle::Cylinder {
        x: 3.0,
        z: 2.0,
        radius: 0.3,
        height: 9.0,
    };
    let tree = Obstacle::Tree {
        x: -4.0,
        z: 0.0,
        radius: 2.0,
        height: 10.0,
    };
    let solids = scene(vec![], vec![chimney, tree]).solids();

    assert_eq!(
        solids,
        vec![
            Occluder::Cylinder {
                base: [3.0, -2.0, 0.0],
                radius: 0.3,
                height: 9.0
            },
            Occluder::Cylinder {
                base: [-4.0, 0.0, 0.0],
                radius: 0.2,
                height: 8.0
            },
            Occluder::Sphere {
                centre: [-4.0, 0.0, 8.0],
                radius: 2.0
            },
        ]
    );
}

#[test]
fn the_scene_shades_with_each_face_as_a_fan_of_triangles_and_its_solids() {
    let chimney = Obstacle::Cylinder {
        x: 3.0,
        z: 2.0,
        radius: 0.3,
        height: 9.0,
    };
    let occluders = scene(vec![block(Roof::Flat)], vec![chimney]).occluders();

    // Four walls and a roof, each a rectangle of two triangles, then the chimney.
    assert_eq!(occluders.len(), 11);
    assert!(occluders.contains(&Occluder::Triangle([
        [0.0, 0.0, 3.0],
        [10.0, 0.0, 3.0],
        [10.0, -8.0, 3.0],
    ])));
    assert!(occluders.contains(&Occluder::Triangle([
        [0.0, 0.0, 3.0],
        [10.0, -8.0, 3.0],
        [0.0, -8.0, 3.0],
    ])));
    assert_eq!(
        occluders.last(),
        Some(&Occluder::Cylinder {
            base: [3.0, -2.0, 0.0],
            radius: 0.3,
            height: 9.0
        })
    );
}
