//! The admin's per-setting write enables (ADR 8). The settings module owns the `setting_enable`
//! table.

use std::time::SystemTime;

use ring::digest::{SHA256, digest};
use rusqlite::{Connection, OptionalExtension, params};
use sunreye_profile::Setting;

use crate::changes::{self, Action, Entry, Subject};

/// Who enables a setting: the one admin (ADR 9).
const ACTOR: &str = "admin";

/// The declaration an enable covers. Any change to it, even a reworded build of the same
/// declaration, only switches the setting off again: never on.
#[must_use]
pub fn fingerprint(setting: &Setting) -> String {
    let hash = digest(&SHA256, format!("{setting:?}").as_bytes());
    hash.as_ref()
        .iter()
        .flat_map(|byte| [byte >> 4, byte & 0xF])
        .filter_map(|nibble| char::from_digit(u32::from(nibble), 16))
        .collect()
}

/// The fingerprint `setting` of `device` was enabled with, if it is.
///
/// # Errors
/// The file cannot be read.
pub fn stored(db: &Connection, device: u32, setting: &str) -> rusqlite::Result<Option<String>> {
    db.query_row(
        "SELECT fingerprint FROM setting_enable WHERE device = ?1 AND setting = ?2",
        params![device, setting],
        |row| row.get(0),
    )
    .optional()
}

/// Enables `setting` of `device` as declared with `fingerprint`, or disables it with `None`,
/// logging the change.
///
/// # Errors
/// The file cannot be written.
pub fn set(
    db: &Connection,
    device: u32,
    setting: &str,
    fingerprint: Option<&str>,
    changed: SystemTime,
) -> rusqlite::Result<()> {
    let tx = db.unchecked_transaction()?;
    let action = if let Some(fingerprint) = fingerprint {
        tx.execute(
            "INSERT INTO setting_enable (device, setting, fingerprint) VALUES (?1, ?2, ?3)
             ON CONFLICT (device, setting) DO UPDATE SET fingerprint = excluded.fingerprint",
            params![device, setting, fingerprint],
        )?;
        Action::Add
    } else {
        tx.execute(
            "DELETE FROM setting_enable WHERE device = ?1 AND setting = ?2",
            params![device, setting],
        )?;
        Action::Remove
    };
    let entry = Entry {
        subject: Subject::Enable,
        id: device,
        action,
        state: Some(serde_json::json!({ "setting": setting })),
        actor: ACTOR,
        changed,
        applies_from: changed,
    };
    changes::append(&tx, &entry)?;
    tx.commit()
}
