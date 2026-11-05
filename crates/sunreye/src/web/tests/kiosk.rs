use std::pin::Pin;

use tokio::sync::OwnedSemaphorePermit;

use super::*;

/// What the dashboard reads, each as a request that answers 200 to a session.
const DASHBOARD_READS: [&str; 4] = [
    "/api/capabilities",
    "/api/profile",
    "/api/history/recent",
    "/api/history/rollup?metric=pv_power&bucket=minute",
];

/// The listed operations a stranger may reach with the kiosk view on, beside the sign-in routes.
fn open_with_kiosk() -> Vec<(String, String)> {
    access_table()
        .into_iter()
        .filter(|route| matches!(route.access, Access::Public | Access::Kiosk))
        .map(|route| (route.method, route.path))
        .collect()
}

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
    let sign_in: Vec<(String, String)> = access_table()
        .into_iter()
        .filter(|route| route.access == Access::Credential)
        .map(|route| (route.method, route.path))
        .collect();
    let mut open = Vec::new();
    for (method, path) in operations(&document) {
        if sign_in.contains(&(method.clone(), path.clone())) {
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
    assert_eq!(open, open_with_kiosk());
    assert!(kiosk_on(&admin).await, "no refused write switched it off");
    drop((stranger, admin));
    core.stop().await;
}

fn rollup(query: &str) -> String {
    format!("/api/history/rollup?metric=pv_power&{query}")
}

#[tokio::test]
async fn a_strangers_rollup_is_capped_at_12000_buckets_on_every_tier_and_a_sessions_at_50000() {
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
        for (api, limit) in [(&stranger, "0"), (&stranger, "-1"), (&admin, "0"), (&admin, "-1")] {
            let query = format!("bucket={bucket}&limit={limit}");
            assert_eq!(get(api, &rollup(&query)).await.status, StatusCode::BAD_REQUEST, "{query}");
        }
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

#[tokio::test]
async fn a_signed_out_or_unknown_session_cookie_reads_as_a_stranger() {
    let (core, admin) = open(&dir("kiosk-stale-cookie")).await;
    let signed_in = login(&admin.anonymous(), ADMIN_EMAIL, ADMIN_PASSWORD, false).await;
    let ended = admin.with_cookie(&signed_in.session_cookie());
    assert_eq!(delete(&ended, "/api/auth/session").await.status, StatusCode::NO_CONTENT);
    let name = signed_in.session_cookie().split('=').next().expect("name").to_owned();
    let unknown = admin.with_cookie(&format!("{name}=not-a-session"));
    for api in [&ended, &unknown] {
        assert_eq!(get(api, &rollup("limit=12001")).await.status, StatusCode::UNAUTHORIZED, "kiosk off");
    }
    switch(&admin, true).await;
    for api in [&ended, &unknown] {
        let answer = get(api, &rollup("limit=12001")).await;
        assert_eq!(answer.json(), json!({"error": "limit must be 1–12000 without a session"}));
        assert_eq!(get(api, &rollup("limit=12000")).await.status, StatusCode::OK);
    }
    drop((ended, unknown, admin));
    core.stop().await;
}

const HISTORY_READS: [&str; 2] = ["/api/history/recent", "/api/history/rollup?metric=pv_power"];

/// Takes every stranger permit, as six reads in flight would.
async fn hold_all(core: &Core) -> Vec<OwnedSemaphorePermit> {
    let mut held = Vec::new();
    while let Some(permit) = core.stranger_permit(Duration::ZERO).await {
        held.push(permit);
    }
    assert_eq!(held.len(), 6, "stranger permits");
    held
}

/// Every permit is free again: none is held or handed to a waiter.
async fn all_free(core: &Core) -> bool {
    let mut held = Vec::new();
    while let Some(permit) = core.stranger_permit(Duration::ZERO).await {
        held.push(permit);
    }
    held.len() == 6
}

fn request(path: &str) -> Request<Body> {
    Request::get(path).header(header::HOST, HOST).body(Body::empty()).expect("request")
}

/// Polls `read` for a while and asserts it is still waiting.
async fn still_pending<F: Future + Unpin>(read: &mut F, what: &str) {
    let mut context = std::task::Context::from_waker(std::task::Waker::noop());
    for _ in 0..20 {
        assert!(Pin::new(&mut *read).poll(&mut context).is_pending(), "{what}: answered while waiting");
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
}

#[tokio::test]
async fn fifteen_strangers_reading_history_at_once_are_all_answered() {
    let (core, admin) = open(&dir("kiosk-reads-at-once")).await;
    switch(&admin, true).await;
    let mut reads = tokio::task::JoinSet::new();
    for n in 0..15 {
        let read = admin.anonymous().router.oneshot(request(HISTORY_READS[n % 2]));
        reads.spawn(async move { (n, read.await.expect("response").status()) });
    }
    while let Some(read) = reads.join_next().await {
        let (n, status) = read.expect("read");
        assert_eq!(status, StatusCode::OK, "read {n}");
    }
    assert!(all_free(&core).await);
    drop(admin);
    core.stop().await;
}

#[tokio::test]
async fn a_seventh_strangers_read_waits_for_a_permit_and_a_session_never_waits() {
    let (core, admin) = open(&dir("kiosk-reads-wait")).await;
    switch(&admin, true).await;
    let stranger = admin.anonymous();
    for path in HISTORY_READS {
        let mut held = hold_all(&core).await;
        let mut read = Box::pin(stranger.router.clone().oneshot(request(path)));
        still_pending(&mut read, path).await;
        let started = Instant::now();
        assert_eq!(get(&admin, path).await.status, StatusCode::OK, "session: {path}");
        assert!(started.elapsed() < Duration::from_secs(2), "{path}: a session waited");
        held.pop();
        let answer = answer(read.await.expect("response")).await;
        assert_eq!(answer.status, StatusCode::OK, "{path}: once a permit freed");
        drop(held);
        assert!(all_free(&core).await, "{path}");
    }
    drop((stranger, admin));
    core.stop().await;
}

#[tokio::test]
async fn a_strangers_read_that_waits_past_the_limit_is_a_503() {
    let config = Config { stranger_wait: StrangerWait(Duration::from_millis(50)), ..Config::default() };
    let (core, admin) = open_with(&dir("kiosk-reads-timeout"), &config).await;
    switch(&admin, true).await;
    let stranger = admin.anonymous();
    let held = hold_all(&core).await;
    for path in HISTORY_READS {
        let refused = get(&stranger, path).await;
        assert_eq!(
            (refused.status, refused.json()),
            (StatusCode::SERVICE_UNAVAILABLE, json!({"error": "Too many history reads without a session"})),
            "{path}"
        );
    }
    drop(held);
    for path in HISTORY_READS {
        assert_eq!(get(&stranger, path).await.status, StatusCode::OK, "released: {path}");
    }
    drop((stranger, admin));
    core.stop().await;
}

#[tokio::test]
async fn a_waiting_strangers_read_whose_client_leaves_takes_no_permit() {
    let (core, admin) = open(&dir("kiosk-reads-leave")).await;
    switch(&admin, true).await;
    let stranger = admin.anonymous();
    for path in HISTORY_READS {
        let mut held = hold_all(&core).await;
        let mut left = Box::pin(stranger.router.clone().oneshot(request(path)));
        still_pending(&mut left, path).await;
        let mut next = Box::pin(stranger.router.clone().oneshot(request(path)));
        still_pending(&mut next, path).await;
        drop(left);
        held.pop();
        assert_eq!(answer(next.await.expect("response")).await.status, StatusCode::OK, "{path}");
        drop(held);
        assert!(all_free(&core).await, "{path}");
    }
    drop((stranger, admin));
    core.stop().await;
}

#[tokio::test]
async fn a_strangers_read_frees_its_permit_when_answered_refused_or_abandoned() {
    let (core, admin) = open(&dir("kiosk-reads-release")).await;
    switch(&admin, true).await;
    let stranger = admin.anonymous();
    for path in HISTORY_READS {
        assert_eq!(get(&stranger, path).await.status, StatusCode::OK, "{path}");
        assert!(all_free(&core).await, "answered: {path}");
    }
    assert_eq!(get(&stranger, &rollup("limit=12001")).await.status, StatusCode::BAD_REQUEST);
    assert!(all_free(&core).await, "refused");
    for path in HISTORY_READS {
        let mut read = Box::pin(stranger.router.clone().oneshot(request(path)));
        let mut context = std::task::Context::from_waker(std::task::Waker::noop());
        let deadline = Instant::now() + Duration::from_secs(10);
        while all_free(&core).await {
            assert!(
                read.as_mut().poll(&mut context).is_pending(),
                "{path}: answered before it was seen in flight"
            );
            assert!(Instant::now() < deadline, "{path}: never in flight");
            tokio::time::sleep(Duration::from_millis(1)).await;
        }
        drop(read);
        assert!(all_free(&core).await, "abandoned: {path}");
    }
    drop((stranger, admin));
    core.stop().await;
}
