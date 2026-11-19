//! Openings as the builder edits them (ADR 20), on a 10 m × 8 m block with 3 m walls.

use serde_json::{Value, json};

use crate::{Light, Opening, OpeningKind, Scene, Unfit, Wall};

fn scene(block: &Value, openings: &[Opening]) -> Scene {
    let mut house = json!({
        "x": 0.0, "z": 0.0, "width": 10.0, "depth": 8.0, "eave": 3.0, "rotation": 0.0,
        "roof": { "kind": "flat" },
    });
    if let (Some(house), Some(block)) = (house.as_object_mut(), block.as_object()) {
        house.extend(block.clone());
    }
    serde_json::from_value(json!({
        "north": 0.0, "blocks": [house], "obstacles": [], "openings": openings,
    }))
    .unwrap()
}

fn house(openings: &[Opening]) -> Scene {
    scene(&json!({}), openings)
}

const WINDOW: Opening = Opening {
    kind: OpeningKind::Window,
    block: 0,
    wall: Wall::Front,
    along: 2.0,
    width: 1.2,
    height: 1.4,
    sill: 0.9,
    light: Light::Auto,
};

#[test]
fn a_new_opening_takes_the_first_free_place_on_a_wall() {
    let first = house(&[])
        .place(OpeningKind::Window, 1.2, 1.4, 0.9)
        .unwrap();

    // Half a metre from the front wall's left corner.
    assert_eq!(
        first,
        Opening {
            along: 0.5,
            ..WINDOW
        }
    );
    // The window ends at 1.7 m; a door keeps 0.2 m from it.
    assert_eq!(
        house(&[first]).place(OpeningKind::FrontDoor, 1.0, 2.1, 0.0),
        Some(Opening {
            kind: OpeningKind::FrontDoor,
            along: 1.9,
            width: 1.0,
            height: 2.1,
            sill: 0.0,
            ..WINDOW
        })
    );
}

#[test]
fn a_full_wall_sends_a_new_opening_to_the_next() {
    // 9 m of garage door leave no place on the 10 m front wall; the right wall is 8 m long.
    let door = Opening {
        kind: OpeningKind::GarageDoor,
        along: 0.5,
        width: 9.0,
        height: 2.1,
        sill: 0.0,
        ..WINDOW
    };

    let placed = house(&[door]).place(OpeningKind::Window, 1.2, 1.4, 0.9);

    assert_eq!(
        placed,
        Some(Opening {
            wall: Wall::Right,
            along: 0.5,
            ..WINDOW
        })
    );
}

#[test]
fn a_carport_takes_no_opening_and_a_low_wall_a_lower_one() {
    let carport = scene(&json!({ "open": true }), &[]);
    let shed = scene(&json!({ "eave": 1.8 }), &[]);

    assert_eq!(carport.place(OpeningKind::Window, 1.2, 1.4, 0.9), None);
    let door = shed.place(OpeningKind::FrontDoor, 1.0, 2.1, 0.0).unwrap();
    assert!((door.height - 1.8).abs() < 1e-9, "{door:?}");
}

#[test]
fn a_change_is_kept_on_its_wall_and_under_the_eave() {
    let beside = Opening {
        along: 5.0,
        ..WINDOW
    };
    let scene = house(&[WINDOW, beside]);
    let along = |along| Opening { along, ..WINDOW };
    let tall = Opening {
        height: 5.0,
        ..WINDOW
    };
    let door = Opening {
        kind: OpeningKind::FrontDoor,
        ..WINDOW
    };

    // The wall is 10 m long and the window 1.2 m wide.
    assert_eq!(scene.refit(0, along(9.5)), Ok(along(8.8)));
    assert_eq!(scene.refit(0, along(-1.0)), Ok(along(0.0)));
    // The eave is at 3 m: 0.9 m of sill leaves 2.1 m.
    let lower = Opening {
        height: 2.1,
        ..WINDOW
    };
    assert_eq!(scene.refit(0, tall), Ok(lower));
    // A door stands on the ground.
    assert_eq!(scene.refit(0, door), Ok(Opening { sill: 0.0, ..door }));
}

#[test]
fn a_change_without_room_or_over_another_opening_is_refused_with_its_reason() {
    let scene = house(&[
        WINDOW,
        Opening {
            along: 5.0,
            ..WINDOW
        },
    ]);

    let wide = Opening {
        width: 30.0,
        ..WINDOW
    };
    assert_eq!(scene.refit(0, wide), Err(Unfit::Room));
    // 4 m + 1.2 m reaches over the window at 5 m.
    let over = Opening {
        along: 4.0,
        ..WINDOW
    };
    assert_eq!(scene.refit(0, over), Err(Unfit::Overlap));
    assert_eq!(scene.refit(2, WINDOW), Err(Unfit::Room));
}
