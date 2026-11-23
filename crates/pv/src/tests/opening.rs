//! Windows and doors on a block's walls (ADR 20), checked against points worked out by hand.

use crate::{Block, Light, Opening, OpeningKind, Overhang, Roof, Scene, Wall};

/// A 10 m × 8 m block at the origin with 3 m walls, and a carport beside it.
fn house(openings: Vec<Opening>) -> Scene {
    let block = |x: f64, open: bool| Block {
        x,
        z: 0.0,
        width: 10.0,
        depth: 8.0,
        eave: 3.0,
        rotation: 0.0,
        roof: Roof::Gable { pitch: 45.0 },
        open,
        overhang: Overhang::default(),
        roof_colour: None,
        wall_colour: None,
        free_form: None,
    };
    Scene {
        north: 0.0,
        blocks: vec![block(0.0, false), block(20.0, true)],
        obstacles: vec![],
        grids: vec![],
        equipment: vec![],
        car_places: vec![],
        chimneys: vec![],
        surfaces: vec![],
        fences: vec![],
        openings,
        roof_windows: vec![],
        face_details: vec![],
    }
}

fn window(wall: Wall, along: f64) -> Opening {
    Opening {
        kind: OpeningKind::Window,
        block: 0,
        wall,
        along,
        width: 1.2,
        height: 1.4,
        sill: 0.9,
        light: Light::Auto,
    }
}

fn door(kind: OpeningKind, along: f64) -> Opening {
    Opening {
        kind,
        sill: 0.0,
        height: 2.1,
        width: 1.0,
        ..window(Wall::Front, along)
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
fn a_front_window_is_fitted_from_its_walls_left_end_seen_from_outside() {
    // The front wall runs along +z = 8 m, which is 8 m south: north −8. Seen from the south its
    // left end is the west corner, so 2 m along is 2 m east.
    let fitted = house(vec![window(Wall::Front, 2.0)]).fitted().unwrap();
    let [low_left, low_right, high_right, high_left] = fitted[0].corners;
    assert_near(low_left, [2.0, -8.0, 0.9]);
    assert_near(low_right, [3.2, -8.0, 0.9]);
    assert_near(high_right, [3.2, -8.0, 2.3]);
    assert_near(high_left, [2.0, -8.0, 2.3]);
    assert_near(fitted[0].out, [0.0, -1.0, 0.0]);
    assert_eq!(fitted[0].kind, OpeningKind::Window);
}

#[test]
fn a_right_wall_runs_north_seen_from_the_east() {
    // The right wall is at x = 10 m; its left end seen from the east is the south corner.
    let fitted = house(vec![window(Wall::Right, 1.0)]).fitted().unwrap();
    assert_near(fitted[0].corners[0], [10.0, -7.0, 0.9]);
    assert_near(fitted[0].corners[1], [10.0, -5.8, 0.9]);
    assert_near(fitted[0].out, [1.0, 0.0, 0.0]);
}

#[test]
fn an_opening_past_its_walls_ends_or_above_the_eave_is_refused() {
    let refused = |opening: Opening| house(vec![opening]).fitted();
    assert_eq!(refused(window(Wall::Front, -0.1)), Err(0));
    // 9 m + 1.2 m is past the 10 m wall.
    assert_eq!(refused(window(Wall::Front, 9.0)), Err(0));
    // The side wall is 8 m.
    assert_eq!(refused(window(Wall::Left, 7.0)), Err(0));
    assert!(refused(window(Wall::Front, 8.8)).is_ok());
    assert_eq!(
        refused(Opening {
            sill: 1.7,
            ..window(Wall::Front, 2.0)
        }),
        Err(0)
    );
}

#[test]
fn an_opening_without_a_size_on_no_block_or_on_a_carport_is_refused() {
    let refused = |opening: Opening| house(vec![opening]).fitted();
    for opening in [
        Opening {
            width: 0.0,
            ..window(Wall::Front, 2.0)
        },
        Opening {
            height: 0.0,
            ..window(Wall::Front, 2.0)
        },
        Opening {
            sill: -0.1,
            ..window(Wall::Front, 2.0)
        },
        Opening {
            block: 2,
            ..window(Wall::Front, 2.0)
        },
        // A carport has posts, not walls.
        Opening {
            block: 1,
            ..window(Wall::Front, 2.0)
        },
    ] {
        assert_eq!(refused(opening), Err(0));
    }
}

#[test]
fn a_door_stands_on_the_ground() {
    for kind in [OpeningKind::FrontDoor, OpeningKind::GarageDoor] {
        assert!(house(vec![door(kind, 4.0)]).fitted().is_ok());
        let raised = Opening {
            sill: 0.2,
            ..door(kind, 4.0)
        };
        assert_eq!(house(vec![raised]).fitted(), Err(0));
    }
}

#[test]
fn openings_that_overlap_on_one_wall_are_refused_the_later_one_named() {
    // 2.0..3.2 and 3.0..4.2 overlap; on another wall, or one above the other, they do not.
    let overlapping = vec![window(Wall::Front, 2.0), window(Wall::Front, 3.0)];
    assert_eq!(house(overlapping).fitted(), Err(1));
    let apart = vec![
        window(Wall::Front, 2.0),
        window(Wall::Front, 3.2),
        window(Wall::Back, 2.0),
        Opening {
            sill: 0.0,
            height: 0.8,
            ..window(Wall::Front, 2.0)
        },
    ];
    assert_eq!(house(apart).fitted().map(|fitted| fitted.len()), Ok(4));
}

#[test]
fn a_scene_stored_without_openings_loads_and_saves_unchanged() {
    let stored = r#"{"north":0.0,"blocks":[],"obstacles":[]}"#;
    let scene: Scene = serde_json::from_str(stored).unwrap();
    assert_eq!(scene.openings, []);
    assert!(!serde_json::to_string(&scene).unwrap().contains("openings"));
}

#[test]
fn an_opening_is_stored_in_camel_case_its_sill_left_out_on_the_ground() {
    let scene = house(vec![door(OpeningKind::FrontDoor, 4.0)]);
    let stored = serde_json::to_value(&scene).unwrap();
    assert_eq!(
        stored["openings"][0],
        serde_json::json!({
            "kind": "frontDoor", "block": 0, "wall": "front",
            "along": 4.0, "width": 1.0, "height": 2.1,
        })
    );
    assert_eq!(serde_json::from_value::<Scene>(stored).unwrap(), scene);
}

#[test]
fn openings_never_shade() {
    let bare = house(vec![]);
    let glazed = house(vec![window(Wall::Front, 2.0)]);
    assert_eq!(bare.faces(), glazed.faces());
    assert_eq!(bare.occluders().len(), glazed.occluders().len());
}

#[test]
fn an_opening_stored_without_a_night_light_lights_by_the_rule_and_is_stored_as_it_was() {
    let stored = r#"{"kind":"window","block":0,"wall":"front","along":2.0,"width":1.2,"height":1.4,"sill":0.9}"#;
    let opening: Opening = serde_json::from_str(stored).unwrap();

    assert_eq!(opening.light, Light::Auto);
    assert_eq!(serde_json::to_string(&opening).unwrap(), stored);
}

#[test]
fn a_chosen_night_light_is_stored_and_reaches_what_is_drawn() {
    let dark = Opening {
        light: Light::Off,
        ..window(Wall::Front, 2.0)
    };
    let stored = serde_json::to_string(&dark).unwrap();

    assert!(stored.ends_with(r#""light":"off"}"#), "{stored}");
    assert_eq!(serde_json::from_str::<Opening>(&stored).unwrap(), dark);

    let lit = Opening {
        light: Light::On,
        ..window(Wall::Front, 5.0)
    };
    let fitted = house(vec![dark, lit, window(Wall::Back, 2.0)])
        .fitted()
        .unwrap();
    let lights: Vec<Light> = fitted.iter().map(|opening| opening.light).collect();
    assert_eq!(lights, vec![Light::Off, Light::On, Light::Auto]);
}
