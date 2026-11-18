//! The forecast table (ADR 15): one row per device, series, target and issue.

use rusqlite::{Connection, Transaction, params};

use super::Keep;
use super::encode::Tick;

/// An hour in ticks.
const HOUR: Tick = 36_000;

/// Writes one issue's points as `(target, value)` from the start of the issue's hour, so its
/// hour is whole, keeping the issues `keep` asks for.
pub fn write(
    tx: &Transaction<'_>,
    (device, series): (u32, i64),
    issued: Tick,
    points: impl Iterator<Item = (Tick, i64)>,
    keep: Keep,
) -> rusqlite::Result<()> {
    let hour = issued - issued.rem_euclid(HOUR);
    let points = points.filter(|(target, _)| *target >= hour);
    match keep {
        Keep::Every => every(tx, (device, series), (issued, hour), points),
        Keep::Latest => latest(tx, (device, series), issued, points),
    }
}

/// Adds the issue beside the earlier ones, then keeps only the latest issue of each target hour
/// that has passed.
fn every(
    tx: &Transaction<'_>,
    (device, series): (u32, i64),
    (issued, hour): (Tick, Tick),
    points: impl Iterator<Item = (Tick, i64)>,
) -> rusqlite::Result<()> {
    let mut insert = tx.prepare_cached(
        "INSERT INTO forecast (device, series, target, issued, value) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT DO UPDATE SET value = excluded.value",
    )?;
    for (target, value) in points {
        insert.execute(params![device, series, target, issued, value])?;
    }
    tx.execute(
        "DELETE FROM forecast AS old
         WHERE device = ?1 AND series = ?2 AND target < ?3
         AND issued < (
           SELECT max(issued) FROM forecast
           WHERE device = old.device AND series = old.series
           AND target >= old.target - old.target % ?4
           AND target < old.target - old.target % ?4 + ?4
         )",
        params![device, series, hour, HOUR],
    )?;
    Ok(())
}

/// Makes each point its target's only row. A changed value is updated in place and an unchanged
/// one is left alone, so a forecast that holds writes no page.
fn latest(
    tx: &Transaction<'_>,
    (device, series): (u32, i64),
    issued: Tick,
    points: impl Iterator<Item = (Tick, i64)>,
) -> rusqlite::Result<()> {
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
    for (target, value) in points {
        let row = params![device, series, target, issued, value];
        if update.execute(row)? == 0 {
            insert.execute(row)?;
        }
    }
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
