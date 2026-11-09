//! The values snapshot toggles (ADR 7) stored when they engaged, one per toggle. The settings
//! module owns the `snapshot` table.

use rusqlite::{Connection, OptionalExtension, params};

/// The value toggle `setting` of `device` stored, if it is engaged.
///
/// # Errors
/// The file cannot be read.
pub fn stored(db: &Connection, device: u32, setting: &str) -> rusqlite::Result<Option<f64>> {
    db.query_row(
        "SELECT value FROM snapshot WHERE device = ?1 AND setting = ?2",
        params![device, setting],
        |row| row.get(0),
    )
    .optional()
}

/// Stores `value` for toggle `setting` of `device`.
///
/// # Errors
/// The file cannot be written.
pub fn store(db: &Connection, device: u32, setting: &str, value: f64) -> rusqlite::Result<()> {
    db.execute(
        "INSERT INTO snapshot (device, setting, value) VALUES (?1, ?2, ?3)",
        params![device, setting, value],
    )
    .map(drop)
}

/// Forgets the value toggle `setting` of `device` stored.
///
/// # Errors
/// The file cannot be written.
pub fn clear(db: &Connection, device: u32, setting: &str) -> rusqlite::Result<()> {
    db.execute(
        "DELETE FROM snapshot WHERE device = ?1 AND setting = ?2",
        params![device, setting],
    )
    .map(drop)
}
