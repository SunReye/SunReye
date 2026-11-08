//! The EVCC settings: admin-only, a flat record that round-trips, a blank or over-long topic root refused.

use super::*;

const PATH: &str = "/api/settings/evcc";

#[tokio::test]
async fn a_fresh_core_reads_the_ingest_off_on_the_evcc_root() {
    let (core, admin) = open(&dir("evcc-fresh")).await;
    let read = get(&admin, PATH).await;
    assert_eq!(read.status, StatusCode::OK);
    assert_eq!(
        read.json(),
        json!({"enabled": false, "connectionId": null, "topicRoot": "evcc", "subtractFromHome": false})
    );
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn a_saved_record_reads_back_and_survives_a_restart() {
    let path = dir("evcc-save");
    let (core, admin) = open(&path).await;
    let record =
        json!({"enabled": true, "connectionId": 4, "topicRoot": "home/evcc", "subtractFromHome": true});
    let saved = put(&admin, PATH, &record).await;
    assert_eq!((saved.status, saved.json()), (StatusCode::OK, record.clone()));
    assert_eq!(get(&admin, PATH).await.json(), record);
    drop(admin);
    core.stop().await;
    let (core, admin) = open(&path).await;
    assert_eq!(get(&admin, PATH).await.json(), record);
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn a_body_naming_fewer_fields_takes_the_defaults_for_the_rest() {
    let (core, admin) = open(&dir("evcc-partial")).await;
    let saved = put(&admin, PATH, &json!({"enabled": true, "connectionId": 2})).await;
    assert_eq!(
        saved.json(),
        json!({"enabled": true, "connectionId": 2, "topicRoot": "evcc", "subtractFromHome": false})
    );
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn a_refused_record_is_a_400_and_the_saved_one_stays() {
    let (core, admin) = open(&dir("evcc-refused")).await;
    let kept =
        put(&admin, PATH, &json!({"enabled": true, "connectionId": 1, "topicRoot": "ev"})).await.json();
    for body in [
        json!({"topicRoot": ""}),
        json!({"topicRoot": "   "}),
        json!({"topicRoot": "x".repeat(121)}),
        json!({"connectionId": 0}),
        json!({"connectionId": -3}),
        json!({"connectionId": "a"}),
        json!({"enabled": "yes"}),
    ] {
        let answer = put(&admin, PATH, &body).await;
        assert_eq!(answer.status, StatusCode::BAD_REQUEST, "{body}");
        assert!(answer.json()["error"].as_str().is_some_and(|e| !e.is_empty()), "{body}");
        assert_eq!(get(&admin, PATH).await.json(), kept, "{body}");
    }
    let longest = put(&admin, PATH, &json!({"topicRoot": "x".repeat(120)})).await;
    assert_eq!(longest.status, StatusCode::OK);
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn a_plain_user_and_a_kiosk_stranger_can_neither_read_nor_save() {
    let (core, admin) = open(&dir("evcc-access")).await;
    let user = reads::plain_user(&admin).await;
    assert_eq!(put(&admin, "/api/settings/kiosk", &json!({"enabled": true})).await.status, StatusCode::OK);
    let stranger = admin.anonymous();
    let body = json!({"enabled": true, "connectionId": 1});
    for (api, status) in [(&user, StatusCode::FORBIDDEN), (&stranger, StatusCode::UNAUTHORIZED)] {
        assert_eq!(get(api, PATH).await.status, status);
        assert_eq!(put(api, PATH, &body).await.status, status);
    }
    assert_eq!(get(&admin, PATH).await.json()["enabled"], false, "a refused save changes nothing");
    drop((admin, user, stranger));
    core.stop().await;
}

const STATE: &str = "/api/evcc";

#[tokio::test]
async fn the_evcc_state_reads_null_while_the_ingest_is_off_and_follows_the_kiosk_view() {
    let (core, admin) = open(&dir("evcc-state-off")).await;
    let user = reads::plain_user(&admin).await;
    let stranger = admin.anonymous();
    for api in [&admin, &user] {
        let answer = get(api, STATE).await;
        assert_eq!((answer.status, answer.json()), (StatusCode::OK, Value::Null));
    }
    assert_eq!(get(&stranger, STATE).await.status, StatusCode::UNAUTHORIZED);
    put(&admin, "/api/settings/kiosk", &json!({"enabled": true})).await;
    assert_eq!(get(&stranger, STATE).await.status, StatusCode::OK);
    drop((admin, user, stranger));
    core.stop().await;
}
