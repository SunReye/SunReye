//! The devices module's SQL on its own tables. A change and its change log entry commit together.

use std::time::SystemTime;

use rusqlite::{Connection as Db, OptionalExtension, params};

use super::{
    Connection, ConnectionDraft, Device, DeviceDraft, Polled, Reach, Refusal, Transport, entry,
};
use crate::changes::{self, Action, Subject};
use crate::transport::Endpoint;

type Outcome<T> = rusqlite::Result<Result<T, Refusal>>;

fn transport(name: &str) -> rusqlite::Result<Transport> {
    match name {
        "modbus-tcp" => Ok(Transport::ModbusTcp),
        _ => Err(rusqlite::Error::InvalidQuery),
    }
}

const fn transport_name(transport: Transport) -> &'static str {
    match transport {
        Transport::ModbusTcp => "modbus-tcp",
    }
}

fn id(db: &Db) -> u32 {
    u32::try_from(db.last_insert_rowid()).unwrap_or(u32::MAX)
}

pub fn connections(db: &Db) -> rusqlite::Result<Vec<Connection>> {
    let ids: Vec<u32> = db
        .prepare("SELECT id FROM connection ORDER BY id")?
        .query_map([], |row| row.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    ids.into_iter()
        .filter_map(|id| connection(db, id).transpose())
        .collect()
}

fn connection(db: &Db, id: u32) -> rusqlite::Result<Option<Connection>> {
    let Some(reach) = db
        .query_row(
            "SELECT name, transport, host, port FROM connection WHERE id = ?1",
            [id],
            |row| {
                Ok(Reach {
                    name: row.get(0)?,
                    transport: transport(&row.get::<_, String>(1)?)?,
                    host: row.get(2)?,
                    port: row.get(3)?,
                })
            },
        )
        .optional()?
    else {
        return Ok(None);
    };
    let secrets = db
        .prepare("SELECT name FROM secret WHERE connection = ?1 ORDER BY name")?
        .query_map([id], |row| row.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(Some(Connection { id, reach, secrets }))
}

/// Applies a draft's secret changes to connection `id`.
fn write_secrets(db: &Db, id: u32, draft: &ConnectionDraft) -> rusqlite::Result<()> {
    for (name, value) in &draft.secrets {
        match value {
            Some(value) => db.execute(
                "INSERT INTO secret (connection, name, value) VALUES (?1, ?2, ?3)
                 ON CONFLICT (connection, name) DO UPDATE SET value = excluded.value",
                params![id, name, value],
            )?,
            None => db.execute(
                "DELETE FROM secret WHERE connection = ?1 AND name = ?2",
                params![id, name],
            )?,
        };
    }
    Ok(())
}

/// Reads back `id` after a change and logs it.
fn log_connection(db: &Db, id: u32, action: Action, changed: SystemTime) -> Outcome<Connection> {
    let Some(stored) = connection(db, id)? else {
        return Ok(Err(Refusal::NoConnection));
    };
    let entry = entry(Subject::Connection, id, action, Some(&stored), changed);
    changes::append(db, &entry)?;
    Ok(Ok(stored))
}

pub fn add_connection(
    db: &Db,
    draft: &ConnectionDraft,
    changed: SystemTime,
) -> Outcome<Connection> {
    let tx = db.unchecked_transaction()?;
    let r = &draft.reach;
    tx.execute(
        "INSERT INTO connection (name, transport, host, port) VALUES (?1, ?2, ?3, ?4)",
        params![r.name, transport_name(r.transport), r.host, r.port],
    )?;
    let id = id(&tx);
    write_secrets(&tx, id, draft)?;
    let added = log_connection(&tx, id, Action::Add, changed)?;
    tx.commit()?;
    Ok(added)
}

pub fn change_connection(
    db: &Db,
    id: u32,
    draft: &ConnectionDraft,
    changed: SystemTime,
) -> Outcome<Connection> {
    let tx = db.unchecked_transaction()?;
    if connection(&tx, id)?.is_none() {
        return Ok(Err(Refusal::NoConnection));
    }
    let r = &draft.reach;
    let taken = units_at(&tx, r.transport, &r.host, r.port, |c, _| c != id)?;
    if units_of(&tx, id)?.iter().any(|u| taken.contains(u)) {
        return Ok(Err(Refusal::Address));
    }
    tx.execute(
        "UPDATE connection SET name = ?2, transport = ?3, host = ?4, port = ?5 WHERE id = ?1",
        params![id, r.name, transport_name(r.transport), r.host, r.port],
    )?;
    write_secrets(&tx, id, draft)?;
    let changed = log_connection(&tx, id, Action::Change, changed)?;
    tx.commit()?;
    Ok(changed)
}

pub fn remove_connection(db: &Db, id: u32, changed: SystemTime) -> Outcome<()> {
    let tx = db.unchecked_transaction()?;
    if connection(&tx, id)?.is_none() {
        return Ok(Err(Refusal::NoConnection));
    }
    if !units_of(&tx, id)?.is_empty() {
        return Ok(Err(Refusal::InUse));
    }
    tx.execute("DELETE FROM secret WHERE connection = ?1", [id])?;
    tx.execute("DELETE FROM connection WHERE id = ?1", [id])?;
    let entry = entry(
        Subject::Connection,
        id,
        Action::Remove,
        None::<&()>,
        changed,
    );
    changes::append(&tx, &entry)?;
    tx.commit()?;
    Ok(Ok(()))
}

/// The unit ids of the devices behind connection `id`.
fn units_of(db: &Db, id: u32) -> rusqlite::Result<Vec<u8>> {
    db.prepare("SELECT unit FROM device WHERE connection = ?1 AND unit IS NOT NULL")?
        .query_map([id], |row| row.get(0))?
        .collect()
}

/// The unit ids taken at an endpoint by devices for which `counts(connection, device)` holds.
fn units_at(
    db: &Db,
    transport: Transport,
    host: &str,
    port: u16,
    counts: impl Fn(u32, u32) -> bool,
) -> rusqlite::Result<Vec<u8>> {
    let rows: Vec<(u32, u32, u8)> = db
        .prepare(
            "SELECT c.id, d.id, d.unit FROM device d JOIN connection c ON c.id = d.connection
             WHERE c.transport = ?1 AND c.host = ?2 AND c.port = ?3 AND d.unit IS NOT NULL",
        )?
        .query_map(params![transport_name(transport), host, port], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows
        .into_iter()
        .filter(|(c, d, _)| counts(*c, *d))
        .map(|(_, _, unit)| unit)
        .collect())
}

pub fn devices(db: &Db) -> rusqlite::Result<Vec<Device>> {
    db.prepare("SELECT id, name, connection, profile, unit, writes FROM device ORDER BY id")?
        .query_map([], device_row)?
        .collect()
}

fn device_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Device> {
    Ok(Device {
        id: row.get(0)?,
        draft: DeviceDraft {
            name: row.get(1)?,
            connection: row.get(2)?,
            profile: row.get(3)?,
            unit: row.get(4)?,
            writes: row.get(5)?,
        },
    })
}

fn device(db: &Db, id: u32) -> rusqlite::Result<Option<Device>> {
    db.query_row(
        "SELECT id, name, connection, profile, unit, writes FROM device WHERE id = ?1",
        [id],
        device_row,
    )
    .optional()
}

/// Refuses an unknown connection, or a unit id another device has at the same endpoint.
fn check_device(db: &Db, id: Option<u32>, draft: &DeviceDraft) -> Outcome<()> {
    let Some(connection) = connection(db, draft.connection)? else {
        return Ok(Err(Refusal::DeviceConnection));
    };
    let r = &connection.reach;
    let units = units_at(db, r.transport, &r.host, r.port, |_, d| Some(d) != id)?;
    if units.contains(&draft.unit) {
        return Ok(Err(Refusal::Address));
    }
    Ok(Ok(()))
}

fn log_device(
    db: &Db,
    device: &Device,
    action: Action,
    changed: SystemTime,
) -> rusqlite::Result<()> {
    let entry = entry(Subject::Device, device.id, action, Some(device), changed);
    changes::append(db, &entry)
}

pub fn add_device(db: &Db, draft: DeviceDraft, changed: SystemTime) -> Outcome<Device> {
    let tx = db.unchecked_transaction()?;
    if let Err(refusal) = check_device(&tx, None, &draft)? {
        return Ok(Err(refusal));
    }
    tx.execute(
        "INSERT INTO device (name, connection, profile, unit, writes) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            draft.name,
            draft.connection,
            draft.profile,
            draft.unit,
            draft.writes
        ],
    )?;
    let device = Device { id: id(&tx), draft };
    log_device(&tx, &device, Action::Add, changed)?;
    tx.commit()?;
    Ok(Ok(device))
}

pub fn change_device(db: &Db, id: u32, draft: DeviceDraft, changed: SystemTime) -> Outcome<Device> {
    let tx = db.unchecked_transaction()?;
    let Some(stored) = device(&tx, id)? else {
        return Ok(Err(Refusal::NoDevice));
    };
    if stored.draft.profile != draft.profile {
        return Ok(Err(Refusal::ProfileChange));
    }
    if let Err(refusal) = check_device(&tx, Some(id), &draft)? {
        return Ok(Err(refusal));
    }
    tx.execute(
        "UPDATE device SET name = ?2, connection = ?3, unit = ?4, writes = ?5 WHERE id = ?1",
        params![id, draft.name, draft.connection, draft.unit, draft.writes],
    )?;
    let device = Device { id, draft };
    log_device(&tx, &device, Action::Change, changed)?;
    tx.commit()?;
    Ok(Ok(device))
}

pub fn remove_device(db: &Db, id: u32, changed: SystemTime) -> Outcome<()> {
    let tx = db.unchecked_transaction()?;
    if tx.execute("DELETE FROM device WHERE id = ?1", [id])? == 0 {
        return Ok(Err(Refusal::NoDevice));
    }
    let entry = entry(Subject::Device, id, Action::Remove, None::<&()>, changed);
    changes::append(&tx, &entry)?;
    tx.commit()?;
    Ok(Ok(()))
}

/// Every device with its connection's endpoint, by id.
pub fn polled(db: &Db) -> rusqlite::Result<Vec<Polled>> {
    db.prepare(
        "SELECT d.id, d.unit, d.profile, c.transport, c.host, c.port
         FROM device d JOIN connection c ON c.id = d.connection
         WHERE d.unit IS NOT NULL ORDER BY d.id",
    )?
    .query_map([], |row| {
        Ok(Polled {
            id: row.get(0)?,
            unit: row.get(1)?,
            profile: row.get(2)?,
            endpoint: match transport(&row.get::<_, String>(3)?)? {
                Transport::ModbusTcp => Endpoint::ModbusTcp {
                    host: row.get(4)?,
                    port: row.get(5)?,
                },
            },
        })
    })?
    .collect()
}
