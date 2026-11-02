use super::*;

const KEYS: &str = "/api/admin/api-keys";
const REVOKE: &str = "/api/admin/api-keys/revoke";
const ENTITIES: &str = "/api/v1/entities";

/// How an integration calls `/api/v1`: no cookie, no Origin, the key in a header.
async fn integration(api: &Api, path: &str, header: Option<(&str, &str)>) -> Answer {
    let mut request = Request::builder().uri(path).header(header::HOST, HOST);
    if let Some((name, value)) = header {
        request = request.header(name, value);
    }
    answer(api.router.clone().oneshot(request.body(Body::empty()).expect("request")).await.expect("response"))
        .await
}

async fn bearer(api: &Api, key: &str) -> StatusCode {
    integration(api, ENTITIES, Some(("authorization", &format!("Bearer {key}")))).await.status
}

async fn user_id(admin: &Api) -> i64 {
    get(admin, "/api/auth/session").await.json()["id"].as_i64().expect("id")
}

async fn issue(admin: &Api, user: i64, name: &str) -> Value {
    let created = post(admin, KEYS, &json!({"userId": user, "name": name})).await;
    assert_eq!(created.status, StatusCode::OK, "{:?}", created.json());
    created.json()
}

fn secret(created: &Value) -> String {
    created["key"].as_str().expect("the key").to_owned()
}

async fn with_profile(name: &str) -> (Arc<Core>, Api, i64) {
    let (core, admin) = open(&dir(name)).await;
    assert_eq!(
        put(&admin, "/api/settings/active-profile", &json!({"id": PROFILE})).await.status,
        StatusCode::OK
    );
    let id = user_id(&admin).await;
    (core, admin, id)
}

fn sha256(key: &str) -> Vec<u8> {
    ring::digest::digest(&ring::digest::SHA256, key.as_bytes()).as_ref().to_vec()
}

#[tokio::test]
async fn a_created_key_starts_with_the_prefix_is_shown_once_and_lists_by_its_head() {
    let (core, admin, me) = with_profile("keys-create").await;
    let created = issue(&admin, me, "Home Assistant").await;
    let key = secret(&created);
    assert!(key.starts_with("sunreye_"), "{key}");
    assert!(key.len() >= "sunreye_".len() + 43, "at least 256 random bits: {key}");
    assert_eq!(
        (&created["name"], &created["userId"], &created["userEmail"]),
        (&json!("Home Assistant"), &json!(me), &json!(ADMIN_EMAIL))
    );
    let start = created["start"].as_str().expect("start");
    assert!(key.starts_with(start) && start.len() < key.len() / 2, "{start}");

    let listed = get(&admin, KEYS).await;
    assert_eq!(listed.status, StatusCode::OK);
    let mut shown = created.clone();
    shown.as_object_mut().expect("object").remove("key");
    assert_eq!(listed.json(), json!([shown]), "everything but the key");
    let other = secret(&issue(&admin, me, "Grafana").await);
    assert_ne!(other, key);
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn the_store_holds_the_keys_sha256_and_never_the_key() {
    let dir = dir("keys-hashed");
    let (core, admin) = open(&dir).await;
    let me = user_id(&admin).await;
    let key = secret(&issue(&admin, me, "Home Assistant").await);
    assert_eq!(core.store.api_key_account(&sha256(&key)).await.expect("find"), Some(me));
    drop(admin);
    core.stop().await;
    // The row may still sit in the write-ahead log.
    let mut file = std::fs::read(dir.join("sunreye.db")).expect("the store file");
    file.extend(std::fs::read(dir.join("sunreye.db-wal")).unwrap_or_default());
    let random = key.strip_prefix("sunreye_").expect("prefix");
    assert!(!file.windows(random.len()).any(|w| w == random.as_bytes()), "the key is in the store file");
    let digest = sha256(&key);
    assert!(file.windows(digest.len()).any(|w| w == digest.as_slice()), "its hash is");
}

#[tokio::test]
async fn a_key_authenticates_v1_in_either_header_and_a_revoked_one_is_refused() {
    let (core, admin, me) = with_profile("keys-v1").await;
    let created = issue(&admin, me, "Home Assistant").await;
    let key = secret(&created);
    let anonymous = admin.anonymous();

    let answered = integration(&anonymous, ENTITIES, Some(("authorization", &format!("Bearer {key}")))).await;
    assert_eq!(answered.status, StatusCode::OK);
    let catalog = answered.json();
    assert_eq!((&catalog["id"], &catalog["manufacturer"]), (&json!(PROFILE), &json!("Deye")));
    assert_eq!(catalog["entities"].as_array().expect("entities").len(), 141);
    assert_eq!(
        catalog["entities"][2],
        json!({"key": "radiator_temp", "label": "DC Temperature", "unit": "°C", "group": "inverter"})
    );
    let by_header = integration(&anonymous, ENTITIES, Some(("x-api-key", &key))).await;
    assert_eq!(by_header.status, StatusCode::OK);

    let revoked = post(&admin, REVOKE, &json!({"id": created["id"]})).await;
    assert_eq!(revoked.status, StatusCode::NO_CONTENT);
    let refused = integration(&anonymous, ENTITIES, Some(("authorization", &format!("Bearer {key}")))).await;
    assert_eq!(
        (refused.status, refused.json()),
        (StatusCode::UNAUTHORIZED, json!({"error": "Invalid or missing API key"}))
    );
    assert_eq!(
        integration(&anonymous, ENTITIES, Some(("x-api-key", &key))).await.status,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(get(&admin, KEYS).await.json(), json!([]));
    assert_eq!(post(&admin, REVOKE, &json!({"id": created["id"]})).await.status, StatusCode::NOT_FOUND);
    drop((anonymous, admin));
    core.stop().await;
}

#[tokio::test]
async fn a_missing_malformed_or_unknown_key_is_refused() {
    let (core, admin, me) = with_profile("keys-malformed").await;
    let key = secret(&issue(&admin, me, "Home Assistant").await);
    let anonymous = admin.anonymous();
    assert_eq!(integration(&anonymous, ENTITIES, None).await.status, StatusCode::UNAUTHORIZED);
    let mut altered = key.clone();
    altered.replace_range(altered.len() - 1.., if key.ends_with('A') { "B" } else { "A" });
    let truncated = &key[..key.len() - 1];
    let lowercase_scheme = format!("bearer {key}");
    let cases = [
        ("authorization", "Bearer "),
        ("authorization", "Bearer sunreye_"),
        ("authorization", "Basic c3VucmV5ZTpwdw=="),
        ("authorization", key.as_str()),
        ("x-api-key", ""),
        ("x-api-key", "not a key"),
        ("x-api-key", altered.as_str()),
        ("x-api-key", truncated),
        ("x-api-key", &key[..12]),
    ];
    for (name, value) in cases {
        let answer = integration(&anonymous, ENTITIES, Some((name, value))).await;
        assert_eq!(answer.status, StatusCode::UNAUTHORIZED, "{name}: {value}");
    }
    assert_eq!(bearer(&anonymous, &key).await, StatusCode::OK);
    let lower = integration(&anonymous, ENTITIES, Some(("authorization", &lowercase_scheme))).await;
    assert_eq!(lower.status, StatusCode::OK, "the scheme is case-insensitive");
    drop((anonymous, admin));
    core.stop().await;
}

#[tokio::test]
async fn a_session_does_not_open_v1_and_a_key_opens_nothing_else() {
    let (core, admin, me) = with_profile("keys-scope").await;
    let key = secret(&issue(&admin, me, "Home Assistant").await);
    assert_eq!(get(&admin, ENTITIES).await.status, StatusCode::UNAUTHORIZED, "the admin's session");
    let anonymous = admin.anonymous();
    for path in ["/api/profiles", "/api/auth/session", KEYS, "/api/admin/users"] {
        let answer = integration(&anonymous, path, Some(("authorization", &format!("Bearer {key}")))).await;
        assert_eq!(answer.status, StatusCode::UNAUTHORIZED, "{path}");
    }
    drop((anonymous, admin));
    core.stop().await;
}

#[tokio::test]
async fn a_plain_users_key_authenticates_until_the_user_is_removed() {
    let (core, admin, _) = with_profile("keys-owner").await;
    let body =
        json!({"email": "user@example.org", "name": "User", "password": ADMIN_PASSWORD, "admin": false});
    let user = post(&admin, "/api/admin/users", &body).await.json()["id"].as_i64().expect("id");
    let key = secret(&issue(&admin, user, "Node-RED").await);
    let anonymous = admin.anonymous();
    assert_eq!(bearer(&anonymous, &key).await, StatusCode::OK);
    assert_eq!(get(&admin, KEYS).await.json().as_array().expect("keys").len(), 1);
    assert_eq!(delete(&admin, &format!("/api/admin/users/{user}")).await.status, StatusCode::NO_CONTENT);
    assert_eq!(bearer(&anonymous, &key).await, StatusCode::UNAUTHORIZED);
    assert_eq!(get(&admin, KEYS).await.json(), json!([]));
    drop((anonymous, admin));
    core.stop().await;
}

#[tokio::test]
async fn an_invalid_request_creates_nothing() {
    let (core, admin, me) = with_profile("keys-invalid").await;
    let cases = [
        (json!({"userId": 999, "name": "k"}), StatusCode::NOT_FOUND),
        (json!({"userId": me, "name": " "}), StatusCode::BAD_REQUEST),
        (json!({"userId": me}), StatusCode::BAD_REQUEST),
    ];
    for (body, want) in cases {
        let answer = post(&admin, KEYS, &body).await;
        assert_eq!(answer.status, want, "{body}");
        assert!(answer.json()["error"].as_str().is_some(), "{body}");
    }
    assert_eq!(get(&admin, KEYS).await.json(), json!([]));
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn without_an_active_profile_v1_answers_404_to_a_valid_key() {
    let (core, admin) = open(&dir("keys-no-profile")).await;
    let key = secret(&issue(&admin, user_id(&admin).await, "Home Assistant").await);
    let answer = integration(&admin.anonymous(), ENTITIES, Some(("x-api-key", &key))).await;
    assert_eq!(
        (answer.status, answer.json()),
        (StatusCode::NOT_FOUND, json!({"error": "No active profile"}))
    );
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn a_plain_user_and_a_stranger_are_refused_on_every_key_route() {
    let (core, admin, me) = with_profile("keys-refused").await;
    let created = issue(&admin, me, "Home Assistant").await;
    let body =
        json!({"email": "user@example.org", "name": "User", "password": ADMIN_PASSWORD, "admin": false});
    post(&admin, "/api/admin/users", &body).await;
    let signed_in = login(&admin.anonymous(), "user@example.org", ADMIN_PASSWORD, false).await;
    let user = admin.with_cookie(&signed_in.session_cookie());
    for (caller, want, error) in [
        (&user, StatusCode::FORBIDDEN, "Admin only"),
        (&admin.anonymous(), StatusCode::UNAUTHORIZED, "Not signed in"),
    ] {
        let answers = [
            get(caller, KEYS).await,
            post(caller, KEYS, &json!({"userId": me, "name": "stolen"})).await,
            post(caller, REVOKE, &json!({"id": created["id"]})).await,
        ];
        for answer in answers {
            assert_eq!((answer.status, answer.json()), (want, json!({"error": error})));
        }
    }
    assert_eq!(
        get(&admin, KEYS).await.json().as_array().expect("keys").len(),
        1,
        "nothing issued or revoked"
    );
    assert_eq!(bearer(&admin.anonymous(), &secret(&created)).await, StatusCode::OK);
    drop((user, admin));
    core.stop().await;
}
