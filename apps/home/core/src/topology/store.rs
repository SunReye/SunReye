//! The topology's SQL, on the storage thread's connection.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, OptionalExtension, params};

use super::routes::Topology;
use super::{Claim, Point, PointDraft, Refusal, Version};
use crate::changes::{self, Action, Entry, Subject};

/// Who changes the topology: the one admin (ADR 9).
const ACTOR: &str = "admin";

fn time(seconds: i64) -> SystemTime {
    UNIX_EPOCH + Duration::from_secs(u64::try_from(seconds).unwrap_or(0))
}

/// Appends a version and its change log entry, issuing ids to new points; refuses an unknown or
/// repeated id.
pub fn insert(
    db: &Connection,
    applies_from: SystemTime,
    drafts: Vec<PointDraft>,
    changed: SystemTime,
) -> rusqlite::Result<Result<Version, Refusal>> {
    let tx = db.unchecked_transaction()?;
    let mut ids: Vec<u32> = Vec::with_capacity(drafts.len());
    for draft in &drafts {
        match point_id(&tx, draft.id, &ids)? {
            Ok(id) => ids.push(id),
            Err(refusal) => return Ok(Err(refusal)),
        }
    }
    let points: Vec<Point> = drafts
        .into_iter()
        .zip(&ids)
        .map(|(draft, &id)| Point {
            id,
            name: draft.name,
            parent: draft.parent.and_then(|index| ids.get(index).copied()),
            claims: draft.claims,
        })
        .collect();
    let applies_from = time(changes::seconds(applies_from));
    tx.execute(
        "INSERT INTO topology (applies_from) VALUES (?1)",
        [changes::seconds(applies_from)],
    )?;
    let topology = tx.last_insert_rowid();
    for (position, point) in (0_i64..).zip(&points) {
        insert_point(&tx, topology, position, point)?;
    }
    let version = Version {
        applies_from,
        points,
    };
    let entry = Entry {
        subject: Subject::Topology,
        id: u32::try_from(topology).unwrap_or(u32::MAX),
        action: Action::Change,
        state: serde_json::to_value(Topology::from(&version)).ok(),
        actor: ACTOR,
        changed,
        applies_from,
    };
    changes::append(&tx, &entry)?;
    tx.commit()?;
    Ok(Ok(version))
}

/// A kept point's id, once per version, or a fresh one.
fn point_id(
    db: &Connection,
    kept: Option<u32>,
    ids: &[u32],
) -> rusqlite::Result<Result<u32, Refusal>> {
    let Some(id) = kept else {
        db.execute("INSERT INTO point DEFAULT VALUES", [])?;
        return Ok(Ok(u32::try_from(db.last_insert_rowid()).unwrap_or(u32::MAX)));
    };
    if ids.contains(&id) {
        return Ok(Err(Refusal::Point));
    }
    let known = db
        .query_row("SELECT 1 FROM point WHERE id = ?1", [id], |_| Ok(()))
        .optional()?;
    Ok(known.map(|()| id).ok_or(Refusal::Point))
}

fn insert_point(
    db: &Connection,
    topology: i64,
    position: i64,
    point: &Point,
) -> rusqlite::Result<()> {
    db.execute(
        "INSERT INTO topology_point (topology, point, position, name, parent)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![topology, point.id, position, point.name, point.parent],
    )?;
    for (position, claim) in (0_i64..).zip(&point.claims) {
        db.execute(
            "INSERT INTO topology_claim (topology, point, position, device, role)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![topology, point.id, position, claim.device, claim.role],
        )?;
    }
    Ok(())
}

/// Every version, by the instant it applies from, ties to the later.
pub fn versions(db: &Connection) -> rusqlite::Result<Vec<Version>> {
    let mut points = db.prepare(
        "SELECT point, name, parent FROM topology_point WHERE topology = ?1 ORDER BY position",
    )?;
    let mut claims = db.prepare(
        "SELECT device, role FROM topology_claim WHERE topology = ?1 AND point = ?2
         ORDER BY position",
    )?;
    let topologies: Vec<(i64, i64)> = db
        .prepare("SELECT id, applies_from FROM topology ORDER BY applies_from, id")?
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    topologies
        .into_iter()
        .map(|(topology, applies_from)| {
            let rows: Vec<(u32, String, Option<u32>)> = points
                .query_map([topology], |row| {
                    Ok((row.get(0)?, row.get(1)?, row.get(2)?))
                })?
                .collect::<rusqlite::Result<_>>()?;
            let points = rows
                .into_iter()
                .map(|(id, name, parent)| {
                    let claims = claims
                        .query_map(params![topology, id], |row| {
                            Ok(Claim {
                                device: row.get(0)?,
                                role: row.get(1)?,
                            })
                        })?
                        .collect::<rusqlite::Result<_>>()?;
                    Ok(Point {
                        id,
                        name,
                        parent,
                        claims,
                    })
                })
                .collect::<rusqlite::Result<_>>()?;
            Ok(Version {
                applies_from: time(applies_from),
                points,
            })
        })
        .collect()
}
