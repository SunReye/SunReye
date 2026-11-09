//! Plant topology (ADR 14): a tree of measurement points, rooted at the grid connection.
//!
//! The topology module owns the `point`, `topology`, `topology_point` and `topology_claim` tables.
//! Point ids are never reused; a change is a new version applying from its instant, and the plant
//! device reads the version in force at each reading.

mod residuals;
mod routes;
mod store;

use std::collections::{BTreeMap, HashSet};
use std::sync::Arc;
use std::time::SystemTime;

use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use tokio::sync::watch;
use utoipa::ToSchema;

use crate::api::{Code, Problem};
use crate::storage::{Aggregate, Database, Error};

const INTERNAL: Problem = Problem {
    status: StatusCode::INTERNAL_SERVER_ERROR,
    code: Code::Internal,
};

/// Why a topology was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Refusal {
    /// Not one tree: no points, the first is not the root, or a parent is not an earlier point.
    Tree,
    /// A kept id no point ever had, or one named twice.
    Point,
    /// A point without a claim, claims of different roles on one point, or a device's role
    /// claimed twice.
    Claim,
    /// Not a power role, or `grid.power` anywhere but the root.
    Role,
    /// A claim names no registered device.
    Device,
}

impl From<Refusal> for Problem {
    fn from(refusal: Refusal) -> Self {
        let code = match refusal {
            Refusal::Tree => Code::TopologyTree,
            Refusal::Point => Code::TopologyPoint,
            Refusal::Claim => Code::TopologyClaim,
            Refusal::Role => Code::TopologyRole,
            Refusal::Device => Code::TopologyDevice,
        };
        Self {
            status: StatusCode::UNPROCESSABLE_ENTITY,
            code,
        }
    }
}

/// A device measuring a point, by the power role it measures there.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct Claim {
    /// The device's id.
    pub device: u32,
    /// Its power role at the point, such as `grid.power`.
    pub role: String,
}

/// A measurement point.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct Point {
    /// Stable; never reused.
    pub id: u32,
    pub name: String,
    /// The parent point's id; `null` for the root, the grid connection.
    pub parent: Option<u32>,
    /// In order: the first with a reading is read.
    pub claims: Vec<Claim>,
}

impl Point {
    /// Claimed by more than one device: flagged, never summed.
    #[must_use]
    pub const fn contested(&self) -> bool {
        self.claims.len() > 1
    }
}

/// A point as the admin enters it.
#[derive(Debug, Clone, Deserialize, ToSchema)]
pub struct PointDraft {
    /// A point kept from an earlier version; absent for a new point.
    pub id: Option<u32>,
    pub name: String,
    /// The index in `points` of an earlier point; `null` for the root, which comes first.
    pub parent: Option<usize>,
    pub claims: Vec<Claim>,
}

/// One topology version.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Version {
    pub applies_from: SystemTime,
    /// Each parent before its children, the root first.
    pub points: Vec<Point>,
}

/// The version in force at `at`; `versions` in the order [`Topologies::versions`] returns.
#[must_use]
pub fn in_force(versions: &[Version], at: SystemTime) -> Option<&Version> {
    versions.iter().rev().find(|v| v.applies_from <= at)
}

/// The topology feature module; clones share one.
#[derive(Debug, Clone)]
pub struct Topologies {
    database: Database,
    changed: Arc<watch::Sender<()>>,
}

impl Topologies {
    #[must_use]
    pub fn new(database: Database) -> Self {
        Self {
            database,
            changed: Arc::new(watch::channel(()).0),
        }
    }

    /// Marked changed by each topology change.
    #[must_use]
    pub fn changes(&self) -> watch::Receiver<()> {
        self.changed.subscribe()
    }

    /// Every version, by the instant it applies from, a later change after an earlier one.
    ///
    /// # Errors
    /// The file cannot be read.
    pub async fn versions(&self) -> Result<Vec<Version>, Error> {
        self.database.run(store::versions).await
    }

    /// Appends a version applying from `applies_from`, logged as changed at `changed`; new points
    /// get fresh ids. `devices` are the registered device ids.
    ///
    /// # Errors
    /// The points are not one measured tree, a claim names an unknown device or role, a kept id is
    /// unknown, or the file cannot be written.
    pub async fn change(
        &self,
        applies_from: SystemTime,
        points: Vec<PointDraft>,
        devices: &[u32],
        changed: SystemTime,
    ) -> Result<Version, Problem> {
        check(&points, devices)?;
        let stored = self
            .database
            .run(move |db| store::insert(db, applies_from, points, changed))
            .await
            .map_err(|_| INTERNAL)??;
        self.changed.send_replace(());
        Ok(stored)
    }
}

/// Refuses drafts that are not one tree measured by known devices' power roles.
fn check(points: &[PointDraft], devices: &[u32]) -> Result<(), Refusal> {
    if points.is_empty() {
        return Err(Refusal::Tree);
    }
    for (index, point) in points.iter().enumerate() {
        let rooted = point.parent.map_or(index == 0, |parent| parent < index);
        if !rooted {
            return Err(Refusal::Tree);
        }
    }
    let mut claimed = HashSet::new();
    for (index, point) in points.iter().enumerate() {
        let role = point.claims.first().ok_or(Refusal::Claim)?.role.as_str();
        let kind = kind(role).ok_or(Refusal::Role)?;
        if (index == 0) != (kind == Kind::Grid) {
            return Err(Refusal::Role);
        }
        for claim in &point.claims {
            if claim.role != role || !claimed.insert((claim.device, role)) {
                return Err(Refusal::Claim);
            }
            if !devices.contains(&claim.device) {
                return Err(Refusal::Device);
            }
        }
    }
    Ok(())
}

/// What a power role measures at its point.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    /// The grid connection: the root, positive when importing.
    Grid,
    /// Power made: it flows out of its point.
    Source,
    /// The battery, positive when charging.
    Storage,
    /// Power used.
    Load,
}

/// The power roles a point may be measured by (ADR 4).
const ROLES: &[(&str, Kind)] = &[
    ("grid.power", Kind::Grid),
    ("pv.power", Kind::Source),
    ("generator.power", Kind::Source),
    ("battery.power", Kind::Storage),
    ("load.power", Kind::Load),
    ("backup.power", Kind::Load),
    ("ev.charge.power", Kind::Load),
];

/// The plant totals summed over the points measured by the same role.
const SUMMED: &[&str] = &[
    "grid.power",
    "pv.power",
    "generator.power",
    "battery.power",
    "ev.charge.power",
];

fn kind(role: &str) -> Option<Kind> {
    ROLES
        .iter()
        .find(|(r, _)| *r == role)
        .map(|&(_, kind)| kind)
}

/// The power into a point's subtree, from its role's reading.
fn inflow(role: &str, value: f64) -> f64 {
    if kind(role) == Some(Kind::Source) {
        -value
    } else {
        value
    }
}

/// The plant at one instant.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Balance {
    /// By point id, each measured point's own consumption: its power minus its nearest measured
    /// descendants. Signed: a source's is negative, and so is a remainder a meter overstates.
    pub own: BTreeMap<u32, f64>,
    /// The plant's values, by role: those of its points, summed, the house load, and the state of
    /// charge weighted by capacity. A total is left out while a point it needs is unmeasured.
    pub totals: Vec<(&'static str, f64)>,
}

/// One measured point: the claim read and its value.
struct Measured<'a> {
    device: u32,
    role: &'a str,
    value: f64,
}

/// Balances the tree `points` over `value`, the latest reading of a device's role, if any. A
/// contested point is read from its first claim that has a value; its claims are never summed.
pub fn balance(points: &[Point], value: impl Fn(u32, &str) -> Option<f64>) -> Balance {
    let measured: BTreeMap<u32, Measured<'_>> = points
        .iter()
        .filter_map(|p| {
            let measured = p.claims.iter().find_map(|c| {
                Some(Measured {
                    device: c.device,
                    role: &c.role,
                    value: value(c.device, &c.role)?,
                })
            })?;
            Some((p.id, measured))
        })
        .collect();
    let own = own(points, &measured);
    let mut totals = summed(points, &measured);
    if measured.len() == points.len() {
        let load: f64 = own
            .iter()
            .filter(|(id, _)| {
                measured
                    .get(id)
                    .and_then(|m| kind(m.role))
                    .is_some_and(|k| matches!(k, Kind::Grid | Kind::Load))
            })
            .map(|(_, watts)| watts)
            .sum();
        // A meter that overstates shows in a point's own consumption, not as negative load.
        totals.push(("load.power", load.max(0.0)));
    }
    // A silent battery still counts: one of two is not the plant's whole charge.
    let batteries: Vec<u32> = points
        .iter()
        .filter(|p| role_of(p).and_then(kind) == Some(Kind::Storage))
        .filter_map(|p| {
            measured
                .get(&p.id)
                .map_or_else(|| p.claims.first().map(|c| c.device), |m| Some(m.device))
        })
        .collect();
    totals.extend(charge(&batteries, &value));
    Balance { own, totals }
}

/// The energy balance check: each consuming point's residual over one day, by point id.
///
/// `energy` is a day's energy of a device's power role. A consumer, the grid connection or a load,
/// cannot give energy out, so what its measured children do not explain of what it gave out is a
/// missing or misplaced point, or a meter that overstates. Points without one are left out.
pub fn residual(points: &[Point], energy: impl Fn(u32, &str) -> Option<f64>) -> BTreeMap<u32, f64> {
    let consuming: HashSet<u32> = points
        .iter()
        .filter(|p| {
            role_of(p)
                .and_then(kind)
                .is_some_and(|k| matches!(k, Kind::Grid | Kind::Load))
        })
        .map(|p| p.id)
        .collect();
    balance(points, energy)
        .own
        .into_iter()
        .filter(|&(id, own)| own < 0.0 && consuming.contains(&id))
        .map(|(id, own)| (id, -own))
        .collect()
}

/// The lifetime counters, in kWh, that give a power role's energy: each added or taken away.
const COUNTERS: &[(&str, &[(&str, f64)])] = &[
    (
        "grid.power",
        &[
            ("grid.energy.imported.total", 1.0),
            ("grid.energy.exported.total", -1.0),
        ],
    ),
    ("pv.power", &[("pv.energy.total", 1.0)]),
    ("generator.power", &[("generator.energy.total", 1.0)]),
    (
        "battery.power",
        &[
            ("battery.energy.charged.total", 1.0),
            ("battery.energy.discharged.total", -1.0),
        ],
    ),
    ("load.power", &[("load.energy.total", 1.0)]),
    ("backup.power", &[("backup.energy.total", 1.0)]),
];

/// A power role's energy in kWh over one rollup window, signed as the role (ADR 4).
///
/// `rollup` is the window's aggregate of a series. The energy is the delta of the role's lifetime
/// counters while each has one, else its integrated power (ADR 3).
pub fn energy(role: &str, rollup: impl Fn(&str) -> Option<Aggregate>) -> Option<f64> {
    let counters = COUNTERS
        .iter()
        .find(|(r, _)| *r == role)
        .map(|&(_, counters)| counters);
    let counted: Option<f64> = counters.and_then(|counters| {
        counters
            .iter()
            .map(|&(series, sign)| match rollup(series)? {
                Aggregate::Counter { delta, .. } => Some(sign * delta),
                Aggregate::Measurement { .. } => None,
            })
            .sum()
    });
    counted.or_else(|| match rollup(role)? {
        Aggregate::Measurement { integral, .. } => Some(integral / 1000.0),
        Aggregate::Counter { .. } => None,
    })
}

/// Each measured point's power minus its nearest measured descendants.
fn own(points: &[Point], measured: &BTreeMap<u32, Measured<'_>>) -> BTreeMap<u32, f64> {
    let mut children: BTreeMap<u32, Vec<u32>> = BTreeMap::new();
    for p in points {
        if let Some(parent) = p.parent {
            children.entry(parent).or_default().push(p.id);
        }
    }
    measured
        .iter()
        .map(|(&id, m)| {
            let below: f64 = children
                .get(&id)
                .into_iter()
                .flatten()
                .map(|&child| reach(child, measured, &children))
                .sum();
            (id, inflow(m.role, m.value) - below)
        })
        .collect()
}

/// The readings of each summed role's points, while all of them are measured.
fn summed(points: &[Point], measured: &BTreeMap<u32, Measured<'_>>) -> Vec<(&'static str, f64)> {
    SUMMED
        .iter()
        .filter_map(|&role| {
            let values: Option<Vec<f64>> = points
                .iter()
                .filter(|p| role_of(p) == Some(role))
                .map(|p| measured.get(&p.id).map(|m| m.value))
                .collect();
            let values = values.filter(|v| !v.is_empty())?;
            Some((role, values.iter().sum()))
        })
        .collect()
}

/// The power `id`'s subtree draws as its parent sees it: its own reading, or while it is
/// unmeasured, that of its nearest measured descendants.
fn reach(
    id: u32,
    measured: &BTreeMap<u32, Measured<'_>>,
    children: &BTreeMap<u32, Vec<u32>>,
) -> f64 {
    measured.get(&id).map_or_else(
        || {
            children
                .get(&id)
                .into_iter()
                .flatten()
                .map(|&child| reach(child, measured, children))
                .sum()
        },
        |m| inflow(m.role, m.value),
    )
}

fn role_of(point: &Point) -> Option<&str> {
    point.claims.first().map(|c| c.role.as_str())
}

/// The plant's state of charge, weighted by capacity, and its capacity. One battery needs no
/// weight; several without every capacity give none.
fn charge(
    batteries: &[u32],
    value: &impl Fn(u32, &str) -> Option<f64>,
) -> Vec<(&'static str, f64)> {
    let readings: Vec<(Option<f64>, Option<f64>)> = batteries
        .iter()
        .map(|&d| (value(d, "battery.soc"), value(d, "battery.capacity")))
        .collect();
    if let [(soc, capacity)] = readings[..] {
        return [("battery.soc", soc), ("battery.capacity", capacity)]
            .into_iter()
            .filter_map(|(role, value)| Some((role, value?)))
            .collect();
    }
    let both: Option<Vec<(f64, f64)>> = readings.iter().map(|&(s, c)| s.zip(c)).collect();
    let Some(both) = both else {
        return Vec::new();
    };
    let capacity: f64 = both.iter().map(|(_, c)| c).sum();
    if capacity <= 0.0 {
        return Vec::new();
    }
    let stored: f64 = both.iter().map(|(s, c)| s * c).sum();
    vec![
        ("battery.soc", stored / capacity),
        ("battery.capacity", capacity),
    ]
}

#[cfg(test)]
mod tests;
