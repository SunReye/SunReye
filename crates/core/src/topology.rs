//! Plant topology (ADR 14): a tree of measurement points, rooted at the grid connection.

use std::collections::BTreeMap;

/// A device measuring a point, by the power role it measures there.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Claim {
    pub device: u32,
    pub role: String,
}

/// A measurement point.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Point {
    pub id: u32,
    pub name: String,
    /// `None` for the root.
    pub parent: Option<u32>,
    pub claims: Vec<Claim>,
}

impl Point {
    #[must_use]
    pub const fn contested(&self) -> bool {
        self.claims.len() > 1
    }
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
