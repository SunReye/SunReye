//! The tariff (ADR 12): set by the admin, applying from a date, editing only the future, every
//! change logged (ADR 19).

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::http::StatusCode;
use serde_json::{Value, json};
use sunreye_profile::{RoleKind, Unit};

use super::devices::send;
use super::{Core, get};
use crate::endpoint::CADENCE;
use crate::plant;
use crate::storage::{ChangePoint, Policy};

impl Core {
    async fn put_tariff(&self, set_cookie: &str, tariff: &Value) -> (StatusCode, Value) {
        self.ask(set_cookie, send("PUT", "/api/v1/tariff", tariff))
            .await
    }

    async fn tariff_at(&self, set_cookie: &str, at: &str) -> (StatusCode, Value) {
        self.ask(set_cookie, get(&format!("/api/v1/tariff?at={at}")))
            .await
    }

    /// The plant's grid power and house load in W from `start`, each from its second to the
    /// next; `None` is a gap. Storage is then rolled up to the API's clock.
    async fn flows(&self, start: &str, flows: &[(u64, Option<(f64, f64)>)]) {
        let start: SystemTime = start.parse::<jiff::Timestamp>().unwrap().into();
        let policy = Policy::new(RoleKind::Measurement, Some(Unit::Watt), 1.0, CADENCE);
        for (role, pick) in [("grid.power", 0), ("load.power", 1)] {
            let series = self.bus.intern(role, None);
            self.storage
                .declare(plant::DEVICE, series, policy)
                .await
                .unwrap();
            let points: Vec<ChangePoint> = flows
                .iter()
                .map(|&(second, watts)| ChangePoint {
                    time: start + Duration::from_secs(second),
                    value: watts.map(|(grid, load)| if pick == 0 { grid } else { load }),
                })
                .collect();
            let end = points.last().unwrap().time + CADENCE;
            self.storage
                .replace(plant::DEVICE, series, start..end, points)
                .await
                .unwrap();
        }
        let now = self.clock.lock().unwrap().unwrap();
        self.storage.tick(now).await.unwrap();
    }

    /// Signed in, the clock at 2026-11-09 00:00 UTC.
    pub(super) async fn on_2026_11_09(path: &std::path::Path) -> (Self, String) {
        let (core, set_cookie) = Self::signed_in(path).await;
        core.set_clock(UNIX_EPOCH + Duration::from_hours(498_384));
        (core, set_cookie)
    }
}

/// 0.30 EUR/kWh, 0.20 on weeknights from 22:00, 0.08 paid for feed-in.
pub(super) fn weeknights(applies_from: &str) -> Value {
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

#[tokio::test]
async fn repricing_corrects_the_past_within_retention_and_is_logged() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::on_2026_11_09(&dir.path().join("core.sqlite")).await;
    let reprice = |tariff: &Value| send("POST", "/api/v1/tariff/reprice", tariff);

    // The default retention of 1827 days before 2026-11-09 00:00 is 2021-11-08 00:00.
    let (status, body) = core
        .ask(&set_cookie, reprice(&weeknights("2021-11-07T23:59:59Z")))
        .await;
    assert_eq!(
        (status, &body["code"]),
        (StatusCode::UNPROCESSABLE_ENTITY, &json!("tariff.retention"))
    );

    let november = weeknights("2026-11-01T00:00:00Z");
    let (status, repriced) = core.ask(&set_cookie, reprice(&november)).await;
    assert_eq!((status, &repriced), (StatusCode::OK, &november));
    assert_eq!(
        core.tariff_at(&set_cookie, "2026-11-02T00:00:00Z").await,
        (StatusCode::OK, november)
    );
    let (_, log) = core.ask(&set_cookie, get("/api/v1/changes")).await;
    assert_eq!(
        log,
        json!({ "changes": [{
            "changed": "2026-11-09T00:00:00Z", "appliesFrom": "2026-11-01T00:00:00Z",
            "actor": "admin", "subject": "tariff", "id": 1, "action": "reprice",
            "state": repriced,
        }] })
    );
}

#[tokio::test]
async fn payback_sums_the_savings_against_the_investment_the_admin_enters() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::on_2026_11_09(&dir.path().join("core.sqlite")).await;
    let (status, payback) = core.ask(&set_cookie, get("/api/v1/payback")).await;
    assert_eq!(
        (status, payback),
        (
            StatusCode::OK,
            json!({ "investment": null, "savings": 0.0, "remaining": null })
        )
    );

    // 2 kW fed in for two hours while the house uses 500 W.
    core.flows(
        "2026-11-01T00:00:00Z",
        &[(0, Some((-2000.0, 500.0))), (7200, None)],
    )
    .await;
    let fixed = json!({
        "appliesFrom": "2026-11-01T00:00:00Z",
        "import": { "price": 0.30, "bands": [] },
        "export": { "price": 0.08, "bands": [] },
    });
    let (status, _) = core
        .ask(&set_cookie, send("POST", "/api/v1/tariff/reprice", &fixed))
        .await;
    assert_eq!(status, StatusCode::OK);
    let investment = json!({ "amount": 10000.0 });
    let (status, set) = core
        .ask(&set_cookie, send("PUT", "/api/v1/investment", &investment))
        .await;
    assert_eq!((status, &set), (StatusCode::OK, &investment));

    // Saved: 2 h × (0.5 kW × 0.30 + 2 kW × 0.08) = 0.62.
    let (_, payback) = core.ask(&set_cookie, get("/api/v1/payback")).await;
    assert_eq!(
        payback,
        json!({ "investment": 10000.0, "savings": 0.62, "remaining": 9999.38 })
    );
    let (_, log) = core.ask(&set_cookie, get("/api/v1/changes")).await;
    assert_eq!(
        log["changes"][1],
        json!({
            "changed": "2026-11-09T00:00:00Z", "appliesFrom": "2026-11-09T00:00:00Z",
            "actor": "admin", "subject": "investment", "id": 0, "action": "change",
            "state": investment,
        })
    );
}

#[tokio::test]
async fn an_investment_that_is_not_a_positive_amount_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::on_2026_11_09(&dir.path().join("core.sqlite")).await;

    for amount in [json!(0.0), json!(-1.0), json!("10000")] {
        let (status, body) = core
            .ask(
                &set_cookie,
                send("PUT", "/api/v1/investment", &json!({ "amount": amount })),
            )
            .await;
        assert!(
            [
                (StatusCode::UNPROCESSABLE_ENTITY, json!("investment.value")),
                (StatusCode::BAD_REQUEST, json!("request.body")),
            ]
            .contains(&(status, body["code"].clone())),
            "{amount}"
        );
    }
}

#[tokio::test]
async fn costs_are_served_per_plant_local_day_with_their_total() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::on_2026_11_09(&dir.path().join("core.sqlite")).await;
    // 2 kW fed in for two hours while the house uses 500 W; the next day 1 kW bought for an hour
    // while it uses 1.5 kW.
    core.flows(
        "2026-11-01T00:00:00Z",
        &[
            (0, Some((-2000.0, 500.0))),
            (7200, None),
            (86_400, Some((1000.0, 1500.0))),
            (90_000, None),
        ],
    )
    .await;
    let fixed = json!({
        "appliesFrom": "2026-11-01T00:00:00Z",
        "import": { "price": 0.30, "bands": [] },
        "export": { "price": 0.08, "bands": [] },
    });
    let (status, _) = core
        .ask(&set_cookie, send("POST", "/api/v1/tariff/reprice", &fixed))
        .await;
    assert_eq!(status, StatusCode::OK);

    let uri = "/api/v1/costs?from=2026-11-01T00:00:00Z&to=2026-11-08T00:00:00Z";
    let (status, costs) = core.ask(&set_cookie, get(uri)).await;

    assert_eq!(status, StatusCode::OK, "{costs}");
    // Saved on the 1st: 2 h × (0.5 kW × 0.30 + 2 kW × 0.08) = 0.62; on the 2nd: 1.5 kWh × 0.30
    // less the 0.30 paid = 0.15.
    assert_eq!(
        costs,
        json!({
            "days": [
                {
                    "start": "2026-11-01T00:00:00Z", "end": "2026-11-02T00:00:00Z",
                    "paid": 0.0, "earned": 0.32, "saved": 0.62,
                },
                {
                    "start": "2026-11-02T00:00:00Z", "end": "2026-11-03T00:00:00Z",
                    "paid": 0.3, "earned": 0.0, "saved": 0.15,
                },
            ],
            "total": { "paid": 0.3, "earned": 0.32, "saved": 0.77 },
        })
    );
}

#[tokio::test]
async fn costs_over_an_empty_range_are_refused() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::on_2026_11_09(&dir.path().join("core.sqlite")).await;

    let uri = "/api/v1/costs?from=2026-11-08T00:00:00Z&to=2026-11-01T00:00:00Z";
    let (status, body) = core.ask(&set_cookie, get(uri)).await;

    assert_eq!(
        (status, &body["code"]),
        (StatusCode::UNPROCESSABLE_ENTITY, &json!("history.range"))
    );
}
