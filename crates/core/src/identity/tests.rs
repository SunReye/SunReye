//! The core's identity over a real store.

use std::path::Path;
use std::time::UNIX_EPOCH;

use super::Identity;
use crate::bus::Bus;
use crate::storage::Storage;

fn open(path: &Path) -> Storage {
    Storage::open(path, UNIX_EPOCH, "UTC", &Bus::default()).unwrap()
}

/// A UUID of version 4, as text.
fn version_4(id: &str) -> bool {
    let groups: Vec<_> = id.split('-').map(str::len).collect();
    let lower_hex = id
        .bytes()
        .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f' | b'-'));
    groups == [8, 4, 4, 4, 12]
        && lower_hex
        && id.as_bytes()[14] == b'4'
        && matches!(id.as_bytes()[19], b'8' | b'9' | b'a' | b'b')
}

#[tokio::test]
async fn the_first_run_creates_the_install_id_and_static_key_that_every_later_run_keeps() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("core.sqlite");
    let storage = open(&path);

    let first = Identity::open(&storage.database()).await.unwrap();
    storage.shutdown().await.unwrap();
    let storage = open(&path);
    let later = Identity::open(&storage.database()).await.unwrap();

    assert!(version_4(first.install_id()), "{}", first.install_id());
    assert_eq!(later.install_id(), first.install_id());
    assert_eq!(later.public_key(), first.public_key());
}

#[tokio::test]
async fn two_installs_share_neither_id_nor_key() {
    let dir = tempfile::tempdir().unwrap();
    let (one, two) = (
        open(&dir.path().join("one.sqlite")),
        open(&dir.path().join("two.sqlite")),
    );

    let (one, two) = (
        Identity::open(&one.database()).await.unwrap(),
        Identity::open(&two.database()).await.unwrap(),
    );

    assert_ne!(one.install_id(), two.install_id());
    assert_ne!(one.public_key(), two.public_key());
}

#[tokio::test]
async fn a_trusted_key_is_an_ed25519_account_key_with_a_role_and_a_revoked_flag() {
    let dir = tempfile::tempdir().unwrap();
    let storage = open(&dir.path().join("core.sqlite"));

    let inserted = storage
        .database()
        .run(|db| {
            let insert = |key: &[u8], role: &str, revoked: i64| {
                db.execute(
                    "INSERT INTO trusted_key (key, role, revoked) VALUES (?1, ?2, ?3)",
                    rusqlite::params![key, role, revoked],
                )
                .is_ok()
            };
            Ok([
                insert(&[1; 32], "admin", 0),
                insert(&[2; 32], "viewer", 1),
                insert(&[3; 32], "owner", 0),
                insert(&[4; 31], "viewer", 0),
                insert(&[5; 32], "viewer", 2),
            ])
        })
        .await
        .unwrap();

    assert_eq!(inserted, [true, true, false, false, false]);
}
