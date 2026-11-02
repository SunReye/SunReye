//! The SQLite store: one file under the data directory (ADR 0004), WAL mode, plain SQL through `sqlx`
//! `query!` checked against the committed `.sqlx` cache. Each query has a test below against an
//! in-memory database. Rollups are not here: SQLite stores and reads, it computes nothing.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use sqlx::migrate::MigrateError;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use sqlx::{Executor, Sqlite, SqlitePool};

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
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewConnection {
    pub transport: String,
    pub host: String,
    pub port: u16,
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
    pub transport: String,
    pub host: String,
    pub port: u16,
}

/// A device with the connection it is reached through.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeviceRow {
    pub id: i64,
    pub connection_id: i64,
    pub profile_id: String,
    pub unit_id: u8,
    pub transport: String,
    pub host: String,
    pub port: u16,
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
        sqlx::migrate!("./migrations").run(&pool).await?;
        Ok(Self { pool })
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

    pub async fn add_connection(&self, connection: &NewConnection) -> Result<i64, StoreError> {
        let row = sqlx::query!(
            r#"INSERT INTO connection (transport, host, port) VALUES (?, ?, ?) RETURNING id AS "id!""#,
            connection.transport,
            connection.host,
            connection.port
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(row.id)
    }

    /// The one connection of this core: the oldest row.
    pub async fn connection(&self) -> Result<Option<ConnectionRow>, StoreError> {
        let row =
            sqlx::query!(r#"SELECT id AS "id!", transport, host, port FROM connection ORDER BY id LIMIT 1"#)
                .fetch_optional(&self.pool)
                .await?;
        row.map(|row| {
            Ok(ConnectionRow {
                id: row.id,
                transport: row.transport,
                host: row.host,
                port: u16::try_from(row.port).map_err(|_| StoreError::Corrupt("port"))?,
            })
        })
        .transpose()
    }

    /// Edits the core's connection in place, so its device stays attached; adds it when there is none.
    pub async fn save_connection(&self, connection: &NewConnection) -> Result<i64, StoreError> {
        let Some(existing) = self.connection().await? else {
            return self.add_connection(connection).await;
        };
        sqlx::query!(
            "UPDATE connection SET transport = ?, host = ?, port = ? WHERE id = ?",
            connection.transport,
            connection.host,
            connection.port,
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
                      connection.transport, connection.host, connection.port
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
                    transport: row.transport,
                    host: row.host,
                    port: u16::try_from(row.port).map_err(|_| StoreError::Corrupt("port"))?,
                })
            })
            .collect()
    }

    /// Adds a closed minute to the device's row for that minute, merging with samples already stored
    /// there (a restart inside the minute), in one transaction.
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
        samples.extend(closed.samples.iter().cloned());
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
        tx.commit().await?;
        Ok(())
    }

    /// The device's samples with `from_ms <= at_ms < to_ms`, oldest first.
    pub async fn readings(
        &self,
        device_id: i64,
        from_ms: i64,
        to_ms: i64,
    ) -> Result<Vec<Sample>, StoreError> {
        if to_ms <= from_ms {
            return Ok(Vec::new());
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
        let keys: BTreeMap<u32, String> =
            metric_ids(&self.pool).await?.into_iter().map(|(key, id)| (id, key)).collect();
        let mut out = Vec::new();
        for row in rows {
            let samples = decode(row.minute, &row.samples, &keys)?;
            out.extend(samples.into_iter().filter(|s| (from_ms..to_ms).contains(&s.at_ms)));
        }
        Ok(out)
    }
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
            .add_connection(&NewConnection { transport: "tcp".into(), host: "10.0.0.5".into(), port: 502 })
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
            .save_connection(&NewConnection { transport: "tcp".into(), host: "10.0.0.5".into(), port: 502 })
            .await
            .expect("save");
        let row = store.connection().await.expect("connection").expect("a row");
        assert_eq!(
            (row.id, row.transport.as_str(), row.host.as_str(), row.port),
            (id, "tcp", "10.0.0.5", 502)
        );
    }

    #[tokio::test]
    async fn saving_a_connection_again_edits_it_in_place() {
        let (store, device) = with_device().await;
        let first = store.connection().await.expect("connection").expect("a row").id;
        let second = NewConnection { transport: "tcp".into(), host: "gateway".into(), port: 1502 };
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
        let bad = NewConnection { transport: "serial".into(), host: "h".into(), port: 502 };
        assert!(store.save_connection(&bad).await.is_err());
        assert_eq!(store.connection().await.expect("connection"), None);
    }

    #[tokio::test]
    async fn saving_a_device_edits_the_connections_device_or_adds_the_first() {
        let store = Store::in_memory().await.expect("store");
        let connection = store
            .save_connection(&NewConnection { transport: "tcp".into(), host: "h".into(), port: 502 })
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
        let connection = NewConnection { transport: "tcp".into(), host: "gateway".into(), port: 1502 };
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
        assert_eq!(devices[0].transport, "tcp");
    }

    #[tokio::test]
    async fn the_schema_refuses_what_it_cannot_hold() {
        let (store, _) = with_device().await;
        let bad_port = NewConnection { transport: "tcp".into(), host: "h".into(), port: 0 };
        assert!(store.add_connection(&bad_port).await.is_err());
        let bad_transport = NewConnection { transport: "carrier-pigeon".into(), host: "h".into(), port: 1 };
        assert!(store.add_connection(&bad_transport).await.is_err());
        let orphan = NewDevice { connection_id: 999, profile_id: "p".into(), unit_id: 1 };
        assert!(store.add_device(&orphan).await.is_err(), "a device needs its connection");
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
        let connection = NewConnection { transport: "tcp".into(), host: "h".into(), port: 502 };
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
