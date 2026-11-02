use super::*;

const USER_EMAIL: &str = "user@example.org";
const USER_PASSWORD: &str = "another long password";

async fn create_user(admin: &Api, email: &str, is_admin: bool) -> Answer {
    let body = json!({"email": email, "name": "User", "password": USER_PASSWORD, "admin": is_admin});
    post(admin, "/api/admin/users", &body).await
}

/// A created account, signed in in its own browser.
async fn signed_in_user(admin: &Api, email: &str, is_admin: bool) -> (i64, Api) {
    let created = create_user(admin, email, is_admin).await;
    assert_eq!(created.status, StatusCode::OK, "{:?}", created.json());
    let id = created.json()["id"].as_i64().expect("id");
    let signed_in = login(&admin.anonymous(), email, USER_PASSWORD, false).await;
    assert_eq!(signed_in.status, StatusCode::OK);
    (id, admin.with_cookie(&signed_in.session_cookie()))
}

async fn admin_id(admin: &Api) -> i64 {
    get(admin, "/api/auth/session").await.json()["id"].as_i64().expect("id")
}

fn role(is_admin: bool) -> Value {
    json!({"admin": is_admin})
}

#[tokio::test]
async fn an_admin_creates_a_user_who_signs_in_and_is_listed() {
    let (core, admin) = open(&dir("users-create")).await;
    let created = create_user(&admin, USER_EMAIL, false).await;
    assert_eq!(created.status, StatusCode::OK);
    let account = created.json();
    assert_eq!(
        (&account["email"], &account["name"], &account["admin"]),
        (&json!(USER_EMAIL), &json!("User"), &json!(false))
    );
    assert_eq!(created.set_cookie, None, "the admin stays signed in as the admin");
    assert_eq!(get(&admin, "/api/auth/session").await.json()["email"], ADMIN_EMAIL);

    let signed_in = login(&admin.anonymous(), USER_EMAIL, USER_PASSWORD, false).await;
    assert_eq!(signed_in.json(), account);
    let stored = core.store.account_by_email(USER_EMAIL).await.expect("store").expect("account");
    assert!(stored.password_hash.starts_with("$2b$12$"), "bcrypt, never the password");

    let listed = get(&admin, "/api/admin/users").await;
    assert_eq!(listed.status, StatusCode::OK);
    let emails: Vec<_> =
        listed.json().as_array().expect("array").iter().map(|a| a["email"].clone()).collect();
    assert_eq!(emails, [json!(ADMIN_EMAIL), json!(USER_EMAIL)]);
    assert!(
        listed.json()[0].get("passwordHash").is_none() && listed.json()[0].get("password_hash").is_none()
    );
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn an_invalid_or_taken_account_is_refused_and_nothing_is_created() {
    let (core, admin) = open(&dir("users-invalid")).await;
    let cases = [
        (json!({"email": "no-at-sign", "name": "U", "password": USER_PASSWORD, "admin": false}), 400),
        (json!({"email": USER_EMAIL, "name": " ", "password": USER_PASSWORD, "admin": false}), 400),
        (json!({"email": USER_EMAIL, "name": "U", "password": "x".repeat(7), "admin": false}), 400),
        (json!({"email": USER_EMAIL, "name": "U", "password": "x".repeat(73), "admin": false}), 400),
        (json!({"email": USER_EMAIL}), 400),
        (json!({"email": "ADMIN@example.org", "name": "U", "password": USER_PASSWORD, "admin": false}), 409),
    ];
    for (body, want) in cases {
        let answer = post(&admin, "/api/admin/users", &body).await;
        assert_eq!(answer.status.as_u16(), want, "{body}");
        assert!(answer.json()["error"].as_str().is_some_and(|e| !e.is_empty()), "{body}");
    }
    assert_eq!(get(&admin, "/api/admin/users").await.json().as_array().expect("array").len(), 1);
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn a_promoted_user_reaches_admin_routes_and_a_demoted_one_is_refused_at_once() {
    let (core, admin) = open(&dir("users-role")).await;
    let (id, user) = signed_in_user(&admin, USER_EMAIL, false).await;
    assert_eq!(get(&user, "/api/profiles").await.status, StatusCode::FORBIDDEN);

    let promoted = put(&admin, &format!("/api/admin/users/{id}/role"), &role(true)).await;
    assert_eq!(promoted.status, StatusCode::OK);
    assert_eq!(promoted.json()["admin"], true);
    assert_eq!(get(&user, "/api/profiles").await.status, StatusCode::OK, "the same session");

    let demoted = put(&admin, &format!("/api/admin/users/{id}/role"), &role(false)).await;
    assert_eq!(demoted.json()["admin"], false);
    assert_eq!(get(&user, "/api/profiles").await.status, StatusCode::FORBIDDEN, "the same session");
    assert_eq!(get(&user, "/api/auth/session").await.status, StatusCode::OK, "still signed in");
    drop((user, admin));
    core.stop().await;
}

#[tokio::test]
async fn a_removed_user_cannot_sign_in_and_their_session_ends() {
    let (core, admin) = open(&dir("users-remove")).await;
    let (id, user) = signed_in_user(&admin, USER_EMAIL, false).await;
    assert_eq!(delete(&admin, &format!("/api/admin/users/{id}")).await.status, StatusCode::NO_CONTENT);

    assert_eq!(get(&user, "/api/auth/session").await.status, StatusCode::UNAUTHORIZED);
    let again = login(&admin.anonymous(), USER_EMAIL, USER_PASSWORD, false).await;
    assert_eq!(again.status, StatusCode::UNAUTHORIZED);
    let listed = get(&admin, "/api/admin/users").await.json();
    assert_eq!(listed.as_array().expect("array").len(), 1);
    drop((user, admin));
    core.stop().await;
}

#[tokio::test]
async fn an_unknown_or_malformed_user_id_is_refused() {
    let (core, admin) = open(&dir("users-unknown")).await;
    assert_eq!(delete(&admin, "/api/admin/users/999").await.status, StatusCode::NOT_FOUND);
    assert_eq!(put(&admin, "/api/admin/users/999/role", &role(true)).await.status, StatusCode::NOT_FOUND);
    assert_eq!(delete(&admin, "/api/admin/users/abc").await.status, StatusCode::BAD_REQUEST);
    let malformed = put(&admin, "/api/admin/users/abc/role", &role(true)).await;
    assert_eq!(malformed.status, StatusCode::BAD_REQUEST);
    assert!(malformed.json()["error"].as_str().is_some(), "the API's error shape");
    let no_role = put(&admin, &format!("/api/admin/users/{}/role", admin_id(&admin).await), &json!({})).await;
    assert_eq!(no_role.status, StatusCode::BAD_REQUEST);
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn the_last_admin_can_be_neither_demoted_nor_removed() {
    let (core, admin) = open(&dir("users-last-admin")).await;
    let me = admin_id(&admin).await;
    let (_, _user) = signed_in_user(&admin, USER_EMAIL, false).await;

    let demoted = put(&admin, &format!("/api/admin/users/{me}/role"), &role(false)).await;
    assert_eq!(demoted.status, StatusCode::CONFLICT);
    assert_eq!(demoted.json(), json!({"error": "The last admin cannot be demoted or removed"}));
    let removed = delete(&admin, &format!("/api/admin/users/{me}")).await;
    assert_eq!(removed.status, StatusCode::CONFLICT);
    assert_eq!(get(&admin, "/api/profiles").await.status, StatusCode::OK, "still the admin");
    let kept = put(&admin, &format!("/api/admin/users/{me}/role"), &role(true)).await;
    assert_eq!(kept.status, StatusCode::OK, "an admin made admin again is no demotion");
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn with_a_second_admin_the_first_steps_down_and_the_second_removes_the_first() {
    let (core, admin) = open(&dir("users-two-admins")).await;
    let me = admin_id(&admin).await;
    let (other, second) = signed_in_user(&admin, "second@example.org", true).await;

    let stepped_down = put(&admin, &format!("/api/admin/users/{me}/role"), &role(false)).await;
    assert_eq!(stepped_down.status, StatusCode::OK);
    assert_eq!(get(&admin, "/api/admin/users").await.status, StatusCode::FORBIDDEN);
    let last = put(&second, &format!("/api/admin/users/{other}/role"), &role(false)).await;
    assert_eq!(last.status, StatusCode::CONFLICT, "the second is now the last admin");
    assert_eq!(delete(&second, &format!("/api/admin/users/{me}")).await.status, StatusCode::NO_CONTENT);
    assert_eq!(get(&admin, "/api/auth/session").await.status, StatusCode::UNAUTHORIZED);
    drop((admin, second));
    core.stop().await;
}

#[tokio::test]
async fn a_plain_user_and_a_stranger_are_refused_on_every_user_route() {
    let (core, admin) = open(&dir("users-refused")).await;
    let (id, user) = signed_in_user(&admin, USER_EMAIL, false).await;
    let body = json!({"email": "x@example.org", "name": "X", "password": USER_PASSWORD, "admin": true});
    let role_path = format!("/api/admin/users/{id}/role");
    let user_path = format!("/api/admin/users/{id}");
    for (caller, want, error) in [
        (&user, StatusCode::FORBIDDEN, "Admin only"),
        (&admin.anonymous(), StatusCode::UNAUTHORIZED, "Not signed in"),
    ] {
        let answers = [
            get(caller, "/api/admin/users").await,
            post(caller, "/api/admin/users", &body).await,
            put(caller, &role_path, &role(true)).await,
            delete(caller, &user_path).await,
        ];
        for answer in answers {
            assert_eq!((answer.status, answer.json()), (want, json!({"error": error})));
        }
    }
    let listed = get(&admin, "/api/admin/users").await.json();
    assert_eq!(listed.as_array().expect("array").len(), 2, "nothing created or removed");
    assert_eq!(listed[1]["admin"], false, "nobody promoted");
    drop((user, admin));
    core.stop().await;
}
