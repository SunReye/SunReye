//! The plant time zone setting: admin-written, validated against the bundled database, kept as saved.

use super::reads::plain_user;
use super::*;

const PATH: &str = "/api/settings/time-zone";

async fn zone(api: &Api) -> Value {
    let answer = get(api, PATH).await;
    assert_eq!(answer.status, StatusCode::OK);
    answer.json()
}

#[tokio::test]
async fn a_fresh_core_reads_a_zone_the_database_holds() {
    let (core, admin) = open(&dir("zone-fresh")).await;
    let read = zone(&admin).await;
    let name = read["timeZone"].as_str().expect("timeZone");
    assert!(crate::plant_zone::lookup(name).is_some(), "{name}");
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn a_saved_zone_answers_in_its_canonical_spelling_and_survives_a_restart() {
    let path = dir("zone-save");
    let (core, admin) = open(&path).await;
    for (sent, kept) in [("europe/berlin", "Europe/Berlin"), ("Asia/Kathmandu", "Asia/Kathmandu")] {
        let saved = put(&admin, PATH, &json!({"timeZone": sent})).await;
        assert_eq!((saved.status, saved.json()), (StatusCode::OK, json!({"timeZone": kept})), "{sent}");
        assert_eq!(zone(&admin).await, json!({"timeZone": kept}), "{sent}");
    }
    drop(admin);
    core.stop().await;
    let (core, admin) = open(&path).await;
    assert_eq!(zone(&admin).await, json!({"timeZone": "Asia/Kathmandu"}));
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn an_unknown_zone_or_a_malformed_body_is_a_400_and_the_saved_zone_stays() {
    let (core, admin) = open(&dir("zone-refused")).await;
    put(&admin, PATH, &json!({"timeZone": "Asia/Kolkata"})).await;
    let kept = json!({"timeZone": "Asia/Kolkata"});
    let named = |value: &str| json!({ "timeZone": value });
    for body in
        [named("Mars/Olympus"), named(""), named("  "), named("UTC+2"), json!({}), json!({"timeZone": 5})]
    {
        let answer = put(&admin, PATH, &body).await;
        assert_eq!(answer.status, StatusCode::BAD_REQUEST, "{body}");
        assert!(answer.json()["error"].as_str().is_some_and(|e| !e.is_empty()), "{body}");
        assert_eq!(zone(&admin).await, kept, "{body}");
    }
    let unparsed = send(&admin, Method::PUT, PATH, Some("not json")).await;
    assert_eq!(unparsed.status, StatusCode::BAD_REQUEST);
    let empty = send(&admin, Method::PUT, PATH, None).await;
    assert_eq!(empty.status, StatusCode::BAD_REQUEST);
    assert_eq!(zone(&admin).await, kept);
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn only_an_admin_reads_or_writes_the_zone() {
    let (core, admin) = open(&dir("zone-gate")).await;
    put(&admin, PATH, &json!({"timeZone": "Asia/Kolkata"})).await;
    let user = plain_user(&admin).await;
    let body = json!({"timeZone": "Europe/Berlin"});
    for (api, read, write) in [(admin.anonymous(), 401, 401), (user, 403, 403)] {
        assert_eq!(get(&api, PATH).await.status.as_u16(), read);
        assert_eq!(put(&api, PATH, &body).await.status.as_u16(), write);
    }
    assert_eq!(zone(&admin).await, json!({"timeZone": "Asia/Kolkata"}));
    drop(admin);
    core.stop().await;
}
