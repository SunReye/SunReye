//! The write log (ADR 7): every write attempt, refused or not, appended and never rolled up.
//! The settings module owns the `write_log` table.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use utoipa::ToSchema;

use super::{Applied, Outcome};
use crate::changes::{rfc3339, seconds};

/// One attempt.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    /// RFC 3339, UTC.
    pub time: String,
    pub device: u32,
    pub setting: String,
    /// The value read before writing; `null` when it could not be read or the setting is
    /// write-only.
    pub before: Option<f64>,
    pub requested: f64,
    /// The value read back; `null` when nothing was written or it could not be read.
    pub after: Option<f64>,
    pub outcome: Outcome,
    /// The recipe step that failed, counted from 1.
    pub failed_step: Option<u32>,
    /// `admin`, or a named controller.
    pub actor: String,
    /// The trusted device key a remote write came through (ADR 16); `null` for a write made at
    /// home.
    pub via: Option<String>,
    /// The code an attempt was refused with before the device; `null` unless `refused`.
    pub refusal: Option<String>,
}

/// An attempt as the funnel records it.
pub struct Attempt<'a> {
    pub time: SystemTime,
    pub device: u32,
    pub setting: &'a str,
    pub requested: f64,
    pub applied: Applied,
    pub actor: &'a str,
    pub via: Option<&'a str>,
    /// The code it was refused with; set only for a `refused` outcome.
    pub refusal: Option<&'a str>,
}

/// Appends `attempt` and returns its entry.
///
/// # Errors
/// The file cannot be written.
pub fn append(db: &Connection, attempt: &Attempt<'_>) -> rusqlite::Result<Entry> {
    let applied = attempt.applied;
    let outcome = name(applied.outcome);
    db.execute(
        "INSERT INTO write_log
         (time, device, setting, before, requested, after, outcome, failed_step, actor, via, refusal)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            seconds(attempt.time),
            attempt.device,
            attempt.setting,
            applied.before,
            attempt.requested,
            applied.after,
            outcome,
            applied.failed_step,
            attempt.actor,
            attempt.via,
            attempt.refusal,
        ],
    )?;
    Ok(Entry {
        time: rfc3339(seconds(attempt.time)),
        device: attempt.device,
        setting: attempt.setting.to_owned(),
        before: applied.before,
        requested: attempt.requested,
        after: applied.after,
        outcome: applied.outcome,
        failed_step: applied.failed_step,
        actor: attempt.actor.to_owned(),
        via: attempt.via.map(str::to_owned),
        refusal: attempt.refusal.map(str::to_owned),
    })
}

/// The last attempt at `setting` on `device` that may have written: every outcome but
/// `unchanged` and `refused`.
///
/// # Errors
/// The file cannot be read.
pub fn last_write(
    db: &Connection,
    device: u32,
    setting: &str,
) -> rusqlite::Result<Option<SystemTime>> {
    let last: Option<i64> = db
        .query_row(
            "SELECT max(time) FROM write_log
             WHERE device = ?1 AND setting = ?2 AND outcome NOT IN ('unchanged', 'refused')",
            params![device, setting],
            |row| row.get(0),
        )
        .optional()?
        .flatten();
    Ok(last.map(|s| UNIX_EPOCH + Duration::from_secs(u64::try_from(s).unwrap_or(0))))
}

/// Every attempt, oldest first.
///
/// # Errors
/// The file cannot be read.
pub fn entries(db: &Connection) -> rusqlite::Result<Vec<Entry>> {
    db.prepare(
        "SELECT time, device, setting, before, requested, after, outcome, failed_step, actor, via,
         refusal FROM write_log ORDER BY id",
    )?
    .query_map([], |row| {
        Ok(Entry {
            time: rfc3339(row.get(0)?),
            device: row.get(1)?,
            setting: row.get(2)?,
            before: row.get(3)?,
            requested: row.get(4)?,
            after: row.get(5)?,
            outcome: outcome(&row.get::<_, String>(6)?)?,
            failed_step: row.get(7)?,
            actor: row.get(8)?,
            via: row.get(9)?,
            refusal: row.get(10)?,
        })
    })?
    .collect()
}

const fn name(outcome: Outcome) -> &'static str {
    match outcome {
        Outcome::Verified => "verified",
        Outcome::Mismatch => "mismatch",
        Outcome::Unknown => "unknown",
        Outcome::Partial => "partial",
        Outcome::Unchanged => "unchanged",
        Outcome::Refused => "refused",
    }
}

fn outcome(name: &str) -> rusqlite::Result<Outcome> {
    Ok(match name {
        "verified" => Outcome::Verified,
        "mismatch" => Outcome::Mismatch,
        "unknown" => Outcome::Unknown,
        "partial" => Outcome::Partial,
        "unchanged" => Outcome::Unchanged,
        "refused" => Outcome::Refused,
        _ => return Err(rusqlite::Error::InvalidQuery),
    })
}

#[cfg(test)]
mod tests;
