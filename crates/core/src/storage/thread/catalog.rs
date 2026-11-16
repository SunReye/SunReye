//! The series catalog's read (ADR 22): each stored series with its bounds.

use rusqlite::{Connection, OptionalExtension, params};
use sunreye_profile::{RoleKind, Unit};

use super::{HOUR, Tick, block_before, decode_blocks, time};
use crate::bus::DeviceId;
use crate::storage::{Catalogued, Error};

/// Every series with a stored change point or rollup, by device, then name. A forecast is not
/// history and is left out.
pub fn catalog(db: &Connection) -> Result<Vec<Catalogued>, Error> {
    let described = db
        .prepare(
            "SELECT step.device, step.series, series.name, step.kind, step.unit
             FROM step JOIN series ON series.id = step.series
             ORDER BY step.device, series.name",
        )?
        .query_map([], |row| {
            Ok((
                row.get::<_, u32>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut stored = Vec::new();
    for (device, series, name, kind, unit) in described {
        if let Some((first, last)) = bounds(db, device, series)? {
            stored.push(Catalogued {
                device: DeviceId(device),
                series: name,
                kind: kind.as_deref().and_then(kind_of),
                unit: unit.and_then(|u| serde_json::from_value(u.into()).ok()),
                first: time(first),
                last: time(last),
            });
        }
    }
    Ok(stored)
}

/// A unit as the `step` table spells it: its symbol.
pub fn unit_name(unit: Unit) -> String {
    serde_json::to_value(unit)
        .ok()
        .and_then(|v| v.as_str().map(str::to_owned))
        .unwrap_or_default()
}

fn kind_of(name: &str) -> Option<RoleKind> {
    match name {
        "measurement" => Some(RoleKind::Measurement),
        "counter" => Some(RoleKind::Counter),
        "status" => Some(RoleKind::Status),
        "held" => Some(RoleKind::Held),
        _ => None,
    }
}

/// The first and last instant stored, of a change point, a gap's included, or a rollup's start.
/// A day's start leads only a day before any finer history, such as an imported one (ADR 18):
/// within a day, its start precedes the first reading. Each probe seeks the table's key, so the
/// read never scans history.
fn bounds(db: &Connection, device: u32, series: i64) -> Result<Option<(Tick, Tick)>, Error> {
    let earliest = decode_blocks(
        db,
        "SELECT hour, data FROM block WHERE device = ?1 AND series = ?2 ORDER BY hour LIMIT 1",
        params![device, series],
    )?;
    let latest = block_before(db, device, series, Tick::MAX)?;
    let key = (device, series);
    let hot = |order| edge(db, ["time", "hot", "time"], order, key);
    let hour = |order| edge(db, ["hour", "rollup_hour", "hour"], order, key);
    let first = [
        earliest.first().map(|p| p.time),
        hot("ASC")?,
        hour("ASC")?.map(|h| h * HOUR),
    ]
    .into_iter()
    .flatten()
    .min();
    let last = [
        latest.last().map(|p| p.time),
        hot("DESC")?,
        hour("DESC")?.map(|h| h * HOUR),
        edge(db, ["start", "rollup_day", "day"], "DESC", key)?,
    ]
    .into_iter()
    .flatten()
    .max();
    let day: Option<(Tick, Tick)> = db
        .prepare_cached(
            "SELECT start, end FROM rollup_day WHERE device = ?1 AND series = ?2
             ORDER BY day LIMIT 1",
        )?
        .query_row(params![device, series], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .optional()?;
    let first = match (day, first) {
        (Some((start, end)), Some(first)) if end <= first => Some(start),
        (Some((start, _)), None) => Some(start),
        (_, first) => first,
    };
    Ok(first.zip(last))
}

/// `column` of the first or last row of a series in `table`, ordered by `key`.
fn edge(
    db: &Connection,
    [column, table, key]: [&str; 3],
    order: &str,
    (device, series): (u32, i64),
) -> Result<Option<Tick>, Error> {
    let sql = format!(
        "SELECT {column} FROM {table} WHERE device = ?1 AND series = ?2
         ORDER BY {key} {order} LIMIT 1"
    );
    Ok(db
        .prepare_cached(&sql)?
        .query_row(params![device, series], |row| row.get(0))
        .optional()?)
}
