//! The SQLite store: one file under the data directory (ADR 0004), WAL mode, plain SQL through `sqlx`
//! `query!` checked against the committed `.sqlx` cache. Each query has a test below against an
//! in-memory database. SQLite stores and reads; rollups are computed by `crate::rollup`.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use sqlx::migrate::{MigrateError, Migrator};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use sqlx::{Executor, Sqlite, SqlitePool};

use tower_sessions::session_store::ExpiredDeletion;
use tower_sessions_sqlx_store::SqliteStore;

mod accounts;
mod tiers;

pub use self::accounts::{ApiKeyRow, NewApiKey, Refusal};
pub use self::tiers::BucketWindow;
use crate::modbus::{Transport, UnknownTransport};
pub use crate::samples::Sample;
use crate::samples::{ClosedMinute, SampleError, decode, encode, minute_of};

const FILE: &str = "sunreye.db";

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("database error: {0}")]
    Sqlx(#[from] sqlx::Error),
    #[error("migration failed: {0}")]
    Migrate(#[from] MigrateError),
    #[error("cannot create the data directory: {0}")]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Sample(#[from] SampleError),
    /// A stored value the schema should have made impossible.
    #[error("stored {0} is out of range")]
    Corrupt(&'static str),
    #[error(transparent)]
    Transport(#[from] UnknownTransport),
    #[error("session store: {0}")]
    Sessions(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewConnection {
    pub transport: Transport,
    pub host: String,
    pub port: u16,
    /// The stick's serial, for `solarman_v5` only; none means it is discovered on connect.
    pub logger_serial: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewDevice {
    pub connection_id: i64,
    pub profile_id: String,
    pub unit_id: u8,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConnectionRow {
    pub id: i64,
    pub transport: Transport,
    pub host: String,
    pub port: u16,
    pub logger_serial: Option<u32>,
}

/// A device with the connection it is reached through.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeviceRow {
    pub id: i64,
    pub connection_id: i64,
    pub profile_id: String,
    pub unit_id: u8,
    pub transport: Transport,
    pub host: String,
    pub port: u16,
    pub logger_serial: Option<u32>,
}

#[derive(Clone, PartialEq, Eq)]
pub struct NewAccount {
    pub email: String,
    pub name: String,
    pub password_hash: String,
}

/// Leaves the hash out of logs.
impl std::fmt::Debug for NewAccount {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("NewAccount").field("email", &self.email).finish_non_exhaustive()
    }
}

#[derive(Clone, PartialEq, Eq)]
pub struct AccountRow {
    pub id: i64,
    pub email: String,
    pub name: String,
    pub password_hash: String,
    pub admin: bool,
}

/// Leaves the hash out of logs.
impl std::fmt::Debug for AccountRow {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AccountRow").field("id", &self.id).field("email", &self.email).finish_non_exhaustive()
    }
}

/// Applies `migrator` with foreign keys off. A migration runs in a transaction, where the pragma cannot
/// change, and rebuilding a parent table with keys on cascades its delete into the children. `pool`
/// holds one connection, so the pragma set here is the one the migration runs on.
async fn migrate(pool: &SqlitePool, migrator: &Migrator) -> Result<(), StoreError> {
    sqlx::query("PRAGMA foreign_keys = OFF").execute(pool).await?;
    let migrated = migrator.run(pool).await;
    sqlx::query("PRAGMA foreign_keys = ON").execute(pool).await?;
    Ok(migrated?)
}

#[derive(Debug)]
pub struct Store {
    pool: SqlitePool,
}

impl Store {
    /// Opens `dir/sunreye.db`, creating the directory and the file, and applies pending migrations.
    pub async fn open(dir: &Path) -> Result<Self, StoreError> {
        std::fs::create_dir_all(dir)?;
        let options = SqliteConnectOptions::new()
            .filename(dir.join(FILE))
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal)
            .synchronous(SqliteSynchronous::Normal);
        Self::connect(options).await
    }

    #[cfg(test)]
    pub(crate) async fn in_memory() -> Result<Self, StoreError> {
        Self::connect(SqliteConnectOptions::new().in_memory(true)).await
    }

    /// One connection: writers never contend, and an in-memory database is not lost to a recycled one.
    async fn connect(options: SqliteConnectOptions) -> Result<Self, StoreError> {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .idle_timeout(None)
            .max_lifetime(None)
            .connect_with(options.foreign_keys(true))
            .await?;
        migrate(&pool, &sqlx::migrate!("./migrations")).await?;
        let store = Self { pool };
        store.sessions().migrate().await?;
        store.sessions().delete_expired().await.map_err(|e| StoreError::Sessions(e.to_string()))?;
        Ok(store)
    }

    /// Login sessions, in this file's `tower_sessions` table.
    pub fn sessions(&self) -> SqliteStore {
        SqliteStore::new(self.pool.clone())
    }

    /// Closes the file; the last connection checkpoints the WAL.
    pub async fn close(self) {
        self.pool.close().await;
    }

    pub async fn setting(&self, key: &str) -> Result<Option<String>, StoreError> {
        let row =
            sqlx::query!("SELECT value FROM setting WHERE key = ?", key).fetch_optional(&self.pool).await?;
        Ok(row.map(|row| row.value))
    }

    pub async fn set_setting(&self, key: &str, value: &str) -> Result<(), StoreError> {
        sqlx::query!(
            "INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
            key,
            value
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn has_accounts(&self) -> Result<bool, StoreError> {
        let row = sqlx::query!(r#"SELECT EXISTS (SELECT 1 FROM account) AS "any!: bool""#)
            .fetch_one(&self.pool)
            .await?;
        Ok(row.any)
    }

    /// Creates the admin while no account exists; `None` once one does. One statement, so two
    /// concurrent sign-ups cannot both become the first.
    pub async fn create_first_account(&self, account: &NewAccount) -> Result<Option<i64>, StoreError> {
        let row = sqlx::query!(
            r#"INSERT INTO account (email, name, password_hash, admin)
               SELECT ?, ?, ?, 1 WHERE NOT EXISTS (SELECT 1 FROM account) RETURNING id AS "id!""#,
            account.email,
            account.name,
            account.password_hash
        )
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(|row| row.id))
    }

    pub async fn account(&self, id: i64) -> Result<Option<AccountRow>, StoreError> {
        let row = sqlx::query_as!(
            AccountRow,
            r#"SELECT id AS "id!", email, name, password_hash, admin AS "admin: bool" FROM account WHERE id = ?"#,
            id
        )
        .fetch_optional(&self.pool)
        .await?;
        Ok(row)
    }

    /// Emails compare without case.
    pub async fn account_by_email(&self, email: &str) -> Result<Option<AccountRow>, StoreError> {
        let row = sqlx::query_as!(
            AccountRow,
            r#"SELECT id AS "id!", email, name, password_hash, admin AS "admin: bool" FROM account WHERE email = ?"#,
            email
        )
        .fetch_optional(&self.pool)
        .await?;
        Ok(row)
    }

    pub async fn add_connection(&self, connection: &NewConnection) -> Result<i64, StoreError> {
        let transport = connection.transport.as_str();
        let row = sqlx::query!(
            r#"INSERT INTO connection (transport, host, port, logger_serial) VALUES (?, ?, ?, ?) RETURNING id AS "id!""#,
            transport,
            connection.host,
            connection.port,
            connection.logger_serial
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(row.id)
    }

    /// The one connection of this core: the oldest row.
    pub async fn connection(&self) -> Result<Option<ConnectionRow>, StoreError> {
        let row = sqlx::query!(
            r#"SELECT id AS "id!", transport, host, port, logger_serial FROM connection ORDER BY id LIMIT 1"#
        )
        .fetch_optional(&self.pool)
        .await?;
        row.map(|row| {
            Ok(ConnectionRow {
                id: row.id,
                transport: row.transport.parse()?,
                host: row.host,
                port: u16::try_from(row.port).map_err(|_| StoreError::Corrupt("port"))?,
                logger_serial: serial(row.logger_serial)?,
            })
        })
        .transpose()
    }

    /// Edits the core's connection in place, so its device stays attached; adds it when there is none.
    pub async fn save_connection(&self, connection: &NewConnection) -> Result<i64, StoreError> {
        let Some(existing) = self.connection().await? else {
            return self.add_connection(connection).await;
        };
        let transport = connection.transport.as_str();
        sqlx::query!(
            "UPDATE connection SET transport = ?, host = ?, port = ?, logger_serial = ? WHERE id = ?",
            transport,
            connection.host,
            connection.port,
            connection.logger_serial,
            existing.id
        )
        .execute(&self.pool)
        .await?;
        Ok(existing.id)
    }

    /// Edits the device on the connection in place, so its stored readings stay its own; adds it when
    /// the connection has none.
    pub async fn save_device(&self, device: &NewDevice) -> Result<i64, StoreError> {
        let devices = self.devices().await?;
        let Some(existing) = devices.iter().find(|d| d.connection_id == device.connection_id) else {
            return self.add_device(device).await;
        };
        sqlx::query!(
            "UPDATE device SET profile_id = ?, unit_id = ? WHERE id = ?",
            device.profile_id,
            device.unit_id,
            existing.id
        )
        .execute(&self.pool)
        .await?;
        Ok(existing.id)
    }

    pub async fn add_device(&self, device: &NewDevice) -> Result<i64, StoreError> {
        let row = sqlx::query!(
            r#"INSERT INTO device (connection_id, profile_id, unit_id) VALUES (?, ?, ?) RETURNING id AS "id!""#,
            device.connection_id,
            device.profile_id,
            device.unit_id
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(row.id)
    }

    pub async fn devices(&self) -> Result<Vec<DeviceRow>, StoreError> {
        let rows = sqlx::query!(
            r#"SELECT device.id AS "id!", device.connection_id, device.profile_id, device.unit_id,
                      connection.transport, connection.host, connection.port, connection.logger_serial
               FROM device JOIN connection ON connection.id = device.connection_id
               ORDER BY device.id"#
        )
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(|row| {
                Ok(DeviceRow {
                    id: row.id,
                    connection_id: row.connection_id,
                    profile_id: row.profile_id,
                    unit_id: u8::try_from(row.unit_id).map_err(|_| StoreError::Corrupt("unit id"))?,
                    transport: row.transport.parse()?,
                    host: row.host,
                    port: u16::try_from(row.port).map_err(|_| StoreError::Corrupt("port"))?,
                    logger_serial: serial(row.logger_serial)?,
                })
            })
            .collect()
    }

    /// Adds a closed minute to the device's row for that minute, merging with samples already stored
    /// there (a restart inside the minute), and rolls it up, in one transaction. A sample at an instant
    /// already stored is dropped, so appending a minute twice counts it once.
    pub async fn append_minute(&self, device_id: i64, closed: &ClosedMinute) -> Result<(), StoreError> {
        let mut tx = self.pool.begin().await?;
        let mut ids = metric_ids(&mut *tx).await?;
        let wanted: BTreeSet<&String> =
            closed.samples.iter().flat_map(|s| s.values.iter().map(|(key, _)| key)).collect();
        let missing: Vec<&String> = wanted.into_iter().filter(|key| !ids.contains_key(*key)).collect();
        for key in missing {
            let id = intern_metric(&mut *tx, key).await?;
            ids.insert(key.clone(), id);
        }
        let keys: BTreeMap<u32, String> = ids.iter().map(|(key, id)| (*id, key.clone())).collect();
        let stored = sqlx::query!(
            "SELECT samples FROM reading_minute WHERE device_id = ? AND minute = ?",
            device_id,
            closed.minute
        )
        .fetch_optional(&mut *tx)
        .await?;
        let mut samples = match stored {
            Some(row) => decode(closed.minute, &row.samples, &keys)?,
            None => Vec::new(),
        };
        let stored_at: BTreeSet<i64> = samples.iter().map(|sample| sample.at_ms).collect();
        samples.extend(closed.samples.iter().filter(|s| !stored_at.contains(&s.at_ms)).cloned());
        samples.sort_by_key(|sample| sample.at_ms);
        let blob = encode(closed.minute, &samples, &ids)?;
        sqlx::query!(
            "INSERT INTO reading_minute (device_id, minute, samples) VALUES (?, ?, ?)
             ON CONFLICT (device_id, minute) DO UPDATE SET samples = excluded.samples",
            device_id,
            closed.minute,
            blob
        )
        .execute(&mut *tx)
        .await?;
        tiers::roll_up(&mut tx, device_id, closed.minute, &samples, &ids).await?;
        tx.commit().await?;
        Ok(())
    }

    /// The device's stored minutes that can hold a sample with `from_ms <= at_ms < to_ms`, undecoded.
    pub async fn minutes(&self, device_id: i64, from_ms: i64, to_ms: i64) -> Result<Minutes, StoreError> {
        if to_ms <= from_ms {
            return Ok(Minutes::default());
        }
        let (first, last) = (minute_of(from_ms), minute_of(to_ms - 1));
        let rows = sqlx::query!(
            "SELECT minute, samples FROM reading_minute WHERE device_id = ? AND minute BETWEEN ? AND ? ORDER BY minute",
            device_id,
            first,
            last
        )
        .fetch_all(&self.pool)
        .await?;
        let keys = metric_ids(&self.pool).await?.into_iter().map(|(key, id)| (id, key)).collect();
        Ok(Minutes { keys, rows: rows.into_iter().map(|row| (row.minute, row.samples)).collect() })
    }

    /// The device's samples with `from_ms <= at_ms < to_ms`, oldest first.
    pub async fn readings(
        &self,
        device_id: i64,
        from_ms: i64,
        to_ms: i64,
    ) -> Result<Vec<Sample>, StoreError> {
        let minutes = self.minutes(device_id, from_ms, to_ms).await?;
        Ok(minutes.samples(from_ms, to_ms).collect::<Result<_, _>>()?)
    }
}

/// Stored minute rows of one device, kept encoded: the blobs are small, the samples they hold are not.
#[derive(Debug, Default)]
pub struct Minutes {
    keys: BTreeMap<u32, String>,
    /// Minute and blob, oldest first.
    rows: Vec<(i64, Vec<u8>)>,
}

impl Minutes {
    /// Samples with `from_ms <= at_ms < to_ms`, oldest first, each minute decoded when reached. A
    /// damaged minute is an `Err` item at its place.
    pub fn samples(&self, from_ms: i64, to_ms: i64) -> impl Iterator<Item = Result<Sample, SampleError>> {
        self.rows.iter().flat_map(move |(minute, blob)| match decode(*minute, blob, &self.keys) {
            Ok(samples) => samples
                .into_iter()
                .filter(|sample| (from_ms..to_ms).contains(&sample.at_ms))
                .map(Ok)
                .collect(),
            Err(error) => vec![Err(error)],
        })
    }
}

fn serial(stored: Option<i64>) -> Result<Option<u32>, StoreError> {
    stored.map(|value| u32::try_from(value).map_err(|_| StoreError::Corrupt("logger serial"))).transpose()
}

async fn metric_ids<'e, E: Executor<'e, Database = Sqlite>>(
    executor: E,
) -> Result<BTreeMap<String, u32>, StoreError> {
    let rows = sqlx::query!(r#"SELECT id AS "id!", key FROM metric"#).fetch_all(executor).await?;
    rows.into_iter()
        .map(|row| Ok((row.key, u32::try_from(row.id).map_err(|_| StoreError::Corrupt("metric id"))?)))
        .collect()
}

async fn intern_metric<'e, E: Executor<'e, Database = Sqlite>>(
    executor: E,
    key: &str,
) -> Result<u32, StoreError> {
    let row = sqlx::query!(
        r#"INSERT INTO metric (key) VALUES (?) ON CONFLICT (key) DO UPDATE SET key = excluded.key RETURNING id AS "id!""#,
        key
    )
    .fetch_one(executor)
    .await?;
    u32::try_from(row.id).map_err(|_| StoreError::Corrupt("metric id"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::samples::MINUTE_MS;

    const MINUTE: i64 = 29_000_000;

    type ConnectionRowTuple = (i64, String, String, i64, Option<i64>);

    fn sample(offset_ms: i64, values: &[(&str, f64)]) -> Sample {
        Sample {
            at_ms: MINUTE * MINUTE_MS + offset_ms,
            values: values.iter().map(|(k, v)| ((*k).to_owned(), *v)).collect(),
        }
    }

    fn closed(minute: i64, samples: Vec<Sample>) -> ClosedMinute {
        ClosedMinute { minute, samples }
    }

    async fn minute_rows(store: &Store, device: i64) -> i64 {
        let query =
            sqlx::query_scalar("SELECT count(*) FROM reading_minute WHERE device_id = ?").bind(device);
        query.fetch_one(&store.pool).await.expect("count")
    }

    async fn corrupt_minute(store: &Store, device: i64) {
        let query = sqlx::query("UPDATE reading_minute SET samples = x'09' WHERE device_id = ?").bind(device);
        query.execute(&store.pool).await.expect("corrupt");
    }

    async fn journal_mode(store: &Store) -> String {
        sqlx::query_scalar("PRAGMA journal_mode").fetch_one(&store.pool).await.expect("mode")
    }

    async fn with_device() -> (Store, i64) {
        let store = Store::in_memory().await.expect("store");
        let connection = store
            .add_connection(&NewConnection {
                transport: Transport::Tcp,
                host: "10.0.0.5".into(),
                port: 502,
                logger_serial: None,
            })
            .await
            .expect("connection");
        let device = store
            .add_device(&NewDevice {
                connection_id: connection,
                profile_id: "deye-sg01hp3".into(),
                unit_id: 1,
            })
            .await
            .expect("device");
        (store, device)
    }

    #[tokio::test]
    async fn a_setting_reads_back_what_was_set_and_a_later_set_replaces_it() {
        let store = Store::in_memory().await.expect("store");
        assert_eq!(store.setting("poll.interval_ms").await.expect("get"), None);
        store.set_setting("poll.interval_ms", "5000").await.expect("set");
        assert_eq!(store.setting("poll.interval_ms").await.expect("get").as_deref(), Some("5000"));
        store.set_setting("poll.interval_ms", "1000").await.expect("set");
        assert_eq!(store.setting("poll.interval_ms").await.expect("get").as_deref(), Some("1000"));
        assert_eq!(store.setting("other").await.expect("get"), None);
    }

    #[tokio::test]
    async fn no_connection_reads_as_none_and_a_saved_one_reads_back() {
        let store = Store::in_memory().await.expect("store");
        assert_eq!(store.connection().await.expect("connection"), None);
        let id = store
            .save_connection(&NewConnection {
                transport: Transport::Tcp,
                host: "10.0.0.5".into(),
                port: 502,
                logger_serial: None,
            })
            .await
            .expect("save");
        let row = store.connection().await.expect("connection").expect("a row");
        assert_eq!(
            (row.id, row.transport, row.host.as_str(), row.port),
            (id, Transport::Tcp, "10.0.0.5", 502)
        );
    }

    #[tokio::test]
    async fn saving_a_connection_again_edits_it_in_place() {
        let (store, device) = with_device().await;
        let first = store.connection().await.expect("connection").expect("a row").id;
        let second = NewConnection {
            transport: Transport::Tcp,
            host: "gateway".into(),
            port: 1502,
            logger_serial: None,
        };
        assert_eq!(store.save_connection(&second).await.expect("save"), first);
        let row = store.connection().await.expect("connection").expect("a row");
        assert_eq!((row.host.as_str(), row.port), ("gateway", 1502));
        let devices = store.devices().await.expect("devices");
        assert_eq!(devices.len(), 1, "the device stays on the same connection");
        assert_eq!((devices[0].id, devices[0].host.as_str()), (device, "gateway"));
    }

    #[tokio::test]
    async fn a_connection_the_schema_refuses_is_an_error() {
        let store = Store::in_memory().await.expect("store");
        let bad = NewConnection { transport: Transport::Tcp, host: "h".into(), port: 0, logger_serial: None };
        assert!(store.save_connection(&bad).await.is_err());
        assert_eq!(store.connection().await.expect("connection"), None);
    }

    #[tokio::test]
    async fn saving_a_device_edits_the_connections_device_or_adds_the_first() {
        let store = Store::in_memory().await.expect("store");
        let connection = store
            .save_connection(&NewConnection {
                transport: Transport::Tcp,
                host: "h".into(),
                port: 502,
                logger_serial: None,
            })
            .await
            .expect("connection");
        let first = NewDevice { connection_id: connection, profile_id: "deye-sg01hp3".into(), unit_id: 1 };
        let id = store.save_device(&first).await.expect("device");
        let second = NewDevice { connection_id: connection, profile_id: "deye-sg05lp3".into(), unit_id: 7 };
        assert_eq!(store.save_device(&second).await.expect("device"), id);
        let devices = store.devices().await.expect("devices");
        let seen: Vec<_> = devices.iter().map(|d| (d.id, d.profile_id.as_str(), d.unit_id)).collect();
        assert_eq!(seen, [(id, "deye-sg05lp3", 7)]);
    }

    #[tokio::test]
    async fn devices_list_with_their_connection_in_insertion_order() {
        let (store, first) = with_device().await;
        let connection = NewConnection {
            transport: Transport::Tcp,
            host: "gateway".into(),
            port: 1502,
            logger_serial: None,
        };
        let connection = store.add_connection(&connection).await.expect("connection");
        let second = NewDevice { connection_id: connection, profile_id: "deye-sg05lp3".into(), unit_id: 0 };
        let second = store.add_device(&second).await.expect("device");
        let devices = store.devices().await.expect("devices");
        let seen: Vec<_> = devices
            .iter()
            .map(|d| (d.id, d.profile_id.as_str(), d.unit_id, d.host.as_str(), d.port))
            .collect();
        assert_eq!(
            seen,
            [(first, "deye-sg01hp3", 1, "10.0.0.5", 502), (second, "deye-sg05lp3", 0, "gateway", 1502)]
        );
        assert_eq!(devices[0].transport, Transport::Tcp);
    }

    #[tokio::test]
    async fn the_schema_refuses_what_it_cannot_hold() {
        let (store, _) = with_device().await;
        let bad_port =
            NewConnection { transport: Transport::Tcp, host: "h".into(), port: 0, logger_serial: None };
        assert!(store.add_connection(&bad_port).await.is_err());
        let orphan = NewDevice { connection_id: 999, profile_id: "p".into(), unit_id: 1 };
        assert!(store.add_device(&orphan).await.is_err(), "a device needs its connection");
    }

    /// A database migrated up to `version`, holding two connections, three devices and readings for two
    /// of them; from the second schema on, also a connection of the new transport with a device.
    async fn populated_at(version: i64) -> SqlitePool {
        let options = SqliteConnectOptions::new().in_memory(true).foreign_keys(true);
        let pool = SqlitePoolOptions::new().max_connections(1).connect_with(options).await.expect("pool");
        let mut until = sqlx::migrate!("./migrations");
        until.migrations = until.migrations.iter().filter(|m| m.version <= version).cloned().collect();
        migrate(&pool, &until).await.expect("migrations");
        let mut rows = vec![
            "INSERT INTO connection (id, transport, host, port) VALUES (1, 'tcp', '10.0.0.5', 502), (2, 'tcp', 'gateway', 1502)",
            "INSERT INTO device (id, connection_id, profile_id, unit_id) VALUES (1, 1, 'deye-sg01hp3', 1), (2, 1, 'deye-sg05lp3', 2), (3, 2, 'deye-sg05lp3', 0)",
            "INSERT INTO metric (id, key) VALUES (1, 'battery.soc')",
            "INSERT INTO reading_minute (device_id, minute, samples) VALUES (1, 100, x'0a'), (3, 100, x'0b')",
        ];
        if version >= 2 {
            rows.push("INSERT INTO connection (id, transport, host, port) VALUES (3, 'rtu_over_tcp', 'serial-gw', 503)");
            rows.push("INSERT INTO device (id, connection_id, profile_id, unit_id) VALUES (4, 3, 'deye-sg05lp3', 1)");
            rows.push("INSERT INTO reading_minute (device_id, minute, samples) VALUES (4, 100, x'0c')");
        }
        for row in rows {
            sqlx::query(row).execute(&pool).await.expect("row");
        }
        pool
    }

    async fn populated_at_the_first_schema() -> SqlitePool {
        populated_at(1).await
    }

    async fn count(pool: &SqlitePool, table: &str) -> i64 {
        sqlx::query_scalar(&format!("SELECT count(*) FROM {table}")).fetch_one(pool).await.expect("count")
    }

    #[tokio::test]
    async fn the_transport_migration_keeps_every_row_of_a_populated_database() {
        let pool = populated_at_the_first_schema().await;
        migrate(&pool, &sqlx::migrate!("./migrations")).await.expect("migrate");

        let connections: Vec<(i64, String, String, i64)> =
            sqlx::query_as("SELECT id, transport, host, port FROM connection ORDER BY id")
                .fetch_all(&pool)
                .await
                .expect("connections");
        assert_eq!(
            connections,
            [(1, "tcp".into(), "10.0.0.5".into(), 502), (2, "tcp".into(), "gateway".into(), 1502)]
        );
        let devices: Vec<(i64, i64)> = sqlx::query_as("SELECT id, connection_id FROM device ORDER BY id")
            .fetch_all(&pool)
            .await
            .expect("devices");
        assert_eq!(devices, [(1, 1), (2, 1), (3, 2)]);
        assert_eq!((count(&pool, "reading_minute").await, count(&pool, "metric").await), (2, 1));
    }

    #[tokio::test]
    async fn after_the_transport_migration_rtu_over_tcp_is_accepted_and_an_unknown_value_refused() {
        let pool = populated_at_the_first_schema().await;
        migrate(&pool, &sqlx::migrate!("./migrations")).await.expect("migrate");
        let insert = |transport: &'static str| {
            let query = sqlx::query("INSERT INTO connection (transport, host, port) VALUES (?, 'h', 1)");
            query.bind(transport).execute(&pool)
        };
        assert!(insert("rtu_over_tcp").await.is_ok());
        assert!(insert("tcp").await.is_ok());
        for refused in ["carrier-pigeon", "rtu-over-tcp", "", "TCP"] {
            assert!(insert(refused).await.is_err(), "{refused:?}");
        }
    }

    #[tokio::test]
    async fn after_the_transport_migration_the_keys_still_hold_and_cascade() {
        let pool = populated_at_the_first_schema().await;
        migrate(&pool, &sqlx::migrate!("./migrations")).await.expect("migrate");

        let enforced: i64 = sqlx::query_scalar("PRAGMA foreign_keys").fetch_one(&pool).await.expect("pragma");
        assert_eq!(enforced, 1, "keys are back on after the migrations");
        let broken: Vec<(String,)> = sqlx::query_as("SELECT \"table\" FROM pragma_foreign_key_check")
            .fetch_all(&pool)
            .await
            .expect("check");
        assert_eq!(broken, []);
        let orphan = "INSERT INTO device (connection_id, profile_id, unit_id) VALUES (99, 'p', 1)";
        assert!(sqlx::query(orphan).execute(&pool).await.is_err(), "a device needs its connection");

        sqlx::query("DELETE FROM connection WHERE id = 2").execute(&pool).await.expect("delete");
        assert_eq!((count(&pool, "device").await, count(&pool, "reading_minute").await), (2, 1));
        sqlx::query("DELETE FROM connection WHERE id = 1").execute(&pool).await.expect("delete");
        assert_eq!((count(&pool, "device").await, count(&pool, "reading_minute").await), (0, 0));
    }

    #[tokio::test]
    async fn a_failing_migration_is_an_error_and_still_puts_the_keys_back_on() {
        let pool = populated_at_the_first_schema().await;
        let mut broken = sqlx::migrate!("./migrations");
        let second = broken.migrations.iter().position(|m| m.version == 2).expect("migration 2");
        broken.migrations.to_mut()[second].sql = "NOT SQL".into();
        assert!(matches!(migrate(&pool, &broken).await, Err(StoreError::Migrate(_))));

        let enforced: i64 = sqlx::query_scalar("PRAGMA foreign_keys").fetch_one(&pool).await.expect("pragma");
        assert_eq!(enforced, 1, "keys are back on after a failed migration");
        assert_eq!(count(&pool, "connection").await, 2, "nothing of the failed migration is kept");
    }

    async fn migrated_from_the_second_schema() -> SqlitePool {
        let pool = populated_at(2).await;
        migrate(&pool, &sqlx::migrate!("./migrations")).await.expect("migrate");
        pool
    }

    #[tokio::test]
    async fn the_solarman_migration_keeps_every_row_of_a_populated_database() {
        let pool = migrated_from_the_second_schema().await;

        let connections: Vec<ConnectionRowTuple> =
            sqlx::query_as("SELECT id, transport, host, port, logger_serial FROM connection ORDER BY id")
                .fetch_all(&pool)
                .await
                .expect("connections");
        assert_eq!(
            connections,
            [
                (1, "tcp".into(), "10.0.0.5".into(), 502, None),
                (2, "tcp".into(), "gateway".into(), 1502, None),
                (3, "rtu_over_tcp".into(), "serial-gw".into(), 503, None),
            ]
        );
        let devices: Vec<(i64, i64)> = sqlx::query_as("SELECT id, connection_id FROM device ORDER BY id")
            .fetch_all(&pool)
            .await
            .expect("devices");
        assert_eq!(devices, [(1, 1), (2, 1), (3, 2), (4, 3)]);
        assert_eq!((count(&pool, "reading_minute").await, count(&pool, "metric").await), (3, 1));
    }

    #[tokio::test]
    async fn after_the_solarman_migration_solarman_v5_is_accepted_with_a_logger_serial_or_without_one() {
        let pool = migrated_from_the_second_schema().await;
        let insert = |transport: &'static str, serial: Option<i64>| {
            let query = sqlx::query(
                "INSERT INTO connection (transport, host, port, logger_serial) VALUES (?, 'h', 1, ?)",
            );
            query.bind(transport).bind(serial).execute(&pool)
        };
        assert!(insert("solarman_v5", Some(3_168_930_341)).await.is_ok(), "a serial above i32::MAX");
        assert!(insert("solarman_v5", None).await.is_ok(), "the stick's reply names the serial");
        assert!(insert("solarman_v5", Some(1)).await.is_ok());
        assert!(insert("solarman_v5", Some(4_294_967_295)).await.is_ok());
        assert!(insert("tcp", None).await.is_ok());
        assert!(insert("rtu_over_tcp", None).await.is_ok());
        for refused in ["solarman-v5", "solarman", "", "SOLARMAN_V5"] {
            assert!(insert(refused, None).await.is_err(), "{refused:?}");
        }
    }

    #[tokio::test]
    async fn a_logger_serial_is_a_nonzero_u32_and_belongs_to_solarman_v5_only() {
        let pool = migrated_from_the_second_schema().await;
        let insert = |transport: &'static str, serial: i64| {
            let query = sqlx::query(
                "INSERT INTO connection (transport, host, port, logger_serial) VALUES (?, 'h', 1, ?)",
            );
            query.bind(transport).bind(serial).execute(&pool)
        };
        assert!(insert("solarman_v5", 3_168_930_341).await.is_ok(), "a valid serial is the control");
        for serial in [0, -1, 4_294_967_296] {
            assert!(insert("solarman_v5", serial).await.is_err(), "{serial}");
        }
        for transport in ["tcp", "rtu_over_tcp"] {
            assert!(insert(transport, 3_168_930_341).await.is_err(), "{transport} has no logger");
        }
    }

    #[tokio::test]
    async fn after_the_solarman_migration_the_keys_still_hold_and_cascade() {
        let pool = migrated_from_the_second_schema().await;

        let enforced: i64 = sqlx::query_scalar("PRAGMA foreign_keys").fetch_one(&pool).await.expect("pragma");
        assert_eq!(enforced, 1, "keys are back on after the migrations");
        let broken: Vec<(String,)> = sqlx::query_as("SELECT \"table\" FROM pragma_foreign_key_check")
            .fetch_all(&pool)
            .await
            .expect("check");
        assert_eq!(broken, []);
        let orphan = "INSERT INTO device (connection_id, profile_id, unit_id) VALUES (99, 'p', 1)";
        assert!(sqlx::query(orphan).execute(&pool).await.is_err(), "a device needs its connection");

        sqlx::query("DELETE FROM connection WHERE id = 3").execute(&pool).await.expect("delete");
        assert_eq!((count(&pool, "device").await, count(&pool, "reading_minute").await), (3, 2));
        sqlx::query("DELETE FROM connection WHERE id = 1").execute(&pool).await.expect("delete");
        assert_eq!((count(&pool, "device").await, count(&pool, "reading_minute").await), (1, 1));
    }

    #[tokio::test]
    async fn a_failing_solarman_migration_is_an_error_keeps_every_row_and_puts_the_keys_back_on() {
        let pool = populated_at(2).await;
        let mut broken = sqlx::migrate!("./migrations");
        let third = broken.migrations.iter().position(|m| m.version == 3).expect("migration 3");
        broken.migrations.to_mut()[third].sql = "NOT SQL".into();
        assert!(matches!(migrate(&pool, &broken).await, Err(StoreError::Migrate(_))));

        let enforced: i64 = sqlx::query_scalar("PRAGMA foreign_keys").fetch_one(&pool).await.expect("pragma");
        assert_eq!(enforced, 1, "keys are back on after a failed migration");
        assert_eq!(count(&pool, "connection").await, 3, "nothing of the failed migration is kept");
        assert_eq!(count(&pool, "device").await, 4);
    }

    #[tokio::test]
    async fn a_solarman_connection_reads_back_with_its_logger_serial_and_a_later_save_replaces_it() {
        let store = Store::in_memory().await.expect("store");
        let solarman = NewConnection {
            transport: Transport::SolarmanV5,
            host: "stick".into(),
            port: 8899,
            logger_serial: Some(3_168_930_341),
        };
        let id = store.save_connection(&solarman).await.expect("save");
        let device = NewDevice { connection_id: id, profile_id: "p".into(), unit_id: 1 };
        store.add_device(&device).await.expect("device");
        let row = store.connection().await.expect("connection").expect("a row");
        assert_eq!((row.transport, row.logger_serial), (Transport::SolarmanV5, Some(3_168_930_341)));
        let devices = store.devices().await.expect("devices");
        assert_eq!(
            (devices[0].transport, devices[0].logger_serial),
            (Transport::SolarmanV5, Some(3_168_930_341))
        );

        let discovered = NewConnection { logger_serial: None, ..solarman.clone() };
        store.save_connection(&discovered).await.expect("save");
        let row = store.connection().await.expect("connection").expect("a row");
        assert_eq!((row.transport, row.logger_serial), (Transport::SolarmanV5, None));

        let tcp = NewConnection { transport: Transport::Tcp, logger_serial: None, ..solarman };
        store.save_connection(&tcp).await.expect("save");
        let row = store.connection().await.expect("connection").expect("a row");
        assert_eq!((row.transport, row.logger_serial), (Transport::Tcp, None));
    }

    #[tokio::test]
    async fn a_logger_serial_the_schema_refuses_is_an_error_and_changes_nothing() {
        let store = Store::in_memory().await.expect("store");
        let stick = |transport, logger_serial| NewConnection {
            transport,
            host: "stick".into(),
            port: 8899,
            logger_serial,
        };
        store.save_connection(&stick(Transport::SolarmanV5, Some(7))).await.expect("save");
        for refused in [stick(Transport::SolarmanV5, Some(0)), stick(Transport::Tcp, Some(7))] {
            assert!(store.save_connection(&refused).await.is_err(), "{refused:?}");
        }
        let row = store.connection().await.expect("connection").expect("a row");
        assert_eq!((row.transport, row.logger_serial), (Transport::SolarmanV5, Some(7)));
    }

    #[tokio::test]
    async fn a_stored_transport_reads_back_as_itself() {
        let store = Store::in_memory().await.expect("store");
        for transport in [Transport::Tcp, Transport::RtuOverTcp, Transport::SolarmanV5] {
            let connection = store
                .add_connection(&NewConnection { transport, host: "h".into(), port: 1, logger_serial: None })
                .await
                .expect("connection");
            let device = NewDevice { connection_id: connection, profile_id: "p".into(), unit_id: 1 };
            store.add_device(&device).await.expect("device");
        }
        let devices = store.devices().await.expect("devices");
        let seen: Vec<_> = devices.iter().map(|d| d.transport).collect();
        assert_eq!(seen, [Transport::Tcp, Transport::RtuOverTcp, Transport::SolarmanV5]);
    }

    #[tokio::test]
    async fn a_minute_reads_back_what_was_appended() {
        let (store, device) = with_device().await;
        let samples = vec![sample(0, &[("a", 1.5), ("b", -2.0)]), sample(5_000, &[("a", 1.5)])];
        store.append_minute(device, &closed(MINUTE, samples.clone())).await.expect("append");
        let back = store.readings(device, 0, i64::MAX).await.expect("readings");
        assert_eq!(back.len(), 2);
        for (got, want) in back.iter().zip(&samples) {
            assert_eq!(got.at_ms, want.at_ms);
            let mut values = got.values.clone();
            values.sort_by(|x, y| x.0.cmp(&y.0));
            assert_eq!(values, want.values);
        }
    }

    #[tokio::test]
    async fn a_second_append_to_the_same_minute_merges_in_time_order() {
        let (store, device) = with_device().await;
        store
            .append_minute(
                device,
                &closed(MINUTE, vec![sample(1_000, &[("a", 1.0)]), sample(3_000, &[("a", 3.0)])]),
            )
            .await
            .expect("first");
        store
            .append_minute(device, &closed(MINUTE, vec![sample(2_000, &[("a", 2.0), ("new", 9.0)])]))
            .await
            .expect("second");
        let back = store.readings(device, 0, i64::MAX).await.expect("readings");
        let at: Vec<i64> = back.iter().map(|s| s.at_ms - MINUTE * MINUTE_MS).collect();
        assert_eq!(at, [1_000, 2_000, 3_000]);
        assert_eq!(back[1].values.len(), 2);
        assert_eq!(back[0].values, [("a".to_owned(), 1.0)]);
    }

    #[tokio::test]
    async fn one_row_holds_a_minute_whatever_the_sample_count() {
        let (store, device) = with_device().await;
        let samples: Vec<Sample> = (0..100)
            .map(|i| sample(i * 500, &[("a", f64::from(i32::try_from(i).expect("small")))]))
            .collect();
        store.append_minute(device, &closed(MINUTE, samples)).await.expect("append");
        store
            .append_minute(device, &closed(MINUTE + 1, vec![sample(MINUTE_MS, &[("a", 0.0)])]))
            .await
            .expect("append");
        assert_eq!(minute_rows(&store, device).await, 2);
    }

    #[tokio::test]
    async fn readings_are_selected_by_device_and_half_open_window() {
        let (store, device) = with_device().await;
        let other = store
            .add_device(&NewDevice { connection_id: 1, profile_id: "p".into(), unit_id: 2 })
            .await
            .expect("device");
        let base = MINUTE * MINUTE_MS;
        store
            .append_minute(
                device,
                &closed(MINUTE, vec![sample(0, &[("a", 1.0)]), sample(30_000, &[("a", 2.0)])]),
            )
            .await
            .expect("append");
        store
            .append_minute(device, &closed(MINUTE + 1, vec![sample(MINUTE_MS + 10, &[("a", 3.0)])]))
            .await
            .expect("append");
        store.append_minute(other, &closed(MINUTE, vec![sample(0, &[("a", 99.0)])])).await.expect("append");
        let at = |samples: Vec<Sample>| samples.iter().map(|s| s.at_ms - base).collect::<Vec<_>>();
        assert_eq!(at(store.readings(device, base, base + 30_000).await.expect("r")), [0]);
        assert_eq!(
            at(store.readings(device, base + 30_000, base + MINUTE_MS + 11).await.expect("r")),
            [30_000, 60_010]
        );
        assert_eq!(at(store.readings(device, base + 1, base + 1).await.expect("r")), [] as [i64; 0]);
        assert_eq!(at(store.readings(device, base + 5, base).await.expect("r")), [] as [i64; 0]);
        assert_eq!(store.readings(other, 0, i64::MAX).await.expect("r")[0].values, [("a".to_owned(), 99.0)]);
    }

    #[tokio::test]
    async fn minutes_hold_only_the_rows_of_the_span_and_decode_one_minute_at_a_time() {
        let (store, device) = with_device().await;
        let base = MINUTE * MINUTE_MS;
        for (minute, value) in [(MINUTE - 1, 1.0), (MINUTE, 2.0), (MINUTE + 1, 3.0), (MINUTE + 2, 4.0)] {
            let at = sample((minute - MINUTE) * MINUTE_MS + 5, &[("a", value)]);
            store.append_minute(device, &closed(minute, vec![at])).await.expect("append");
        }
        sqlx::query("UPDATE reading_minute SET samples = x'09' WHERE minute = ?")
            .bind(MINUTE + 2)
            .execute(&store.pool)
            .await
            .expect("corrupt");

        let minutes = store.minutes(device, base, base + MINUTE_MS + 6).await.expect("minutes");
        let seen: Vec<f64> =
            minutes.samples(base, base + MINUTE_MS + 6).map(|s| s.expect("sample").values[0].1).collect();
        assert_eq!(seen, [2.0, 3.0], "the row before and the row after are not read");

        let reaching = store.minutes(device, base, base + 3 * MINUTE_MS).await.expect("minutes");
        let items: Vec<_> = reaching.samples(base, base + 3 * MINUTE_MS).collect();
        assert!(items[..2].iter().all(Result::is_ok), "the undamaged minutes come first");
        assert!(items[2].is_err(), "the damaged one is an item, not a failure of the read");
        assert_eq!(items.len(), 3);

        let none = store.minutes(device, base + 5, base).await.expect("minutes");
        assert_eq!(none.samples(0, i64::MAX).count(), 0);
    }

    #[tokio::test]
    async fn a_sample_outside_its_minute_is_refused_and_nothing_is_stored() {
        let (store, device) = with_device().await;
        let stray = Sample { at_ms: (MINUTE + 5) * MINUTE_MS, values: vec![("a".into(), 1.0)] };
        let error = store.append_minute(device, &closed(MINUTE, vec![stray])).await.expect_err("refused");
        assert!(matches!(error, StoreError::Sample(_)), "{error}");
        assert_eq!(store.readings(device, 0, i64::MAX).await.expect("r"), []);
    }

    #[tokio::test]
    async fn a_damaged_stored_blob_is_an_error_not_a_misread() {
        let (store, device) = with_device().await;
        store.append_minute(device, &closed(MINUTE, vec![sample(0, &[("a", 1.0)])])).await.expect("append");
        corrupt_minute(&store, device).await;
        assert!(matches!(store.readings(device, 0, i64::MAX).await, Err(StoreError::Sample(_))));
        let more = closed(MINUTE, vec![sample(1, &[("a", 2.0)])]);
        assert!(
            store.append_minute(device, &more).await.is_err(),
            "a merge never rewrites what it cannot read"
        );
    }

    async fn applied_migrations(store: &Store) -> i64 {
        sqlx::query_scalar("SELECT COUNT(*) FROM _sqlx_migrations")
            .fetch_one(&store.pool)
            .await
            .expect("count")
    }

    #[tokio::test]
    async fn migrations_apply_from_empty_and_running_them_again_changes_nothing() {
        let (store, device) = with_device().await;
        store.set_setting("k", "v").await.expect("set");
        let applied = applied_migrations(&store).await;
        assert!(applied >= 1);
        sqlx::migrate!("./migrations").run(&store.pool).await.expect("second run");
        assert_eq!(applied_migrations(&store).await, applied);
        assert_eq!(store.setting("k").await.expect("get").as_deref(), Some("v"));
        assert_eq!(store.devices().await.expect("devices")[0].id, device);
    }

    #[tokio::test]
    async fn reopening_a_file_store_applies_no_migration_twice() {
        let dir = std::env::temp_dir().join(format!("sunreye-store-migrate-{}", std::process::id()));
        drop(std::fs::remove_dir_all(&dir));
        let store = Store::open(&dir).await.expect("open");
        let applied = applied_migrations(&store).await;
        store.close().await;
        let store = Store::open(&dir).await.expect("reopen");
        assert_eq!(applied_migrations(&store).await, applied);
        store.close().await;
        drop(std::fs::remove_dir_all(&dir));
    }

    #[tokio::test]
    async fn a_connection_lost_mid_transaction_leaves_no_minute_row() {
        let dir = std::env::temp_dir().join(format!("sunreye-store-crash-{}", std::process::id()));
        drop(std::fs::remove_dir_all(&dir));
        let store = Store::open(&dir).await.expect("open");
        let connection =
            NewConnection { transport: Transport::Tcp, host: "h".into(), port: 502, logger_serial: None };
        let connection = store.add_connection(&connection).await.expect("connection");
        let device = NewDevice { connection_id: connection, profile_id: "p".into(), unit_id: 1 };
        let device = store.add_device(&device).await.expect("device");
        store
            .append_minute(device, &closed(MINUTE, vec![sample(0, &[("a", 1.0)])]))
            .await
            .expect("committed");

        let mut conn = store.pool.acquire().await.expect("connection").detach();
        sqlx::query("BEGIN IMMEDIATE").execute(&mut conn).await.expect("begin");
        sqlx::query("INSERT INTO reading_minute (device_id, minute, samples) VALUES (?, ?, x'00')")
            .bind(device)
            .bind(MINUTE + 1)
            .execute(&mut conn)
            .await
            .expect("insert");
        // Dropped with no COMMIT or ROLLBACK issued: what a killed process leaves.
        drop(conn);
        store.close().await;

        let store = Store::open(&dir).await.expect("reopen");
        assert_eq!(minute_rows(&store, device).await, 1);
        assert_eq!(store.readings(device, 0, i64::MAX).await.expect("r").len(), 1);
        store.close().await;
        drop(std::fs::remove_dir_all(&dir));
    }

    fn account(email: &str) -> NewAccount {
        NewAccount { email: email.into(), name: "Ada".into(), password_hash: "$2b$12$hash".into() }
    }

    #[test]
    fn an_account_prints_without_its_password_hash() {
        let new = account("ada@example.org");
        let row = AccountRow {
            id: 1,
            email: new.email.clone(),
            name: new.name.clone(),
            password_hash: new.password_hash.clone(),
            admin: true,
        };
        for printed in [format!("{new:?}"), format!("{row:?}"), format!("{new:#?}")] {
            assert!(printed.contains("ada@example.org"), "{printed}");
            assert!(!printed.contains("$2b$"), "{printed}");
        }
    }

    #[tokio::test]
    async fn the_first_account_is_an_admin_and_no_second_one_is_created_that_way() {
        let store = Store::in_memory().await.expect("store");
        assert!(!store.has_accounts().await.expect("any"));
        let id = store.create_first_account(&account("ada@example.org")).await.expect("create");
        let id = id.expect("the first account is created");
        assert!(store.has_accounts().await.expect("any"));
        let want = AccountRow {
            id,
            email: "ada@example.org".into(),
            name: "Ada".into(),
            password_hash: "$2b$12$hash".into(),
            admin: true,
        };
        assert_eq!(store.account(id).await.expect("by id"), Some(want));
        assert_eq!(store.create_first_account(&account("eve@example.org")).await.expect("second"), None);
        assert_eq!(store.account_by_email("eve@example.org").await.expect("by email"), None);
    }

    #[tokio::test]
    async fn an_account_is_found_by_email_in_any_case_and_an_unknown_one_is_none() {
        let store = Store::in_memory().await.expect("store");
        let id = store.create_first_account(&account("Ada@Example.org")).await.expect("c").expect("id");
        let found = store.account_by_email("ada@example.ORG").await.expect("by email").expect("found");
        assert_eq!(found.id, id);
        assert_eq!(store.account_by_email("bob@example.org").await.expect("by email"), None);
        assert_eq!(store.account(id + 1).await.expect("by id"), None);
    }

    #[tokio::test]
    async fn a_file_store_keeps_its_data_across_close_and_open_and_runs_in_wal_mode() {
        let dir = std::env::temp_dir().join(format!("sunreye-store-{}", std::process::id()));
        drop(std::fs::remove_dir_all(&dir));
        let store = Store::open(&dir.join("nested")).await.expect("open creates the directory");
        store.set_setting("k", "v").await.expect("set");
        assert_eq!(journal_mode(&store).await, "wal");
        store.close().await;
        let store = Store::open(&dir.join("nested")).await.expect("reopen");
        assert_eq!(store.setting("k").await.expect("get").as_deref(), Some("v"));
        store.close().await;
        drop(std::fs::remove_dir_all(&dir));
    }
}
