//! A request path never fetches: the refresh loops do, and a handler only serves what they kept.

use super::forecast::{NOW, configure_settings, onboarded};
use super::*;
use crate::run::Clock;
use crate::support::Offline;
use crate::support::paused_at;

/// The query each swept GET needs to reach its handler body; a GET absent here is requested bare.
const QUERIES: [(&str, &str); 2] = [
    ("/api/energy/series", "from=2026-07-23T00:00:00Z&to=2026-07-24T00:00:00Z&bucket=day"),
    ("/api/history/rollup", "metric=pv_power"),
];

fn gets(accesses: &[Access]) -> Vec<String> {
    let query = |path: &str| QUERIES.iter().find(|(route, _)| *route == path).map(|(_, query)| *query);
    requests(accesses)
        .into_iter()
        .filter(|(method, _)| method == "GET")
        .map(|(_, path)| query(&path).map_or_else(|| path.clone(), |query| format!("{path}?{query}")))
        .collect()
}

/// An onboarded core with the forecast configured, every fetch URL at `offline` and no refresh loop or learn
/// run: only a request path can dial `offline`.
async fn still(name: &str, offline: &Offline) -> (Arc<Core>, Api) {
    let core = Core::open_still(&dir(name), offline.url.clone(), paused_at(NOW)).await.expect("core");
    let (core, admin) = onboarded(core).await;
    configure_settings(&admin, None).await;
    assert_eq!(put(&admin, "/api/settings/kiosk", &json!({"enabled": true})).await.status, StatusCode::OK);
    (core, admin)
}

async fn answers_without_fetching(api: &Api, path: &str, offline: &Offline) {
    let answer = get(api, path).await;
    assert!(
        answer.status.is_success(),
        "GET {path}: {} {}",
        answer.status,
        String::from_utf8_lossy(&answer.body)
    );
    assert_eq!(offline.dials(), 0, "GET {path} fetched");
}

#[tokio::test(start_paused = true)]
async fn no_kiosk_or_session_read_fetches_in_its_request_path() {
    let offline = Offline::start();
    let (core, admin) = still("sweep-fetch", &offline).await;
    assert_eq!(offline.dials(), 0, "nothing but a request path runs");

    let reads = gets(&[Access::Kiosk, Access::Session]);
    assert_eq!(reads.len(), 11, "{reads:?}");
    for path in &reads {
        answers_without_fetching(&admin, path, &offline).await;
    }
    let stranger = admin.anonymous();
    for path in gets(&[Access::Kiosk]) {
        answers_without_fetching(&stranger, &path, &offline).await;
    }
    drop((stranger, admin));
    core.stop().await;
}

#[tokio::test(start_paused = true)]
async fn a_fetch_of_a_still_core_dials_the_offline_address() {
    let offline = Offline::start();
    let (core, admin) = still("sweep-dial", &offline).await;
    let refreshed = core.solar.refresh(&core.store, &Clock::wall(), &core.roots).await;
    assert!(!refreshed.expect("refresh"), "nothing answers");
    assert_eq!(offline.dials(), 1);
    drop(admin);
    core.stop().await;
}
