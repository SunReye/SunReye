//! The MQTT settings: admin-only, validated, and the password never read back.

use super::*;

const PATH: &str = "/api/settings/mqtt";
const SECRET: &str = "s3cret-broker-pw";

#[tokio::test]
async fn a_fresh_core_reads_the_export_off_with_the_3x_prefixes() {
    let (core, admin) = open(&dir("mqtt-fresh")).await;
    let read = get(&admin, PATH).await;
    assert_eq!(read.status, StatusCode::OK);
    assert_eq!(
        read.json(),
        json!({
            "enabled": false, "brokerUrl": "", "username": null, "passwordSet": false, "clientId": null,
            "topicPrefix": "sunreye", "haDiscoveryEnabled": false, "haDiscoveryPrefix": "homeassistant",
            "plantSlug": "plant"
        })
    );
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn the_password_is_stored_and_no_read_route_returns_it() {
    let (core, admin) = open(&dir("mqtt-secret")).await;
    let body = json!({"brokerUrl": "mqtts://broker.lan", "username": "mqtt", "password": SECRET, "plantSlug": "haus-sud"});
    let saved = put(&admin, PATH, &body).await;
    assert_eq!(saved.status, StatusCode::OK);
    assert_eq!(saved.json()["passwordSet"], true);
    assert_eq!(saved.json()["plantSlug"], "haus-sud");
    let stored = core.store.setting("mqtt").await.expect("setting").expect("stored");
    assert!(stored.contains(SECRET), "the store keeps it for the broker");

    let table = parse_access(include_str!("../../../route-access.txt"));
    let reads: Vec<&Route> = table.iter().filter(|r| r.method == "get").collect();
    assert!(reads.iter().any(|r| r.path == PATH));
    assert!(!String::from_utf8_lossy(&saved.body).contains(SECRET), "the save's answer");
    for route in reads {
        let (_, path) = route.request();
        let answer = get(&admin, &path).await;
        assert!(!String::from_utf8_lossy(&answer.body).contains(SECRET), "{path} returned the password");
    }
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn a_refused_record_is_a_400_and_the_saved_one_stays() {
    let (core, admin) = open(&dir("mqtt-refused")).await;
    let good = json!({"brokerUrl": "mqtt://10.0.0.2:1884", "plantSlug": "haus-sud"});
    let kept = put(&admin, PATH, &good).await.json();
    for body in [
        json!({"brokerUrl": "http://h"}),
        json!({"enabled": true, "brokerUrl": ""}),
        json!({"topicPrefix": "a/#"}),
        json!({"plantSlug": ""}),
        json!({"password": "pw", "username": null}),
        json!({"enabled": "yes"}),
    ] {
        let answer = put(&admin, PATH, &body).await;
        assert_eq!(answer.status, StatusCode::BAD_REQUEST, "{body}");
        assert_eq!(get(&admin, PATH).await.json(), kept, "{body}");
    }
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn a_plain_user_can_neither_read_nor_save_the_settings() {
    let (core, admin) = open(&dir("mqtt-user")).await;
    let user = reads::plain_user(&admin).await;
    assert_eq!(get(&user, PATH).await.status, StatusCode::FORBIDDEN);
    assert_eq!(put(&user, PATH, &json!({"enabled": false})).await.status, StatusCode::FORBIDDEN);
    drop((admin, user));
    core.stop().await;
}
