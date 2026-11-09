//! Backup and restore over real SQLite files.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use sunreye_profile::RoleKind;

use super::{Error, Options, OptionsError, command, restore, write};
use crate::bus::{Bus, DeviceId, Reading, SeriesId};
use crate::identity::Identity;
use crate::startup::STORE;
use crate::storage::{ChangePoint, Policy, Storage};

/// 2026-08-26 12:00 UTC.
const T0: u64 = 1_787_745_600;
const DEVICE: DeviceId = DeviceId(3);
/// A car body's id, as the core names an upload.
const CAR: &str = "c6a4d4b0b1bd1dc8e5a1c3d2c7a5c5c2e0f4b7f2b0d4d1a6e8b5c3d2a1f0e9d8";

fn at(seconds: u64) -> SystemTime {
    UNIX_EPOCH + Duration::from_secs(T0 + seconds)
}

/// A data directory whose store holds one series of raw history and whose `cars` one body.
struct Data {
    dir: PathBuf,
    bus: Bus,
    power: SeriesId,
}

impl Data {
    fn new(dir: &Path) -> Self {
        let bus = Bus::default();
        let power = bus.intern("pv.power", None);
        std::fs::create_dir_all(dir).unwrap();
        Self {
            dir: dir.to_owned(),
            bus,
            power,
        }
    }

    async fn open(&self) -> Storage {
        let storage = Storage::open(&self.dir.join(STORE), UNIX_EPOCH, "UTC", &self.bus).unwrap();
        let policy = Policy {
            kind: RoleKind::Measurement,
            step: 1.0,
            deadband: 0.0,
            cadence: Duration::from_secs(5),
        };
        storage.declare(DEVICE, self.power, policy).await.unwrap();
        storage
    }

    /// Readings at 0 s, 10 s and 60 s, all written by the clock at 180 s.
    async fn record(&self, storage: &Storage) {
        for (seconds, value) in [(0, 100.0), (10, 250.0), (60, 250.0)] {
            let reading = Reading {
                device: DEVICE,
                series: self.power,
                value,
                unit: None,
                time: at(seconds),
                cadence: crate::endpoint::CADENCE,
            };
            storage.record(reading).await.unwrap();
        }
        storage.tick(at(180)).await.unwrap();
        std::fs::create_dir_all(self.dir.join("cars")).unwrap();
        std::fs::write(self.dir.join("cars").join(format!("{CAR}.glb")), b"glb").unwrap();
    }

    async fn history(&self, storage: &Storage) -> Vec<ChangePoint> {
        storage
            .history(DEVICE, self.power, at(0), at(3600))
            .await
            .unwrap()
    }
}

/// The permission bits of `path`.
fn mode(path: &Path) -> u32 {
    use std::os::unix::fs::PermissionsExt as _;
    std::fs::metadata(path).unwrap().permissions().mode() & 0o777
}

#[tokio::test]
async fn a_restored_backup_brings_back_raw_history_and_the_car_bodies() {
    let dir = tempfile::tempdir().unwrap();
    let data = Data::new(&dir.path().join("data"));
    let storage = data.open().await;
    data.record(&storage).await;
    let before = data.history(&storage).await;
    let file = dir.path().join("sunreye.tar");

    write(&storage.database(), &data.dir, &file, false)
        .await
        .unwrap();
    storage.shutdown().await.unwrap();
    std::fs::remove_dir_all(&data.dir).unwrap();
    restore(&file, &data.dir).unwrap();
    let storage = data.open().await;

    assert!(before.len() >= 2, "{before:?}");
    assert_eq!(data.history(&storage).await, before);
    let car = std::fs::read(data.dir.join("cars").join(format!("{CAR}.glb"))).unwrap();
    assert_eq!(car, b"glb");
}

/// Unlock codes: distinctive, so a search of the file finds only a leak.
const OLD: &str = "52817";
const CODE: &str = "93061";

/// Adds a connection whose secret `unlock` was `OLD` and is now `CODE`.
async fn secret(storage: &Storage) {
    storage
        .database()
        .run(|db| {
            db.execute_batch(&format!(
                "INSERT INTO connection (name, transport, host, port)
                   VALUES ('gateway', 'modbus-tcp', '192.0.2.7', 502);
                 INSERT INTO secret (connection, name, value) VALUES (1, 'unlock', '{OLD}');
                 UPDATE secret SET value = '{CODE}';"
            ))
        })
        .await
        .unwrap();
}

/// Creates the core's identity and trusts one account as `admin`.
async fn trust(storage: &Storage) -> Identity {
    let identity = Identity::open(&storage.database()).await.unwrap();
    storage
        .database()
        .run(|db| {
            db.execute(
                "INSERT INTO trusted_key (key, role) VALUES (?1, 'admin')",
                [[7u8; 32]],
            )
        })
        .await
        .unwrap();
    identity
}

fn holds(file: &Path, value: &str) -> bool {
    let bytes = std::fs::read(file).unwrap();
    bytes.windows(value.len()).any(|w| w == value.as_bytes())
}

#[tokio::test]
async fn a_backup_holds_no_secret_value_unless_the_admin_asks() {
    let dir = tempfile::tempdir().unwrap();
    let data = Data::new(&dir.path().join("data"));
    let storage = data.open().await;
    secret(&storage).await;
    let (without, with) = (dir.path().join("without.tar"), dir.path().join("with.tar"));

    write(&storage.database(), &data.dir, &without, false)
        .await
        .unwrap();
    write(&storage.database(), &data.dir, &with, true)
        .await
        .unwrap();

    assert!(holds(&without, "gateway"), "the connection is backed up");
    assert!(!holds(&without, CODE));
    assert!(!holds(&without, OLD));
    assert!(holds(&with, CODE));
    assert!(!holds(&with, OLD));
}

/// Each table of the store at `path` and its row count.
fn tables(path: &Path) -> Vec<(String, i64)> {
    let db = rusqlite::Connection::open(path).unwrap();
    let names: Vec<String> = db
        .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    names
        .into_iter()
        .map(|name| {
            let count = db
                .query_row(&format!("SELECT count(*) FROM \"{name}\""), [], |row| {
                    row.get(0)
                })
                .unwrap();
            (name, count)
        })
        .collect()
}

#[tokio::test]
async fn every_table_but_the_secrets_is_backed_up() {
    let dir = tempfile::tempdir().unwrap();
    let data = Data::new(&dir.path().join("data"));
    let storage = data.open().await;
    data.record(&storage).await;
    secret(&storage).await;
    let identity = trust(&storage).await;
    let file = dir.path().join("sunreye.tar");
    write(&storage.database(), &data.dir, &file, false)
        .await
        .unwrap();
    storage.shutdown().await.unwrap();
    let before = tables(&data.dir.join(STORE));
    let restored = dir.path().join("restored");

    restore(&file, &restored).unwrap();

    let expected: Vec<_> = before
        .into_iter()
        .map(|(name, count)| (name.clone(), if name == "secret" { 0 } else { count }))
        .collect();
    assert_eq!(tables(&restored.join(STORE)), expected);
    // The core's identity (ADR 16) goes in, so a restore keeps every pairing.
    let carried = |table: &str| expected.iter().any(|(name, n)| name == table && *n == 1);
    assert!(
        carried("identity") && carried("trusted_key"),
        "{expected:?}"
    );
    let storage = Data::new(&restored).open().await;
    assert_eq!(Identity::open(&storage.database()).await.unwrap(), identity);
}

#[tokio::test]
async fn a_backup_is_readable_by_the_core_alone_and_never_overwrites_a_file() {
    let dir = tempfile::tempdir().unwrap();
    let data = Data::new(&dir.path().join("data"));
    let storage = data.open().await;
    let (file, taken) = (dir.path().join("sunreye.tar"), dir.path().join("taken"));
    std::fs::write(&taken, "kept").unwrap();

    write(&storage.database(), &data.dir, &file, false)
        .await
        .unwrap();
    let refused = write(&storage.database(), &data.dir, &taken, false).await;

    assert_eq!(mode(&file), 0o600);
    assert!(matches!(refused, Err(Error::Exists)), "{refused:?}");
    assert_eq!(std::fs::read_to_string(&taken).unwrap(), "kept");
}

/// A backup of a store a later release migrated.
async fn newer(dir: &Path) -> PathBuf {
    let data = Data::new(&dir.join("newer"));
    let storage = data.open().await;
    storage
        .database()
        .run(|db| db.pragma_update(None, "user_version", crate::storage::SCHEMA + 1))
        .await
        .unwrap();
    let file = dir.join("newer.tar");
    write(&storage.database(), &data.dir, &file, false)
        .await
        .unwrap();
    file
}

#[tokio::test]
async fn a_backup_of_a_newer_schema_is_refused_and_the_store_left_as_it_was() {
    let dir = tempfile::tempdir().unwrap();
    let file = newer(dir.path()).await;
    let data = Data::new(&dir.path().join("data"));
    let storage = data.open().await;
    data.record(&storage).await;
    let before = data.history(&storage).await;
    storage.shutdown().await.unwrap();

    let refused = restore(&file, &data.dir);
    let storage = data.open().await;

    assert!(
        matches!(refused, Err(Error::Newer(v)) if v == crate::storage::SCHEMA + 1),
        "{refused:?}"
    );
    assert_eq!(data.history(&storage).await, before);
}

#[tokio::test]
async fn a_restore_is_refused_while_a_core_runs_on_the_data_directory() {
    let dir = tempfile::tempdir().unwrap();
    let data = Data::new(&dir.path().join("data"));
    let storage = data.open().await;
    let file = dir.path().join("sunreye.tar");
    write(&storage.database(), &data.dir, &file, false)
        .await
        .unwrap();
    let _core = crate::startup::claim(&data.dir).unwrap().unwrap();

    let refused = restore(&file, &data.dir);

    assert!(matches!(refused, Err(Error::Running)), "{refused:?}");
}

#[test]
fn a_file_that_is_no_backup_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("notes.txt");
    std::fs::write(&file, "not a tar".repeat(100)).unwrap();

    let refused = restore(&file, &dir.path().join("data"));

    assert!(matches!(refused, Err(Error::File(_))), "{refused:?}");
}

fn args(line: &str) -> Vec<String> {
    line.split_whitespace().map(str::to_owned).collect()
}

fn data_dir(name: &str) -> Option<String> {
    (name == "SUNREYE_DATA_DIR").then(|| "/data".to_owned())
}

#[test]
fn the_backup_command_takes_the_file_whether_to_include_secrets_and_the_data_directory() {
    let plain = Options::backup(args("sunreye.tar"), data_dir);
    let secrets = Options::backup(args("--secrets --data-dir=/d sunreye.tar"), |_| None);

    let options = |data: &str, secrets| Options {
        file: PathBuf::from("sunreye.tar"),
        data_dir: PathBuf::from(data),
        secrets,
    };
    assert_eq!(plain, Ok(options("/data", false)));
    assert_eq!(secrets, Ok(options("/d", true)));
}

#[test]
fn the_restore_command_takes_the_file_and_the_data_directory_only() {
    let options = Options::restore(args("sunreye.tar --data-dir /d"), |_| None);
    let secrets = Options::restore(args("sunreye.tar --secrets"), data_dir);
    let no_file = Options::restore(args("--data-dir /d"), |_| None);

    assert_eq!(
        options,
        Ok(Options {
            file: PathBuf::from("sunreye.tar"),
            data_dir: PathBuf::from("/d"),
            secrets: false,
        })
    );
    assert_eq!(secrets, Err(OptionsError::Unknown("--secrets".to_owned())));
    assert_eq!(no_file, Err(OptionsError::Missing("the backup's path")));
}

#[tokio::test]
async fn the_backup_command_backs_up_the_store_of_a_running_core() {
    let dir = tempfile::tempdir().unwrap();
    let data = Data::new(&dir.path().join("data"));
    let storage = data.open().await;
    data.record(&storage).await;
    let before = data.history(&storage).await;
    let options = Options {
        file: dir.path().join("sunreye.tar"),
        data_dir: data.dir.clone(),
        secrets: false,
    };

    let written = command(&options);
    storage.shutdown().await.unwrap();
    let restored = Data::new(&dir.path().join("restored"));
    restore(&options.file, &restored.dir).unwrap();
    let storage = restored.open().await;

    assert!(written.unwrap() > 0);
    assert_eq!(restored.history(&storage).await, before);
}
