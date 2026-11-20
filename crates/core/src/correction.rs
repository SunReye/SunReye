//! The correction learner (ADR 17).
//!
//! Twice a day it fetches the settled days of archive weather it has not learned, stores them as
//! `weather.*` history, runs the PV model on them with the layout in force at each hour, and
//! folds each hour of each MPPT input into that input's month × hour grid against its measured
//! `pv.mppt.power`, else its inverter's `pv.power`.
//!
//! An inverter profile need not declare its AC rating, so an hour is taken to be at the AC limit
//! when the inverter's measured `pv.power` peaks within 2 % of the highest hourly peak it has
//! stored in the past year while the model on archive weather expects more than that peak.
//!
//! Each run, and each layout change, also stores every input's last 30 days measured against the
//! model, so the builder's read runs no model (ADR 20, 24).
//!
//! The correction module owns the `correction_cell`, `correction_state` and `correction_recent`
//! tables.

mod grid;
mod routes;

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::ops::ControlFlow;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use jiff::civil::Date;
use jiff::tz::TimeZone;
use rusqlite::{Connection, OptionalExtension, params};
use sunreye_pv as pv;
use tokio::sync::watch;
use tokio::time::Instant;

pub use grid::{Cell, Grid, Hour};

use crate::bus::{DeviceId, Series};
use crate::layout::{Layouts, Version, in_force};
use crate::location::Location;
use crate::solar::{self, Key};
use crate::storage::{self, Aggregate, Database, Reader, Storage, Tier};
use crate::utc_day;
use crate::weather::{self, Archive, Error, Past, Slot};

const HOUR: Duration = Duration::from_hours(1);
const DAY: Duration = Duration::from_hours(24);
/// Learning runs twice a day (ADR 17).
const EVERY: Duration = Duration::from_hours(12);
/// Days archive weather takes to settle, as in 3.x and v4.
const SETTLE_DAYS: i64 = 3;
/// How far a first run reaches back, as in 3.x and v4.
const BACKFILL_DAYS: i64 = 90;
/// How far back an inverter's highest hourly peak is looked for.
const PEAK_WINDOW: Duration = Duration::from_hours(365 * 24);
/// A measured peak this close to the highest is at the AC limit.
const AT_LIMIT: f64 = 0.98;

/// An inverter's MPPT input: its device and `pv.mppt.*` index.
type Input = (DeviceId, u32);

/// Each MPPT input's learned grid, as the solar forecast applies it.
pub trait Grids: Sync {
    /// The grid learned for an inverter's MPPT input; all 1 when none is.
    fn grid(
        &self,
        device: DeviceId,
        input: u32,
    ) -> impl Future<Output = Result<Grid, storage::Error>> + Send;
}

impl Grids for Corrections {
    fn grid(
        &self,
        device: DeviceId,
        input: u32,
    ) -> impl Future<Output = Result<Grid, storage::Error>> + Send {
        Self::grid(self, device, input)
    }
}

/// Grids set by hand.
#[cfg(test)]
impl<S: std::hash::BuildHasher + Sync> Grids for HashMap<Input, Grid, S> {
    fn grid(
        &self,
        device: DeviceId,
        input: u32,
    ) -> impl Future<Output = Result<Grid, storage::Error>> + Send {
        std::future::ready(Ok(self.get(&(device, input)).cloned().unwrap_or_default()))
    }
}

/// How far back each input's measured power is compared with the model (ADR 20).
const RECENT: Duration = Duration::from_hours(30 * 24);

/// The correction learner, the one writer of the learned grids.
pub struct Learner<A> {
    past: Arc<Past<A>>,
    corrections: Corrections,
}

/// The learned grids and the model on stored archive weather, as the builder reads them.
#[derive(Clone)]
pub struct Corrections {
    layouts: Layouts,
    database: Database,
    history: Reader,
    weather: DeviceId,
}

/// An MPPT input's learned grid, and its last 30 days measured against the model.
#[derive(Debug, Clone, PartialEq)]
pub struct InputReport {
    pub device: DeviceId,
    pub input: u32,
    pub grid: Grid,
    /// None without a location, or without an hour both modelled and measured.
    pub recent: Option<Recent>,
}

/// Energy over the hours an input is both modelled on archive weather and measured, in kWh.
/// Hours at the inverter's AC limit are left out, as learning leaves them out.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Recent {
    pub measured: f64,
    /// Uncorrected, so a misplaced face or a missing obstacle shows.
    pub modelled: f64,
}

impl<A: Archive> Learner<A> {
    /// Learns from the archive weather `past` fetches and stores under the weather device
    /// `weather`.
    pub fn new(past: Arc<Past<A>>, weather: DeviceId, layouts: Layouts, storage: &Storage) -> Self {
        Self {
            past,
            corrections: Corrections::new(layouts, weather, storage),
        }
    }

    /// Learns while the plant's `location` is set: on start, at once when it changes, and every
    /// 12 hours from then, with hours cut in the plant `zone`, until storage or the location
    /// stops; and stores the last 30 days again at once when the layout changes. `clock` gives
    /// each run's time.
    pub async fn run(
        &self,
        storage: &Storage,
        mut location: watch::Receiver<Option<Location>>,
        zone: watch::Receiver<TimeZone>,
        clock: impl Fn() -> SystemTime + Sync,
    ) {
        let mut layout = self.corrections.layouts.changes();
        let mut next = Instant::now();
        loop {
            let current = *location.borrow_and_update();
            let plant_zone = zone.borrow().clone();
            if let Some(at) = current
                && logged(self.learn(storage, at, &plant_zone, clock()).await).is_break()
            {
                return;
            }
            next += EVERY;
            loop {
                tokio::select! {
                    () = tokio::time::sleep_until(next) => break,
                    changed = location.changed() => {
                        if changed.is_err() {
                            return;
                        }
                        next = Instant::now();
                        break;
                    }
                    Ok(()) = layout.changed() => {
                        let current = *location.borrow();
                        let plant_zone = zone.borrow().clone();
                        let Some(at) = current else { continue };
                        let refreshed = self.corrections.refresh(at, &plant_zone, clock()).await;
                        if logged(refreshed.map_err(Error::Storage)).is_break() {
                            return;
                        }
                    }
                }
            }
        }
    }

    /// Learns the settled UTC days up to 3 days before `now` it has not learned, reaching 90
    /// days back at first, then stores each input's last 30 days before `now` measured against
    /// the model, whether or not a day was learned. A day is learned once one of its hours is
    /// measured, so a day the archive has not settled is fetched again next time.
    ///
    /// # Errors
    /// The archive or storage failed; what failed is not stored.
    pub async fn learn(
        &self,
        storage: &Storage,
        location: Location,
        zone: &TimeZone,
        now: SystemTime,
    ) -> Result<(), Error> {
        let learned = self.learn_days(storage, location, zone, now).await;
        if matches!(learned, Err(Error::Storage(storage::Error::Stopped))) {
            return learned;
        }
        self.corrections.refresh(location, zone, now).await?;
        learned
    }

    /// Learns the settled days not yet learned.
    async fn learn_days(
        &self,
        storage: &Storage,
        location: Location,
        zone: &TimeZone,
        now: SystemTime,
    ) -> Result<(), Error> {
        let c = &self.corrections;
        let through = c.database.run(learned_through).await?;
        let Some((first, last)) = window(through, now) else {
            return Ok(());
        };
        self.past.fetch(storage, location, first, last).await?;
        let (from, to) = (utc_day::start(first), utc_day::start(last) + DAY);
        let plant = c.plant(location, zone, from..to).await?;
        let mut grids = c.database.run(grids).await?;
        let mut learned = None;
        for input in inputs(&plant.versions) {
            let measured = c.measured(input, from..to).await?;
            let grid = grids.entry(input).or_default();
            learned = learned.max(plant.fold(grid, &measured, input, hours(from, to)));
        }
        let Some(learned) = learned else {
            return Ok(());
        };
        let day = utc_day::of(learned).to_string();
        c.database.run(move |db| save(db, &grids, &day)).await?;
        Ok(())
    }

    /// The grid learned for an inverter's MPPT input.
    ///
    /// # Errors
    /// The file cannot be read.
    #[cfg(test)]
    pub async fn grid(&self, device: DeviceId, input: u32) -> Result<Grid, storage::Error> {
        self.corrections.grid(device, input).await
    }
}

impl Corrections {
    /// Reads the grids and the archive weather stored under the weather device `weather`.
    #[must_use]
    pub fn new(layouts: Layouts, weather: DeviceId, storage: &Storage) -> Self {
        Self {
            layouts,
            database: storage.database(),
            history: storage.reader(),
            weather,
        }
    }

    /// The grid learned for an inverter's MPPT input; all 1 when none is.
    ///
    /// # Errors
    /// The file cannot be read.
    pub async fn grid(&self, device: DeviceId, input: u32) -> Result<Grid, storage::Error> {
        let mut grids = self.database.run(grids).await?;
        Ok(grids.remove(&(device, input)).unwrap_or_default())
    }

    /// Every MPPT input any layout version wires a string to, with its grid and, while the plant
    /// is `located`, its last 30 days measured against the model as last stored. Runs no model.
    ///
    /// # Errors
    /// Storage failed.
    pub async fn report(&self, located: bool) -> Result<Vec<InputReport>, storage::Error> {
        let versions = self.layouts.versions().await?;
        let (mut grids, mut recent) = self
            .database
            .run(|db| Ok((grids(db)?, stored_recent(db)?)))
            .await?;
        Ok(inputs(&versions)
            .into_iter()
            .map(|(device, input)| InputReport {
                device,
                input,
                grid: grids.remove(&(device, input)).unwrap_or_default(),
                recent: recent.remove(&(device, input)).filter(|_| located),
            })
            .collect())
    }

    /// Stores, at `location`, each input's whole hours of the 30 days before `now` measured
    /// against the model, in place of those stored. Hours are cut in the plant `zone`.
    ///
    /// # Errors
    /// Storage failed; nothing is stored.
    pub async fn refresh(
        &self,
        location: Location,
        zone: &TimeZone,
        now: SystemTime,
    ) -> Result<(), storage::Error> {
        // Whole seconds: a sub-second left on it would miss every stored hour.
        let since = now.duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
        let to = UNIX_EPOCH + Duration::from_secs(since - since % HOUR.as_secs());
        let from = to - RECENT;
        let plant = self.plant(location, zone, from..to).await?;
        let mut recent = HashMap::new();
        for input in inputs(&plant.versions) {
            let measured = self.measured(input, from..to).await?;
            if let Some(energy) = plant.recent(&measured, input, hours(from, to)) {
                recent.insert(input, energy);
            }
        }
        self.database.run(move |db| save_recent(db, &recent)).await
    }

    /// The layout versions, and the model on the archive weather stored for `range`.
    async fn plant(
        &self,
        location: Location,
        zone: &TimeZone,
        range: std::ops::Range<SystemTime>,
    ) -> Result<Plant, storage::Error> {
        let weather =
            weather::archived(&self.history, self.weather, range.start, range.end).await?;
        let versions = self.layouts.versions().await?;
        Ok(Plant {
            modelled: Modelled::new(&self.layouts, &versions, location, weather).await?,
            nameplates: Nameplates::new(&self.layouts).await?,
            versions,
            zone: zone.clone(),
        })
    }

    /// The hourly means the input learns against: its `pv.mppt.power` while stored, else its
    /// inverter's `pv.power`; with the inverter's `pv.power` and its highest hourly peak.
    async fn measured(
        &self,
        (device, input): Input,
        range: std::ops::Range<SystemTime>,
    ) -> Result<Measured, storage::Error> {
        let rollups = async |role: &str, index, range: std::ops::Range<SystemTime>| {
            let series = Series {
                role: role.to_owned(),
                index,
            };
            let stored = self
                .history
                .rollups(device, &series, Tier::Hour, range)
                .await?;
            Ok::<_, storage::Error>(
                stored
                    .into_iter()
                    .filter_map(|r| match r.aggregate {
                        Aggregate::Measurement { mean, max, .. } => Some((r.start, (mean, max))),
                        Aggregate::Counter { .. } | Aggregate::Held { .. } => None,
                    })
                    .collect::<BTreeMap<SystemTime, (f64, f64)>>(),
            )
        };
        let own = rollups("pv.mppt.power", Some(input), range.clone()).await?;
        let inverter = rollups("pv.power", None, range.clone()).await?;
        let year = rollups("pv.power", None, range.end - PEAK_WINDOW..range.end).await?;
        let peak = year.values().map(|(_, max)| *max).reduce(f64::max);
        Ok(Measured {
            own: (!own.is_empty()).then_some(own),
            inverter,
            peak,
        })
    }
}

/// The model's hourly means on archive weather.
struct Modelled(HashMap<SystemTime, HashMap<Key, f64>>);

impl Modelled {
    async fn new(
        layouts: &Layouts,
        versions: &[Version],
        location: Location,
        weather: Vec<Slot>,
    ) -> Result<Self, storage::Error> {
        let weather = weather.iter().filter_map(sky).collect();
        let estimates = solar::estimates(layouts, versions, location, weather).await?;
        Ok(Self(estimates.into_iter().collect()))
    }

    /// The mean over the hour from `start` of `key`: the model at both ends, as the archive's
    /// weather is instantaneous.
    fn mean(&self, key: &Key, start: SystemTime) -> Option<f64> {
        let at = |time| self.0.get(&time)?.get(key).copied();
        Some(f64::midpoint(at(start)?, at(start + HOUR)?))
    }
}

/// Watts peak by inverter and input, from each version's strings.
struct Nameplates(HashMap<u32, f64>);

impl Nameplates {
    async fn new(layouts: &Layouts) -> Result<Self, storage::Error> {
        let types = layouts.module_types().await?;
        Ok(Self(
            types
                .into_iter()
                .map(|m| (m.id, m.datasheet.pmax))
                .collect(),
        ))
    }

    /// The input's and its inverter's watts peak in `version`.
    fn of(&self, version: &Version, (device, input): Input) -> (f64, f64) {
        let mut sums = (0.0, 0.0);
        for s in version
            .strings
            .iter()
            .filter(|s| s.wiring.device == device.0)
        {
            let w = &s.wiring;
            let peak = f64::from(w.modules) * self.0.get(&w.module_type).copied().unwrap_or(0.0);
            sums.1 += peak;
            if w.input == input {
                sums.0 += peak;
            }
        }
        sums
    }
}

/// What an input and its inverter measured, by hour start: mean and peak watts.
struct Measured {
    own: Option<BTreeMap<SystemTime, (f64, f64)>>,
    inverter: BTreeMap<SystemTime, (f64, f64)>,
    /// The inverter's highest hourly peak in the past year.
    peak: Option<f64>,
}

impl Measured {}

/// What a learn run models: the layout versions, the model on archive weather and the plant zone.
struct Plant {
    versions: Vec<Version>,
    modelled: Modelled,
    nameplates: Nameplates,
    zone: TimeZone,
}

/// An hour modelled and measured.
enum Observed {
    /// The inverter is at its AC limit: the hour folds into no grid.
    AtLimit,
    /// The hour, with the input's and the inverter's watts peak.
    Hour(Hour, f64, f64),
}

/// Every MPPT input any version wires a string to.
fn inputs(versions: &[Version]) -> BTreeSet<Input> {
    versions
        .iter()
        .flat_map(|v| &v.strings)
        .map(|s| (DeviceId(s.wiring.device), s.wiring.input))
        .collect()
}

impl Plant {
    /// The energy of `hours` the input is modelled and measured in, short of the AC limit.
    fn recent(
        &self,
        measured: &Measured,
        input: Input,
        hours: impl Iterator<Item = SystemTime>,
    ) -> Option<Recent> {
        let observed: Vec<Hour> = hours
            .filter_map(|start| match self.observe(measured, input, start)? {
                Observed::Hour(hour, ..) => Some(hour),
                Observed::AtLimit => None,
            })
            .collect();
        // Watt-hour means of whole hours, in kWh.
        (!observed.is_empty()).then(|| Recent {
            measured: observed.iter().map(|h| h.measured).sum::<f64>() / 1000.0,
            modelled: observed.iter().map(|h| h.modelled).sum::<f64>() / 1000.0,
        })
    }

    /// Folds into `grid` each of `hours` the input is modelled and measured in, in order; the
    /// last such hour.
    fn fold(
        &self,
        grid: &mut Grid,
        measured: &Measured,
        input: Input,
        hours: impl Iterator<Item = SystemTime>,
    ) -> Option<SystemTime> {
        let mut last = None;
        for start in hours {
            let Some(observed) = self.observe(measured, input, start) else {
                continue;
            };
            last = Some(start);
            if let Observed::Hour(hour, input_nameplate, inverter_nameplate) = observed {
                grid.learn(&[hour], input_nameplate, inverter_nameplate);
            }
        }
        last
    }

    /// The hour from `start`, once its layout is in force and it is modelled and measured.
    fn observe(
        &self,
        measured: &Measured,
        (device, input): Input,
        start: SystemTime,
    ) -> Option<Observed> {
        let version = in_force(&self.versions, start)?;
        let inverter_modelled = self.modelled.mean(&(device, "pv.power", None), start)?;
        let inverter = measured.inverter.get(&start).copied();
        let (input_nameplate, inverter_nameplate) = self.nameplates.of(version, (device, input));
        let (expected, value, nameplate) = match &measured.own {
            Some(own) => (
                self.modelled
                    .mean(&(device, "pv.mppt.power", Some(input)), start)?,
                own.get(&start)?.0,
                input_nameplate,
            ),
            None => (inverter_modelled, inverter?.0, inverter_nameplate),
        };
        let at_limit = inverter
            .zip(measured.peak)
            .is_some_and(|((_, max), peak)| at_limit(max, inverter_modelled, peak));
        if at_limit {
            return Some(Observed::AtLimit);
        }
        let (month, hour) = plant_hour(start, &self.zone);
        let observed = Hour {
            month,
            hour,
            modelled: expected,
            measured: value,
            inverter_modelled,
            inverter_measured: inverter.map(|(mean, _)| mean),
        };
        Some(Observed::Hour(observed, nameplate, inverter_nameplate))
    }
}

/// Whether an inverter whose measured power peaked at `max` while the model expected `modelled`
/// is at its AC limit `cap`: its declared rating, or the highest peak it has measured.
#[must_use]
pub fn at_limit(max: f64, modelled: f64, cap: f64) -> bool {
    max >= AT_LIMIT * cap && modelled > cap
}

/// The settled UTC days not yet learned, first and last; none when none is due.
fn window(through: Option<Date>, now: SystemTime) -> Option<(Date, Date)> {
    let last = utc_day::of(now)
        .checked_sub(jiff::Span::new().days(SETTLE_DAYS))
        .ok()?;
    let first = match through {
        Some(day) => day.tomorrow().ok()?,
        None => last
            .checked_sub(jiff::Span::new().days(BACKFILL_DAYS))
            .ok()?,
    };
    (first <= last).then_some((first, last))
}

/// The plant-local month and hour an hour starts in.
#[must_use]
pub fn plant_hour(start: SystemTime, zone: &TimeZone) -> (u8, u8) {
    let local = jiff::Timestamp::try_from(start)
        .unwrap_or(jiff::Timestamp::UNIX_EPOCH)
        .to_zoned(zone.clone());
    let unsigned = |n: i8| u8::try_from(n).unwrap_or(0);
    (unsigned(local.month()), unsigned(local.hour()))
}

/// The hour starts from `from` to before `to`.
fn hours(from: SystemTime, to: SystemTime) -> impl Iterator<Item = SystemTime> {
    std::iter::successors(Some(from), |t| Some(*t + HOUR)).take_while(move |t| *t < to)
}

/// A slot as the PV model takes it.
fn sky(slot: &Slot) -> Option<(SystemTime, pv::Weather)> {
    let since = slot.target.duration_since(UNIX_EPOCH).ok()?;
    let weather = pv::Weather {
        unix: i64::try_from(since.as_secs()).ok()?,
        ghi: slot.ghi,
        dni: slot.dni,
        dhi: slot.dhi,
        temperature: slot.temperature,
        wind: slot.wind,
    };
    Some((slot.target, weather))
}

fn learned_through(db: &Connection) -> rusqlite::Result<Option<Date>> {
    let day: Option<String> = db
        .query_row("SELECT learned_through FROM correction_state", [], |row| {
            row.get(0)
        })
        .optional()?;
    Ok(day.and_then(|d| d.parse().ok()))
}

fn grids(db: &Connection) -> rusqlite::Result<HashMap<Input, Grid>> {
    let mut statement =
        db.prepare("SELECT device, input, month, hour, ratio, weight FROM correction_cell")?;
    let mut grids: HashMap<Input, Grid> = HashMap::new();
    let rows = statement.query_map([], |row| {
        let input = (DeviceId(row.get(0)?), row.get(1)?);
        let cell = Cell {
            ratio: row.get(4)?,
            weight: row.get(5)?,
        };
        Ok((input, row.get::<_, u8>(2)?, row.get::<_, u8>(3)?, cell))
    })?;
    for row in rows {
        let (input, month, hour, cell) = row?;
        grids.entry(input).or_default().set(month, hour, cell);
    }
    Ok(grids)
}

fn stored_recent(db: &Connection) -> rusqlite::Result<HashMap<Input, Recent>> {
    let mut statement =
        db.prepare("SELECT device, input, measured, modelled FROM correction_recent")?;
    let rows = statement.query_map([], |row| {
        let input = (DeviceId(row.get(0)?), row.get(1)?);
        let recent = Recent {
            measured: row.get(2)?,
            modelled: row.get(3)?,
        };
        Ok((input, recent))
    })?;
    rows.collect()
}

fn save_recent(db: &Connection, recent: &HashMap<Input, Recent>) -> rusqlite::Result<()> {
    let tx = db.unchecked_transaction()?;
    tx.execute("DELETE FROM correction_recent", [])?;
    for ((device, input), r) in recent {
        tx.execute(
            "INSERT INTO correction_recent (device, input, measured, modelled) \
             VALUES (?1, ?2, ?3, ?4)",
            params![device.0, input, r.measured, r.modelled],
        )?;
    }
    tx.commit()
}

/// Logs a failure; breaks once storage has stopped.
fn logged(result: Result<(), Error>) -> ControlFlow<()> {
    match result {
        Err(Error::Storage(storage::Error::Stopped)) => return ControlFlow::Break(()),
        Err(e) => tracing::warn!("correction: {e}"),
        Ok(()) => {}
    }
    ControlFlow::Continue(())
}

fn save(db: &Connection, grids: &HashMap<Input, Grid>, through: &str) -> rusqlite::Result<()> {
    let tx = db.unchecked_transaction()?;
    for ((device, input), grid) in grids {
        for (month, hour, cell) in grid.cells() {
            tx.execute(
                "INSERT OR REPLACE INTO correction_cell (device, input, month, hour, ratio, weight) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![device.0, input, month, hour, cell.ratio, cell.weight],
            )?;
        }
    }
    tx.execute(
        "INSERT OR REPLACE INTO correction_state (id, learned_through) VALUES (0, ?1)",
        params![through],
    )?;
    tx.commit()
}

#[cfg(test)]
mod tests;
