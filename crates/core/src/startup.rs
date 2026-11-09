//! Startup (ADR 2): the two options, and the core served until shutdown.

use std::fmt;
use std::future::{Future, IntoFuture};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::time::{Duration, SystemTime};

use tokio::net::TcpListener;
use tokio::sync::{oneshot, watch};

use crate::api::{self, Api};
use crate::auth::Auth;
use crate::bus::Bus;
use crate::live::Live;
use crate::storage::{self, Storage};

const DEFAULT_LISTEN: SocketAddr =
    SocketAddr::new(std::net::IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED), 8099);
/// Storage closes a bucket and marks silent series once a minute (ADR 3).
const MINUTE: Duration = Duration::from_secs(60);
/// How long open requests may finish after a shutdown signal; live streams never do.
const GRACE: Duration = Duration::from_secs(3);

/// Everything startup takes; every other setting lives in SQLite.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Options {
    pub data_dir: PathBuf,
    pub listen: SocketAddr,
}

/// Why the options were refused.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OptionsError {
    Missing(&'static str),
    NoValue(&'static str),
    Address(String),
    Unknown(String),
}

impl fmt::Display for OptionsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Missing(flag) => write!(f, "--{flag} or {} is required", variable(flag)),
            Self::NoValue(flag) => write!(f, "--{flag} needs a value"),
            Self::Address(value) => write!(f, "--listen: `{value}` is not an address and port"),
            Self::Unknown(arg) => write!(f, "unknown argument `{arg}`"),
        }
    }
}

impl std::error::Error for OptionsError {}

/// `data-dir` reads `SUNREYE_DATA_DIR`.
fn variable(flag: &str) -> String {
    format!("SUNREYE_{}", flag.replace('-', "_").to_ascii_uppercase())
}

impl Options {
    /// Reads `--data-dir` and `--listen` from `args`, each falling back to its environment
    /// variable from `env`.
    ///
    /// # Errors
    /// No data directory, an address that does not parse, or an argument that is not a flag.
    pub fn parse(
        args: impl IntoIterator<Item = String>,
        env: impl Fn(&str) -> Option<String>,
    ) -> Result<Self, OptionsError> {
        let (mut data_dir, mut listen) = (None, None);
        let mut args = args.into_iter();
        while let Some(arg) = args.next() {
            let (name, inline) = match arg.split_once('=') {
                Some((name, value)) => (name, Some(value.to_owned())),
                None => (arg.as_str(), None),
            };
            let (flag, slot) = match name {
                "--data-dir" => ("data-dir", &mut data_dir),
                "--listen" => ("listen", &mut listen),
                _ => return Err(OptionsError::Unknown(arg)),
            };
            *slot = Some(
                inline
                    .or_else(|| args.next())
                    .ok_or(OptionsError::NoValue(flag))?,
            );
        }
        let data_dir = data_dir
            .or_else(|| env(&variable("data-dir")))
            .ok_or(OptionsError::Missing("data-dir"))?;
        let listen = match listen.or_else(|| env(&variable("listen"))) {
            Some(listen) => listen.parse().map_err(|_| OptionsError::Address(listen))?,
            None => DEFAULT_LISTEN,
        };
        Ok(Self {
            data_dir: PathBuf::from(data_dir),
            listen,
        })
    }
}

/// Why the core stopped.
#[derive(Debug)]
pub enum Error {
    Io(std::io::Error),
    Storage(storage::Error),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(e) => write!(f, "{e}"),
            Self::Storage(e) => write!(f, "storage: {e}"),
        }
    }
}

impl std::error::Error for Error {}

impl From<std::io::Error> for Error {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e)
    }
}

impl From<storage::Error> for Error {
    fn from(e: storage::Error) -> Self {
        Self::Storage(e)
    }
}

/// Opens the store in `data_dir` and serves the API on `listener` until `shutdown` resolves,
/// then writes the open bucket. `build` is the build time: the clock is unsynced until past it.
///
/// # Errors
/// The store cannot be opened or written, or serving fails.
pub async fn serve(
    listener: TcpListener,
    data_dir: PathBuf,
    build: SystemTime,
    shutdown: impl Future<Output = ()>,
) -> Result<(), Error> {
    std::fs::create_dir_all(&data_dir)?;
    let bus = Bus::default();
    let storage = Storage::open(&data_dir.join("core.sqlite"), build, &plant_zone(), &bus)?;
    // Problems are known before the first request.
    let (problems, watched) = watch::channel(Vec::new());
    tick(&storage, &problems).await?;
    let api = Api {
        auth: Auth::open(storage.database()).await?,
        live: Live::spawn(&bus),
        problems: watched,
    };
    let app = api::router(api).into_make_service_with_connect_info::<SocketAddr>();
    let (stop, stopped) = oneshot::channel::<()>();
    let server = axum::serve(listener, app).with_graceful_shutdown(async {
        stopped.await.ok();
    });
    let mut server = std::pin::pin!(server.into_future());
    tokio::select! {
        result = &mut server => result?,
        stopped = clock(&storage, &problems) => stopped?,
        () = shutdown => {
            stop.send(()).ok();
            if let Ok(result) = tokio::time::timeout(GRACE, &mut server).await {
                result?;
            }
        }
    }
    storage.shutdown().await?;
    Ok(())
}

/// The plant timezone is not configurable yet; the host's stands in.
fn plant_zone() -> String {
    jiff::tz::TimeZone::system()
        .iana_name()
        .unwrap_or("UTC")
        .to_owned()
}

/// Ticks storage once a minute, from a minute after the first tick.
async fn clock(
    storage: &Storage,
    problems: &watch::Sender<Vec<storage::Problem>>,
) -> Result<(), storage::Error> {
    let mut minute = tokio::time::interval_at(tokio::time::Instant::now() + MINUTE, MINUTE);
    loop {
        minute.tick().await;
        tick(storage, problems).await?;
    }
}

/// Tells storage the time and publishes its problems, logging each change.
async fn tick(
    storage: &Storage,
    problems: &watch::Sender<Vec<storage::Problem>>,
) -> Result<(), storage::Error> {
    storage.tick(SystemTime::now()).await?;
    let now = storage.problems().await?;
    problems.send_if_modified(|known| {
        if *known == now {
            return false;
        }
        for problem in now.iter().filter(|p| !known.contains(p)) {
            tracing::warn!(code = problem.code(), "problem");
        }
        for problem in known.iter().filter(|p| !now.contains(p)) {
            tracing::info!(code = problem.code(), "problem resolved");
        }
        known.clone_from(&now);
        true
    });
    Ok(())
}

#[cfg(test)]
mod tests;
