//! The forecast table (ADR 15): one row per device, series, target and issue.

use rusqlite::{Connection, Transaction, params};

use super::encode::Tick;

/// An hour in ticks.
const HOUR: Tick = 36_000;

/// Writes one issue's points as `(target, value)` from the start of the issue's hour, so its
/// hour is whole, then keeps only the latest issue of each target hour that has passed.
pub fn write(
    tx: &Transaction<'_>,
    device: u32,
    series: i64,
    issued: Tick,
    points: impl Iterator<Item = (Tick, i64)>,
) -> rusqlite::Result<()> {
    let mut insert = tx.prepare_cached(
        "INSERT INTO forecast (device, series, target, issued, value) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT DO UPDATE SET value = excluded.value",
    )?;
    let hour = issued - issued.rem_euclid(HOUR);
    for (target, value) in points.filter(|(target, _)| *target >= hour) {
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
