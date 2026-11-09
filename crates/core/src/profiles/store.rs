//! The profiles module's tables: added indexes, the last good copy of each fetched profile, the
//! updates waiting for the admin, the settings applied updates changed, and whether the active
//! profile key has been revoked.

use std::time::SystemTime;

use rusqlite::{Connection, OptionalExtension, params};

use crate::changes::{self, Action, Entry, Subject};

/// Who adds an index or applies an update: the one admin (ADR 9).
const ACTOR: &str = "admin";

/// A stored profile file and its signature, exactly as fetched.
pub struct Fetched {
    pub document: Vec<u8>,
    pub signature: Option<Vec<u8>>,
}

pub fn indexes(db: &Connection) -> rusqlite::Result<Vec<String>> {
    db.prepare("SELECT url FROM profile_index ORDER BY id")?
        .query_map([], |row| row.get(0))?
        .collect()
}

/// Adds `url` once, logging the change; an index already added is left as it is.
pub fn add_index(db: &Connection, url: &str, changed: SystemTime) -> rusqlite::Result<()> {
    let tx = db.unchecked_transaction()?;
    let added = tx.execute(
        "INSERT INTO profile_index (url) VALUES (?1) ON CONFLICT (url) DO NOTHING",
        [url],
    )?;
    if added > 0 {
        let entry = Entry {
            subject: Subject::Index,
            id: u32::try_from(tx.last_insert_rowid()).unwrap_or(u32::MAX),
            action: Action::Add,
            state: Some(serde_json::json!({ "url": url })),
            actor: ACTOR,
            changed,
            applies_from: changed,
        };
        changes::append(&tx, &entry)?;
    }
    tx.commit()
}

pub fn fetched(db: &Connection) -> rusqlite::Result<Vec<Fetched>> {
    db.prepare("SELECT document, signature FROM fetched_profile ORDER BY id")?
        .query_map([], |row| {
            Ok(Fetched {
                document: row.get(0)?,
                signature: row.get(1)?,
            })
        })?
        .collect()
}

/// Keeps `fetched` as the last good copy of profile `id`.
pub fn keep(db: &Connection, id: &str, fetched: &Fetched) -> rusqlite::Result<()> {
    db.execute(
        "INSERT INTO fetched_profile (id, document, signature) VALUES (?1, ?2, ?3)
         ON CONFLICT (id) DO UPDATE SET document = excluded.document,
         signature = excluded.signature",
        params![id, fetched.document, fetched.signature],
    )?;
    Ok(())
}

pub fn revoked(db: &Connection) -> rusqlite::Result<bool> {
    db.query_row("SELECT 1 FROM profile_key_revoked", [], |_| Ok(()))
        .optional()
        .map(|row| row.is_some())
}

pub fn revoke(db: &Connection) -> rusqlite::Result<()> {
    db.execute(
        "INSERT INTO profile_key_revoked (id) VALUES (0) ON CONFLICT (id) DO NOTHING",
        [],
    )?;
    Ok(())
}

/// The update waiting for profile `id`, if one is.
pub fn waiting(db: &Connection, id: &str) -> rusqlite::Result<Option<Fetched>> {
    db.query_row(
        "SELECT document, signature FROM profile_update WHERE id = ?1",
        [id],
        |row| {
            Ok(Fetched {
                document: row.get(0)?,
                signature: row.get(1)?,
            })
        },
    )
    .optional()
}

/// Every update waiting, by profile id.
pub fn updates(db: &Connection) -> rusqlite::Result<Vec<(String, Fetched)>> {
    db.prepare("SELECT id, document, signature FROM profile_update ORDER BY id")?
        .query_map([], |row| {
            let fetched = Fetched {
                document: row.get(1)?,
                signature: row.get(2)?,
            };
            Ok((row.get(0)?, fetched))
        })?
        .collect()
}

/// Keeps `fetched` as the update waiting for profile `id`, in place of an older one.
pub fn wait(db: &Connection, id: &str, fetched: &Fetched) -> rusqlite::Result<()> {
    db.execute(
        "INSERT INTO profile_update (id, document, signature) VALUES (?1, ?2, ?3)
         ON CONFLICT (id) DO UPDATE SET document = excluded.document,
         signature = excluded.signature",
        params![id, fetched.document, fetched.signature],
    )?;
    Ok(())
}

/// An update the admin applies: its copy, the settings it added or changed, and when.
pub struct Applied<'a> {
    pub id: &'a str,
    pub version: &'a str,
    pub fetched: &'a Fetched,
    pub changed: &'a [String],
    pub time: SystemTime,
}

/// Serves `applied` as the last good copy, marks the settings it changed, and logs it.
pub fn apply(db: &Connection, applied: &Applied<'_>) -> rusqlite::Result<()> {
    let tx = db.unchecked_transaction()?;
    keep(&tx, applied.id, applied.fetched)?;
    tx.execute("DELETE FROM profile_update WHERE id = ?1", [applied.id])?;
    for setting in applied.changed {
        tx.execute(
            "INSERT INTO profile_setting_changed (profile, setting) VALUES (?1, ?2)
             ON CONFLICT DO NOTHING",
            params![applied.id, setting],
        )?;
    }
    let entry = Entry {
        subject: Subject::Profile,
        id: 0,
        action: Action::Change,
        state: Some(serde_json::json!({ "id": applied.id, "version": applied.version })),
        actor: ACTOR,
        changed: applied.time,
        applies_from: applied.time,
    };
    changes::append(&tx, &entry)?;
    tx.commit()
}

/// The settings applied updates changed, as (profile, setting).
pub fn changed(db: &Connection) -> rusqlite::Result<Vec<(String, String)>> {
    db.prepare("SELECT profile, setting FROM profile_setting_changed")?
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect()
}
