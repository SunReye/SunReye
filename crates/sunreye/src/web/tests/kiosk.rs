use super::*;

/// What the dashboard reads, each as a request that answers 200 to a session.
const DASHBOARD_READS: [&str; 4] = [
    "/api/capabilities",
    "/api/profile",
    "/api/history/recent",
    "/api/history/rollup?metric=pv_power&bucket=minute",
];

/// The listed operations a stranger may reach with the kiosk view on, beside the sign-in routes.
const OPEN_WITH_KIOSK: [(&str, &str); 7] = [
    ("get", "/api/capabilities"),
    ("get", "/api/history/recent"),
    ("get", "/api/history/rollup"),
    ("get", "/api/kiosk"),
    ("get", "/api/profile"),
    ("get", "/api/profile-status"),
    ("get", "/api/setup-status"),
];

const SIGN_IN: [(&str, &str); 2] = [("post", "/api/auth/login"), ("post", "/api/auth/sign-up")];

async fn switch(api: &Api, on: bool) -> Answer {
    put(api, "/api/settings/kiosk", &json!({"enabled": on})).await
}

async fn kiosk_on(api: &Api) -> bool {
    let answer = get(&api.anonymous(), "/api/kiosk").await;
    assert_eq!(answer.status, StatusCode::OK);
    answer.json()["enabled"].as_bool().expect("enabled")
}

async fn plain_user(core: &Core, admin: &Api) -> Api {
    let account = NewAccount {
        email: "viewer@example.org".into(),
        name: "Viewer".into(),
        password_hash: password::Passwords::new().hash(ADMIN_PASSWORD.into()).await.expect("hash"),
    };
    core.store.add_account(&account, false).await.expect("plain account");
    let signed_in = login(&admin.anonymous(), "viewer@example.org", ADMIN_PASSWORD, false).await;
    admin.with_cookie(&signed_in.session_cookie())
}

#[tokio::test]
async fn the_kiosk_view_is_off_on_a_fresh_core() {
    let (core, admin) = open(&dir("kiosk-fresh")).await;
    assert!(!kiosk_on(&admin).await);
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn only_an_admin_switches_the_kiosk_view() {
    let (core, admin) = open(&dir("kiosk-switch")).await;
    let user = plain_user(&core, &admin).await;
    let refused = [(admin.anonymous(), StatusCode::UNAUTHORIZED), (user, StatusCode::FORBIDDEN)];
    for (api, status) in &refused {
        assert_eq!(switch(api, true).await.status, *status);
        assert!(!kiosk_on(&admin).await, "a refused switch changes nothing");
    }
    let on = switch(&admin, true).await;
    assert_eq!((on.status, on.json()), (StatusCode::OK, json!({"enabled": true})));
    assert!(kiosk_on(&admin).await);
    for (api, status) in &refused {
        assert_eq!(switch(api, false).await.status, *status);
        assert!(kiosk_on(&admin).await, "a refused switch changes nothing");
    }
    assert_eq!(switch(&admin, false).await.json(), json!({"enabled": false}));
    assert!(!kiosk_on(&admin).await);
    assert_eq!(
        put(&admin, "/api/settings/kiosk", &json!({"enabled": "yes"})).await.status,
        StatusCode::BAD_REQUEST
    );
    drop((refused, admin));
    core.stop().await;
}

#[tokio::test]
async fn the_kiosk_view_lets_a_stranger_read_the_dashboard_as_a_session_does() {
    let (core, admin) = open(&dir("kiosk-reads")).await;
    put(&admin, "/api/settings/active-profile", &json!({"id": PROFILE})).await;
    let stranger = admin.anonymous();
    for path in DASHBOARD_READS {
        assert_eq!(get(&stranger, path).await.status, StatusCode::UNAUTHORIZED, "kiosk off: {path}");
    }
    switch(&admin, true).await;
    for path in DASHBOARD_READS {
        let (open, session) = (get(&stranger, path).await, get(&admin, path).await);
        assert_eq!(session.status, StatusCode::OK, "{path}");
        assert_eq!((open.status, open.json()), (session.status, session.json()), "{path}");
        assert_eq!(open.set_cookie, None, "{path}: no session for a stranger");
    }
    switch(&admin, false).await;
    for path in DASHBOARD_READS {
        assert_eq!(get(&stranger, path).await.status, StatusCode::UNAUTHORIZED, "off again: {path}");
    }
    drop((stranger, admin));
    core.stop().await;
}

/// `/api/v1` asks for an API key, every other route for a session.
fn refusal(path: &str) -> &'static str {
    if path.starts_with("/api/v1/") { "Invalid or missing API key" } else { "Not signed in" }
}

#[tokio::test]
async fn with_the_kiosk_view_on_a_stranger_reaches_only_the_allow_list() {
    let (core, admin) = open(&dir("kiosk-listing")).await;
    switch(&admin, true).await;
    let document = get(&admin, "/openapi/json").await.json();
    let stranger = admin.anonymous();
    let mut open = Vec::new();
    for (method, path) in operations(&document) {
        if SIGN_IN.contains(&(method.as_str(), path.as_str())) {
            continue;
        }
        let route = (method.to_uppercase(), path.replace("{id}", "1"));
        let answer = call_for_answer(&stranger, (&route.0, &route.1)).await;
        if answer.status == StatusCode::UNAUTHORIZED {
            assert_eq!(answer.json(), json!({"error": refusal(&path)}), "{route:?}");
        } else {
            open.push((method, path));
        }
    }
    let want: Vec<(String, String)> =
        OPEN_WITH_KIOSK.iter().map(|(m, p)| ((*m).into(), (*p).into())).collect();
    assert_eq!(open, want);
    assert!(kiosk_on(&admin).await, "no refused write switched it off");
    drop((stranger, admin));
    core.stop().await;
}
