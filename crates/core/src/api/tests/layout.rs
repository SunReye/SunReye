//! The PV layout (ADR 17): module types and strings with stable ids, applying from a date.

use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use serde_json::{Value, json};

use super::{Core, HOME, from, get, json, problem, with_cookie};

/// The owner's module, made up where the ticket is silent.
fn datasheet() -> Value {
    json!({
        "name": "Owner 400", "pmax": 400.0, "vmp": 34.0, "imp": 11.76, "voc": 41.0, "isc": 12.5,
        "powerCoefficient": -0.35, "voltageCoefficient": -0.27, "currentCoefficient": 0.05,
        "width": 1.134, "height": 1.722, "bypassDiodes": 3,
    })
}

fn send(method: &str, uri: &str, body: &Value) -> Request<Body> {
    let request = Request::builder()
        .method(method)
        .uri(uri)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap();
    from(HOME, request)
}

fn string(id: Option<u64>, name: &str, module_type: &Value, input: u32, azimuth: f64) -> Value {
    let mut string = json!({
        "name": name, "moduleType": module_type, "device": 1, "input": input, "modules": 16,
        "optimized": 0, "tilt": 35.0, "azimuth": azimuth, "loss": 2.0,
    });
    if let Some(id) = id {
        string["id"] = json!(id);
    }
    string
}

impl Core {
    async fn call(&self, set_cookie: &str, request: Request<Body>) -> (StatusCode, Value) {
        let response = self.send(with_cookie(set_cookie, request)).await;
        (response.status(), json(response).await)
    }

    /// Adds the owner's module type; returns its id.
    async fn module_type(&self, set_cookie: &str) -> Value {
        let (status, body) = self
            .call(
                set_cookie,
                send("POST", "/api/v1/module-types", &datasheet()),
            )
            .await;
        assert_eq!(status, StatusCode::CREATED);
        body["id"].clone()
    }

    async fn put_layout(&self, set_cookie: &str, applies_from: &str, strings: &[Value]) -> Value {
        let body = json!({ "appliesFrom": applies_from, "strings": strings });
        let (status, body) = self
            .call(set_cookie, send("PUT", "/api/v1/layout", &body))
            .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        body
    }
}

fn ids(layout: &Value) -> Vec<(String, u64)> {
    layout["strings"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| {
            (
                s["name"].as_str().unwrap().to_owned(),
                s["id"].as_u64().unwrap(),
            )
        })
        .collect()
}

#[tokio::test]
async fn module_types_are_listed_with_their_ids() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let id = core.module_type(&set_cookie).await;

    let (status, body) = core.call(&set_cookie, get("/api/v1/module-types")).await;

    assert_eq!(status, StatusCode::OK);
    let mut listed = datasheet();
    listed["id"] = id;
    assert_eq!(body, json!({ "moduleTypes": [listed] }));
}

#[tokio::test]
async fn strings_keep_their_ids_and_a_removed_id_is_never_reused() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let module = core.module_type(&set_cookie).await;
    let first = core
        .put_layout(
            &set_cookie,
            "2026-11-01T00:00:00Z",
            &[
                string(None, "south", &module, 1, 0.0),
                string(None, "north", &module, 1, 180.0),
            ],
        )
        .await;
    let [(_, south), (_, north)] = ids(&first)[..] else {
        panic!("{first}")
    };
    assert_ne!(south, north);

    let second = core
        .put_layout(
            &set_cookie,
            "2026-11-02T00:00:00Z",
            &[
                string(Some(south), "south", &module, 1, 0.0),
                string(None, "east", &module, 2, -90.0),
            ],
        )
        .await;

    let [(_, kept), (_, east)] = ids(&second)[..] else {
        panic!("{second}")
    };
    assert_eq!(kept, south);
    assert!(east != south && east != north, "a fresh id: {east}");
}

#[tokio::test]
async fn a_layout_change_applies_from_its_date() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let module = core.module_type(&set_cookie).await;
    core.put_layout(
        &set_cookie,
        "2026-11-01T00:00:00Z",
        &[string(None, "south", &module, 1, 0.0)],
    )
    .await;
    core.put_layout(
        &set_cookie,
        "2026-11-10T00:00:00Z",
        &[string(None, "north", &module, 1, 180.0)],
    )
    .await;

    let at = |instant: &str| get(&format!("/api/v1/layout?at={instant}"));
    let (_, before) = core.call(&set_cookie, at("2026-11-09T12:00:00Z")).await;
    let (_, after) = core.call(&set_cookie, at("2026-11-10T00:00:00Z")).await;
    let (status, none) = core.call(&set_cookie, at("2026-10-31T00:00:00Z")).await;

    assert_eq!(before["appliesFrom"], "2026-11-01T00:00:00Z");
    assert_eq!(ids(&before)[0].0, "south");
    assert_eq!(ids(&after)[0].0, "north");
    assert_eq!(
        (status, none["code"].clone()),
        (StatusCode::NOT_FOUND, json!("layout.none"))
    );
}

#[tokio::test]
async fn strings_wire_to_a_known_inverters_mppt_inputs_and_known_ids() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let module = core.module_type(&set_cookie).await;
    let refused = async |strings: Vec<Value>| {
        let body = json!({ "appliesFrom": "2026-11-01T00:00:00Z", "strings": strings });
        let response = core
            .send(with_cookie(
                &set_cookie,
                send("PUT", "/api/v1/layout", &body),
            ))
            .await;
        problem(response).await
    };
    let mut elsewhere = string(None, "south", &module, 1, 0.0);
    elsewhere["device"] = json!(9);
    let unprocessable = |code: &str| (StatusCode::UNPROCESSABLE_ENTITY, code.to_owned());

    // The Deye profile declares two MPPT inputs.
    assert_eq!(
        refused(vec![string(None, "s", &module, 3, 0.0)]).await,
        unprocessable("layout.input")
    );
    assert_eq!(
        refused(vec![elsewhere]).await,
        unprocessable("layout.device")
    );
    assert_eq!(
        refused(vec![string(Some(42), "s", &module, 1, 0.0)]).await,
        unprocessable("layout.string")
    );
    assert_eq!(
        refused(vec![string(None, "s", &json!(42), 1, 0.0)]).await,
        unprocessable("layout.module-type")
    );
}

#[tokio::test]
async fn capabilities_mark_parallel_strings_estimated() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let module_type = core.module_type(&set_cookie).await;
    let layout = core
        .put_layout(
            &set_cookie,
            "2026-01-01T00:00:00Z",
            &[
                string(None, "south", &module_type, 1, 0.0),
                string(None, "north", &module_type, 1, 180.0),
                string(None, "second", &module_type, 2, 0.0),
            ],
        )
        .await;
    let ids = ids(&layout);

    let (status, body) = core.call(&set_cookie, get("/api/v1/capabilities")).await;

    assert_eq!(status, StatusCode::OK);
    // The second string is alone on input 2: measured, not estimated.
    let estimated = [&ids[0].1, &ids[1].1].map(|id| format!("pv.string.power[{id}]"));
    assert_eq!(body["devices"]["1"]["estimated"], json!(estimated));
}

/// A 10 m × 8 m gable house at 35°; face 1 faces south.
fn house(module_type: &Value, modules: &[Value]) -> Value {
    json!({
        "north": 0.0,
        "blocks": [{
            "x": 0.0, "z": 0.0, "width": 10.0, "depth": 8.0, "eave": 3.0, "rotation": 0.0,
            "roof": { "kind": "gable", "pitch": 35.0 },
        }],
        "obstacles": [],
        "grids": [{
            "block": 0, "face": 1, "moduleType": module_type, "landscape": false, "setback": 0.3,
            "modules": modules,
        }],
    })
}

fn cell(row: u32, column: u32, string: Option<u32>, optimized: bool) -> Value {
    let mut cell = json!({ "row": row, "column": column, "optimized": optimized });
    if let Some(string) = string {
        cell["string"] = json!(string);
    }
    cell
}

impl Core {
    async fn put_scene(
        &self,
        set_cookie: &str,
        strings: &[Value],
        scene: &Value,
    ) -> (StatusCode, Value) {
        let body =
            json!({ "appliesFrom": "2026-11-01T00:00:00Z", "strings": strings, "scene": scene });
        self.call(set_cookie, send("PUT", "/api/v1/layout", &body))
            .await
    }
}

#[tokio::test]
async fn a_scene_derives_its_strings_planes_and_module_counts() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let module = core.module_type(&set_cookie).await;
    // The browser's numbers are not trusted: the scene decides.
    let mut south = string(None, "south", &module, 1, 90.0);
    south["tilt"] = json!(5.0);
    let scene = house(
        &module,
        &[
            cell(0, 0, Some(0), false),
            cell(0, 1, Some(0), true),
            cell(1, 0, Some(0), false),
            cell(1, 1, None, false),
        ],
    );

    let (status, saved) = core.put_scene(&set_cookie, &[south], &scene).await;

    assert_eq!(status, StatusCode::OK, "{saved}");
    let string = &saved["strings"][0];
    assert_eq!(
        (&string["modules"], &string["optimized"]),
        (&json!(3), &json!(1))
    );
    assert!(
        (string["tilt"].as_f64().unwrap() - 35.0).abs() < 1e-9,
        "{string}"
    );
    assert!(string["azimuth"].as_f64().unwrap().abs() < 1e-9, "{string}");
    assert_eq!(saved["scene"], scene);
    let (_, read) = core.call(&set_cookie, get("/api/v1/layout")).await;
    assert_eq!(read["scene"], scene);
}

#[tokio::test]
async fn saving_refuses_modules_outside_the_setback_or_overlapping_or_unknown() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let module = core.module_type(&set_cookie).await;
    let strings = [string(None, "south", &module, 1, 0.0)];
    let refused = async |modules: &[Value]| {
        let (status, body) = core
            .put_scene(&set_cookie, &strings, &house(&module, modules))
            .await;
        (status, body["code"].as_str().unwrap_or_default().to_owned())
    };
    let unprocessable = |code: &str| (StatusCode::UNPROCESSABLE_ENTITY, code.to_owned());

    // Two rows of portrait modules fit inside the setback.
    assert_eq!(
        refused(&[cell(2, 0, Some(0), false)]).await,
        unprocessable("layout.setback")
    );
    assert_eq!(
        refused(&[cell(0, 0, Some(0), false), cell(0, 0, None, false)]).await,
        unprocessable("layout.overlap")
    );
    assert_eq!(
        refused(&[cell(0, 0, Some(1), false)]).await,
        unprocessable("layout.scene")
    );
}

#[tokio::test]
async fn a_string_too_long_for_the_inverter_in_the_cold_is_saved_with_a_warning() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let module = core.module_type(&set_cookie).await;
    let mut long = string(None, "long", &module, 1, 0.0);
    long["modules"] = json!(18);

    let saved = core
        .put_layout(
            &set_cookie,
            "2026-11-01T00:00:00Z",
            &[long, string(None, "short", &module, 2, 0.0)],
        )
        .await;

    // 18 × 41 V × (1 + 0.27 %/K × 35 K) at −10 °C, above the Deye's 800 V; 16 stay below.
    let warnings = saved["warnings"].as_array().unwrap();
    assert_eq!(warnings.len(), 1, "{saved}");
    assert_eq!(warnings[0]["string"], saved["strings"][0]["id"]);
    assert!((warnings[0]["openCircuitVoltage"].as_f64().unwrap() - 807.741).abs() < 1e-6);
    assert_eq!(warnings[0]["maxInputVoltage"], json!(800.0));
}

#[tokio::test]
async fn equipment_markers_are_saved_with_the_scene_and_one_off_its_wall_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let module = core.module_type(&set_cookie).await;
    let strings = [string(None, "south", &module, 1, 0.0)];
    let with = |along: f64| {
        let mut scene = house(&module, &[cell(0, 0, Some(0), false)]);
        scene["equipment"] = json!([{
            "device": 1, "kind": "inverter", "block": 0, "wall": "front", "along": along,
            "inside": false,
        }]);
        scene
    };

    let (status, saved) = core.put_scene(&set_cookie, &strings, &with(2.0)).await;
    let (refused, body) = core.put_scene(&set_cookie, &strings, &with(11.0)).await;

    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_eq!(saved["scene"], with(2.0));
    // The front wall is 10 m long.
    assert_eq!(
        (refused, &body["code"]),
        (StatusCode::UNPROCESSABLE_ENTITY, &json!("layout.scene"))
    );
}

#[tokio::test]
async fn a_car_place_under_a_carport_is_saved_and_the_carports_modules_join_a_string() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let module = core.module_type(&set_cookie).await;
    let strings = [string(None, "carport", &module, 1, 0.0)];
    let with = |colour: &str| {
        let mut scene = house(&module, &[cell(0, 0, Some(0), false)]);
        scene["blocks"].as_array_mut().unwrap().push(json!({
            "x": 12.0, "z": 0.0, "width": 3.0, "depth": 5.0, "eave": 2.2, "rotation": 0.0,
            "roof": { "kind": "flat" }, "open": true,
        }));
        scene["grids"].as_array_mut().unwrap().push(json!({
            "block": 1, "face": 0, "moduleType": module, "landscape": false, "setback": 0.1,
            "modules": [cell(0, 0, Some(0), false), cell(0, 1, Some(0), false)],
        }));
        scene["carPlaces"] = json!([{
            "device": 2, "x": 12.25, "z": 0.0, "width": 2.5, "length": 5.0, "rotation": 0.0,
            "body": { "class": "sedan", "colour": colour },
        }]);
        scene
    };

    let (status, saved) = core
        .put_scene(&set_cookie, &strings, &with("#f2f2ee"))
        .await;
    let (refused, body) = core.put_scene(&set_cookie, &strings, &with("pearl")).await;

    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_eq!(saved["scene"], with("#f2f2ee"));
    assert_eq!(saved["strings"][0]["modules"], json!(3));
    assert_eq!(
        (refused, &body["code"]),
        (StatusCode::UNPROCESSABLE_ENTITY, &json!("layout.scene"))
    );
}
