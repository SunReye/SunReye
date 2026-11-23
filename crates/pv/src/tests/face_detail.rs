//! What is known of a roof face (ADR 20): its covering and whether its pitch is confirmed,
//! on the 10 m × 8 m gable house at 35°, whose two faces are 0 and 1.

use serde_json::{Value, json};

use crate::Scene;

fn house(details: &Value) -> Scene {
    serde_json::from_value(json!({
        "north": 0.0,
        "blocks": [{
            "x": 0.0, "z": 0.0, "width": 10.0, "depth": 8.0, "eave": 3.0, "rotation": 0.0,
            "roof": { "kind": "gable", "pitch": 35.0 },
        }],
        "obstacles": [],
        "grids": [],
        "faceDetails": details,
    }))
    .unwrap()
}

#[test]
fn a_face_carries_its_covering_and_a_confirmed_pitch() {
    let details = json!([
        { "block": 0, "face": 0, "covering": "tiles", "pitchConfirmed": true },
        { "block": 0, "face": 1, "covering": "metal" },
    ]);

    let scene = house(&details);

    assert_eq!(
        serde_json::to_value(&scene).unwrap()["faceDetails"],
        details
    );
    assert_eq!(scene.check_details(), Ok(()));
}

#[test]
fn a_scene_without_details_writes_none() {
    let scene = house(&json!([]));

    assert!(
        serde_json::to_value(&scene)
            .unwrap()
            .get("faceDetails")
            .is_none()
    );
}

#[test]
fn a_detail_naming_no_face_or_a_face_twice_is_refused() {
    let nowhere = json!([{ "block": 0, "face": 2, "covering": "slate" }]);
    let twice = json!([
        { "block": 0, "face": 1, "covering": "slate" },
        { "block": 0, "face": 1, "covering": "bitumen" },
    ]);

    assert_eq!(house(&nowhere).check_details(), Err(0));
    assert_eq!(house(&twice).check_details(), Err(1));
}
