//! The devices module's SQL on its own tables. A change and its change log entry commit together.

use std::time::SystemTime;

use rusqlite::{Connection as Db, OptionalExtension, params};

use super::{
    Brokering, Connection, ConnectionDraft, Device, DeviceDraft, Hosting, Polled, Publish, Reach,
    Reads, Refusal, Transport, entry,
};
use crate::changes::{self, Action, Subject};
use crate::http;
use crate::mqtt;
use crate::transport::Endpoint;

type Outcome<T> = rusqlite::Result<Result<T, Refusal>>;

fn transport(name: &str) -> rusqlite::Result<Transport> {
    match name {
        "modbus-tcp" => Ok(Transport::ModbusTcp),
        "rtu-over-tcp" => Ok(Transport::RtuOverTcp),
        "solarman-v5" => Ok(Transport::SolarmanV5),
        "mqtt" => Ok(Transport::Mqtt),
        "http" => Ok(Transport::Http),
        _ => Err(rusqlite::Error::InvalidQuery),
    }
}

const fn transport_name(transport: Transport) -> &'static str {
    match transport {
        Transport::ModbusTcp => "modbus-tcp",
        Transport::RtuOverTcp => "rtu-over-tcp",
        Transport::SolarmanV5 => "solarman-v5",
        Transport::Mqtt => "mqtt",
        Transport::Http => "http",
    }
}

fn id(db: &Db) -> u32 {
    u32::try_from(db.last_insert_rowid()).unwrap_or(u32::MAX)
}

/// A stored `publish`: NULL for none, else whether discovery is sent.
const fn publish(discovery: bool) -> Publish {
    Publish { discovery }
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
            "SELECT name, transport, host, port, topic_root, publish FROM connection WHERE id = ?1",
            [id],
            |row| {
                Ok(Reach {
                    name: row.get(0)?,
                    transport: transport(&row.get::<_, String>(1)?)?,
                    host: row.get(2)?,
                    port: row.get(3)?,
                    topic_root: row.get(4)?,
                    publish: row.get::<_, Option<bool>>(5)?.map(publish),
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
    Ok(Some(Connection {
        id,
        reach,
        secrets,
        status: None,
    }))
}

/// The value of connection `id`'s secret `name`, for the funnel alone: never returned by the API.
pub fn secret(db: &Db, id: u32, name: &str) -> rusqlite::Result<Option<String>> {
    db.query_row(
        "SELECT value FROM secret WHERE connection = ?1 AND name = ?2",
        params![id, name],
        |row| row.get(0),
    )
    .optional()
}

/// Every broker connection with its credentials, topic root and devices, by id, for its client
/// alone.
pub fn brokers(db: &Db) -> rusqlite::Result<Vec<Brokering>> {
    type Row = (u32, String, u16, Option<String>, Option<bool>);
    let rows: Vec<Row> = db
        .prepare(
            "SELECT id, host, port, topic_root, publish FROM connection
             WHERE transport = 'mqtt' ORDER BY id",
        )?
        .query_map([], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
            ))
        })?
        .collect::<rusqlite::Result<_>>()?;
    rows.into_iter()
        .map(|(id, host, port, root, discovery)| {
            let credentials = credentials(db, id)?;
            let devices = behind(db, id)?;
            Ok(Brokering {
                id,
                broker: mqtt::Broker {
                    host,
                    port,
                    credentials,
                },
                root: root.unwrap_or_default(),
                devices,
                publish: discovery.map(publish),
            })
        })
        .collect()
}

/// Every HTTP host connection with its credentials and devices, by id, for its task alone.
pub fn hosts(db: &Db) -> rusqlite::Result<Vec<Hosting>> {
    let rows: Vec<(u32, String, u16)> = db
        .prepare("SELECT id, host, port FROM connection WHERE transport = 'http' ORDER BY id")?
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
        .collect::<rusqlite::Result<_>>()?;
    rows.into_iter()
        .map(|(id, host, port)| {
            Ok(Hosting {
                host: http::Host {
                    host,
                    port,
                    credentials: credentials(db, id)?,
                },
                devices: behind(db, id)?,
            })
        })
        .collect()
}

/// Connection `id`'s `username` and `password` secrets, when a username is set.
fn credentials(db: &Db, id: u32) -> rusqlite::Result<Option<(String, String)>> {
    let username = secret(db, id, "username")?;
    let password = secret(db, id, "password")?;
    Ok(username.map(|u| (u, password.unwrap_or_default())))
}

/// Each device's id, address and profile behind connection `id`, by id.
fn behind(db: &Db, id: u32) -> rusqlite::Result<Vec<(u32, u8, String)>> {
    db.prepare(
        "SELECT id, unit, profile FROM device WHERE connection = ?1 AND unit IS NOT NULL ORDER BY id",
    )?
    .query_map([id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
    .collect()
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
        "INSERT INTO connection (name, transport, host, port, topic_root, publish)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            r.name,
            transport_name(r.transport),
            r.host,
            r.port,
            r.topic_root,
            r.publish.map(|p| p.discovery)
        ],
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
    let units = units_of(&tx, id)?;
    let was = connection(&tx, id)?.map(|c| c.reach.transport.reads());
    if Some(r.transport.reads()) != was && !units.is_empty() {
        return Ok(Err(Refusal::Transport));
    }
    let taken = units_at(&tx, r, |c, _| c != id)?;
    if units.iter().any(|u| taken.contains(u)) {
        return Ok(Err(Refusal::Address));
    }
    tx.execute(
        "UPDATE connection SET name = ?2, transport = ?3, host = ?4, port = ?5, topic_root = ?6,
         publish = ?7 WHERE id = ?1",
        params![
            id,
            r.name,
            transport_name(r.transport),
            r.host,
            r.port,
            r.topic_root,
            r.publish.map(|p| p.discovery)
        ],
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

/// The device addresses taken at an endpoint, under a broker's topic root, by devices for which
/// `counts(connection, device)` holds.
fn units_at(db: &Db, r: &Reach, counts: impl Fn(u32, u32) -> bool) -> rusqlite::Result<Vec<u8>> {
    let rows: Vec<(u32, u32, u8)> = db
        .prepare(
            "SELECT c.id, d.id, d.unit FROM device d JOIN connection c ON c.id = d.connection
             WHERE c.transport = ?1 AND c.host = ?2 AND c.port = ?3 AND c.topic_root IS ?4
             AND d.unit IS NOT NULL",
        )?
        .query_map(
            params![transport_name(r.transport), r.host, r.port, r.topic_root],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )?
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

pub fn device(db: &Db, id: u32) -> rusqlite::Result<Option<Device>> {
    db.query_row(
        "SELECT id, name, connection, profile, unit, writes FROM device WHERE id = ?1",
        [id],
        device_row,
    )
    .optional()
}

/// Refuses an unknown connection, one whose transport does not carry the binding the profile
/// `reads` through, or a device address another device has at the same endpoint.
fn check_device(db: &Db, id: Option<u32>, draft: &DeviceDraft, reads: Reads) -> Outcome<()> {
    let Some(connection) = connection(db, draft.connection)? else {
        return Ok(Err(Refusal::DeviceConnection));
    };
    let r = &connection.reach;
    if r.transport.reads() != reads {
        return Ok(Err(Refusal::Transport));
    }
    let units = units_at(db, r, |_, d| Some(d) != id)?;
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

pub fn add_device(
    db: &Db,
    draft: DeviceDraft,
    reads: Reads,
    changed: SystemTime,
) -> Outcome<Device> {
    let tx = db.unchecked_transaction()?;
    if let Err(refusal) = check_device(&tx, None, &draft, reads)? {
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

pub fn change_device(
    db: &Db,
    id: u32,
    draft: DeviceDraft,
    reads: Reads,
    changed: SystemTime,
) -> Outcome<Device> {
    let tx = db.unchecked_transaction()?;
    let Some(stored) = device(&tx, id)? else {
        return Ok(Err(Refusal::NoDevice));
    };
    if stored.draft.profile != draft.profile {
        return Ok(Err(Refusal::ProfileChange));
    }
    if let Err(refusal) = check_device(&tx, Some(id), &draft, reads)? {
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
    tx.execute("DELETE FROM deadband_override WHERE device = ?1", [id])?;
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
         WHERE d.unit IS NOT NULL AND c.transport NOT IN ('mqtt', 'http') ORDER BY d.id",
    )?
    .query_map([], |row| {
        let (host, port) = (row.get(4)?, row.get(5)?);
        Ok(Polled {
            id: row.get(0)?,
            unit: row.get(1)?,
            profile: row.get(2)?,
            endpoint: match transport(&row.get::<_, String>(3)?)? {
                Transport::ModbusTcp => Endpoint::ModbusTcp { host, port },
                Transport::RtuOverTcp => Endpoint::RtuOverTcp { host, port },
                Transport::SolarmanV5 => Endpoint::SolarmanV5 { host, port },
                Transport::Mqtt | Transport::Http => return Err(rusqlite::Error::InvalidQuery),
            },
        })
    })?
    .collect()
}
