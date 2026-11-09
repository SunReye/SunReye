//! Car places (ADR 20), checked against points worked out by hand.

use crate::{Body, BodyClass, CarPlace, Scene, Stand};

fn place(rotation: f64) -> CarPlace {
    CarPlace {
        device: 7,
        x: 2.0,
        z: 1.0,
        width: 3.0,
        length: 5.0,
        rotation,
        body: Some(Body {
            class: BodyClass::Sedan,
            colour: "#f2f2ee".to_owned(),
        }),
        model: None,
    }
}

fn scene(north: f64, places: Vec<CarPlace>) -> Scene {
    Scene {
        north,
        blocks: vec![],
        obstacles: vec![],
        grids: vec![],
        equipment: vec![],
        car_places: places,
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
fn a_car_stands_at_its_places_centre_nose_forward_with_its_label_above() {
    // The place runs 3 m east and 5 m south from (2, −1): its centre is (3.5, −3.5).
    let stands = scene(0.0, vec![place(0.0)]).stands().unwrap();

    let [Stand { at, forward, above }] = stands.as_slice() else {
        panic!("{stands:?}");
    };
    assert_near(*at, [3.5, -3.5, 0.0]);
    assert_near(*forward, [0.0, 1.0, 0.0]);
    assert_near(*above, [3.5, -3.5, 2.5]);
}

#[test]
fn a_place_turns_about_its_corner_and_with_the_compass() {
    // Turned 90° clockwise about (2, −1), the place runs south 3 m and west 5 m; the compass
    // turns everything back 90°.
    let turned = scene(0.0, vec![place(90.0)]).stands().unwrap();
    let north = scene(-90.0, vec![place(90.0)]).stands().unwrap();

    assert_near(turned[0].at, [-0.5, -2.5, 0.0]);
    assert_near(turned[0].forward, [1.0, 0.0, 0.0]);
    assert_near(north[0].forward, [0.0, 1.0, 0.0]);
}

#[test]
fn a_place_without_size_with_a_colour_no_hex_code_or_a_model_no_digest_is_refused() {
    let flat = CarPlace {
        length: 0.0,
        ..place(0.0)
    };
    let named = CarPlace {
        body: Some(Body {
            class: BodyClass::Van,
            colour: "white".to_owned(),
        }),
        ..place(0.0)
    };
    let linked = CarPlace {
        model: Some("../core.sqlite".to_owned()),
        ..place(0.0)
    };
    let uploaded = CarPlace {
        model: Some("ab".repeat(32)),
        ..place(0.0)
    };

    assert_eq!(scene(0.0, vec![place(0.0), flat]).stands(), Err(1));
    assert_eq!(scene(0.0, vec![named]).stands(), Err(0));
    assert_eq!(scene(0.0, vec![linked]).stands(), Err(0));
    assert!(scene(0.0, vec![uploaded]).stands().is_ok());
}
