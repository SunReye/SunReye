//! Startup (ADR 2): the options, and the core served until shutdown.

use std::fmt;
use std::future::{Future, IntoFuture};
use std::net::{IpAddr, SocketAddr};
use std::path::PathBuf;
use std::time::{Duration, SystemTime};

use tokio::net::TcpListener;
use tokio::sync::{oneshot, watch};

use crate::api::{self, Api};
use crate::auth::Auth;
use crate::bus::Bus;
use crate::cars::CarBodies;
use crate::changes::Changes;
use crate::correction::Learner;
use crate::devices::Devices;
use crate::estimates::StringEstimates;
use crate::layout::{Inverters, Layouts};
use crate::live::Live;
use crate::location::{Location, PlantLocation};
use crate::plant::Plant;
use crate::profiles::{self, Profiles};
use crate::solar::SolarForecast;
use crate::storage::{self, Storage};
use crate::tariff::{TariffDevice, Tariffs};
use crate::topology::Topologies;
use crate::weather::{self, Archive, Provider, Weather};

const DEFAULT_LISTEN: SocketAddr =
    SocketAddr::new(IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED), 8099);
/// The store's file in the data directory.
pub(crate) const STORE: &str = "core.sqlite";
/// Storage closes a bucket and marks silent series once a minute (ADR 3).
const MINUTE: Duration = Duration::from_secs(60);
/// How long open requests may finish after a shutdown signal; live streams never do.
const GRACE: Duration = Duration::from_secs(3);

/// Everything startup takes; every other setting lives in SQLite.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Options {
    pub data_dir: PathBuf,
    pub listen: SocketAddr,
    /// The Home Assistant Supervisor's address, whose ingress requests act as admin (ADR 9).
    /// Only the add-on image sets it.
    pub ingress: Option<IpAddr>,
}

/// Why the options were refused.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OptionsError {
    Missing(&'static str),
    NoValue(&'static str),
    Address(String),
    Ip(String),
    Unknown(String),
}

impl fmt::Display for OptionsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Missing(flag) => write!(f, "--{flag} or {} is required", variable(flag)),
            Self::NoValue(flag) => write!(f, "--{flag} needs a value"),
            Self::Address(value) => write!(f, "--listen: `{value}` is not an address and port"),
            Self::Ip(value) => write!(f, "--ingress: `{value}` is not an IP address"),
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
    /// Reads `--data-dir`, `--listen` and `--ingress` from `args`, each falling back to its environment
    /// variable from `env`.
    ///
    /// # Errors
    /// No data directory, an address that does not parse, or an argument that is not a flag.
    pub fn parse(
        args: impl IntoIterator<Item = String>,
        env: impl Fn(&str) -> Option<String>,
    ) -> Result<Self, OptionsError> {
        let (mut data_dir, mut listen, mut ingress) = (None, None, None);
        let mut args = args.into_iter();
        while let Some(arg) = args.next() {
            let (name, inline) = match arg.split_once('=') {
                Some((name, value)) => (name, Some(value.to_owned())),
                None => (arg.as_str(), None),
            };
            let (flag, slot) = match name {
                "--data-dir" => ("data-dir", &mut data_dir),
                "--listen" => ("listen", &mut listen),
                "--ingress" => ("ingress", &mut ingress),
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
        let ingress = match ingress.or_else(|| env(&variable("ingress"))) {
            Some(ingress) => Some(ingress.parse().map_err(|_| OptionsError::Ip(ingress))?),
            None => None,
        };
        Ok(Self {
            data_dir: PathBuf::from(data_dir),
            listen,
            ingress,
        })
    }
}

/// Why the core stopped.
#[derive(Debug)]
pub enum Error {
    Io(std::io::Error),
    Storage(storage::Error),
    /// The profiles cannot be opened.
    Profiles(profiles::Error),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(e) => write!(f, "{e}"),
            Self::Storage(e) => write!(f, "storage: {e}"),
            Self::Profiles(e) => write!(f, "profiles: {e}"),
        }
    }
}

impl std::error::Error for Error {}

impl From<std::io::Error> for Error {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e)
    }
}

impl From<profiles::Error> for Error {
    fn from(e: profiles::Error) -> Self {
        Self::Profiles(e)
    }
}

impl From<storage::Error> for Error {
    fn from(e: storage::Error) -> Self {
        Self::Storage(e)
    }
}

/// What the core starts from, besides its listener.
#[derive(Debug)]
pub struct Boot<P, A> {
    pub data_dir: PathBuf,
    /// The Supervisor's address, if trusted.
    pub ingress: Option<IpAddr>,
    /// The build time: the clock is unsynced until past it.
    pub build: SystemTime,
    /// The weather device's provider.
    pub weather: P,
    /// Where past weather is fetched from for learning.
    pub archive: A,
    /// Where profile indexes are fetched from.
    pub fetch: std::sync::Arc<dyn profiles::Fetch>,
    /// The compiled-in profile keys.
    pub keys: Option<profiles::Keys>,
}

/// Creates `dir` if needed, readable by the core alone (ADR 7): its database holds the connections'
/// secrets.
fn private(dir: &std::path::Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt as _;
    std::fs::create_dir_all(dir)?;
    std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))
}

/// Opens the store in the data directory and serves the API on `listener` until `shutdown`
/// resolves, then writes the open bucket.
///
/// # Errors
/// The store cannot be opened or written, or serving fails.
pub async fn serve(
    listener: TcpListener,
    boot: Boot<impl Provider + Send, impl Archive + Send>,
    shutdown: impl Future<Output = ()>,
) -> Result<(), Error> {
    private(&boot.data_dir)?;
    let bus = Bus::default();
    let file = boot.data_dir.join(STORE);
    let zone = plant_zone();
    let storage = Storage::open(&file, boot.build, &zone, &bus)?;
    let (problems, watched) = problems(&storage).await?;
    let profiles = Profiles::open(storage.database(), boot.fetch, boot.keys).await?;
    let (devices, layouts) = devices(&storage, &profiles, &bus).await?;
    let (topologies, tariffs) = (
        Topologies::new(storage.database()),
        Tariffs::new(&storage, &bus, storage.zones().watch()),
    );
    let _computed = Computed::spawn(&storage, (&layouts, &topologies, &tariffs), &bus);
    let location = PlantLocation::open(storage.database()).await?;
    let forecasting = forecast(
        &storage,
        (boot.weather, boot.archive),
        layouts.clone(),
        location.watch(),
        &bus,
    );
    let api = Api {
        auth: Auth::open(storage.database(), boot.ingress).await?,
        live: Live::spawn(&bus),
        problems: watched,
        history: storage.reader(),
        layouts,
        devices,
        changes: Changes::new(storage.database()),
        location,
        profiles,
        topologies,
        tariffs,
        cars: CarBodies::new(boot.data_dir.join("cars")),
        zones: storage.zones(),
        clock: std::sync::Arc::new(SystemTime::now),
    };
    let background = async {
        tokio::select! {
            stopped = clock(&storage, &problems) => stopped,
            // Both stop only once storage has.
            () = forecasting => Ok(()),
        }
    };
    until(listener, api::router(api), background, shutdown).await?;
    storage.shutdown().await?;
    Ok(())
}

/// The registered devices, and the PV layouts over their inverters.
async fn devices(
    storage: &Storage,
    profiles: &Profiles,
    bus: &Bus,
) -> Result<(Devices, Layouts), Error> {
    let inverters = Inverters::default();
    let devices = Devices::start(
        storage.database(),
        storage.declarer(),
        profiles.catalogue(),
        bus.clone(),
        inverters.clone(),
    )
    .await?;
    Ok((devices, Layouts::new(storage.database(), inverters)))
}

/// Serves `router` on `listener` until `background` ends or `shutdown` resolves, then lets open
/// requests finish for a grace period.
async fn until(
    listener: TcpListener,
    router: axum::Router,
    background: impl Future<Output = Result<(), storage::Error>>,
    shutdown: impl Future<Output = ()>,
) -> Result<(), Error> {
    let app = router.into_make_service_with_connect_info::<SocketAddr>();
    let (stop, stopped) = oneshot::channel::<()>();
    let server = axum::serve(listener, app).with_graceful_shutdown(async {
        stopped.await.ok();
    });
    let mut server = std::pin::pin!(server.into_future());
    tokio::select! {
        result = &mut server => result?,
        stopped = background => stopped?,
        () = shutdown => {
            stop.send(()).ok();
            if let Ok(result) = tokio::time::timeout(GRACE, &mut server).await {
                result?;
            }
        }
    }
    Ok(())
}

/// The computed devices driven by the bus (ADR 15); dropping it stops them.
struct Computed {
    _estimates: StringEstimates,
    _plant: Plant,
    _tariff: TariffDevice,
}

impl Computed {
    fn spawn(
        storage: &Storage,
        (layouts, topologies, tariffs): (&Layouts, &Topologies, &Tariffs),
        bus: &Bus,
    ) -> Self {
        Self {
            _estimates: StringEstimates::spawn(
                layouts.clone(),
                storage.reader(),
                storage.declarer(),
                bus,
            ),
            _plant: Plant::spawn(topologies.clone(), storage.declarer(), bus),
            _tariff: TariffDevice::spawn(tariffs.clone(), std::sync::Arc::new(SystemTime::now)),
        }
    }
}

/// Runs the weather device, the solar forecast and the correction learner until storage stops.
async fn forecast(
    storage: &Storage,
    (provider, archive): (impl Provider, impl Archive),
    layouts: Layouts,
    location: watch::Receiver<Option<Location>>,
    bus: &Bus,
) {
    let weather = Weather::new(provider, weather::DEVICE, bus);
    let solar = SolarForecast::new(layouts.clone(), weather::DEVICE, bus);
    let learner = Learner::new(archive, weather::DEVICE, layouts, storage, bus);
    tokio::join!(
        weather.run(storage, location.clone(), SystemTime::now),
        solar.run(storage, location.clone(), weather.issues(), SystemTime::now),
        // Boxed: its learn run alone would make the core's future large.
        Box::pin(learner.run(storage, location, storage.zones().watch(), SystemTime::now)),
    );
}

/// The host's zone stands in until the admin sets the plant timezone.
/// The host's zone, which days are cut in until the admin sets the plant's.
pub(crate) fn plant_zone() -> String {
    jiff::tz::TimeZone::system()
        .iana_name()
        .unwrap_or("UTC")
        .to_owned()
}

type Problems = watch::Sender<Vec<storage::Problem>>;

/// Storage's problems, known before the first request.
async fn problems(
    storage: &Storage,
) -> Result<(Problems, watch::Receiver<Vec<storage::Problem>>), storage::Error> {
    let (problems, watched) = watch::channel(Vec::new());
    tick(storage, &problems).await?;
    Ok((problems, watched))
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
