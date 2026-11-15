//! Imported surroundings over the API (ADR 20): the admin loads them, the core's task fetches
//! and stores the document, and a viewer reads it by the digest the scene names.

use std::time::Duration;

use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use serde_json::{Value, json};

use super::viewers::login;
use super::{Core, HOME, from, get, problem, with_cookie};

pub(super) fn load(body: &Value) -> Request<Body> {
    let request = Request::post("/api/v1/surroundings")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap();
    from(HOME, request)
}

fn located() -> Request<Body> {
    let request = Request::put("/api/v1/location")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "latitude": 47.07, "longitude": 15.44 }).to_string(),
        ))
        .unwrap();
    from(HOME, request)
}

/// The status once the fetch task has finished.
pub(super) async fn settled(core: &Core, admin: &str) -> Value {
    for _ in 0..500 {
        let (_, status) = core.ask(admin, get("/api/v1/surroundings")).await;
        if status["state"] != "fetching" {
            return status;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("the fetch never ended");
}

#[tokio::test]
async fn the_admin_loads_surroundings_and_a_viewer_reads_the_document() {
    let dir = tempfile::tempdir().unwrap();
    let (core, admin) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    core.viewer(&admin, "grandma", "sunny days").await;
    let viewer = core.sign_in(login("grandma", "sunny days")).await;
    core.ask(&admin, located()).await;

    let (idle, before) = core.ask(&admin, get("/api/v1/surroundings")).await;
    // The plant's location is kept to 0.01°, 440 m from the square the recording is of.
    let exact = json!({ "radius": 100, "latitude": 47.0739, "longitude": 15.4413 });
    let (accepted, started) = core.ask(&admin, load(&exact)).await;
    let status = settled(&core, &admin).await;
    let id = status["document"].as_str().unwrap();
    let read = core
        .send(with_cookie(
            &viewer,
            get(&format!("/api/v1/surroundings/{id}")),
        ))
        .await;

    assert_eq!(
        (idle, &before),
        (StatusCode::OK, &json!({ "state": "idle" }))
    );
    assert_eq!(
        (accepted, &started),
        (StatusCode::ACCEPTED, &json!({ "state": "fetching" }))
    );
    assert_eq!(status, json!({ "state": "ready", "document": id }));
    assert_eq!(id.len(), 64);
    assert_eq!(read.status(), StatusCode::OK);
    assert_eq!(read.headers()[header::CONTENT_TYPE], "application/json");
    let document = super::json(read).await;
    assert_eq!(document["radius"], 100.0);
    assert_eq!(document["buildings"].as_array().unwrap().len(), 31);
    assert_eq!(document["credits"][0], "© OpenStreetMap contributors");
    assert!(
        dir.path()
            .join("surroundings")
            .join(format!("{id}.json"))
            .exists()
    );
}

#[tokio::test]
async fn only_the_admin_loads_surroundings_or_sees_how_a_load_went() {
    let dir = tempfile::tempdir().unwrap();
    let (core, admin) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    core.viewer(&admin, "grandma", "sunny days").await;
    let viewer = core.sign_in(login("grandma", "sunny days")).await;

    let loading = core
        .send(with_cookie(&viewer, load(&json!({ "radius": 100 }))))
        .await;
    let status = core
        .send(with_cookie(&viewer, get("/api/v1/surroundings")))
        .await;

    let forbidden = (StatusCode::FORBIDDEN, "auth.forbidden".to_owned());
    assert_eq!(problem(loading).await, forbidden);
    assert_eq!(problem(status).await, forbidden);
}

#[tokio::test]
async fn a_load_is_refused_without_a_location_for_another_radius_or_a_body_it_cannot_read() {
    let dir = tempfile::tempdir().unwrap();
    let (core, admin) = Core::signed_in(&dir.path().join("core.sqlite")).await;

    let nowhere = core.ask(&admin, load(&json!({ "radius": 200 }))).await;
    let exact = json!({ "radius": 200, "latitude": 47.0739, "longitude": 15.4413 });
    let (given, _) = core.ask(&admin, load(&exact)).await;
    settled(&core, &admin).await;
    let radius = core.ask(&admin, load(&json!({ "radius": 250 }))).await;
    let unread = core.ask(&admin, load(&json!({ "radius": "wide" }))).await;

    let refusal = |(status, body): (StatusCode, Value)| (status, body["code"].clone());
    assert_eq!(
        refusal(nowhere),
        (
            StatusCode::UNPROCESSABLE_ENTITY,
            json!("surroundings.location")
        )
    );
    assert_eq!(given, StatusCode::ACCEPTED);
    assert_eq!(
        refusal(radius),
        (
            StatusCode::UNPROCESSABLE_ENTITY,
            json!("surroundings.radius")
        )
    );
    assert_eq!(
        refusal(unread),
        (StatusCode::BAD_REQUEST, json!("request.body"))
    );
}

#[tokio::test]
async fn a_document_no_one_fetched_is_not_found() {
    let dir = tempfile::tempdir().unwrap();
    let (core, admin) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    std::fs::write(dir.path().join("core.json"), "{}").unwrap();

    let unknown = core
        .send(with_cookie(
            &admin,
            get(&format!("/api/v1/surroundings/{}", "0".repeat(64))),
        ))
        .await;
    let outside = core
        .send(with_cookie(&admin, get("/api/v1/surroundings/..%2Fcore")))
        .await;

    let none = (StatusCode::NOT_FOUND, "surroundings.none".to_owned());
    assert_eq!(problem(unknown).await, none);
    assert_eq!(problem(outside).await, none);
}
