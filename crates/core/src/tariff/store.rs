//! The tariff's SQL, on the storage thread's connection.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, params};

use super::routes::Tariff;
use super::{Band, Days, Schedule, Version};
use crate::changes::{self, Action, Entry, Subject};

/// Who changes the tariff: the one admin (ADR 9).
const ACTOR: &str = "admin";
const FLOWS: [&str; 2] = ["import", "export"];

fn time(seconds: i64) -> SystemTime {
    UNIX_EPOCH + Duration::from_secs(u64::try_from(seconds).unwrap_or(0))
}

/// Appends a version and its change log entry; returns it as stored, to the second.
pub fn insert(db: &Connection, version: Version, changed: SystemTime) -> rusqlite::Result<Version> {
    let tx = db.unchecked_transaction()?;
    let version = Version {
        applies_from: time(changes::seconds(version.applies_from)),
        ..version
    };
    tx.execute(
        "INSERT INTO tariff (applies_from, import_price, export_price) VALUES (?1, ?2, ?3)",
        params![
            changes::seconds(version.applies_from),
            version.import.price,
            version.export.price
        ],
    )?;
    let tariff = tx.last_insert_rowid();
    for (flow, schedule) in FLOWS.into_iter().zip([&version.import, &version.export]) {
        for (position, band) in (0_i64..).zip(&schedule.bands) {
            tx.execute(
                "INSERT INTO tariff_band (tariff, flow, position, days, start, end, price)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    tariff,
                    flow,
                    position,
                    band.days.0,
                    band.from,
                    band.to,
                    band.price
                ],
            )?;
        }
    }
    let entry = Entry {
        subject: Subject::Tariff,
        id: u32::try_from(tariff).unwrap_or(u32::MAX),
        action: Action::Change,
        state: serde_json::to_value(Tariff::from(&version)).ok(),
        actor: ACTOR,
        changed,
        applies_from: version.applies_from,
    };
    changes::append(&tx, &entry)?;
    tx.commit()?;
    Ok(version)
}

/// Every version, by the instant it applies from, ties to the later.
pub fn versions(db: &Connection) -> rusqlite::Result<Vec<Version>> {
    let mut bands = db.prepare(
        "SELECT days, start, end, price FROM tariff_band WHERE tariff = ?1 AND flow = ?2
         ORDER BY position",
    )?;
    let tariffs: Vec<(i64, i64, f64, f64)> = db
        .prepare(
            "SELECT id, applies_from, import_price, export_price FROM tariff
             ORDER BY applies_from, id",
        )?
        .query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })?
        .collect::<rusqlite::Result<_>>()?;
    tariffs
        .into_iter()
        .map(|(tariff, applies_from, import, export)| {
            let mut schedule = |flow: &str, price: f64| -> rusqlite::Result<Schedule> {
                let bands = bands
                    .query_map(params![tariff, flow], |row| {
                        Ok(Band {
                            days: Days(row.get(0)?),
                            from: row.get(1)?,
                            to: row.get(2)?,
                            price: row.get(3)?,
                        })
                    })?
                    .collect::<rusqlite::Result<_>>()?;
                Ok(Schedule { price, bands })
            };
            Ok(Version {
                applies_from: time(applies_from),
                import: schedule("import", import)?,
                export: schedule("export", export)?,
            })
        })
        .collect()
}
