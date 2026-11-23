//! Modules on roof faces (ADR 20), checked against a 10 m × 8 m gable house at 35° worked out
//! by hand: each roof face is 10 m wide and 4 m ÷ cos 35° = 4.883 m up the slope.

use super::fixtures::MODULE;
use super::fixtures::shaded_substrings;
use crate::Overhang;
use crate::{
    Block, GridModule, Misplaced, ModuleGrid, Neighbour, Obstacle, Place, Plane, Point, Roof,
    Scene, Size, Spot, Sun, open_circuit_voltage,
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
            open: false,
            overhang: Overhang::default(),
            roof_colour: None,
            wall_colour: None,
            free_form: None,
        }],
        obstacles: vec![],
        grids,
        equipment: vec![],
        car_places: vec![],
        chimneys: vec![],
        surfaces: vec![],
        fences: vec![],
        openings: vec![],
        roof_windows: vec![],
        face_details: vec![],
        existing_pv: vec![],
    }
}

fn grid(landscape: bool, modules: Vec<GridModule>) -> ModuleGrid {
    ModuleGrid {
        block: 0,
        face: SOUTH_FACE,
        module_type: 7,
        landscape,
        setback: 0.3,
        modules,
    }
}

/// A module as scenes stored it before modules had places.
const fn cell(row: u32, column: u32, string: Option<u32>) -> GridModule {
    GridModule {
        spot: Spot::Cell { row, column },
        string,
        optimized: false,
        order: None,
    }
}

/// A module with its lower left corner `across` and `up` the face.
const fn module(across: f64, up: f64, landscape: bool) -> GridModule {
    GridModule {
        spot: Spot::Place {
            across,
            up,
            landscape,
        },
        string: None,
        optimized: false,
        order: None,
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

fn same(actual: [[f64; 2]; 2], expected: [[f64; 2]; 2]) -> bool {
    actual
        .iter()
        .flatten()
        .zip(expected.iter().flatten())
        .all(|(a, e)| close(*a, *e))
}

#[test]
fn a_modules_footprint_runs_from_its_place_by_its_own_orientation() {
    let grid = grid(false, vec![]);

    let portrait = grid.footprint(SIZE, module(0.5, 1.0, false).spot);
    let landscape = grid.footprint(SIZE, module(0.5, 1.0, true).spot);

    assert!(same(portrait, [[0.5, 1.0], [1.634, 2.722]]), "{portrait:?}");
    assert!(
        same(landscape, [[0.5, 1.0], [2.222, 2.134]]),
        "{landscape:?}"
    );
}

#[test]
fn a_module_stored_in_a_cell_lies_at_the_cells_corner_in_the_grids_orientation() {
    // Row 2 starts 0.3 + 2 × 1.742 = 3.784 m up the slope, column 1 0.3 + 1.154 m across.
    let area = grid(false, vec![]).footprint(SIZE, cell(2, 1, None).spot);
    // Landscape, a cell is 1.742 m across and 1.154 m up.
    let turned = grid(true, vec![]).footprint(SIZE, cell(2, 1, None).spot);

    assert!(same(area, [[1.454, 3.784], [2.588, 5.506]]), "{area:?}");
    assert!(same(turned, [[2.042, 2.608], [3.764, 3.742]]), "{turned:?}");
}

#[test]
fn a_scene_stored_with_rows_and_columns_loads_where_it_was_and_is_saved_with_places() {
    let stored = serde_json::json!({
        "block": 0, "face": 1, "moduleType": 7, "landscape": false, "setback": 0.3,
        "modules": [
            { "row": 0, "column": 0, "string": 4, "optimized": true, "order": 2 },
            { "row": 1, "column": 3 },
        ],
    });
    let scene = house(0.0, vec![serde_json::from_value(stored).unwrap()]);
    let before = scene.modules(size).unwrap();

    let settled = scene.settled(size);

    assert_eq!(settled.modules(size).unwrap(), before);
    let saved = serde_json::to_value(&settled.grids[0].modules).unwrap();
    let close_to =
        |value: &serde_json::Value, expected: f64| close(value.as_f64().unwrap(), expected);
    assert!(close_to(&saved[0]["across"], 0.3) && close_to(&saved[0]["up"], 0.3));
    assert!(close_to(&saved[1]["across"], 3.762) && close_to(&saved[1]["up"], 2.042));
    assert_eq!(saved[0]["landscape"], false);
    assert_eq!(
        (
            &saved[0]["string"],
            &saved[0]["optimized"],
            &saved[0]["order"]
        ),
        (&4.into(), &true.into(), &2.into())
    );
    assert!(saved[0].get("row").is_none() && saved[1].get("column").is_none());
    // Saved, it reads back as it is.
    let again: Vec<GridModule> = serde_json::from_value(saved).unwrap();
    assert_eq!(again, settled.grids[0].modules);
}

#[test]
fn a_module_with_neither_a_place_nor_a_cell_or_with_both_is_refused() {
    let read = |value| serde_json::from_value::<GridModule>(value);

    assert!(read(serde_json::json!({ "across": 1.0, "up": 1.0, "landscape": true })).is_ok());
    assert!(read(serde_json::json!({ "string": 1 })).is_err());
    assert!(read(serde_json::json!({ "across": 1.0, "up": 1.0 })).is_err());
    assert!(
        read(serde_json::json!({
            "across": 1.0, "up": 1.0, "landscape": true, "row": 0, "column": 0,
        }))
        .is_err()
    );
}

#[test]
fn a_placed_module_takes_its_face_plane_and_its_own_centre() {
    let mut first = module(0.3, 0.3, false);
    first.string = Some(4);
    let scene = house(0.0, vec![grid(false, vec![first])]);

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
fn portrait_and_landscape_modules_share_a_face() {
    // The landscape one starts 2 cm right of the portrait one and is 1.722 m across.
    let scene = house(
        0.0,
        vec![grid(
            false,
            vec![module(0.3, 0.3, false), module(1.454, 0.3, true)],
        )],
    );

    let placed = scene.modules(size).unwrap();

    let lain: Vec<Place> = placed.iter().filter_map(|p| p.module.place).collect();
    assert_eq!(lain.len(), 2);
    assert!(!lain[0].landscape && lain[1].landscape);
    // Its centre lies 1.454 + 0.861 m across and 0.3 + 0.567 m up the slope.
    assert!(close(lain[1].centre[0], 2.315), "{lain:?}");
    assert!(close(
        lain[1].centre[2],
        0.867f64.mul_add(35f64.to_radians().sin(), 3.0)
    ));
}

#[test]
fn an_unassigned_module_is_placed_without_a_string() {
    let scene = house(0.0, vec![grid(false, vec![module(4.0, 2.0, false)])]);

    assert_eq!(scene.modules(size).unwrap()[0].string, None);
}

#[test]
fn a_module_crossing_the_setback_is_refused() {
    // 0.29 m from the left edge; and one whose top reaches past the ridge's setback at 4.583 m.
    for crossing in [
        module(0.29, 0.3, false),
        module(3.0, 2.87, false),
        cell(2, 0, None),
    ] {
        let scene = house(
            0.0,
            vec![grid(false, vec![module(0.3, 0.3, false), crossing])],
        );

        assert_eq!(
            scene.modules(size),
            Err(Misplaced::Setback { grid: 0, module: 1 }),
            "{crossing:?}"
        );
    }
}

#[test]
fn modules_that_overlap_are_refused_and_modules_that_touch_are_not() {
    let overlapping = house(
        0.0,
        vec![grid(
            false,
            vec![module(0.3, 0.3, false), module(1.4, 2.0, false)],
        )],
    );
    let touching = house(
        0.0,
        vec![grid(
            false,
            vec![module(0.3, 0.3, false), module(1.434, 0.3, false)],
        )],
    );
    // A second grid on the same face lies over the first's module.
    let across_grids = house(
        0.0,
        vec![
            grid(false, vec![module(0.3, 0.3, false)]),
            grid(true, vec![module(1.0, 1.0, true)]),
        ],
    );

    assert_eq!(
        overlapping.modules(size),
        Err(Misplaced::Overlap { grid: 0, module: 1 })
    );
    assert_eq!(touching.modules(size).map(|placed| placed.len()), Ok(2));
    assert_eq!(
        across_grids.modules(size),
        Err(Misplaced::Overlap { grid: 1, module: 0 })
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
    let mut scene = house(0.0, vec![grid(false, vec![cell(0, 0, Some(1))])]).settled(size);
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

#[test]
fn a_supplied_neighbour_shades_a_module_as_an_equal_box_does() {
    let low_south = Sun {
        zenith: 70.0,
        azimuth: 0.0,
    };
    let scene = house(0.0, vec![grid(false, vec![cell(0, 0, Some(1))])]).settled(size);
    let module = scene.modules(size).unwrap()[0].module;
    let shade = |occluders: &[crate::Occluder]| {
        shaded_substrings(
            &MODULE,
            module.plane,
            module.place.unwrap(),
            low_south,
            occluders,
        )
    };
    // The wall above as the consumer gives it: east and north of the scene's origin.
    let wall = Neighbour {
        footprint: vec![[-5.0, -10.0], [15.0, -10.0], [15.0, -10.3], [-5.0, -10.3]],
        height: 6.0,
    };

    let mut occluders = scene.occluders();
    occluders.extend(Neighbour::occluders(&[wall]).unwrap());

    assert_eq!(shade(&scene.occluders()), 0);
    assert_eq!(shade(&occluders), 3);
}

#[test]
fn the_roof_inside_the_setback_is_the_outline_moved_in_from_every_edge() {
    let mut scene = house(0.0, vec![]);
    let roofs = scene.roofs();

    let inset = roofs[SOUTH_FACE].inset(0.3).unwrap();

    assert_eq!(inset.len(), 4);
    for corner in [
        [0.3, 0.3],
        [9.7, 0.3],
        [9.7, SLOPE - 0.3],
        [0.3, SLOPE - 0.3],
    ] {
        assert!(
            inset
                .iter()
                .any(|p| close(p[0], corner[0]) && close(p[1], corner[1])),
            "{corner:?} missing from {inset:?}"
        );
    }
    // A setback wider than half the face leaves no roof.
    assert_eq!(roofs[SOUTH_FACE].inset(2.5), None);

    // A hip's faces are triangles and trapezia: every corner stays 0.3 m inside every edge.
    scene.blocks[0].roof = Roof::Hip { pitch: 35.0 };
    for roof in scene.roofs() {
        let inset = roof.inset(0.3).unwrap();
        assert_eq!(inset.len(), roof.outline.len());
        assert!(
            inset.iter().all(|p| roof.inside(*p, 0.3 - 1e-6)),
            "{inset:?}"
        );
    }
}
