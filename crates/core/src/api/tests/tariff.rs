//! The tariff (ADR 12): set by the admin, applying from a date, editing only the future, every
//! change logged (ADR 19).

use std::time::{Duration, UNIX_EPOCH};

use axum::http::StatusCode;
use serde_json::{Value, json};

use super::devices::send;
use super::{Core, get};

impl Core {
    async fn put_tariff(&self, set_cookie: &str, tariff: &Value) -> (StatusCode, Value) {
        self.ask(set_cookie, send("PUT", "/api/v1/tariff", tariff))
            .await
    }

    async fn tariff_at(&self, set_cookie: &str, at: &str) -> (StatusCode, Value) {
        self.ask(set_cookie, get(&format!("/api/v1/tariff?at={at}")))
            .await
    }

    /// Signed in, the clock at 2026-11-09 00:00 UTC.
    async fn on_2026_11_09(path: &std::path::Path) -> (Self, String) {
        let (core, set_cookie) = Self::signed_in(path).await;
        core.set_clock(UNIX_EPOCH + Duration::from_hours(498_384));
        (core, set_cookie)
    }
}

/// 0.30 EUR/kWh, 0.20 on weeknights from 22:00, 0.08 paid for feed-in.
fn weeknights(applies_from: &str) -> Value {
    json!({
        "appliesFrom": applies_from,
        "import": {
            "price": 0.30,
            "bands": [{ "days": [1, 2, 3, 4, 5], "from": "22:00", "to": "24:00", "price": 0.20 }],
        },
        "export": { "price": 0.08, "bands": [] },
    })
}

#[tokio::test]
async fn a_tariff_applies_from_its_date() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::on_2026_11_09(&dir.path().join("core.sqlite")).await;
    let (status, body) = core.ask(&set_cookie, get("/api/v1/tariff")).await;
    assert_eq!(
        (status, &body["code"]),
        (StatusCode::NOT_FOUND, &json!("tariff.none"))
    );

    let december = weeknights("2026-12-01T00:00:00Z");
    let (status, set) = core.put_tariff(&set_cookie, &december).await;
    assert_eq!((status, &set), (StatusCode::OK, &december));
    let mut fixed = weeknights("2027-01-01T00:00:00Z");
    fixed["import"]["bands"] = json!([]);
    let (status, _) = core.put_tariff(&set_cookie, &fixed).await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) = core.tariff_at(&set_cookie, "2026-11-30T23:59:59Z").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(
        core.tariff_at(&set_cookie, "2026-12-24T00:00:00Z").await,
        (StatusCode::OK, december)
    );
    assert_eq!(
        core.tariff_at(&set_cookie, "2027-01-01T00:00:00Z").await,
        (StatusCode::OK, fixed)
    );
}

#[tokio::test]
async fn editing_a_tariff_changes_only_the_future() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::on_2026_11_09(&dir.path().join("core.sqlite")).await;
    let (status, _) = core
        .put_tariff(&set_cookie, &weeknights("2026-11-09T00:00:00Z"))
        .await;
    assert_eq!(status, StatusCode::OK);
    core.set_clock(UNIX_EPOCH + Duration::from_hours(498_384 + 24));

    let (status, body) = core
        .put_tariff(&set_cookie, &weeknights("2026-11-09T12:00:00Z"))
        .await;
    assert_eq!(
        (status, &body["code"]),
        (StatusCode::UNPROCESSABLE_ENTITY, &json!("tariff.past"))
    );

    // Without a date, an edit applies from now.
    let mut now = weeknights("");
    now.as_object_mut().unwrap().remove("appliesFrom");
    now["export"]["price"] = json!(0.07);
    let (status, set) = core.put_tariff(&set_cookie, &now).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(set["appliesFrom"], json!("2026-11-10T00:00:00Z"));
    let (_, before) = core.tariff_at(&set_cookie, "2026-11-09T23:59:59Z").await;
    assert_eq!(before["export"]["price"], json!(0.08));
    let (_, after) = core.ask(&set_cookie, get("/api/v1/tariff")).await;
    assert_eq!(after["export"]["price"], json!(0.07));
}

#[tokio::test]
async fn a_tariff_change_is_logged_with_the_date_it_applies_from() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::on_2026_11_09(&dir.path().join("core.sqlite")).await;

    let (_, tariff) = core
        .put_tariff(&set_cookie, &weeknights("2026-12-01T00:00:00Z"))
        .await;

    let (_, log) = core.ask(&set_cookie, get("/api/v1/changes")).await;
    assert_eq!(
        log,
        json!({ "changes": [{
            "changed": "2026-11-09T00:00:00Z", "appliesFrom": "2026-12-01T00:00:00Z",
            "actor": "admin", "subject": "tariff", "id": 1, "action": "change",
            "state": tariff,
        }] })
    );
}

#[tokio::test]
async fn a_band_that_is_not_one_span_of_a_day_or_overlaps_another_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::on_2026_11_09(&dir.path().join("core.sqlite")).await;
    let band = |days: Value, from: &str, to: &str| json!({ "days": days, "from": from, "to": to, "price": 0.2 });
    let refused = [
        vec![band(json!([]), "08:00", "20:00")],
        vec![band(json!([0]), "08:00", "20:00")],
        vec![band(json!([8]), "08:00", "20:00")],
        vec![band(json!([1]), "20:00", "08:00")],
        vec![band(json!([1]), "08:00", "08:00")],
        vec![band(json!([1]), "24:00", "24:00")],
        vec![band(json!([1]), "08:00", "24:01")],
        vec![band(json!([1]), "08:60", "20:00")],
        vec![band(json!([1]), "8:00", "20:00")],
        vec![
            band(json!([1, 2]), "08:00", "12:00"),
            band(json!([2, 3]), "11:59", "20:00"),
        ],
    ];

    for bands in refused {
        let mut tariff = weeknights("2026-12-01T00:00:00Z");
        tariff["export"]["bands"] = json!(bands);
        let (status, body) = core.put_tariff(&set_cookie, &tariff).await;
        assert_eq!(
            (status, &body["code"]),
            (StatusCode::UNPROCESSABLE_ENTITY, &json!("tariff.band")),
            "{bands:?}"
        );
    }
    let mut touching = weeknights("2026-12-01T00:00:00Z");
    touching["export"]["bands"] = json!([
        band(json!([1, 2]), "00:00", "12:00"),
        band(json!([2, 3]), "12:00", "24:00"),
    ]);
    let (status, _) = core.put_tariff(&set_cookie, &touching).await;
    assert_eq!(status, StatusCode::OK);
}
