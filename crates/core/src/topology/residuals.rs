//! The energy balance check route (ADR 14): the residual per plant-local day, read from the daily
//! rollups of the points' devices. History, so a viewer reads it (ADR 9).

use std::collections::{BTreeMap, HashMap};
use std::ops::Range;
use std::time::{Duration, SystemTime};

use axum::Json;
use axum::extract::rejection::QueryRejection;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use super::{COUNTERS, INTERNAL, Topologies, Version, energy, in_force, residual};
use crate::api::{Code, Problem, ProblemDetails};
use crate::bus::{DeviceId, Series};
use crate::storage::{Aggregate, Reader, Tier};

const QUERY: Problem = Problem {
    status: StatusCode::BAD_REQUEST,
    code: Code::RequestQuery,
};
const RANGE: Problem = Problem {
    status: StatusCode::UNPROCESSABLE_ENTITY,
    code: Code::HistoryRange,
};
/// The longest range: as many days as history's day tier returns (ADR 9).
const SPAN: Duration = Duration::from_hours(24 * 1498);

impl Topologies {
    /// The energy balance check, over the history `reader` reads.
    pub fn residual_routes(self, reader: Reader) -> OpenApiRouter {
        OpenApiRouter::new()
            .routes(routes!(balance))
            .with_state((self, reader))
    }
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
struct Params {
    /// The first instant, RFC 3339: a day starting from it on is read.
    from: String,
    /// The instant after the last, RFC 3339.
    to: String,
}

/// The days with rolled-up history, in order.
#[derive(Serialize, ToSchema)]
struct Balance {
    days: Vec<Day>,
}

/// One plant-local day.
#[derive(Serialize, ToSchema)]
struct Day {
    /// RFC 3339, UTC.
    start: String,
    /// RFC 3339, UTC.
    end: String,
    /// In kWh, the sum of `points`: zero when the tree explains the day.
    residual: f64,
    /// Each consuming point with a residual.
    points: Vec<PointResidual>,
}

/// The energy a consuming point gave out that its measured children do not explain.
#[derive(Serialize, ToSchema)]
struct PointResidual {
    /// The point's id.
    point: u32,
    /// In kWh.
    residual: f64,
}

/// The residual per plant-local day (ADR 14): energy a consuming point gave out that its
/// measured children do not explain, so a missing or misplaced point.
#[utoipa::path(get, path = "/api/v1/balance", params(Params), responses(
    (status = 200, body = Balance),
    (status = "4XX", body = ProblemDetails, content_type = "application/problem+json"),
))]
async fn balance(
    State((topologies, reader)): State<(Topologies, Reader)>,
    params: Result<Query<Params>, QueryRejection>,
) -> Result<Json<Balance>, Problem> {
    let Query(params) = params.map_err(|_| QUERY)?;
    let range = instant(&params.from)?..instant(&params.to)?;
    let span = range.end.duration_since(range.start).map_err(|_| RANGE)?;
    if span.is_zero() || span > SPAN {
        return Err(RANGE);
    }
    let versions = topologies.versions().await.map_err(|_| INTERNAL)?;
    let rollups = Rollups::read(&reader, &versions, range).await?;
    let days = rollups
        .days()
        .into_iter()
        .filter_map(|(start, end)| {
            // The tree in force at the day's end.
            let version = in_force(&versions, end.checked_sub(Duration::from_nanos(1))?)?;
            let points = residual(&version.points, |device, role| {
                energy(role, |series| rollups.get(device, series, start))
            });
            Some(Day {
                start: rfc3339(start),
                end: rfc3339(end),
                residual: points.values().sum(),
                points: points
                    .into_iter()
                    .map(|(point, residual)| PointResidual { point, residual })
                    .collect(),
            })
        })
        .collect();
    Ok(Json(Balance { days }))
}

/// The daily rollups of every series a claim's energy may come from.
struct Rollups(HashMap<(u32, String), BTreeMap<SystemTime, (SystemTime, Aggregate)>>);

impl Rollups {
    /// Those of each claim of a version in force over `range`.
    async fn read(
        reader: &Reader,
        versions: &[Version],
        range: Range<SystemTime>,
    ) -> Result<Self, Problem> {
        let first = versions.iter().rposition(|v| v.applies_from <= range.start);
        let mut wanted: Vec<(u32, String)> = Vec::new();
        let versions = versions
            .iter()
            .skip(first.unwrap_or(0))
            .filter(|v| v.applies_from < range.end);
        for claim in versions.flat_map(|v| &v.points).flat_map(|p| &p.claims) {
            wanted.push((claim.device, claim.role.clone()));
            if let Some((_, counters)) = COUNTERS.iter().find(|(role, _)| *role == claim.role) {
                wanted.extend(
                    counters
                        .iter()
                        .map(|&(series, _)| (claim.device, series.to_owned())),
                );
            }
        }
        let mut rollups = HashMap::new();
        for key in wanted {
            if rollups.contains_key(&key) {
                continue;
            }
            let name = Series::parse(&key.1).ok_or(INTERNAL)?;
            let days = reader
                .rollups(DeviceId(key.0), &name, Tier::Day, range.clone())
                .await
                .map_err(|_| INTERNAL)?
                .into_iter()
                .map(|r| (r.start, (r.end, r.aggregate)))
                .collect();
            rollups.insert(key, days);
        }
        Ok(Self(rollups))
    }

    /// Every day any series has, by start, with its end.
    fn days(&self) -> BTreeMap<SystemTime, SystemTime> {
        self.0
            .values()
            .flat_map(|days| days.iter().map(|(&start, &(end, _))| (start, end)))
            .collect()
    }

    fn get(&self, device: u32, series: &str, day: SystemTime) -> Option<Aggregate> {
        let days = self.0.get(&(device, series.to_owned()))?;
        days.get(&day).map(|&(_, aggregate)| aggregate)
    }
}

fn instant(text: &str) -> Result<SystemTime, Problem> {
    let instant: jiff::Timestamp = text.parse().map_err(|_| QUERY)?;
    Ok(instant.into())
}

fn rfc3339(time: SystemTime) -> String {
    jiff::Timestamp::try_from(time)
        .map(|t| t.to_string())
        .unwrap_or_default()
}
