//! The battery's capacity estimate (ADR 4, 9): the plant's hourly rollups, kept forever (ADR 3),
//! read by the pure `battery` module.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::Json;
use axum::extract::State;
use serde::Serialize;
use utoipa::ToSchema;

use super::{Clock, Problem, ProblemDetails, internal, rfc3339};
use crate::battery;
use crate::bus::Series;
use crate::plant;
use crate::storage::{Aggregate, Reader, Rollup, Tier};

/// Every hour rolled up, to 2106.
const ALL: Duration = Duration::from_secs(u32::MAX as u64);

pub type BatteryState = State<(Reader, Clock)>;

/// The usable capacity inferred from the state of charge over each unbroken discharge of at
/// least 20 points; no vendor register reports it.
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Capacity {
    /// In time order.
    measurements: Vec<CapacityMeasurement>,
    /// kWh: the median of the latest five measurements; `null` before the first.
    now: Option<f64>,
    /// kWh: the median of the first five.
    first: Option<f64>,
    /// The relative change a year, from half a year of measurements and more than five.
    per_year: Option<f64>,
    /// kWh, as the latest `battery.capacity` a device reports; `null` without one.
    nameplate: Option<f64>,
    /// kWh discharged, summed per hour.
    discharged: f64,
    /// Full cycles: `discharged` over the nameplate, else over `now`.
    cycles: Option<f64>,
    /// RFC 3339: the first hour with battery power.
    since: Option<String>,
}

#[derive(Serialize, ToSchema)]
struct CapacityMeasurement {
    /// RFC 3339: when the discharge ended.
    end: String,
    kwh: f64,
}

async fn rollups(
    reader: &Reader,
    role: &str,
    tier: Tier,
    now: SystemTime,
) -> Result<Vec<Rollup>, Problem> {
    let series = Series {
        role: role.to_owned(),
        index: None,
    };
    reader
        .rollups(
            plant::DEVICE,
            &series,
            tier,
            UNIX_EPOCH..now.min(UNIX_EPOCH + ALL),
        )
        .await
        .map_err(internal)
}

/// The battery's usable capacity over the whole record.
#[utoipa::path(get, path = "/api/v1/battery/capacity", responses(
    (status = 200, body = Capacity),
    (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
))]
pub async fn capacity(State((reader, clock)): BatteryState) -> Result<Json<Capacity>, Problem> {
    let now = clock();
    let soc = rollups(&reader, "battery.soc", Tier::Hour, now).await?;
    let power = rollups(&reader, "battery.power", Tier::Hour, now).await?;
    let rated = rollups(&reader, "battery.capacity", Tier::Day, now).await?;
    let nameplate = rated.last().and_then(|r| match r.aggregate {
        Aggregate::Measurement { max, .. } => Some(max),
        Aggregate::Counter { .. } | Aggregate::Held { .. } => None,
    });
    let found = battery::estimate(&soc, &power, nameplate);
    Ok(Json(Capacity {
        measurements: found
            .measurements
            .iter()
            .map(|m| CapacityMeasurement {
                end: rfc3339(m.end),
                kwh: m.kwh,
            })
            .collect(),
        now: found.now,
        first: found.first,
        per_year: found.per_year,
        nameplate,
        discharged: found.discharged,
        cycles: found.cycles,
        since: found.since.map(rfc3339),
    }))
}
