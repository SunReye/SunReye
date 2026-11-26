//! The forecast table (ADR 15): one row per device, series, target and issue.

use std::ops::Range;

use rusqlite::{Connection, Transaction, params};

use super::Keep;
use super::encode::Tick;

/// An hour in ticks.
const HOUR: Tick = 36_000;

/// Writes one issue's points as `(target, value)` from the start of the issue's hour, each its
/// target's only row. A changed value is updated in place and an unchanged one is left alone, so
/// a forecast that holds writes no page. Under [`Keep::Ahead`] a target of the issue's own hour
/// keeps the row an earlier issue gave it.
pub fn write(
    tx: &Transaction<'_>,
    (device, series): (u32, i64),
    issued: Tick,
    points: impl Iterator<Item = (Tick, i64)>,
    keep: Keep,
) -> rusqlite::Result<()> {
    let hour = issued - issued.rem_euclid(HOUR);
    let replaced_from = match keep {
        Keep::Ahead => hour + HOUR,
        Keep::Latest => hour,
    };
    let mut update = tx.prepare_cached(
        "UPDATE OR REPLACE forecast SET issued = ?4, value = ?5
         WHERE device = ?1 AND series = ?2 AND target = ?3 AND value <> ?5",
    )?;
    let mut insert = tx.prepare_cached(
        "INSERT INTO forecast (device, series, target, issued, value)
         SELECT ?1, ?2, ?3, ?4, ?5 WHERE NOT EXISTS (
           SELECT 1 FROM forecast WHERE device = ?1 AND series = ?2 AND target = ?3
         )",
    )?;
    for (target, value) in points.filter(|(target, _)| *target >= hour) {
        let row = params![device, series, target, issued, value];
        if target < replaced_from || update.execute(row)? == 0 {
            insert.execute(row)?;
        }
    }
    Ok(())
}

/// Deletes every forecast of `device` with a target within `targets`.
pub fn delete(db: &Connection, device: u32, targets: Range<Tick>) -> rusqlite::Result<()> {
    db.prepare_cached("DELETE FROM forecast WHERE device = ?1 AND target >= ?2 AND target < ?3")?
        .execute(params![device, targets.start, targets.end])?;
    Ok(())
}

/// Every stored `(target, issued, value)` with a target from `from` to before `to`.
pub fn read(
    db: &Connection,
    device: u32,
    series: i64,
    from: Tick,
    to: Tick,
) -> rusqlite::Result<Vec<(Tick, Tick, i64)>> {
    db.prepare_cached(
        "SELECT target, issued, value FROM forecast
         WHERE device = ?1 AND series = ?2 AND target >= ?3 AND target < ?4
         ORDER BY target, issued",
    )?
    .query_map(params![device, series, from, to], |row| {
        Ok((row.get(0)?, row.get(1)?, row.get(2)?))
    })?
    .collect()
}
