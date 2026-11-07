//! A request path never fetches: the refresh loops do, and a handler only serves what they kept.

use std::time::Duration;

use super::forecast::{configure_settings, fixed_now, onboarded};
use super::*;
use crate::support::{Stalled, UNREACHABLE};

/// Longer than any read takes, shorter than the 8 s a fetch to a stalled address holds its caller.
const ANSWERS_WITHIN: Duration = Duration::from_secs(4);

fn gets(accesses: &[Access]) -> Vec<String> {
    requests(accesses).into_iter().filter(|(method, _)| method == "GET").map(|(_, path)| path).collect()
}

async fn answers_in_time(api: &Api, path: &str) {
    tokio::time::timeout(ANSWERS_WITHIN, get(api, path))
        .await
        .unwrap_or_else(|_| panic!("GET {path} waited on a fetch"));
}

#[tokio::test]
async fn no_kiosk_or_session_read_fetches_in_its_request_path() {
    let stalled = Stalled::start().await;
    let urls = (stalled.url.clone(), UNREACHABLE.to_owned());
    let core = Core::open_forecasting(&dir("sweep-fetch"), Vec::new(), urls, fixed_now).await.expect("core");
    let (core, admin) = onboarded(core).await;
    configure_settings(&admin, None).await;
    assert_eq!(put(&admin, "/api/settings/kiosk", &json!({"enabled": true})).await.status, StatusCode::OK);

    let reads = gets(&[Access::Kiosk, Access::Session]);
    assert!(reads.len() > 8, "{reads:?}");
    for path in &reads {
        answers_in_time(&admin, path).await;
    }
    let stranger = admin.anonymous();
    for path in gets(&[Access::Kiosk]) {
        answers_in_time(&stranger, &path).await;
    }
    drop((stranger, admin));
    core.stop().await;
}
