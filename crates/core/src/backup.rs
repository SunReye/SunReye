//! Backup and restore (ADR 3): the store and the car bodies (ADR 20) in one tar.
//!
//! The store is copied by SQLite's online backup API. Credential secrets stay out unless asked
//! (ADR 7); every other table goes in, so the core's identity (ADR 16) does too.

mod routes;
mod tar;

use std::fmt;
use std::fs::{File, OpenOptions};
use std::io::{self, BufWriter, Write as _};
use std::os::unix::fs::OpenOptionsExt as _;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use rusqlite::Connection;

use crate::startup::{self, STORE};
use crate::storage::{self, Database, SCHEMA};

pub use self::routes::Backups;

/// The car bodies' directory in the data directory and in a backup.
const CARS: &str = "cars";

#[derive(Debug)]
pub enum Error {
    Io(io::Error),
    Sqlite(rusqlite::Error),
    Storage(storage::Error),
    /// The named file exists: a backup never overwrites one.
    Exists,
    /// A core runs on the data directory.
    Running,
    /// The file is not a backup this build reads.
    File(String),
    /// The backup's schema is newer than this build's.
    Newer(i64),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(e) => write!(f, "{e}"),
            Self::Sqlite(e) => write!(f, "sqlite: {e}"),
            Self::Storage(e) => write!(f, "storage: {e}"),
            Self::Exists => f.write_str("the file exists"),
            Self::Running => f.write_str("a core runs on the data directory: stop it first"),
            Self::File(reason) => write!(f, "not a backup: {reason}"),
            Self::Newer(version) => write!(
                f,
                "the backup's schema {version} is newer than this build's {SCHEMA}"
            ),
        }
    }
}

impl std::error::Error for Error {}

impl From<io::Error> for Error {
    fn from(e: io::Error) -> Self {
        Self::Io(e)
    }
}

impl From<rusqlite::Error> for Error {
    fn from(e: rusqlite::Error) -> Self {
        Self::Sqlite(e)
    }
}

impl From<storage::Error> for Error {
    fn from(e: storage::Error) -> Self {
        Self::Storage(e)
    }
}

/// What `sunreye backup --help` prints: the flags [`Options::backup`] reads.
pub const BACKUP_USAGE: &str = "\
Usage: sunreye backup <file> [--secrets] [--data-dir <dir>]

Backs up the store and car bodies, the core running or not.

Flags:
  --secrets          include the connections' secrets
  --data-dir <dir>   the data directory; SUNREYE_DATA_DIR
";

/// What `sunreye restore --help` prints: the flags [`Options::restore`] reads.
pub const RESTORE_USAGE: &str = "\
Usage: sunreye restore <file> [--data-dir <dir>]

Replaces the store and car bodies while the core is stopped.

Flags:
  --data-dir <dir>   the data directory; SUNREYE_DATA_DIR
";

/// What `sunreye backup` and `sunreye restore` take.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Options {
    /// The backup.
    pub file: PathBuf,
    pub data_dir: PathBuf,
    /// Whether a backup holds the credential secrets.
    pub secrets: bool,
}

/// Why the options were refused.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OptionsError {
    Missing(&'static str),
    NoValue(&'static str),
    Unknown(String),
}

impl fmt::Display for OptionsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Missing(what) => write!(f, "{what} is required"),
            Self::NoValue(flag) => write!(f, "--{flag} needs a value"),
            Self::Unknown(arg) => write!(f, "unknown argument `{arg}`"),
        }
    }
}

impl std::error::Error for OptionsError {}

impl Options {
    /// Reads the backup's path, `--secrets` and `--data-dir`, which falls back to
    /// `SUNREYE_DATA_DIR` from `env`.
    ///
    /// # Errors
    /// No file or data directory, or an unknown argument.
    pub fn backup(
        args: impl IntoIterator<Item = String>,
        env: impl Fn(&str) -> Option<String>,
    ) -> Result<Self, OptionsError> {
        Self::parse(args, env, true)
    }

    /// Reads the backup's path and `--data-dir`, which falls back to `SUNREYE_DATA_DIR` from
    /// `env`.
    ///
    /// # Errors
    /// No file or data directory, or an unknown argument.
    pub fn restore(
        args: impl IntoIterator<Item = String>,
        env: impl Fn(&str) -> Option<String>,
    ) -> Result<Self, OptionsError> {
        Self::parse(args, env, false)
    }

    fn parse(
        args: impl IntoIterator<Item = String>,
        env: impl Fn(&str) -> Option<String>,
        backup: bool,
    ) -> Result<Self, OptionsError> {
        let (mut file, mut data_dir, mut secrets) = (None, None, false);
        let mut args = args.into_iter();
        while let Some(arg) = args.next() {
            if !arg.starts_with("--") && file.is_none() {
                file = Some(PathBuf::from(arg));
            } else if backup && arg == "--secrets" {
                secrets = true;
            } else if arg == "--data-dir" {
                data_dir = Some(args.next().ok_or(OptionsError::NoValue("data-dir"))?);
            } else if let Some(value) = arg.strip_prefix("--data-dir=") {
                data_dir = Some(value.to_owned());
            } else {
                return Err(OptionsError::Unknown(arg));
            }
        }
        let data_dir = data_dir
            .or_else(|| env("SUNREYE_DATA_DIR"))
            .ok_or(OptionsError::Missing("--data-dir or SUNREYE_DATA_DIR"))?;
        Ok(Self {
            file: file.ok_or(OptionsError::Missing("the backup's path"))?,
            data_dir: PathBuf::from(data_dir),
            secrets,
        })
    }
}

/// `sunreye backup`: backs up the store in the options' data directory, with the core running
/// or not, into the new file they name. Returns the file's size.
///
/// # Errors
/// The file exists, there is no store, or a file cannot be read or written.
pub fn command(options: &Options) -> Result<u64, Error> {
    use rusqlite::OpenFlags;
    let store = Connection::open_with_flags(
        options.data_dir.join(STORE),
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    let staged = Staged::new(&options.data_dir)?;
    copy(&store, &staged.0)?;
    drop(store);
    finish(&staged, &options.data_dir, &options.file, options.secrets)
}

/// Backs up the store behind `database`, with the car bodies of `data_dir`, into the new file
/// `file`; with the credential secrets only when `secrets`. Returns the file's size.
///
/// # Errors
/// `file` exists, or the store or a file cannot be read or written.
pub async fn write(
    database: &Database,
    data_dir: &Path,
    file: &Path,
    secrets: bool,
) -> Result<u64, Error> {
    let staged = Staged::new(data_dir)?;
    let path = staged.0.clone();
    database.run(move |db| copy(db, &path)).await?;
    let (data_dir, file) = (data_dir.to_owned(), file.to_owned());
    tokio::task::spawn_blocking(move || finish(&staged, &data_dir, &file, secrets))
        .await
        .map_err(io::Error::other)?
}

/// Restores the backup `file` into `data_dir`, replacing its store and car bodies; refused while
/// a core runs on it.
///
/// # Errors
/// A core runs on `data_dir`, the file is no backup or one of a newer schema, or a file cannot
/// be read or written. The data directory is then left as it was.
pub fn restore(file: &Path, data_dir: &Path) -> Result<(), Error> {
    startup::private(data_dir)?;
    let _claim = startup::claim(data_dir)?.ok_or(Error::Running)?;
    let store = data_dir.join(STORE);
    let (staged, cars) = (suffixed(&store, ".restore"), data_dir.join("cars.restore"));
    let unpacked = unpack(file, &staged, &cars).and_then(|()| check(&staged));
    if let Err(e) = unpacked {
        std::fs::remove_file(&staged).ok();
        std::fs::remove_dir_all(&cars).ok();
        return Err(e);
    }
    // The old store's WAL would be replayed onto the new one.
    for suffix in ["-wal", "-shm"] {
        remove(&suffixed(&store, suffix))?;
    }
    std::fs::rename(&staged, &store)?;
    match std::fs::remove_dir_all(data_dir.join(CARS)) {
        Err(e) if e.kind() != io::ErrorKind::NotFound => return Err(e.into()),
        _ => {}
    }
    std::fs::rename(&cars, data_dir.join(CARS))?;
    Ok(())
}

/// A copy of the store in the data directory, removed when dropped.
struct Staged(PathBuf);

impl Staged {
    fn new(data_dir: &Path) -> io::Result<Self> {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let n = NEXT.fetch_add(1, Ordering::Relaxed);
        let path = data_dir.join(format!("backup-{}-{n}.sqlite", std::process::id()));
        private_file(&path)?;
        Ok(Self(path))
    }
}

impl Drop for Staged {
    fn drop(&mut self) {
        for suffix in ["", "-journal", "-wal", "-shm"] {
            std::fs::remove_file(suffixed(&self.0, suffix)).ok();
        }
    }
}

/// Copies `db` page by page into the file at `to` (SQLite's online backup API).
fn copy(db: &Connection, to: &Path) -> rusqlite::Result<()> {
    use rusqlite::backup::{Backup, StepResult};
    let mut copy = Connection::open(to)?;
    // All pages in one step, under one read snapshot: a writer elsewhere cannot restart it.
    let step = Backup::new(db, &mut copy)?.step(-1)?;
    if matches!(step, StepResult::Done) {
        return Ok(());
    }
    Err(rusqlite::Error::SqliteFailure(
        rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_BUSY),
        Some("the backup did not complete".to_owned()),
    ))
}

/// Strips the staged copy to what a backup holds, then writes it and the car bodies to `file`.
fn finish(staged: &Staged, data_dir: &Path, file: &Path, secrets: bool) -> Result<u64, Error> {
    {
        let db = Connection::open(&staged.0)?;
        db.execute_batch("PRAGMA journal_mode = DELETE; PRAGMA secure_delete = ON;")?;
        if !secrets {
            db.execute("DELETE FROM secret", [])?;
        }
        // Free pages may hold a secret since changed or removed.
        db.execute_batch("VACUUM")?;
    }
    let out = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(file)
        .map_err(|e| {
            if e.kind() == io::ErrorKind::AlreadyExists {
                Error::Exists
            } else {
                Error::Io(e)
            }
        })?;
    let written = pack(out, &staged.0, &data_dir.join(CARS));
    if written.is_err() {
        std::fs::remove_file(file).ok();
    }
    Ok(written?)
}

/// Writes the store and each car body as one tar; returns its size.
fn pack(out: File, store: &Path, cars: &Path) -> io::Result<u64> {
    let mut out = BufWriter::new(out);
    let mut members = vec![(STORE.to_owned(), store.to_owned())];
    let mut bodies = match std::fs::read_dir(cars) {
        Ok(entries) => entries
            .map(|entry| entry.map(|e| e.file_name().to_string_lossy().into_owned()))
            .collect::<io::Result<Vec<_>>>()?,
        Err(e) if e.kind() == io::ErrorKind::NotFound => Vec::new(),
        Err(e) => return Err(e),
    };
    bodies.retain(|name| body(name));
    bodies.sort();
    members.extend(
        bodies
            .into_iter()
            .map(|name| (format!("{CARS}/{name}"), cars.join(name))),
    );
    for (name, path) in members {
        let mut file = File::open(path)?;
        let size = file.metadata()?.len();
        tar::append(&mut out, &name, size, &mut file)?;
    }
    tar::end(&mut out)?;
    let out = out.into_inner().map_err(io::IntoInnerError::into_error)?;
    out.sync_all()?;
    Ok(out.metadata()?.len())
}

/// A car body's file name: its SHA-256 in lowercase hex, then `.glb`.
fn body(name: &str) -> bool {
    name.strip_suffix(".glb").is_some_and(|id| {
        id.len() == 64 && id.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
    })
}

/// Unpacks the backup `file`: its store to `store`, its car bodies into `cars`.
fn unpack(file: &Path, store: &Path, cars: &Path) -> Result<(), Error> {
    remove(store)?;
    match std::fs::remove_dir_all(cars) {
        Err(e) if e.kind() != io::ErrorKind::NotFound => return Err(e.into()),
        _ => {}
    }
    std::fs::create_dir(cars)?;
    let mut found = false;
    tar::read(io::BufReader::new(File::open(file)?), |name, body| {
        let mut out = if name == STORE {
            found = true;
            private_file(store)?
        } else if let Some(name) = name.strip_prefix("cars/").filter(|n| self::body(n)) {
            private_file(&cars.join(name))?
        } else {
            return Err(Error::File(format!("unexpected member `{name}`")));
        };
        io::copy(body, &mut out)?;
        out.flush()?;
        Ok(())
    })
    .map_err(unreadable)?;
    found
        .then_some(())
        .ok_or_else(|| Error::File(format!("no `{STORE}`")))
}

/// A short archive or a foreign header as a file that is no backup.
fn unreadable(e: Error) -> Error {
    if let Error::Io(io) = &e {
        if io.kind() == io::ErrorKind::UnexpectedEof {
            return Error::File("cut short".into());
        }
        if io.kind() == io::ErrorKind::InvalidData {
            return Error::File("not a tar this build writes".into());
        }
    }
    e
}

/// Refuses a store that is not SQLite or whose schema is newer than this build's.
fn check(store: &Path) -> Result<(), Error> {
    let db = Connection::open(store)?;
    let version: i64 = db
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|e| Error::File(e.to_string()))?;
    if version > SCHEMA {
        return Err(Error::Newer(version));
    }
    Ok(())
}

/// Creates `path`, empty and readable by the core alone (ADR 7).
fn private_file(path: &Path) -> io::Result<File> {
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)
}

fn remove(path: &Path) -> io::Result<()> {
    match std::fs::remove_file(path) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        other => other,
    }
}

fn suffixed(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(suffix);
    PathBuf::from(name)
}

#[cfg(test)]
mod tests;
