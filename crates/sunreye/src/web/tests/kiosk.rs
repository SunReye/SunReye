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

fn rollup(query: &str) -> String {
    format!("/api/history/rollup?metric=pv_power&{query}")
}

#[tokio::test]
async fn a_stranger_gets_at_most_12000_buckets_per_read_on_every_tier_and_a_session_keeps_50000() {
    let (core, admin) = open(&dir("kiosk-rollup-cap")).await;
    switch(&admin, true).await;
    let stranger = admin.anonymous();
    for bucket in ["minute", "hour", "day"] {
        for served in [format!("bucket={bucket}&limit=12000"), format!("bucket={bucket}")] {
            assert_eq!(get(&stranger, &rollup(&served)).await.status, StatusCode::OK, "{served}");
        }
        for refused in [format!("bucket={bucket}&limit=12001"), format!("bucket={bucket}&limit=50000")] {
            let answer = get(&stranger, &rollup(&refused)).await;
            assert_eq!(
                (answer.status, answer.json()),
                (StatusCode::BAD_REQUEST, json!({"error": "limit must be 1–12000 without a session"})),
                "{refused}"
            );
        }
        let zero = get(&stranger, &rollup(&format!("bucket={bucket}&limit=0"))).await;
        assert_eq!(zero.status, StatusCode::BAD_REQUEST, "bucket={bucket}&limit=0");
        for served in ["limit=12001", "limit=50000"] {
            let query = format!("bucket={bucket}&{served}");
            assert_eq!(get(&admin, &rollup(&query)).await.status, StatusCode::OK, "session: {query}");
        }
        let over = get(&admin, &rollup(&format!("bucket={bucket}&limit=50001"))).await;
        assert_eq!(over.json(), json!({"error": "limit must be 1–50000"}), "session: {bucket}");
    }
    drop((stranger, admin));
    core.stop().await;
}

const HISTORY_READS: [&str; 2] = ["/api/history/recent", "/api/history/rollup?metric=pv_power"];

#[tokio::test]
async fn six_strangers_read_history_at_once_a_seventh_is_a_503_and_a_session_is_never_refused() {
    let (core, admin) = open(&dir("kiosk-reads-at-once")).await;
    switch(&admin, true).await;
    let stranger = admin.anonymous();
    let held: Vec<_> = (0..6).map(|n| core.stranger_read().unwrap_or_else(|| panic!("read {n}"))).collect();
    assert!(core.stranger_read().is_none(), "a seventh");
    for path in HISTORY_READS {
        let started = Instant::now();
        let refused = get(&stranger, path).await;
        assert!(started.elapsed() < Duration::from_secs(1), "{path}: refused without waiting");
        assert_eq!(
            (refused.status, refused.json()),
            (StatusCode::SERVICE_UNAVAILABLE, json!({"error": "Too many history reads without a session"})),
            "{path}"
        );
        assert_eq!(get(&admin, path).await.status, StatusCode::OK, "session: {path}");
    }
    drop(held);
    for path in HISTORY_READS {
        assert_eq!(get(&stranger, path).await.status, StatusCode::OK, "released: {path}");
    }
    drop((stranger, admin));
    core.stop().await;
}

/// Every permit is free again: none of the six is held.
fn all_free(core: &Core) -> bool {
    let held: Vec<_> = std::iter::from_fn(|| core.stranger_read()).take(7).collect();
    held.len() == 6
}

#[tokio::test]
async fn a_strangers_read_frees_its_permit_when_answered_refused_or_abandoned() {
    let (core, admin) = open(&dir("kiosk-reads-release")).await;
    switch(&admin, true).await;
    let stranger = admin.anonymous();
    for path in HISTORY_READS {
        assert_eq!(get(&stranger, path).await.status, StatusCode::OK, "{path}");
        assert!(all_free(&core), "answered: {path}");
    }
    assert_eq!(get(&stranger, &rollup("limit=12001")).await.status, StatusCode::BAD_REQUEST);
    assert!(all_free(&core), "refused");
    for path in HISTORY_READS {
        let request = Request::get(path).header(header::HOST, HOST).body(Body::empty()).expect("request");
        let mut read = Box::pin(stranger.router.clone().oneshot(request));
        let mut context = std::task::Context::from_waker(std::task::Waker::noop());
        let deadline = Instant::now() + Duration::from_secs(10);
        while all_free(&core) {
            assert!(
                read.as_mut().poll(&mut context).is_pending(),
                "{path}: answered before it was seen in flight"
            );
            assert!(Instant::now() < deadline, "{path}: never in flight");
            tokio::time::sleep(Duration::from_millis(1)).await;
        }
        drop(read);
        assert!(all_free(&core), "abandoned: {path}");
    }
    drop((stranger, admin));
    core.stop().await;
}
