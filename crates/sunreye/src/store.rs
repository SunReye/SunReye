//! The SQLite store (ADR 0004): one file per install, WAL mode, plain SQL checked against the
//! schema at compile time from the committed `.sqlx` cache.

use std::path::Path;

use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use sqlx::{SqliteConnection, SqlitePool};

/// A handle to the store. Cloning shares the connection pool.
#[derive(Clone, Debug)]
pub struct Store {
    pool: SqlitePool,
}

impl Store {
    /// Opens the database file, creating it when absent, and applies pending migrations.
    pub async fn open(path: &Path) -> Result<Self, sqlx::Error> {
        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal)
            .synchronous(SqliteSynchronous::Full);
        Self::connect(options, 4).await
    }

    /// A private database that lives as long as the handle; for tests.
    pub async fn open_in_memory() -> Result<Self, sqlx::Error> {
        // Each in-memory connection is its own database, so the pool holds exactly one.
        Self::connect(SqliteConnectOptions::new().in_memory(true), 1).await
    }

    async fn connect(options: SqliteConnectOptions, connections: u32) -> Result<Self, sqlx::Error> {
        let pool = SqlitePoolOptions::new()
            .max_connections(connections)
            .idle_timeout(None)
            .max_lifetime(None)
            .connect_with(options)
            .await?;
        let store = Self { pool };
        store.migrate().await?;
        Ok(store)
    }

    /// Applies the migrations not yet applied; running it again changes nothing.
    pub async fn migrate(&self) -> Result<(), sqlx::Error> {
        sqlx::migrate!().run(&self.pool).await?;
        Ok(())
    }

    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }

    /// Waits for open connections to finish and closes them.
    pub async fn close(&self) {
        self.pool.close().await;
    }

    pub async fn set_setting(&self, key: &str, value: &str) -> Result<(), sqlx::Error> {
        sqlx::query!(
            "INSERT INTO settings (key, value) VALUES (?, ?)
             ON CONFLICT (key) DO UPDATE SET value = excluded.value",
            key,
            value
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn setting(&self, key: &str) -> Result<Option<String>, sqlx::Error> {
        let row =
            sqlx::query!("SELECT value FROM settings WHERE key = ?", key).fetch_optional(&self.pool).await?;
        Ok(row.map(|row| row.value))
    }

    /// Commits one closed minute of one device. A minute is written once: a second write is an error.
    pub async fn write_minute(&self, device_id: i64, minute: i64, samples: &[u8]) -> Result<(), sqlx::Error> {
        let mut connection = self.pool.acquire().await?;
        insert_minute(&mut connection, device_id, minute, samples).await
    }

    pub async fn minute(&self, device_id: i64, minute: i64) -> Result<Option<Vec<u8>>, sqlx::Error> {
        let row = sqlx::query!(
            "SELECT samples FROM readings_minute WHERE device_id = ? AND minute = ?",
            device_id,
            minute
        )
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(|row| row.samples))
    }
}

/// Inserts a minute row on the given connection, so a caller can place it inside its own transaction.
pub async fn insert_minute(
    connection: &mut SqliteConnection,
    device_id: i64,
    minute: i64,
    samples: &[u8],
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        "INSERT INTO readings_minute (device_id, minute, samples) VALUES (?, ?, ?)",
        device_id,
        minute,
        samples
    )
    .execute(connection)
    .await?;
    Ok(())
}

/// Placeholder encoding of one minute's samples: little-endian `u16`, back to back. Slice 1 replaces it.
#[must_use]
pub fn pack_samples(samples: &[u16]) -> Vec<u8> {
    samples.iter().flat_map(|sample| sample.to_le_bytes()).collect()
}

/// Inverse of [`pack_samples`]; `None` when the bytes are not whole samples.
#[must_use]
pub fn unpack_samples(bytes: &[u8]) -> Option<Vec<u16>> {
    let (whole, rest) = bytes.as_chunks::<2>();
    rest.is_empty().then(|| whole.iter().map(|pair| u16::from_le_bytes(*pair)).collect())
}
