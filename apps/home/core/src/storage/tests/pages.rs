//! The file's page size (ADR 3) through the storage interface.

use std::path::Path;
use std::time::Duration;

use super::{DEVICE, Plant, at, epoch, policy};
use crate::storage::{Backfill, Held, Storage};

fn page_size(path: &Path) -> i64 {
    let db = rusqlite::Connection::open(path).unwrap();
    db.query_row("PRAGMA page_size", [], |row| row.get(0))
        .unwrap()
}

/// Rewrites the closed store at `path` as a build before 8 KB pages left it.
fn shrink_pages(path: &Path) {
    rusqlite::Connection::open(path)
        .unwrap()
        .execute_batch(
            "PRAGMA journal_mode = DELETE;
             PRAGMA page_size = 4096;
             VACUUM;
             PRAGMA journal_mode = WAL;",
        )
        .unwrap();
}

/// Imports `hours` of a reading every 5 s whose noise packs into blocks of 1 to 2 KB.
async fn import_noisy_hours(plant: &Plant, storage: &Storage, hours: u32) {
    // A fixed linear congruential generator: the same blocks on every run.
    let mut state = 0x2545_f491_u32;
    let mut noise = move |span: u32| {
        state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        f64::from((state >> 8) % span)
    };
    let raw = (0..hours * 720)
        .map(|i| {
            // Quiet hours and busy ones, as night and day.
            let span = 4 << ((i / 720) % 7);
            Held {
                time: at(f64::from(i) * 5.0),
                value: 500.0 + noise(span) / 10.0,
                hold: Some(Duration::from_secs(5)),
            }
        })
        .collect();
    let backfill = Backfill {
        raw,
        ..Backfill::default()
    };
    storage
        .import(DEVICE, plant.power, policy(), backfill)
        .await
        .unwrap();
}

#[tokio::test]
async fn a_new_file_has_8_kb_pages() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("p.sqlite");

    Plant::new()
        .open(&path, epoch())
        .await
        .shutdown()
        .await
        .unwrap();

    assert_eq!(page_size(&path), 8192);
}

#[tokio::test]
async fn blocks_of_1_to_2_kb_take_little_more_room_than_their_payload() {
    let dir = tempfile::tempdir().unwrap();
    let plant = Plant::new();
    let storage = plant.open(&dir.path().join("p.sqlite"), epoch()).await;
    import_noisy_hours(&plant, &storage, 480).await;

    // The hour after the import holds only the gap that ends it.
    let (blocks, smallest, largest, payload, pages): (i64, i64, i64, i64, i64) = storage
        .database()
        .run(|db| {
            db.query_row(
                "SELECT count(*), min(length(data)), max(length(data)), sum(length(data)),
                        (SELECT sum(pgsize) FROM dbstat WHERE name = 'block')
                 FROM block WHERE hour < (SELECT max(hour) FROM block)",
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
        })
        .await
        .unwrap();

    assert!(blocks >= 400, "{blocks} blocks");
    assert!(
        smallest >= 1000 && largest <= 2048,
        "blocks of {smallest} to {largest} bytes"
    );
    #[expect(clippy::cast_precision_loss, reason = "a few megabytes")]
    let ratio = pages as f64 / payload as f64;
    assert!(ratio <= 1.3, "{pages} bytes for {payload} of payload");
}

#[tokio::test]
async fn a_file_at_another_page_size_is_converted_once_at_open() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("p.sqlite");
    let plant = Plant::new();
    let storage = plant.open(&path, epoch()).await;
    import_noisy_hours(&plant, &storage, 24).await;
    let before = plant.history(&storage, 0.0, 86_400.0).await;
    storage.shutdown().await.unwrap();
    shrink_pages(&path);
    assert_eq!(page_size(&path), 4096);

    let storage = plant.open(&path, epoch()).await;
    let journal: String = storage
        .database()
        .run(|db| db.query_row("PRAGMA journal_mode", [], |row| row.get(0)))
        .await
        .unwrap();
    let after = plant.history(&storage, 0.0, 86_400.0).await;
    storage.shutdown().await.unwrap();

    assert_eq!(page_size(&path), 8192);
    assert_eq!(journal, "wal");
    assert!(before.len() > 10_000, "{} change points", before.len());
    assert_eq!(after, before);
}

#[tokio::test]
async fn a_file_another_process_holds_open_opens_unconverted_and_converts_later() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("p.sqlite");
    let plant = Plant::new();
    let storage = plant.open(&path, epoch()).await;
    import_noisy_hours(&plant, &storage, 2).await;
    let before = plant.history(&storage, 0.0, 7200.0).await;
    storage.shutdown().await.unwrap();
    shrink_pages(&path);
    // As `sunreye backup` reading the store while the core starts.
    let other = rusqlite::Connection::open(&path).unwrap();
    let _: i64 = other
        .query_row("SELECT count(*) FROM block", [], |row| row.get(0))
        .unwrap();

    let storage = plant.open(&path, epoch()).await;
    let held = plant.history(&storage, 0.0, 7200.0).await;
    storage.shutdown().await.unwrap();
    drop(other);
    assert_eq!(held, before);
    assert_eq!(page_size(&path), 4096);

    plant.open(&path, epoch()).await.shutdown().await.unwrap();
    assert_eq!(page_size(&path), 8192);
}
