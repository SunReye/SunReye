//! The weather computed device (ADR 15, 17): irradiance, temperature and wind forecasts for the
//! plant's location, fetched by its own task through an interchangeable provider.

#[cfg(test)]
pub mod fake;
mod open_meteo;

use std::collections::HashMap;
use std::fmt;
use std::future::Future;
use std::ops::{ControlFlow, Range};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rusqlite::OptionalExtension;
use sunreye_profile::RoleKind;

use tokio::sync::watch;
use tokio::time::Instant;

use crate::bus::{Bus, DeviceId, Series, SeriesId};
use crate::location::Location;
use crate::storage::{self, ChangePoint, Issue, Policy, Storage};
use crate::utc_day;

#[cfg(test)]
pub use open_meteo::parse_archive;
pub use open_meteo::{OpenMeteo, OpenMeteoArchive};

const HOUR: Duration = Duration::from_secs(3600);
/// Days the backfill fetches in one request.
const CHUNK_DAYS: i64 = 30;
/// The backfill's first wait after a refused request.
const BACKOFF: Duration = Duration::from_secs(60);

/// The weather device's id: computed devices count down from the top, registered devices up
/// from 1 (ADR 15).
pub const DEVICE: DeviceId = DeviceId(u32::MAX);

/// The weather at one 15-minute target, irradiance in W/m².
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Slot {
    pub target: SystemTime,
    pub ghi: f64,
    pub dni: f64,
    pub dhi: f64,
    /// Air temperature in °C.
    pub temperature: f64,
    /// Wind speed in m/s, when the provider has it.
    pub wind: Option<f64>,
    pub detail: Detail,
}

/// The weather beyond what the PV model reads (ADR 23), each when the provider has it.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Detail {
    /// The WMO weather code.
    pub code: Option<f64>,
    /// In mm/h.
    pub precipitation: Option<f64>,
    /// In cm/h.
    pub snowfall: Option<f64>,
    /// In m.
    pub visibility: Option<f64>,
    /// Relative humidity in %.
    pub humidity: Option<f64>,
    /// Where the wind comes from in °, 0 north, 90 east.
    pub wind_direction: Option<f64>,
    /// In m/s.
    pub gusts: Option<f64>,
    /// In °C.
    pub apparent_temperature: Option<f64>,
    /// Seconds of sunshine in the slot.
    pub sunshine: Option<f64>,
    /// In %; the forecast has it at whole hours only.
    pub cloud_cover: Option<f64>,
    /// In m; the forecast has it at whole hours only.
    pub snow_depth: Option<f64>,
}

/// A source of weather forecasts: Open-Meteo, or a fake in tests.
pub trait Provider: Sync {
    /// The forecast at 15-minute resolution for today and two more days at `location`.
    fn fetch(&self, location: Location) -> impl Future<Output = Result<Vec<Slot>, Error>> + Send;
}

/// A source of past weather: Open-Meteo's archive, or a fake in tests.
pub trait Archive: Sync {
    /// The weather hourly at `location` over the UTC days `from` to `to`, both included; hours
    /// the source has not settled yet are absent.
    fn fetch(
        &self,
        location: Location,
        from: jiff::civil::Date,
        to: jiff::civil::Date,
    ) -> impl Future<Output = Result<Vec<Slot>, Error>> + Send;
}

#[derive(Debug)]
pub enum Error {
    /// The provider could not be reached or refused the request.
    Fetch(String),
    /// The provider's answer is not a forecast.
    Format,
    Storage(storage::Error),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Fetch(e) => write!(f, "fetch: {e}"),
            Self::Format => f.write_str("the answer is not a forecast"),
            Self::Storage(e) => write!(f, "storage: {e}"),
        }
    }
}

impl std::error::Error for Error {}

impl From<storage::Error> for Error {
    fn from(e: storage::Error) -> Self {
        Self::Storage(e)
    }
}

/// What the PV model reads.
const GHI: &str = "weather.ghi";
const DNI: &str = "weather.dni";
const DHI: &str = "weather.dhi";
const TEMPERATURE: &str = "weather.temperature";
const WIND: &str = "weather.wind";
/// The first of ADR 23's roles: where it starts, the backfill's span ends.
const CODE: &str = "weather.code";
/// Snow depth, which the clear-sky index reads.
pub const SNOW_DEPTH: &str = "weather.snow_depth";

/// One stored quantity: its role, its kind, its unit's symbol, the step it is stored in, its
/// value in a slot, whether the archive has it and whether the PV model reads it.
struct Quantity {
    role: &'static str,
    kind: RoleKind,
    unit: Option<&'static str>,
    step: f64,
    value: fn(&Slot) -> Option<f64>,
    archived: bool,
    /// The correction learner fetches these from the start (ADR 17); the backfill the rest.
    model: bool,
}

const QUANTITIES: [Quantity; 16] = [
    Quantity {
        role: GHI,
        kind: RoleKind::Measurement,
        unit: Some("W/m²"),
        step: 0.1,
        value: |s| Some(s.ghi),
        archived: true,
        model: true,
    },
    Quantity {
        role: DNI,
        kind: RoleKind::Measurement,
        unit: Some("W/m²"),
        step: 0.1,
        value: |s| Some(s.dni),
        archived: true,
        model: true,
    },
    Quantity {
        role: DHI,
        kind: RoleKind::Measurement,
        unit: Some("W/m²"),
        step: 0.1,
        value: |s| Some(s.dhi),
        archived: true,
        model: true,
    },
    Quantity {
        role: TEMPERATURE,
        kind: RoleKind::Measurement,
        unit: Some("°C"),
        step: 0.1,
        value: |s| Some(s.temperature),
        archived: true,
        model: true,
    },
    Quantity {
        role: WIND,
        kind: RoleKind::Measurement,
        unit: Some("m/s"),
        step: 0.01,
        value: |s| s.wind,
        archived: true,
        model: true,
    },
    Quantity {
        role: CODE,
        kind: RoleKind::Status,
        unit: None,
        step: 1.0,
        value: |s| s.detail.code,
        archived: true,
        model: false,
    },
    Quantity {
        role: "weather.precipitation",
        kind: RoleKind::Measurement,
        unit: Some("mm/h"),
        step: 0.01,
        value: |s| s.detail.precipitation,
        archived: true,
        model: false,
    },
    Quantity {
        role: "weather.snowfall",
        kind: RoleKind::Measurement,
        unit: Some("cm/h"),
        step: 0.01,
        value: |s| s.detail.snowfall,
        archived: true,
        model: false,
    },
    Quantity {
        role: "weather.visibility",
        kind: RoleKind::Measurement,
        unit: Some("m"),
        step: 1.0,
        value: |s| s.detail.visibility,
        archived: false,
        model: false,
    },
    Quantity {
        role: "weather.humidity",
        kind: RoleKind::Measurement,
        unit: Some("%"),
        step: 0.1,
        value: |s| s.detail.humidity,
        archived: true,
        model: false,
    },
    Quantity {
        role: "weather.wind_direction",
        kind: RoleKind::Measurement,
        unit: Some("°"),
        step: 1.0,
        value: |s| s.detail.wind_direction,
        archived: true,
        model: false,
    },
    Quantity {
        role: "weather.gusts",
        kind: RoleKind::Measurement,
        unit: Some("m/s"),
        step: 0.01,
        value: |s| s.detail.gusts,
        archived: true,
        model: false,
    },
    Quantity {
        role: "weather.apparent_temperature",
        kind: RoleKind::Measurement,
        unit: Some("°C"),
        step: 0.1,
        value: |s| s.detail.apparent_temperature,
        archived: true,
        model: false,
    },
    Quantity {
        role: "weather.sunshine",
        kind: RoleKind::Measurement,
        unit: Some("s"),
        step: 1.0,
        value: |s| s.detail.sunshine,
        archived: true,
        model: false,
    },
    Quantity {
        role: "weather.cloud_cover",
        kind: RoleKind::Measurement,
        unit: Some("%"),
        step: 1.0,
        value: |s| s.detail.cloud_cover,
        archived: true,
        model: false,
    },
    Quantity {
        role: SNOW_DEPTH,
        kind: RoleKind::Measurement,
        unit: Some("m"),
        step: 0.001,
        value: |s| s.detail.snow_depth,
        archived: true,
        model: false,
    },
];

/// The clear-sky index, measured rather than fetched (ADR 23).
pub const CLEAR_SKY_INDEX: &str = "weather.clearness";

/// The roles the weather device stores, as capabilities report them (ADR 15).
pub fn roles() -> impl Iterator<Item = &'static str> {
    QUANTITIES
        .iter()
        .map(|q| q.role)
        .chain(std::iter::once(CLEAR_SKY_INDEX))
}

/// The weather device. Only its own task fetches; everyone else reads the forecast store.
pub struct Weather<P> {
    provider: P,
    device: DeviceId,
    series: [SeriesId; QUANTITIES.len()],
    issued: watch::Sender<Option<SystemTime>>,
}

impl<P: Provider> Weather<P> {
    pub fn new(provider: P, device: DeviceId, bus: &Bus) -> Self {
        Self {
            provider,
            device,
            series: QUANTITIES.map(|q| bus.intern(q.role, None)),
            issued: watch::channel(None).0,
        }
    }

    /// The issue time of the latest forecast stored, announced as each is stored.
    pub fn issues(&self) -> watch::Receiver<Option<SystemTime>> {
        self.issued.subscribe()
    }

    /// Fetches for the plant's `location` while one is set: on start, at once when it changes,
    /// and hourly from then, until storage or the location stops. A failed fetch keeps the last
    /// good forecast.
    pub async fn run(
        &self,
        storage: &Storage,
        mut location: watch::Receiver<Option<Location>>,
        clock: impl Fn() -> SystemTime + Sync,
    ) {
        let mut next = Instant::now();
        loop {
            let current = *location.borrow_and_update();
            if let Some(at) = current
                && self.announce(storage, at, clock()).await.is_break()
            {
                return;
            }
            next += HOUR;
            // Armed only after the refresh, so no timer is pending while it waits on storage.
            tokio::select! {
                () = tokio::time::sleep_until(next) => {}
                changed = location.changed() => {
                    if changed.is_err() {
                        return;
                    }
                    next = Instant::now();
                }
            }
        }
    }

    /// Refreshes and announces the issue; breaks once storage has stopped.
    async fn announce(
        &self,
        storage: &Storage,
        location: Location,
        issued: SystemTime,
    ) -> ControlFlow<()> {
        match self.refresh(storage, location, issued).await {
            Ok(()) => {
                self.issued.send_replace(Some(issued));
            }
            Err(Error::Storage(storage::Error::Stopped)) => return ControlFlow::Break(()),
            Err(e) => tracing::warn!("weather: {e}"),
        }
        ControlFlow::Continue(())
    }

    /// Fetches one forecast for the plant at `location` and stores it as issued at `issued`.
    ///
    /// # Errors
    /// The provider or storage failed.
    pub async fn refresh(
        &self,
        storage: &Storage,
        location: Location,
        issued: SystemTime,
    ) -> Result<(), Error> {
        let slots = self.provider.fetch(location.rounded()).await?;
        for (quantity, series) in QUANTITIES.iter().zip(self.series) {
            let values = slots
                .iter()
                .filter_map(|s| Some((s.target, (quantity.value)(s)?)))
                .collect();
            let issue = Issue {
                issued,
                step: quantity.step,
                values,
            };
            storage.forecast(self.device, series, issue).await?;
        }
        Ok(())
    }
}

/// Past weather (ADR 17): fetched from an archive and stored as `weather.*` history, so learning
/// and charts read it locally.
pub struct Past<A> {
    archive: A,
    device: DeviceId,
    series: [SeriesId; QUANTITIES.len()],
}

impl<A: Archive> Past<A> {
    pub fn new(archive: A, device: DeviceId, bus: &Bus) -> Self {
        Self {
            archive,
            device,
            series: QUANTITIES.map(|q| bus.intern(q.role, None)),
        }
    }

    /// Fetches the UTC days `from` to `to` for the plant at `location` and stores them hourly,
    /// replacing what was stored for those hours; an hour the archive lacks is a gap.
    ///
    /// # Errors
    /// The archive or storage failed.
    pub async fn fetch(
        &self,
        storage: &Storage,
        location: Location,
        from: jiff::civil::Date,
        to: jiff::civil::Date,
    ) -> Result<(), Error> {
        let slots = self.archive.fetch(location.rounded(), from, to).await?;
        let (Some(first), Some(last)) = (slots.first(), slots.last()) else {
            return Ok(());
        };
        let archived = QUANTITIES
            .iter()
            .zip(self.series)
            .filter(|(q, _)| q.archived);
        let end = last.target + HOUR;
        for (quantity, series) in archived {
            let mut points = hourly(quantity, &slots, first.target..end);
            // Past the last hour nothing is known.
            points.push(ChangePoint {
                time: end,
                value: None,
            });
            let range = first.target..end + Duration::from_secs(1);
            self.replace(storage, (quantity, series), range, points)
                .await?;
        }
        Ok(())
    }

    /// Once after the upgrade (ADR 23), while the plant's `location` is set: fetches the archive
    /// for the quantities the PV model does not read over the span weather history covered
    /// then, newest first in 30-day chunks. Each chunk stored is recorded, so a restart resumes;
    /// a refused request is retried after a wait that doubles up to an hour. Returns when all is
    /// fetched, or once storage or the location stops.
    pub async fn backfill(
        &self,
        storage: &Storage,
        mut location: watch::Receiver<Option<Location>>,
    ) {
        let mut wait = BACKOFF;
        loop {
            let Some(at) = location
                .wait_for(Option::is_some)
                .await
                .ok()
                .and_then(|at| *at)
            else {
                return;
            };
            match self.chunk(storage, at).await {
                Ok(ControlFlow::Break(())) | Err(Error::Storage(storage::Error::Stopped)) => return,
                Ok(ControlFlow::Continue(())) => wait = BACKOFF,
                Err(Error::Storage(e)) => {
                    tracing::warn!("weather backfill: {e}");
                    return;
                }
                Err(e) => {
                    tracing::warn!("weather backfill: {e}");
                    // Armed only after storage, so no timer is pending while it waits on it.
                    tokio::time::sleep(wait).await;
                    wait = (wait * 2).min(HOUR);
                }
            }
        }
    }

    /// Fetches and stores the newest chunk left; breaks once none is.
    async fn chunk(&self, storage: &Storage, location: Location) -> Result<ControlFlow<()>, Error> {
        let Some((start, until)) = self.left(storage).await? else {
            return Ok(ControlFlow::Break(()));
        };
        let database = storage.database();
        if until <= start {
            database
                .run(|db| db.execute("DELETE FROM weather_backfill", []))
                .await?;
            return Ok(ControlFlow::Break(()));
        }
        let last = utc_day::of(until - Duration::from_secs(1));
        let first = utc_day::of(start).max(last - jiff::Span::new().days(CHUNK_DAYS - 1));
        let slots = self.archive.fetch(location.rounded(), first, last).await?;
        let from = utc_day::start(first).max(start);
        let detail = QUANTITIES
            .iter()
            .zip(&self.series)
            .filter(|(q, _)| q.archived && !q.model);
        for (quantity, &series) in detail {
            // No gap at `until`: newer history may start there.
            let points = hourly(quantity, &slots, from..until);
            self.replace(storage, (quantity, series), from..until, points)
                .await?;
        }
        let until = seconds(from);
        database
            .run(move |db| db.execute("UPDATE weather_backfill SET until = ?1", [until]))
            .await?;
        Ok(ControlFlow::Continue(()))
    }

    /// What is left to fetch; none once all is. The span is taken on the first call: from the
    /// first stored irradiance to the first stored weather code, else to the last irradiance.
    async fn left(&self, storage: &Storage) -> Result<Option<(SystemTime, SystemTime)>, Error> {
        let database = storage.database();
        let row = database
            .run(|db| {
                db.query_row("SELECT start, until FROM weather_backfill", [], |row| {
                    Ok((row.get::<_, Option<i64>>(0)?, row.get::<_, Option<i64>>(1)?))
                })
                .optional()
            })
            .await?;
        match row {
            None => Ok(None),
            Some((Some(start), Some(until))) => Ok(Some((instant(start), instant(until)))),
            Some(_) => {
                let catalog = storage.reader().catalog().await?;
                let bounds = |role: &str| {
                    catalog
                        .iter()
                        .find(|c| c.device == self.device && c.series == role)
                        .map(|c| (c.first, c.last))
                };
                let (start, until) = match (bounds(GHI), bounds(CODE)) {
                    (None, _) => (UNIX_EPOCH, UNIX_EPOCH),
                    (Some((first, _)), Some((code, _))) => (first, code),
                    (Some((first, last)), None) => (first, last),
                };
                let span = [seconds(start), seconds(until)];
                database
                    .run(move |db| {
                        db.execute("UPDATE weather_backfill SET start = ?1, until = ?2", span)
                    })
                    .await?;
                Ok(Some((start, until)))
            }
        }
    }

    /// Declares `quantity` and replaces its history within `range` with `points`.
    async fn replace(
        &self,
        storage: &Storage,
        (quantity, series): (&Quantity, SeriesId),
        range: Range<SystemTime>,
        points: Vec<ChangePoint>,
    ) -> Result<(), Error> {
        let policy = Policy::new(quantity.kind, None, quantity.step, HOUR);
        let policy = quantity.unit.map_or(policy, |unit| policy.in_unit(unit));
        storage.declare(self.device, series, policy).await?;
        storage.replace(self.device, series, range, points).await?;
        Ok(())
    }
}

/// The value of `quantity` in `slots` at each whole hour of `span`, a gap where they lack it.
fn hourly(quantity: &Quantity, slots: &[Slot], span: Range<SystemTime>) -> Vec<ChangePoint> {
    hours(span.start, span.end)
        .map(|time| ChangePoint {
            time,
            value: slots
                .iter()
                .find(|s| s.target == time)
                .and_then(|s| (quantity.value)(s)),
        })
        .collect()
}

/// The stored weather of `device` at each whole hour from `from` to before `to` that has
/// irradiance and temperature.
///
/// # Errors
/// Storage failed.
pub async fn archived(
    reader: &storage::Reader,
    device: DeviceId,
    from: SystemTime,
    to: SystemTime,
) -> Result<Vec<Slot>, storage::Error> {
    let mut stored = HashMap::new();
    for quantity in QUANTITIES.iter().filter(|q| q.model) {
        let series = Series {
            role: quantity.role.to_owned(),
            index: None,
        };
        let points = reader.history(device, &series, from, to).await?;
        stored.insert(quantity.role, points);
    }
    let at = |role: &str, time: SystemTime| {
        let points: &Vec<ChangePoint> = stored.get(role)?;
        points.iter().rev().find(|p| p.time <= time)?.value
    };
    Ok(hours(from, to)
        .filter_map(|target| {
            Some(Slot {
                target,
                ghi: at(GHI, target)?,
                dni: at(DNI, target)?,
                dhi: at(DHI, target)?,
                temperature: at(TEMPERATURE, target)?,
                wind: at(WIND, target),
                detail: Detail::default(),
            })
        })
        .collect())
}

fn seconds(time: SystemTime) -> i64 {
    jiff::Timestamp::try_from(time).map_or(0, jiff::Timestamp::as_second)
}

fn instant(seconds: i64) -> SystemTime {
    jiff::Timestamp::from_second(seconds).map_or(UNIX_EPOCH, SystemTime::from)
}

/// The whole hours from `from` to before `to`.
fn hours(from: SystemTime, to: SystemTime) -> impl Iterator<Item = SystemTime> {
    let since = from
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let first = UNIX_EPOCH + Duration::from_secs(since.div_ceil(HOUR.as_secs()) * HOUR.as_secs());
    std::iter::successors(Some(first), |t| Some(*t + HOUR)).take_while(move |t| *t < to)
}

#[cfg(test)]
mod tests;
