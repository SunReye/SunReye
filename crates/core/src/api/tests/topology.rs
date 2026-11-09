//! The plant topology (ADR 14): measurement points with stable ids, applying from a date, every
//! change logged (ADR 19).

use std::time::{Duration, UNIX_EPOCH};

use axum::http::StatusCode;
use serde_json::{Value, json};

use super::devices::{gateway, send};
use super::{Core, get};

/// The owner's Deye as device 1 and a grid meter as device 2, behind one gateway.
async fn plant(core: &Core, set_cookie: &str) {
    let connection = core.connection(set_cookie, &gateway()).await;
    assert_eq!(core.deye(set_cookie, &connection, 1).await, json!(1));
    assert_eq!(core.deye(set_cookie, &connection, 2).await, json!(2));
}

fn point(id: Option<u64>, name: &str, parent: Option<usize>, claims: &[(u32, &str)]) -> Value {
    let claims: Vec<Value> = claims
        .iter()
        .map(|(device, role)| json!({ "device": device, "role": role }))
        .collect();
    let mut point = json!({ "name": name, "parent": parent, "claims": claims });
    if let Some(id) = id {
        point["id"] = json!(id);
    }
    point
}

impl Core {
    async fn put_topology(
        &self,
        set_cookie: &str,
        applies_from: &str,
        points: &[Value],
    ) -> (StatusCode, Value) {
        let body = json!({ "appliesFrom": applies_from, "points": points });
        self.ask(set_cookie, send("PUT", "/api/v1/topology", &body))
            .await
    }
}

impl Core {
    async fn topology_at(&self, set_cookie: &str, at: &str) -> (StatusCode, Value) {
        let uri = format!("/api/v1/topology?at={at}");
        self.ask(set_cookie, get(&uri)).await
    }
}

/// The grid and PV from 2026, a battery added from June; returns the grid and PV point ids.
async fn two_versions(core: &Core, set_cookie: &str) -> (Value, Value) {
    let (status, first) = core
        .put_topology(
            set_cookie,
            "2026-01-01T00:00:00Z",
            &[
                point(None, "Grid", None, &[(2, "grid.power")]),
                point(None, "PV", Some(0), &[(1, "pv.power")]),
            ],
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{first}");
    let (grid, pv) = (
        first["points"][0]["id"].clone(),
        first["points"][1]["id"].clone(),
    );
    let (status, _) = core
        .put_topology(
            set_cookie,
            "2026-06-01T00:00:00Z",
            &[
                point(grid.as_u64(), "Grid", None, &[(2, "grid.power")]),
                point(pv.as_u64(), "PV", Some(0), &[(1, "pv.power")]),
                point(None, "Battery", Some(0), &[(1, "battery.power")]),
            ],
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    (grid, pv)
}

#[tokio::test]
async fn a_topology_change_applies_from_its_date_and_keeps_point_ids() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    plant(&core, &set_cookie).await;
    let (grid, pv) = two_versions(&core, &set_cookie).await;

    let (status, before) = core.topology_at(&set_cookie, "2025-12-31T00:00:00Z").await;
    assert_eq!(
        (status, &before["code"]),
        (StatusCode::NOT_FOUND, &json!("topology.none"))
    );
    let (_, spring) = core.topology_at(&set_cookie, "2026-03-01T00:00:00Z").await;
    assert_eq!(
        spring,
        json!({
            "appliesFrom": "2026-01-01T00:00:00Z",
            "points": [
                { "id": grid, "name": "Grid", "parent": null, "contested": false,
                  "claims": [{ "device": 2, "role": "grid.power" }] },
                { "id": pv, "name": "PV", "parent": grid, "contested": false,
                  "claims": [{ "device": 1, "role": "pv.power" }] },
            ],
        })
    );
    let (_, summer) = core.topology_at(&set_cookie, "2026-07-01T00:00:00Z").await;
    let battery = &summer["points"][2];
    assert_eq!(summer["appliesFrom"], json!("2026-06-01T00:00:00Z"));
    assert_eq!(
        (&battery["name"], &battery["parent"]),
        (&json!("Battery"), &grid)
    );
    assert!(battery["id"] != grid && battery["id"] != pv);
}

#[tokio::test]
async fn two_devices_claiming_one_point_are_flagged() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    plant(&core, &set_cookie).await;

    let (status, topology) = core
        .put_topology(
            &set_cookie,
            "2026-01-01T00:00:00Z",
            &[point(
                None,
                "Grid",
                None,
                &[(2, "grid.power"), (1, "grid.power")],
            )],
        )
        .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(topology["points"][0]["contested"], json!(true));
}

#[tokio::test]
async fn a_topology_change_is_logged_with_the_date_it_applies_from() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    plant(&core, &set_cookie).await;
    core.set_clock(UNIX_EPOCH + Duration::from_hours(498_384));

    let (_, topology) = core
        .put_topology(
            &set_cookie,
            "2026-12-01T00:00:00Z",
            &[point(None, "Grid", None, &[(2, "grid.power")])],
        )
        .await;

    let (_, log) = core.ask(&set_cookie, get("/api/v1/changes")).await;
    let last = log["changes"].as_array().unwrap().last().unwrap().clone();
    assert_eq!(
        last,
        json!({
            "changed": "2026-11-09T00:00:00Z", "appliesFrom": "2026-12-01T00:00:00Z",
            "actor": "admin", "subject": "topology", "id": 1, "action": "change",
            "state": topology,
        })
    );
}

/// Drafts that are not one measured tree, with the code each is refused with.
fn refused() -> Vec<(Vec<Value>, &'static str)> {
    let grid = point(None, "Grid", None, &[(2, "grid.power")]);
    let under =
        |name: &str, claims: &[(u32, &str)]| vec![grid.clone(), point(None, name, Some(0), claims)];
    let mut twice = under("PV", &[(1, "pv.power")]);
    twice.push(point(None, "PV again", Some(0), &[(1, "pv.power")]));
    vec![
        (vec![], "topology.tree"),
        (
            vec![grid.clone(), point(None, "PV", Some(1), &[(1, "pv.power")])],
            "topology.tree",
        ),
        (
            vec![grid.clone(), point(None, "PV", None, &[(1, "pv.power")])],
            "topology.tree",
        ),
        (
            vec![point(None, "PV", None, &[(1, "pv.power")])],
            "topology.role",
        ),
        (under("Meter", &[(1, "grid.power")]), "topology.role"),
        (under("Volts", &[(1, "battery.voltage")]), "topology.role"),
        (under("PV", &[(9, "pv.power")]), "topology.device"),
        (under("Empty", &[]), "topology.claim"),
        (twice, "topology.claim"),
        (
            under("Mixed", &[(1, "pv.power"), (2, "load.power")]),
            "topology.claim",
        ),
        (
            vec![point(Some(42), "Grid", None, &[(2, "grid.power")])],
            "topology.point",
        ),
    ]
}

#[tokio::test]
async fn a_topology_that_is_not_a_measured_tree_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    plant(&core, &set_cookie).await;

    for (points, code) in refused() {
        let (status, body) = core
            .put_topology(&set_cookie, "2026-01-01T00:00:00Z", &points)
            .await;
        assert_eq!(
            (status, &body["code"]),
            (StatusCode::UNPROCESSABLE_ENTITY, &json!(code)),
            "{points:?}"
        );
    }
    let (status, _) = core.ask(&set_cookie, get("/api/v1/topology")).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}
