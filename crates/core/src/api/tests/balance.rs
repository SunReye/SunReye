//! The energy balance check (ADR 14): the residual per plant-local day, from stored rollups.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::http::StatusCode;
use serde_json::json;
use sunreye_profile::RoleKind;

use super::{Core, get, problem, with_cookie};
use crate::bus::{DeviceId, Reading};
use crate::storage::Policy;
use crate::topology::{Claim, PointDraft, Topologies};

/// 2026-08-26 00:00 UTC, the start of a plant-local day in the core's zone.
const DAY: u64 = 1_787_702_400;
const HOUR: u64 = 3600;
const INVERTER: DeviceId = DeviceId(7);
const METER: DeviceId = DeviceId(8);

fn at(seconds: u64) -> SystemTime {
    UNIX_EPOCH + Duration::from_secs(DAY + seconds)
}

fn draft(name: &str, parent: Option<usize>, (device, role): (DeviceId, &str)) -> PointDraft {
    PointDraft {
        id: None,
        name: name.to_owned(),
        parent,
        claims: vec![Claim {
            device: device.0,
            role: role.to_owned(),
        }],
    }
}

impl Core {
    /// Stores one reading an hour of `role` of `device` through the day and into the next
    /// midnight.
    async fn hourly(
        &self,
        device: DeviceId,
        (role, kind): (&str, RoleKind),
        value: impl Fn(u64) -> f64,
    ) {
        let series = self.bus.intern(role, None);
        let policy = Policy {
            kind,
            step: 0.5,
            deadband: 0.0,
            cadence: Duration::from_secs(HOUR),
        };
        self.storage.declare(device, series, policy).await.unwrap();
        for hour in 0..=24 {
            let reading = Reading {
                device,
                series,
                value: value(hour),
                unit: None,
                time: at(hour * HOUR),
                cadence: crate::endpoint::CADENCE,
            };
            self.storage.record(reading).await.unwrap();
        }
    }
}

#[tokio::test]
async fn a_day_reports_the_energy_a_consumer_gave_out_unexplained() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;
    let topology = Topologies::new(core.storage.database())
        .change(
            at(0) - Duration::from_hours(30 * 24),
            vec![
                draft("Grid", None, (METER, "grid.power")),
                draft("PV", Some(0), (INVERTER, "pv.power")),
                draft("House", Some(0), (INVERTER, "load.power")),
            ],
            &[INVERTER.0, METER.0],
            at(0),
        )
        .await
        .unwrap();
    let grid = topology.points[0].id;
    core.hourly(METER, ("grid.power", RoleKind::Measurement), |_| -500.0)
        .await;
    core.hourly(INVERTER, ("load.power", RoleKind::Measurement), |_| 250.0)
        .await;
    // Integrated, the PV's 1 kW would make 24 kWh; its counter rose 11.5 kWh within the day.
    core.hourly(INVERTER, ("pv.power", RoleKind::Measurement), |_| 1000.0)
        .await;
    core.hourly(INVERTER, ("pv.energy.total", RoleKind::Counter), |hour| {
        0.5f64.mul_add(f64::from(u32::try_from(hour).unwrap()), 100.0)
    })
    .await;
    core.storage.tick(at(3 * 86_400)).await.unwrap();

    let uri = "/api/v1/balance?from=2026-08-26T00:00:00Z&to=2026-08-27T00:00:00Z";
    let (status, body) = core.ask(&set_cookie, get(uri)).await;

    assert_eq!(status, StatusCode::OK, "{body}");
    // The grid point exported 12 kWh and fed the house's 6 kWh, of the PV's 11.5 kWh: it gave
    // out 12 + 6 − 11.5 = 6.5 kWh no point explains.
    assert_eq!(
        body,
        json!({
            "days": [{
                "start": "2026-08-26T00:00:00Z",
                "end": "2026-08-27T00:00:00Z",
                "residual": 6.5,
                "points": [{ "point": grid, "residual": 6.5 }],
            }],
        })
    );
}

#[tokio::test]
async fn an_empty_range_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let (core, set_cookie) = Core::signed_in(&dir.path().join("core.sqlite")).await;

    let uri = "/api/v1/balance?from=2026-08-27T00:00:00Z&to=2026-08-26T00:00:00Z";
    let response = core.send(with_cookie(&set_cookie, get(uri))).await;

    assert_eq!(
        problem(response).await,
        (StatusCode::UNPROCESSABLE_ENTITY, "history.range".to_owned())
    );
}
