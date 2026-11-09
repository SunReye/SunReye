//! Module grids on roof faces (ADR 20), checked against a 10 m × 8 m gable house at 35° worked out
//! by hand: each roof face is 10 m wide and 4 m ÷ cos 35° = 4.883 m up the slope.

use super::fixtures::MODULE;
use crate::shade::shaded_substrings;
use crate::{
    Block, Cell, Misplaced, ModuleGrid, Obstacle, Place, Plane, Point, Roof, Scene, Size, Sun,
    open_circuit_voltage,
};

const SIZE: Size = Size {
    width: 1.134,
    height: 1.722,
};
const SLOPE: f64 = 4.883_098_355_045_824;
/// The block's faces: the north face first, then the south face.
const SOUTH_FACE: usize = 1;

fn house(north: f64, grids: Vec<ModuleGrid>) -> Scene {
    Scene {
        north,
        blocks: vec![Block {
            x: 0.0,
            z: 0.0,
            width: 10.0,
            depth: 8.0,
            eave: 3.0,
            rotation: 0.0,
            roof: Roof::Gable { pitch: 35.0 },
        }],
        obstacles: vec![],
        grids,
        equipment: vec![],
    }
}

fn grid(landscape: bool, modules: Vec<Cell>) -> ModuleGrid {
    ModuleGrid {
        block: 0,
        face: SOUTH_FACE,
        module_type: 7,
        landscape,
        setback: 0.3,
        modules,
    }
}

const fn cell(row: u32, column: u32, string: Option<u32>) -> Cell {
    Cell {
        row,
        column,
        string,
        optimized: false,
    }
}

fn size(module_type: u32) -> Option<Size> {
    (module_type == 7).then_some(SIZE)
}

fn close(actual: f64, expected: f64) -> bool {
    (actual - expected).abs() < 1e-6
}

fn near(actual: Point, expected: Point) -> bool {
    actual.iter().zip(expected).all(|(a, e)| close(*a, e))
}

#[test]
fn a_gable_roof_has_a_north_and_a_south_face_each_laid_out_from_its_eave() {
    let roofs = house(0.0, vec![]).roofs();

    assert_eq!(roofs.len(), 2);
    let [north, south] = [&roofs[0], &roofs[1]];
    assert!(close(north.plane.tilt, 35.0) && close(north.plane.azimuth, 180.0));
    assert!(close(south.plane.tilt, 35.0) && close(south.plane.azimuth, 0.0));
    assert_eq!((south.block, south.face), (0, SOUTH_FACE));
    for corner in [[0.0, 0.0], [10.0, 0.0], [10.0, SLOPE], [0.0, SLOPE]] {
        assert!(
            south
                .outline
                .iter()
                .any(|p| close(p[0], corner[0]) && close(p[1], corner[1])),
            "{corner:?} missing from {:?}",
            south.outline
        );
    }
}

#[test]
fn the_compass_turns_each_face_with_the_scene() {
    // The scene's forward axis points east, so the front eave faces west.
    let roofs = house(90.0, vec![]).roofs();

    assert!(close(roofs[SOUTH_FACE].plane.azimuth, 90.0));
}

#[test]
fn a_cell_is_the_module_plus_a_gap_inside_the_setback() {
    let roofs = house(0.0, vec![]).roofs();
    let face = &roofs[SOUTH_FACE];

    // Portrait: 0.3 + c × 1.154 + 1.134 ≤ 9.7 and 0.3 + r × 1.742 + 1.722 ≤ 4.583.
    let portrait = face.cells(&grid(false, vec![]), SIZE);
    assert_eq!(portrait.len(), 8 * 2);
    assert!(portrait.iter().any(|c| (c.row, c.column) == (1, 7)));
    // Landscape: 0.3 + c × 1.742 + 1.722 ≤ 9.7 and 0.3 + r × 1.154 + 1.134 ≤ 4.583.
    let landscape = face.cells(&grid(true, vec![]), SIZE);
    assert_eq!(landscape.len(), 5 * 3);
}

#[test]
fn a_placed_module_takes_its_face_plane_and_its_cell_centre() {
    let scene = house(0.0, vec![grid(false, vec![cell(0, 0, Some(4))])]);

    let placed = scene.modules(size).unwrap();

    assert_eq!(placed.len(), 1);
    let module = placed[0].module;
    assert_eq!(placed[0].string, Some(4));
    assert!(close(module.plane.tilt, 35.0) && close(module.plane.azimuth, 0.0));
    let Some(Place { centre, landscape }) = module.place else {
        panic!("unplaced")
    };
    assert!(!landscape);
    // 0.867 m east and 1.161 m up the slope from the south eave's west corner, (0, −8, 3).
    assert!(
        near(
            centre,
            [0.867, -7.048_964_476_580_481, 3.665_922_242_603_564_5]
        ),
        "{centre:?}"
    );
}

#[test]
fn an_unassigned_module_is_placed_without_a_string() {
    let scene = house(0.0, vec![grid(false, vec![cell(1, 3, None)])]);

    assert_eq!(scene.modules(size).unwrap()[0].string, None);
}

#[test]
fn a_module_outside_the_setback_is_refused() {
    let scene = house(
        0.0,
        vec![grid(false, vec![cell(0, 0, None), cell(2, 0, None)])],
    );

    assert_eq!(
        scene.modules(size),
        Err(Misplaced::Setback {
            grid: 0,
            row: 2,
            column: 0
        })
    );
}

#[test]
fn two_modules_in_one_cell_are_refused() {
    let scene = house(
        0.0,
        vec![grid(false, vec![cell(0, 1, Some(1)), cell(0, 1, Some(2))])],
    );

    assert_eq!(
        scene.modules(size),
        Err(Misplaced::Overlap {
            grid: 0,
            row: 0,
            column: 1
        })
    );
}

#[test]
fn a_grid_on_a_missing_face_or_of_an_unknown_module_type_is_refused() {
    let mut on_nothing = grid(false, vec![]);
    on_nothing.face = 2;
    let mut unknown = grid(false, vec![]);
    unknown.module_type = 8;

    assert_eq!(
        house(0.0, vec![on_nothing]).modules(size),
        Err(Misplaced::Face { grid: 0 })
    );
    assert_eq!(
        house(0.0, vec![unknown]).modules(size),
        Err(Misplaced::ModuleType { grid: 0 })
    );
}

#[test]
fn a_string_open_circuit_voltage_rises_in_the_cold() {
    // 16 × 41 V × (1 + 0.27 %/K × 35 K), worked by hand.
    assert!(close(open_circuit_voltage(&MODULE, 16, -10.0), 717.992));
    assert!(close(open_circuit_voltage(&MODULE, 16, 25.0), 656.0));
}

#[test]
fn a_flat_roof_lies_level_facing_south() {
    let mut scene = house(0.0, vec![]);
    scene.blocks[0].roof = Roof::Flat;

    let roofs = scene.roofs();

    assert_eq!(roofs.len(), 1);
    assert_eq!(
        roofs[0].plane,
        Plane {
            tilt: 0.0,
            azimuth: 0.0
        }
    );
}

#[test]
fn a_placed_module_is_shaded_by_a_wall_in_front_of_the_house_but_never_by_its_own_roof() {
    let low_south = Sun {
        zenith: 70.0,
        azimuth: 0.0,
    };
    let mut scene = house(0.0, vec![grid(false, vec![cell(0, 0, Some(1))])]);
    let shade = |scene: &Scene| {
        let module = scene.modules(size).unwrap()[0].module;
        shaded_substrings(
            &MODULE,
            module.plane,
            module.place.unwrap(),
            low_south,
            &scene.occluders(),
        )
    };

    assert_eq!(shade(&scene), 0);

    // A 6 m wall 2 m south of the front eave.
    scene.obstacles.push(Obstacle::Box {
        x: -5.0,
        z: 10.0,
        width: 20.0,
        depth: 0.3,
        height: 6.0,
        rotation: 0.0,
    });
    assert_eq!(shade(&scene), 3);
}
