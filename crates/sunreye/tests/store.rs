//! The SQLite store from ADR 0004: migrations, settings, minute rows and what a crash leaves.

#![allow(clippy::expect_used, reason = "helpers outside #[test] fns may panic like the tests")]

use std::path::Path;
use std::time::Instant;

use sunreye::store::{Store, insert_minute, pack_samples, unpack_samples};

const DEVICE: i64 = 1;
const MINUTE: i64 = 1_700_000_040;

async fn file_store(dir: &Path) -> Store {
    Store::open(&dir.join("sunreye.db")).await.expect("open file store")
}

async fn minute_rows(store: &Store) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM readings_minute").fetch_one(store.pool()).await.expect("count")
}

async fn applied_migrations(store: &Store) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM _sqlx_migrations").fetch_one(store.pool()).await.expect("count")
}

#[tokio::test]
async fn migrations_apply_to_an_empty_database() {
    let store = Store::open_in_memory().await.expect("open");
    assert!(applied_migrations(&store).await >= 1);
    assert_eq!(store.setting("anything").await.expect("read"), None);
    assert_eq!(minute_rows(&store).await, 0);
}

#[tokio::test]
async fn migrating_again_changes_nothing() {
    let store = Store::open_in_memory().await.expect("open");
    store.set_setting("k", "v").await.expect("write");
    let applied = applied_migrations(&store).await;
    store.migrate().await.expect("second run");
    assert_eq!(applied_migrations(&store).await, applied);
    assert_eq!(store.setting("k").await.expect("read").as_deref(), Some("v"));
}

#[tokio::test]
async fn reopening_a_file_database_keeps_migrations_and_data() {
    let dir = tempfile::tempdir().expect("tempdir");
    let first = file_store(dir.path()).await;
    let applied = applied_migrations(&first).await;
    first.close().await;
    let second = file_store(dir.path()).await;
    assert_eq!(applied_migrations(&second).await, applied);
}

#[tokio::test]
async fn a_settings_write_survives_reopening_the_file() {
    let dir = tempfile::tempdir().expect("tempdir");
    let store = file_store(dir.path()).await;
    store.set_setting("plant.time_zone", "Europe/Berlin").await.expect("write");
    store.close().await;
    let store = file_store(dir.path()).await;
    assert_eq!(store.setting("plant.time_zone").await.expect("read").as_deref(), Some("Europe/Berlin"));
}

#[tokio::test]
async fn a_settings_write_replaces_the_earlier_value() {
    let store = Store::open_in_memory().await.expect("open");
    store.set_setting("k", "one").await.expect("write");
    store.set_setting("k", "two").await.expect("write");
    assert_eq!(store.setting("k").await.expect("read").as_deref(), Some("two"));
}

#[tokio::test]
async fn an_empty_setting_value_is_a_value_not_an_absence() {
    let store = Store::open_in_memory().await.expect("open");
    store.set_setting("k", "").await.expect("write");
    assert_eq!(store.setting("k").await.expect("read").as_deref(), Some(""));
}

#[tokio::test]
async fn a_file_database_runs_in_wal_mode() {
    let dir = tempfile::tempdir().expect("tempdir");
    let store = file_store(dir.path()).await;
    let mode: String =
        sqlx::query_scalar("PRAGMA journal_mode").fetch_one(store.pool()).await.expect("pragma");
    assert_eq!(mode, "wal");
}

#[tokio::test]
async fn a_minute_row_reads_back_what_was_written() {
    let store = Store::open_in_memory().await.expect("open");
    let samples = pack_samples(&[1, 2, 65_535]);
    store.write_minute(DEVICE, MINUTE, &samples).await.expect("write");
    assert_eq!(store.minute(DEVICE, MINUTE).await.expect("read"), Some(samples));
    assert_eq!(store.minute(DEVICE, MINUTE + 60).await.expect("read"), None);
    assert_eq!(store.minute(DEVICE + 1, MINUTE).await.expect("read"), None);
}

#[tokio::test]
async fn a_minute_is_stored_once_per_device() {
    let store = Store::open_in_memory().await.expect("open");
    store.write_minute(DEVICE, MINUTE, &[1, 0]).await.expect("write");
    assert!(store.write_minute(DEVICE, MINUTE, &[2, 0]).await.is_err());
    assert_eq!(store.minute(DEVICE, MINUTE).await.expect("read"), Some(vec![1, 0]));
    store.write_minute(DEVICE + 1, MINUTE, &[3, 0]).await.expect("another device, same minute");
}

#[tokio::test]
async fn a_dropped_transaction_leaves_no_minute_row() {
    let dir = tempfile::tempdir().expect("tempdir");
    let store = file_store(dir.path()).await;
    let mut tx = store.pool().begin().await.expect("begin");
    insert_minute(&mut tx, DEVICE, MINUTE, &[1, 0]).await.expect("insert");
    drop(tx);
    assert_eq!(minute_rows(&store).await, 0);
}

#[tokio::test]
async fn a_connection_lost_mid_transaction_leaves_no_minute_row() {
    let dir = tempfile::tempdir().expect("tempdir");
    let store = file_store(dir.path()).await;
    store.write_minute(DEVICE, MINUTE - 60, &[9, 0]).await.expect("an earlier, committed minute");

    let mut conn = store.pool().acquire().await.expect("connection").detach();
    sqlx::query("BEGIN IMMEDIATE").execute(&mut conn).await.expect("begin");
    insert_minute(&mut conn, DEVICE, MINUTE, &[1, 0]).await.expect("insert");
    // Dropped with no COMMIT or ROLLBACK issued: what a killed process leaves.
    drop(conn);
    store.close().await;

    let store = file_store(dir.path()).await;
    assert_eq!(minute_rows(&store).await, 1);
    assert_eq!(store.minute(DEVICE, MINUTE).await.expect("read"), None);
    assert_eq!(store.minute(DEVICE, MINUTE - 60).await.expect("read"), Some(vec![9, 0]));
}

#[test]
fn packed_samples_round_trip() {
    for samples in [vec![], vec![0], vec![u16::MAX, 0, 1]] {
        assert_eq!(unpack_samples(&pack_samples(&samples)), Some(samples));
    }
}

#[test]
fn a_blob_that_is_not_whole_samples_is_refused() {
    assert_eq!(unpack_samples(&[1]), None);
    assert_eq!(unpack_samples(&[1, 0, 2]), None);
}

/// One simulated device-day: 1 s polling of 8 registers, packed per minute, one commit per minute.
/// Run `cargo test --release --test store device_day -- --nocapture` for the numbers.
#[tokio::test]
async fn a_device_day_is_1440_minute_rows() {
    const REGISTERS: usize = 8;
    let dir = tempfile::tempdir().expect("tempdir");
    let store = file_store(dir.path()).await;
    let started = Instant::now();
    for minute in 0..1440_i64 {
        let samples: Vec<u16> = (0..60 * REGISTERS)
            .map(|i| {
                u16::try_from((minute * 7 + i64::try_from(i).expect("small")) % 65_536).expect("in range")
            })
            .collect();
        store.write_minute(DEVICE, MINUTE + minute * 60, &pack_samples(&samples)).await.expect("write");
    }
    let elapsed = started.elapsed();
    assert_eq!(minute_rows(&store).await, 1440);

    let first = store.minute(DEVICE, MINUTE).await.expect("read").expect("row");
    assert_eq!(unpack_samples(&first).expect("whole samples").len(), 60 * REGISTERS);

    store.close().await;
    let bytes = std::fs::metadata(dir.path().join("sunreye.db")).expect("db file").len();
    eprintln!("device-day: insert {elapsed:?}, file {bytes} bytes");
    assert!(bytes >= 1440 * 60 * 8 * 2, "the packed samples alone are this large");
}
