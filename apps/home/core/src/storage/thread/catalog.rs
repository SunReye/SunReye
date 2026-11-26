//! The series catalog's read (ADR 22): each stored series with its bounds.

use rusqlite::{Connection, OptionalExtension, params};
use sunreye_profile::RoleKind;

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
            let kind = kind.as_deref().map_or_else(|| named_kind(&name), kind_of);
            stored.push(Catalogued {
                device: DeviceId(device),
                series: name,
                kind,
                unit,
                first: time(first),
                last: time(last),
            });
        }
    }
    Ok(stored)
}

/// A named role's kind, for a series declared before kinds were stored (migration 0028); none for
/// an extra, which declares its own (ADR 4).
fn named_kind(series: &str) -> Option<RoleKind> {
    let role = series.split_once('[').map_or(series, |(role, _)| role);
    (!role.starts_with("extra.")).then(|| sunreye_profile::role_kind(role))
}

pub(super) fn kind_of(name: &str) -> Option<RoleKind> {
    match name {
        "measurement" => Some(RoleKind::Measurement),
        "counter" => Some(RoleKind::Counter),
        "status" => Some(RoleKind::Status),
        "held" => Some(RoleKind::Held),
        _ => None,
    }
}

/// The first and last instant stored, of a change point, a gap's included, or a rollup's start.
/// A rollup's start leads only when the window closes before any finer history, such as an
/// imported one (ADR 18): inside its window, the start precedes the first reading. Each probe
/// seeks the table's key, so the read never scans history.
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
    let points = [earliest.first().map(|p| p.time), hot("ASC")?];
    let first = points.into_iter().flatten().min();
    let first = before(hour("ASC")?.map(|h| (h * HOUR, h * HOUR + HOUR)), first);
    let day = first_day(db, key)?;
    let first = before(day, first);
    let last = [
        latest.last().map(|p| p.time),
        hot("DESC")?,
        hour("DESC")?.map(|h| h * HOUR),
        edge(db, ["start", "rollup_day", "day"], "DESC", key)?,
    ]
    .into_iter()
    .flatten()
    .max();
    Ok(first.zip(last))
}

/// The start of `window` when it closes by `first` or nothing finer is stored, else `first`.
const fn before(window: Option<(Tick, Tick)>, first: Option<Tick>) -> Option<Tick> {
    match (window, first) {
        (Some((start, end)), Some(first)) if end <= first => Some(start),
        (Some((start, _)), None) => Some(start),
        (_, first) => first,
    }
}

/// The first rolled-up day's window.
fn first_day(db: &Connection, (device, series): (u32, i64)) -> Result<Option<(Tick, Tick)>, Error> {
    Ok(db
        .prepare_cached(
            "SELECT start, end FROM rollup_day WHERE device = ?1 AND series = ?2
             ORDER BY day LIMIT 1",
        )?
        .query_row(params![device, series], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .optional()?)
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
