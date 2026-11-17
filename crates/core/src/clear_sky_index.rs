//! The clear-sky index (ADR 23), stored as the weather device's `weather.clearness` history.
//!
//! Over each quarter hour it is the plant's measured PV energy divided by what the `pv` model
//! makes under a clear sky with each MPPT input's correction (ADR 17).
//!
//! An input counts while it has readings and its inverter is short of its AC limit; an inverter
//! without `pv.mppt.power` counts as a whole by its `pv.power`. The index is null with the sun
//! under 5°, with no input left, or while the modules are snow-covered.
//!
//! The series is its own progress: each run ends with a gap at the last quarter it closed, and
//! the next starts there, or at the first stored PV history.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::ops::ControlFlow;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use jiff::tz::TimeZone;
use sunreye_profile::RoleKind;
use sunreye_pv as pv;
use tokio::sync::watch;

use crate::bus::{Bus, DeviceId, Series, SeriesId};
use crate::correction::{Grid, Grids, at_limit, plant_hour};
use crate::layout::{Layouts, Version, in_force};
use crate::location::Location;
use crate::solar::{self, Key};
use crate::storage::{self, Aggregate, ChangePoint, Policy, Reader, Storage, Tier};
use crate::weather;

/// An inverter's PV power, and one MPPT input's.
const PV_POWER: &str = "pv.power";
const MPPT_POWER: &str = "pv.mppt.power";

const QUARTER: Duration = Duration::from_mins(15);
/// A run covers at most this much, so a backfill stores its progress as it goes.
const CHUNK: Duration = Duration::from_hours(24);
/// Readings of a closing quarter reach storage this long after it.
const LAG: Duration = Duration::from_secs(30);
const STEP: f64 = 0.001;
/// Degrees: below it the clear-sky model is too dim to divide by.
const SUN_ELEVATION: f64 = 5.0;
/// Metres of snow depth from which modules may be snow-covered.
const SNOW_LIES: f64 = 0.01;
/// Under this index with snow lying, the modules are snow-covered.
const SNOW_COVERED: f64 = 0.05;
/// How far back an inverter's highest peak is looked for, as the correction learner does.
const PEAK_WINDOW: Duration = Duration::from_hours(365 * 24);
/// A forecast snow depth holds until the next hourly target.
const HELD: Duration = Duration::from_hours(1);

/// The clear-sky index, the one writer of `weather.clearness`.
pub struct ClearSkyIndex {
    layouts: Layouts,
    history: Reader,
    weather: DeviceId,
    series: SeriesId,
}

impl ClearSkyIndex {
    /// Stores the index under the weather device `weather`.
    #[must_use]
    pub fn new(layouts: Layouts, weather: DeviceId, storage: &Storage, bus: &Bus) -> Self {
        Self {
            layouts,
            history: storage.reader(),
            weather,
            series: bus.intern(weather::CLEAR_SKY_INDEX, None),
        }
    }

    /// Computes while the plant's `location` is set: on start, at once when it changes, and as
    /// each quarter hour closes, with the grids from `corrections`, until storage or the
    /// location stops. `clock` gives each run's time.
    pub async fn run(
        &self,
        storage: &Storage,
        corrections: &impl Grids,
        mut location: watch::Receiver<Option<Location>>,
        clock: impl Fn() -> SystemTime + Sync,
    ) {
        loop {
            let current = *location.borrow_and_update();
            if let Some(at) = current
                && self
                    .logged(storage, corrections, at, clock())
                    .await
                    .is_break()
            {
                return;
            }
            let now = clock();
            let next = quarter(now) + QUARTER + LAG;
            tokio::select! {
                () = tokio::time::sleep(next.duration_since(now).unwrap_or_default()) => {}
                changed = location.changed() => {
                    if changed.is_err() {
                        return;
                    }
                }
            }
        }
    }

    /// Catches up, logging a failure; breaks once storage has stopped.
    async fn logged(
        &self,
        storage: &Storage,
        corrections: &impl Grids,
        location: Location,
        now: SystemTime,
    ) -> ControlFlow<()> {
        match self.catch_up(storage, corrections, location, now).await {
            Err(storage::Error::Stopped) => return ControlFlow::Break(()),
            Err(e) => tracing::warn!("clear-sky index: {e}"),
            Ok(()) => {}
        }
        ControlFlow::Continue(())
    }

    /// Computes every quarter closed by `now` since the last run, or since the first stored PV
    /// history, a day at a time.
    ///
    /// # Errors
    /// Storage failed; the days computed before are kept.
    pub async fn catch_up(
        &self,
        storage: &Storage,
        corrections: &impl Grids,
        location: Location,
        now: SystemTime,
    ) -> Result<(), storage::Error> {
        let to = quarter(now);
        let versions = self.layouts.versions().await?;
        let Some(mut from) = self.resume(&versions, to).await? else {
            return Ok(());
        };
        if from >= to {
            return Ok(());
        }
        let policy = Policy::new(RoleKind::Measurement, None, STEP, QUARTER);
        storage.declare(self.weather, self.series, policy).await?;
        let mut grids = HashMap::new();
        for (device, inputs) in wired(&versions) {
            for input in inputs {
                grids.insert((device, input), corrections.grid(device, input).await?);
            }
        }
        let zone = storage.zones().now();
        let run = Run {
            versions: &versions,
            grids: &grids,
            location,
            zone: &zone,
        };
        while from < to {
            let end = (from + CHUNK).min(to);
            let points = self.chunk(&run, from, end).await?;
            storage
                .replace(
                    self.weather,
                    self.series,
                    from..end + Duration::from_secs(1),
                    points,
                )
                .await?;
            from = end;
            tokio::task::yield_now().await;
        }
        Ok(())
    }

    /// Where computing starts: the gap the last run ended with, else the first quarter of
    /// stored PV history; none without either.
    async fn resume(
        &self,
        versions: &[Version],
        to: SystemTime,
    ) -> Result<Option<SystemTime>, storage::Error> {
        let own = Series {
            role: weather::CLEAR_SKY_INDEX.to_owned(),
            index: None,
        };
        let stored = self
            .history
            .history(self.weather, &own, to, to + Duration::from_secs(1))
            .await?;
        if let Some(last) = stored.last() {
            return Ok(Some(last.time));
        }
        let series: Vec<(DeviceId, Series)> = wired(versions)
            .into_iter()
            .flat_map(|(device, inputs)| {
                std::iter::once(None)
                    .chain(inputs.into_iter().map(Some))
                    .map(move |input| (device, power(input)))
            })
            .collect();
        let mut first: Option<SystemTime> = None;
        for (device, series) in series {
            let days = self
                .history
                .rollups(device, &series, Tier::Day, UNIX_EPOCH..to)
                .await?;
            let start = days.first().map(|d| d.start);
            first = first.into_iter().chain(start).min();
        }
        let applies = versions.first().map(|v| v.applies_from);
        Ok(first.zip(applies).map(|(f, a)| quarter(f.max(a))))
    }

    /// The index of each quarter from `from` to before `to`, ending with a gap at `to`.
    async fn chunk(
        &self,
        run: &Run<'_>,
        from: SystemTime,
        to: SystemTime,
    ) -> Result<Vec<ChangePoint>, storage::Error> {
        let at = pv::Location {
            latitude: run.location.latitude,
            longitude: run.location.longitude,
        };
        let daylight: Vec<(SystemTime, pv::Weather)> = quarters(from, to)
            .filter_map(|q| {
                let mid = unix(q + QUARTER / 2)?;
                let elevation = 90.0 - pv::sun_position(mid, at).zenith;
                (elevation >= SUN_ELEVATION).then(|| (q, pv::clear_weather(mid, at)))
            })
            .collect();
        let modelled: HashMap<SystemTime, HashMap<Key, f64>> =
            solar::estimates(&self.layouts, run.versions, run.location, daylight)
                .await?
                .into_iter()
                .collect();
        let mut readings = HashMap::new();
        for (device, inputs) in wired(run.versions) {
            readings.insert(device, self.readings(device, inputs, from, to).await?);
        }
        let snow = self.snow(from, to).await?;
        let mut points: Vec<ChangePoint> = Vec::new();
        for q in quarters(from, to) {
            let value = modelled.get(&q).and_then(|clear| {
                let index = run.index(q, clear, &readings)?;
                let covered =
                    snow.at(q).is_some_and(|depth| depth >= SNOW_LIES) && index < SNOW_COVERED;
                (!covered).then_some(index)
            });
            if points.last().is_none_or(|p| p.value != value) {
                points.push(ChangePoint { time: q, value });
            }
        }
        points.push(ChangePoint {
            time: to,
            value: None,
        });
        Ok(points)
    }

    /// An inverter's readings from `from` to `to`, and the AC limit it reaches.
    async fn readings(
        &self,
        device: DeviceId,
        inputs: BTreeSet<u32>,
        from: SystemTime,
        to: SystemTime,
    ) -> Result<Readings, storage::Error> {
        let power_points = self.history.history(device, &power(None), from, to).await?;
        let mut own = HashMap::new();
        for input in inputs {
            let points = self
                .history
                .history(device, &power(Some(input)), from, to)
                .await?;
            if points.iter().any(|p| p.value.is_some()) {
                own.insert(input, points);
            }
        }
        let rating = self
            .layouts
            .inverters()
            .profile(device)
            .and_then(|p| p.inverter()?.ac_rating);
        let cap = match rating {
            Some(rating) => Some(rating),
            None => self
                .history
                .rollups(device, &power(None), Tier::Day, to - PEAK_WINDOW..to)
                .await?
                .iter()
                .filter_map(|r| match r.aggregate {
                    Aggregate::Measurement { max, .. } => Some(max),
                    Aggregate::Counter { .. } | Aggregate::Held { .. } => None,
                })
                .reduce(f64::max),
        };
        Ok(Readings {
            power: power_points,
            own,
            cap,
        })
    }

    /// The snow depth stored as history from `from` to `to`, and forecast.
    async fn snow(&self, from: SystemTime, to: SystemTime) -> Result<Snow, storage::Error> {
        let series = Series {
            role: weather::SNOW_DEPTH.to_owned(),
            index: None,
        };
        let history = self
            .history
            .history(self.weather, &series, from, to)
            .await?;
        // By target, then issue: the last of a target is its latest.
        let forecasts = self
            .history
            .forecasts(self.weather, &series, from - HELD, to)
            .await?
            .into_iter()
            .map(|f| (f.target, f.value))
            .collect();
        Ok(Snow { history, forecasts })
    }
}

/// What one catch-up computes with.
struct Run<'a> {
    versions: &'a [Version],
    grids: &'a HashMap<(DeviceId, u32), Grid>,
    location: Location,
    zone: &'a TimeZone,
}

impl Run<'_> {
    /// The plant's measured over clear-sky power in the quarter from `q`, over the inputs with
    /// readings short of their inverter's AC limit; none without one.
    fn index(
        &self,
        q: SystemTime,
        clear: &HashMap<Key, f64>,
        readings: &HashMap<DeviceId, Readings>,
    ) -> Option<f64> {
        let version = in_force(self.versions, q)?;
        let (month, hour) = plant_hour(q, self.zone);
        let (mut measured, mut modelled) = (0.0, 0.0);
        for (device, inputs) in wired(std::slice::from_ref(version)) {
            let Some(readings) = readings.get(&device) else {
                continue;
            };
            let inputs: Vec<(u32, f64)> = inputs
                .into_iter()
                .map(|input| {
                    let watts = clear
                        .get(&(device, MPPT_POWER, Some(input)))
                        .copied()
                        .unwrap_or(0.0);
                    let factor = self
                        .grids
                        .get(&(device, input))
                        .map_or(1.0, |g| g.factor(month, hour));
                    (input, watts * factor)
                })
                .collect();
            let (m, c) = readings.sums(q, &inputs);
            measured += m;
            modelled += c;
        }
        (modelled > 0.0).then(|| measured / modelled)
    }
}

impl Readings {
    /// The inverter's measured and clear-sky watts in the quarter from `q`, given each input's
    /// clear-sky watts: the inputs with readings, none at its AC limit.
    fn sums(&self, q: SystemTime, inputs: &[(u32, f64)]) -> (f64, f64) {
        let total: f64 = inputs.iter().map(|(_, w)| w).sum();
        let power = mean_and_max(&self.power, q);
        let limited = power
            .zip(self.cap)
            .is_some_and(|((_, max), cap)| at_limit(max, total, cap));
        if limited {
            return (0.0, 0.0);
        }
        if self.own.is_empty() {
            return power.map_or((0.0, 0.0), |(mean, _)| (mean, total));
        }
        inputs
            .iter()
            .filter_map(|(input, watts)| {
                let (mean, _) = mean_and_max(self.own.get(input)?, q)?;
                Some((mean, *watts))
            })
            .fold((0.0, 0.0), |(m, c), (mean, watts)| (m + mean, c + watts))
    }
}

/// An inverter's readings over a run's chunk.
struct Readings {
    /// Its `pv.power`.
    power: Vec<ChangePoint>,
    /// Each input's `pv.mppt.power`, for the inputs that have one.
    own: HashMap<u32, Vec<ChangePoint>>,
    /// Its declared AC rating, else the highest peak it measured in the past year.
    cap: Option<f64>,
}

/// The snow depth: archived history, else the latest forecast for the hour.
struct Snow {
    history: Vec<ChangePoint>,
    forecasts: BTreeMap<SystemTime, f64>,
}

impl Snow {
    fn at(&self, time: SystemTime) -> Option<f64> {
        let archived = self.history.iter().rev().find(|p| p.time <= time);
        if let Some(depth) = archived.and_then(|p| p.value) {
            return Some(depth);
        }
        let (target, depth) = self.forecasts.range(..=time).next_back()?;
        (time.duration_since(*target).ok()? < HELD).then_some(*depth)
    }
}

/// The time-weighted mean and the peak of `points` over the quarter from `q`; none without a
/// value in it.
fn mean_and_max(points: &[ChangePoint], q: SystemTime) -> Option<(f64, f64)> {
    let end = q + QUARTER;
    let (mut integral, mut covered, mut max) = (0.0, 0.0, f64::NEG_INFINITY);
    for (i, point) in points.iter().enumerate() {
        let next = points.get(i + 1).map_or(end, |p| p.time);
        let (start, stop) = (point.time.max(q), next.min(end));
        let Some(value) = point.value else {
            continue;
        };
        let Ok(span) = stop.duration_since(start) else {
            continue;
        };
        if span.is_zero() {
            continue;
        }
        integral = value.mul_add(span.as_secs_f64(), integral);
        covered += span.as_secs_f64();
        max = max.max(value);
    }
    (covered > 0.0).then(|| (integral / covered, max))
}

/// Each inverter any of `versions` wires a string to, with its MPPT inputs.
fn wired(versions: &[Version]) -> BTreeMap<DeviceId, BTreeSet<u32>> {
    let mut wired: BTreeMap<DeviceId, BTreeSet<u32>> = BTreeMap::new();
    for string in versions.iter().flat_map(|v| &v.strings) {
        let w = &string.wiring;
        wired.entry(DeviceId(w.device)).or_default().insert(w.input);
    }
    wired
}

/// An inverter's `pv.power`, or an input's `pv.mppt.power`.
fn power(input: Option<u32>) -> Series {
    Series {
        role: if input.is_some() {
            MPPT_POWER
        } else {
            PV_POWER
        }
        .to_owned(),
        index: input,
    }
}

/// The start of the quarter `time` falls in.
fn quarter(time: SystemTime) -> SystemTime {
    let since = time
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    UNIX_EPOCH + Duration::from_secs(since - since % QUARTER.as_secs())
}

/// The quarter starts from `from` to before `to`.
fn quarters(from: SystemTime, to: SystemTime) -> impl Iterator<Item = SystemTime> {
    std::iter::successors(Some(from), |t| Some(*t + QUARTER)).take_while(move |t| *t < to)
}

fn unix(time: SystemTime) -> Option<i64> {
    i64::try_from(time.duration_since(UNIX_EPOCH).ok()?.as_secs()).ok()
}

#[cfg(test)]
mod tests;
