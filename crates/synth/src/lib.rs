//! The benchmark's data (ADR 24): years of the reference plant from a fixed seed, registered
//! through the core's API and inserted through its history import.

pub mod forecasts;
pub mod generate;
pub mod home;
pub mod meters;
pub mod model;
pub mod noise;
pub mod plant;
pub mod providers;
pub mod series;
pub mod sky;

use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use jiff::tz::TimeZone;
use sunreye_core::bus::Bus;
use sunreye_core::correction::Learner;
use sunreye_core::location::Location;
use sunreye_core::profiles::Chosen;
use sunreye_core::storage::{Backfill, Policy, Storage};
use sunreye_core::weather::{self, Past};
use sunreye_profile::RoleKind;
use sunreye_pv as pv;

use crate::generate::{Physics, Written};
use crate::home::Home;
use crate::model::Model;
use crate::noise::Noise;
use crate::plant::MEMBERS;
use crate::providers::{Archive, Clock, Forecasts, Prices};
use crate::series::{Member, Plant};
use crate::sky::Sky;

/// Bumped whenever the same seed would generate a different file.
pub const GENERATOR: u32 = 2;
/// The store's file name in the data directory, as the core opens it.
pub const STORE: &str = "core.sqlite";
/// Change-point retention's default (ADR 3): readings are generated for this long before the end.
pub const RETENTION_DAYS: i64 = 1827;
/// The archive weather a learner run fetches at once.
const ARCHIVE_DAYS: i64 = 30;

/// The cache key of a generated file (ADR 24): this generator's version and the seed. A file of
/// an earlier schema is migrated by the core that opens it.
#[must_use]
pub fn key(seed: u64) -> String {
    format!("generator{GENERATOR}-seed{seed}")
}

#[derive(Debug)]
pub enum Error {
    /// The data directory already holds a store.
    Exists(PathBuf),
    Io(std::io::Error),
    /// The core refused or failed.
    Core(String),
    /// Registering the plant through the API failed.
    Setup(String),
}

impl Error {
    pub(crate) fn core(e: impl fmt::Display) -> Self {
        Self::Core(e.to_string())
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Exists(path) => write!(f, "{} exists", path.display()),
            Self::Io(e) => write!(f, "{e}"),
            Self::Core(e) => write!(f, "core: {e}"),
            Self::Setup(e) => write!(f, "setup: {e}"),
        }
    }
}

impl std::error::Error for Error {}

impl From<std::io::Error> for Error {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e)
    }
}

/// What to generate: the data directory, the span in Unix seconds, how much of it ends as
/// readings rather than hourly values, and the seed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Options {
    pub out: PathBuf,
    /// Whole hours.
    pub from: i64,
    pub to: i64,
    pub readings: Duration,
    pub seed: u64,
}

/// What was generated.
#[derive(Debug, Clone, PartialEq)]
pub struct Summary {
    pub written: Written,
    pub forecasts: usize,
    /// The store's size in bytes.
    pub bytes: u64,
}

/// Generates the store in a data directory that must not yet hold one.
///
/// # Errors
/// The directory holds a store, the core failed, or the plant could not be registered.
pub fn generate(options: &Options) -> Result<Summary, Error> {
    let path = options.out.join(STORE);
    if path.exists() {
        return Err(Error::Exists(path));
    }
    std::fs::create_dir_all(&options.out)?;
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    let (written, forecasts) = runtime.block_on(insert(options, &path))?;
    let bytes = std::fs::metadata(&path)?.len();
    Ok(Summary {
        written,
        forecasts,
        bytes,
    })
}

/// The reference plant's sky, from `seed`.
#[must_use]
pub const fn sky(seed: u64) -> Sky {
    Sky::new(
        seed,
        pv::Location {
            latitude: plant::LATITUDE,
            longitude: plant::LONGITUDE,
        },
    )
}

#[expect(
    clippy::too_many_lines,
    reason = "wires the core's modules together, as startup does"
)]
async fn insert(options: &Options, path: &Path) -> Result<(Written, usize), Error> {
    let (from, to) = (options.from, options.to);
    let raw = (to - i64::try_from(options.readings.as_secs()).unwrap_or(0)).max(from);
    let bus = Bus::default();
    // The image has no zone of its own: the admin sets the plant's.
    let storage = Storage::open(path, UNIX_EPOCH, "UTC", &bus).map_err(Error::core)?;
    let registered = plant::register(&storage, &bus, &options.out, instant(from)).await?;
    let zone = TimeZone::get(plant::ZONE).map_err(Error::core)?;
    let location = Location {
        latitude: plant::LATITUDE,
        longitude: plant::LONGITUDE,
    };
    let sky = sky(options.seed);
    let mut written = Written::default();
    let began = Instant::now();
    let model = Model::run(&registered.wiring, sky, from, to);
    written
        .seconds
        .push(("pv model", began.elapsed().as_secs_f64()));
    let profiles = MEMBERS
        .iter()
        .map(|m| {
            registered
                .catalogue
                .resolve(&Chosen::new(m.profile, m.variant))
                .ok_or_else(|| Error::Setup(format!("no profile {}", m.profile)))
        })
        .collect::<Result<Vec<_>, Error>>()?;
    let members: Vec<Member<'_>> = MEMBERS
        .iter()
        .zip(&registered.devices)
        .zip(&profiles)
        .map(|((m, &id), profile)| Member {
            id,
            kind: m.kind,
            profile,
        })
        .collect();
    let versions = registered
        .topologies
        .versions()
        .await
        .map_err(Error::core)?;
    let points = versions
        .last()
        .map(|v| v.points.clone())
        .unwrap_or_default();
    let plant = Plant::new(&members, points, &registered.strings, &bus);
    let prices = || Prices {
        noise: Noise::new(options.seed),
        sky,
        zone: zone.clone(),
    };
    let market = prices();
    let physics = Physics {
        sky,
        model: &model,
        prices: &market,
        plant: &plant,
    };
    let home = Home::new(options.seed, sky, zone.clone(), registered.wiring.ratings);
    generate::history(&storage, &physics, home, (from, raw, to), &mut written).await?;
    let clock = Clock::default();
    clock.set(to);
    let archive = Arc::new(Past::new(
        Archive {
            sky,
            clock: clock.clone(),
        },
        weather::DEVICE,
        &bus,
    ));
    let began = Instant::now();
    archived(&storage, &archive, location, (raw, to)).await?;
    written.days += old_weather(&storage, sky, (from, raw), &bus).await?;
    written
        .seconds
        .push(("archive weather", began.elapsed().as_secs_f64()));
    let began = Instant::now();
    let forecasts = forecasts::solar(
        &storage,
        (sky, &registered.wiring, &zone),
        &plant.stored,
        &registered.strings,
        (from, to),
    )
    .await?;
    forecasts::spot(&storage, (prices(), &zone, &clock), (from, to), &bus).await?;
    let provider = Forecasts {
        sky,
        clock: clock.clone(),
        zone: zone.clone(),
    };
    forecasts::weather(&storage, (provider, &zone, &clock), location, to, &bus).await?;
    written
        .seconds
        .push(("forecasts", began.elapsed().as_secs_f64()));
    let began = Instant::now();
    clock.set(to);
    let learner = Learner::new(archive, weather::DEVICE, registered.layouts, &storage);
    // A live learner's first run: archive weather 90 days back, and the grids learned from it.
    learner
        .learn(&storage, location, &zone, instant(to))
        .await
        .map_err(|e| Error::Core(format!("correction: {e}")))?;
    written
        .seconds
        .push(("correction", began.elapsed().as_secs_f64()));
    storage.shutdown().await.map_err(Error::core)?;
    Ok((written, forecasts))
}

/// Archive weather from `raw` to `to` through the core's own archive fetch, a learner run's chunk
/// at a time, and the years before as the daily values the core keeps of them.
async fn archived(
    storage: &Storage,
    archive: &Past<Archive>,
    location: Location,
    (raw, to): (i64, i64),
) -> Result<(), Error> {
    let day = |unix: i64| {
        jiff::Timestamp::from_second(unix)
            .map(|t| t.to_zoned(TimeZone::UTC).date())
            .map_err(Error::core)
    };
    let mut start = raw;
    while start < to {
        let end = (start + ARCHIVE_DAYS * 86_400).min(to);
        let (first, last) = (day(start)?, day(end - 1)?);
        archive
            .fetch(storage, location, first, last)
            .await
            .map_err(|e| Error::Core(format!("archive weather: {e}")))?;
        start = end;
    }
    Ok(())
}

/// The archive weather of the years from `from` to `raw` as the daily means the core keeps past
/// retention (ADR 3); answers the days written.
async fn old_weather(
    storage: &Storage,
    sky: Sky,
    (from, raw): (i64, i64),
    bus: &Bus,
) -> Result<usize, Error> {
    let first = from.div_euclid(86_400) * 86_400;
    let days: Vec<i64> = (first..=raw - 86_400).step_by(86_400).collect();
    if days.is_empty() {
        return Ok(0);
    }
    let slots: Vec<Vec<sunreye_core::weather::Slot>> = model::parallel(days.len(), |i| {
        days.get(i).map_or_else(Vec::new, |&day| {
            (0..24).map(|h| sky.slot(sky.at(day + h * 3600))).collect()
        })
    });
    let mut written = 0;
    for quantity in &providers::ARCHIVED {
        let values = days
            .iter()
            .zip(&slots)
            .filter_map(|(&day, slots)| {
                let values: Vec<f64> = slots.iter().filter_map(quantity.value).collect();
                #[expect(clippy::cast_precision_loss, reason = "hours of a day")]
                let mean = values.iter().sum::<f64>() / values.len() as f64;
                (!values.is_empty()).then(|| (instant(day), mean))
            })
            .collect();
        let policy = Policy::new(
            RoleKind::Measurement,
            None,
            quantity.step,
            Duration::from_hours(1),
        )
        .in_unit(quantity.unit);
        let backfill = Backfill {
            days: values,
            ..Backfill::default()
        };
        let series = bus.intern(quantity.role, None);
        written += storage
            .import(weather::DEVICE, series, policy, backfill)
            .await
            .map_err(|e| Error::Core(format!("{}: {e}", quantity.role)))?
            .days;
    }
    Ok(written)
}

/// The instant `unix` seconds after the epoch.
#[must_use]
pub fn instant(unix: i64) -> SystemTime {
    UNIX_EPOCH + seconds(unix)
}

/// `count` seconds, none when negative.
#[must_use]
pub fn seconds(count: i64) -> Duration {
    Duration::from_secs(count.max(0).cast_unsigned())
}

/// Unix seconds of `time`.
#[must_use]
pub fn unix(time: SystemTime) -> i64 {
    time.duration_since(UNIX_EPOCH)
        .map_or(0, |d| i64::try_from(d.as_secs()).unwrap_or(i64::MAX))
}
