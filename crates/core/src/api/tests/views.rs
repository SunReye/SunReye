//! Explore's saved views (ADR 22, ADR 9): the admin keeps up to 20 named route queries for the
//! whole plant, in the order saved; viewers read them.

use axum::http::StatusCode;
use serde_json::{Value, json};

use super::devices::{delete, send};
use super::viewers::login;
use super::{Core, get, post, problem, with_cookie};
use crate::backup::restore;
use crate::startup::STORE;

const TODAY: &str = "d=4294967294&s=pv.power,load.power&r=day";

impl Core {
    /// The admin saves view `name` of `query`; returns it.
    async fn save_view(&self, set_cookie: &str, name: &str, query: &str) -> Value {
        let view = json!({ "name": name, "query": query });
        let (status, body) = self
            .ask(set_cookie, send("POST", "/api/v1/views", &view))
            .await;
        assert_eq!(status, StatusCode::CREATED, "{body}");
        body
    }
}

#[tokio::test]
async fn saved_views_list_in_the_order_saved_with_their_query_as_given() {
    let dir = tempfile::tempdir().unwrap();
    let (core, admin) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let today = core.save_view(&admin, "Heute", TODAY).await;
    let odd = core
        .save_view(&admin, "Alles", "x=%E2%9C%93&&unknown")
        .await;

    let (status, body) = core.ask(&admin, get("/api/v1/views")).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body,
        json!({ "views": [
            { "id": today["id"], "name": "Heute", "query": TODAY },
            { "id": odd["id"], "name": "Alles", "query": "x=%E2%9C%93&&unknown" },
        ] })
    );
}

#[tokio::test]
async fn a_viewer_reads_the_saved_views_and_changes_none() {
    let dir = tempfile::tempdir().unwrap();
    let (core, admin) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let view = core.save_view(&admin, "Heute", TODAY).await;
    core.viewer(&admin, "grandma", "sunny days").await;
    let viewer = core.sign_in(login("grandma", "sunny days")).await;
    let uri = format!("/api/v1/views/{}", view["id"]);
    let draft = json!({ "name": "Mine", "query": "" });

    let (status, body) = core.ask(&viewer, get("/api/v1/views")).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["views"][0]["name"], "Heute");
    for request in [
        send("POST", "/api/v1/views", &draft),
        send("PUT", &uri, &draft),
        delete(&uri),
    ] {
        assert_eq!(
            problem(core.send(with_cookie(&viewer, request)).await).await,
            (StatusCode::FORBIDDEN, "auth.forbidden".to_owned())
        );
    }
}

#[tokio::test]
async fn a_query_of_2_kb_is_kept_and_a_longer_one_refused() {
    let dir = tempfile::tempdir().unwrap();
    let (core, admin) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    core.save_view(&admin, "Voll", &"a".repeat(2048)).await;
    let longer = json!({ "name": "Zu lang", "query": "a".repeat(2049) });

    let response = core
        .send(with_cookie(&admin, send("POST", "/api/v1/views", &longer)))
        .await;

    assert_eq!(
        problem(response).await,
        (StatusCode::UNPROCESSABLE_ENTITY, "views.value".to_owned())
    );
}

#[tokio::test]
async fn a_blank_name_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let (core, admin) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let blank = json!({ "name": " ", "query": TODAY });

    let response = core
        .send(with_cookie(&admin, send("POST", "/api/v1/views", &blank)))
        .await;

    assert_eq!(
        problem(response).await,
        (StatusCode::UNPROCESSABLE_ENTITY, "views.value".to_owned())
    );
}

#[tokio::test]
async fn a_taken_name_is_refused_even_when_the_views_are_full() {
    let dir = tempfile::tempdir().unwrap();
    let (core, admin) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    for n in 1..=20 {
        core.save_view(&admin, &format!("View {n}"), TODAY).await;
    }
    let refused = |name: &str| {
        let draft = json!({ "name": name, "query": TODAY });
        core.send(with_cookie(&admin, send("POST", "/api/v1/views", &draft)))
    };

    assert_eq!(
        problem(refused("View 3").await).await,
        (StatusCode::CONFLICT, "views.name".to_owned())
    );
    assert_eq!(
        problem(refused("View 21").await).await,
        (StatusCode::CONFLICT, "views.full".to_owned())
    );
}

#[tokio::test]
async fn a_view_is_replaced_in_place_and_its_name_stays_unique() {
    let dir = tempfile::tempdir().unwrap();
    let (core, admin) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let first = core.save_view(&admin, "Heute", TODAY).await;
    let second = core.save_view(&admin, "Woche", "r=week").await;
    let uri = format!("/api/v1/views/{}", first["id"]);
    let put = |name: &str, query: &str| {
        let draft = json!({ "name": name, "query": query });
        core.send(with_cookie(&admin, send("PUT", &uri, &draft)))
    };

    let taken = problem(put("Woche", TODAY).await).await;
    let (status, kept) = core
        .ask(
            &admin,
            send(
                "PUT",
                &uri,
                &json!({ "name": "Heute", "query": "r=day&m=fold" }),
            ),
        )
        .await;
    let (_, list) = core.ask(&admin, get("/api/v1/views")).await;

    assert_eq!(taken, (StatusCode::CONFLICT, "views.name".to_owned()));
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        kept,
        json!({ "id": first["id"], "name": "Heute", "query": "r=day&m=fold" })
    );
    assert_eq!(list["views"][0], kept);
    assert_eq!(list["views"][1]["id"], second["id"]);
}

#[tokio::test]
async fn an_unknown_view_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let (core, admin) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let draft = json!({ "name": "Heute", "query": TODAY });

    let put = core
        .send(with_cookie(&admin, send("PUT", "/api/v1/views/9", &draft)))
        .await;
    let removed = core
        .send(with_cookie(&admin, delete("/api/v1/views/9")))
        .await;

    assert_eq!(
        problem(put).await,
        (StatusCode::NOT_FOUND, "views.none".to_owned())
    );
    assert_eq!(
        problem(removed).await,
        (StatusCode::NOT_FOUND, "views.none".to_owned())
    );
}

#[tokio::test]
async fn a_removed_view_leaves_the_list_and_frees_a_place() {
    let dir = tempfile::tempdir().unwrap();
    let (core, admin) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let view = core.save_view(&admin, "Heute", TODAY).await;

    let response = core
        .send(with_cookie(
            &admin,
            delete(&format!("/api/v1/views/{}", view["id"])),
        ))
        .await;
    let (_, list) = core.ask(&admin, get("/api/v1/views")).await;

    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert_eq!(list, json!({ "views": [] }));
    core.save_view(&admin, "Heute", TODAY).await;
}

#[tokio::test]
async fn each_write_appends_the_view_after_it_to_the_change_log() {
    let dir = tempfile::tempdir().unwrap();
    let (core, admin) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let view = core.save_view(&admin, "Heute", TODAY).await;
    let uri = format!("/api/v1/views/{}", view["id"]);
    let renamed = json!({ "name": "Tag", "query": TODAY });
    core.ask(&admin, send("PUT", &uri, &renamed)).await;
    core.ask(&admin, delete(&uri)).await;

    let (_, log) = core.ask(&admin, get("/api/v1/changes")).await;

    let entries: Vec<_> = log["changes"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["subject"] == "view")
        .map(|e| (e["id"].clone(), e["action"].clone(), e["state"].clone()))
        .collect();
    let id = view["id"].clone();
    assert_eq!(
        entries,
        [
            (
                id.clone(),
                json!("add"),
                json!({ "id": id, "name": "Heute", "query": TODAY })
            ),
            (
                id.clone(),
                json!("change"),
                json!({ "id": id, "name": "Tag", "query": TODAY })
            ),
            (id, json!("remove"), Value::Null),
        ]
    );
}

#[tokio::test]
async fn a_backup_and_restore_keep_the_saved_views() {
    let dir = tempfile::tempdir().unwrap();
    let (core, admin) = Core::signed_in(&dir.path().join(STORE)).await;
    core.save_view(&admin, "Heute", TODAY).await;
    let (_, saved) = core.ask(&admin, get("/api/v1/views")).await;
    let backup = json!({ "name": "views.tar" });
    let (status, _) = core
        .ask(&admin, send("POST", "/api/v1/backups", &backup))
        .await;
    assert_eq!(status, StatusCode::CREATED);
    let restored = dir.path().join("restored");

    restore(&dir.path().join("share").join("views.tar"), &restored).unwrap();

    let core = Core::open(&restored.join(STORE)).await;
    let admin = core.sign_in(post("/api/v1/login", "correct horse")).await;
    let (_, views) = core.ask(&admin, get("/api/v1/views")).await;
    assert_eq!(views, saved);
}
