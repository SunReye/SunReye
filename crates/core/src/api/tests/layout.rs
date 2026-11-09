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
