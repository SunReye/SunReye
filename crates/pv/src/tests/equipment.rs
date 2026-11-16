//! Equipment markers on a block's wall (ADR 20), checked against points worked out by hand.

use crate::{Block, Equipment, EquipmentKind, Mount, Overhang, Roof, Scene, Wall};

/// A 10 m × 8 m block at the origin under a 45° gable: its ridge stands at 3 + 4 = 7 m.
fn house(equipment: Vec<Equipment>) -> Scene {
    Scene {
        north: 0.0,
        blocks: vec![Block {
            x: 0.0,
            z: 0.0,
            width: 10.0,
            depth: 8.0,
            eave: 3.0,
            rotation: 0.0,
            roof: Roof::Gable { pitch: 45.0 },
            open: false,
            overhang: Overhang::default(),
            roof_colour: None,
            wall_colour: None,
        }],
        obstacles: vec![],
        grids: vec![],
        equipment,
        car_places: vec![],
        chimneys: vec![],
        surfaces: vec![],
        fences: vec![],
        openings: vec![],
        roof_windows: vec![],
        imported: None,
    }
}

fn marker(wall: Wall, along: f64, inside: bool) -> Equipment {
    Equipment {
        device: 1,
        kind: EquipmentKind::Inverter,
        block: 0,
        wall,
        along,
        inside,
    }
}

fn assert_near(actual: [f64; 3], expected: [f64; 3]) {
    assert!(
        actual
            .iter()
            .zip(expected)
            .all(|(a, e)| (a - e).abs() < 1e-9),
        "{actual:?} is not {expected:?}"
    );
}

#[test]
fn a_marker_hangs_on_its_wall_at_head_height_with_its_label_above_the_ridge() {
    // The front wall runs east along z = 8, the shading frame's north −8; outside is south.
    let mounts = house(vec![marker(Wall::Front, 2.0, false)])
        .mounts()
        .unwrap();

    let [Mount { at, above }] = mounts.as_slice() else {
        panic!("{mounts:?}");
    };
    assert_near(*at, [2.0, -8.1, 1.5]);
    assert_near(*above, [2.0, -8.1, 8.0]);
}

#[test]
fn along_counts_from_the_walls_left_end_seen_from_outside_and_inside_sits_behind_it() {
    // Seen from the east, the right wall's left end is its south-east corner.
    let mounts = house(vec![marker(Wall::Right, 3.0, true)])
        .mounts()
        .unwrap();

    assert_near(mounts[0].at, [9.9, -5.0, 1.5]);
}

#[test]
fn a_marker_off_its_wall_or_its_block_is_misplaced() {
    let past = house(vec![
        marker(Wall::Back, 2.0, false),
        marker(Wall::Left, 9.0, false),
    ]);
    let nowhere = house(vec![Equipment {
        block: 1,
        ..marker(Wall::Front, 1.0, false)
    }]);

    assert_eq!(past.mounts(), Err(1));
    assert_eq!(nowhere.mounts(), Err(0));
}

#[test]
fn a_wall_carries_its_frame_from_its_left_end_seen_from_outside() {
    let near = |actual: [f64; 3], expected: [f64; 3]| {
        let close = actual
            .iter()
            .zip(expected)
            .all(|(a, e)| (a - e).abs() < 1e-9);
        assert!(close, "{actual:?} is not {expected:?}");
    };
    let [front, right, _, _] = house(vec![]).walls().remove(0);

    // The front wall runs along +z = 8 m, 8 m south; seen from the south, east is to the right.
    near(front.left, [0.0, -8.0, 0.0]);
    near(front.right, [1.0, 0.0, 0.0]);
    near(front.out, [0.0, -1.0, 0.0]);
    // The right wall starts at the south-east corner and runs north.
    near(right.left, [10.0, -8.0, 0.0]);
    near(right.right, [0.0, 1.0, 0.0]);
    near(right.out, [1.0, 0.0, 0.0]);

    // Turned a quarter clockwise about its corner, the front faces west and runs south.
    let mut turned = house(vec![]);
    turned.blocks.iter_mut().for_each(|b| b.rotation = 90.0);
    let [front, ..] = turned.walls().remove(0);
    near(front.left, [-8.0, 0.0, 0.0]);
    near(front.right, [0.0, -1.0, 0.0]);
    near(front.out, [-1.0, 0.0, 0.0]);
}
