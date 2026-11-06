//! The forecast correction's learn run (3.x `forecast-correction-job.ts`): settled days of reanalysis
//! irradiance through the forecast model, each hour against the measured hourly average of `pv.total.power`,
//! folded into the plant's primary inverter's grid. Learns whenever the forecast is configured; the forecast
//! applies the grid only while `forecast.correction.enabled`.
//!
//! The learning target is the primary inverter: its own arrays against its total PV power. 3.x models every
//! plant array against it, which overstates a multi-inverter plant. An array wired to a string that reports
//! `pv.string.power` also learns a grid of its own from that string, held to
//! `fixtures/oracle/forecast-string-correction.ndjson`; the forecast scales it by that grid where learned. No
//! string voltage rule: no recorded data supports one.

use std::collections::{BTreeMap, BTreeSet};
use std::future::Future;
use std::pin::Pin;
use std::time::Duration;

use jiff::civil::Date;
use jiff::tz::TimeZone;
use tokio::sync::watch;
use tokio::time::MissedTickBehavior;

use crate::forecast::{
    self, CorrectionModel, ForecastConfig, Irradiance, Learned, Location, Observation, Point, Run, SimInputs,
    Skill, StringObservation,
};
use crate::open_meteo;
use crate::plant_zone;
use crate::rollup::Tier;
use crate::run::Core;
use crate::store::{BucketWindow, DeviceRow, Store, StoreError, StringGrid};
use crate::weather::{self, OPEN_METEO, WeatherConfig};

/// The first run waits for the core to settle; later runs retry days the archive had not settled.
const FIRST_AFTER: Duration = Duration::from_mins(2);
const EVERY: Duration = Duration::from_hours(12);

/// What the learn task runs each time: [`learn_logged`] outside tests.
pub(crate) type Job = for<'a> fn(&'a Core) -> Pin<Box<dyn Future<Output = ()> + Send + 'a>>;

/// [`learn_once`] with its failure logged.
pub(crate) fn learn_logged(core: &Core) -> Pin<Box<dyn Future<Output = ()> + Send + '_>> {
    Box::pin(async move {
        if let Err(error) = learn_once(core).await {
            tracing::error!(%error, "forecast correction learn failed");
        }
    })
}

/// Runs `job` after [`FIRST_AFTER`] and then every [`EVERY`] until `stopped` changes, which also drops a run
/// in flight, or until `job` has nothing to run.
pub(crate) async fn schedule<F, R>(mut job: F, mut stopped: watch::Receiver<bool>)
where
    F: FnMut() -> Option<R>,
    R: Future<Output = ()>,
{
    let mut ticker = tokio::time::interval_at(tokio::time::Instant::now() + FIRST_AFTER, EVERY);
    ticker.set_missed_tick_behavior(MissedTickBehavior::Delay);
    loop {
        tokio::select! {
            biased;
            _ = stopped.changed() => return,
            _ = ticker.tick() => {}
        }
        let Some(run) = job() else { return };
        tokio::select! {
            biased;
            _ = stopped.changed() => return,
            () = run => {}
        }
    }
}

const PV_ROLE: &str = "pv.total.power";
const STRING_ROLE: &str = "pv.string.power";
const HOUR_MS: i64 = 3_600_000;

/// How far one inverter's correction has learned.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LearnState {
    /// The last plant-local day folded in.
    pub learned_through: Date,
    pub skill: Skill,
}

/// What one run did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    /// The forecast is not configured, or the primary inverter has no arrays or no total PV power.
    Idle,
    /// Every settled day is learned.
    UpToDate,
    /// The archive could not be had: nothing is written and the days are retried.
    FetchFailed,
    /// No measured hour in the window: the cursor stays so the days are retried once history exists.
    NoMeasuredHours,
    Learned {
        hours: usize,
        through: Date,
    },
}

/// The inverter the correction is learned for and applied from: the first in service.
fn primary(devices: &[DeviceRow]) -> Option<&DeviceRow> {
    devices.iter().find(|d| d.in_service() && d.role == "inverter")
}

/// The primary inverter's grid and state; none without an inverter in service.
pub async fn stored(store: &Store) -> Result<Option<(CorrectionModel, Option<LearnState>)>, StoreError> {
    let devices = store.devices().await?;
    let Some(device) = primary(&devices) else { return Ok(None) };
    Ok(Some(store.correction(device.id).await?))
}

/// What the forecast applies: the primary inverter's grid, none while empty, and each plant array's string
/// grid in `arrays` order.
pub async fn applied(
    store: &Store,
    arrays: &[weather::PvArray],
) -> Result<(Option<CorrectionModel>, Vec<Option<CorrectionModel>>), StoreError> {
    let devices = store.devices().await?;
    let Some(device) = primary(&devices) else { return Ok((None, Vec::new())) };
    let (model, _) = store.correction(device.id).await?;
    let strings = store.string_corrections(device.id).await?;
    let model = Some(model).filter(|m| !m.is_empty());
    Ok((model, string_grids(arrays, &device.id.to_string(), &strings)))
}

/// The grid of the string each array is wired to on the inverter `slug`; none for an array of another inverter,
/// without a string, or on a string with no grid.
fn string_grids(
    arrays: &[weather::PvArray],
    slug: &str,
    strings: &BTreeMap<u32, CorrectionModel>,
) -> Vec<Option<CorrectionModel>> {
    arrays
        .iter()
        .map(|a| {
            let own = a.device_slug.as_deref() == Some(slug);
            a.mppt.filter(|_| own).and_then(|mppt| strings.get(&mppt).cloned())
        })
        .collect()
}

/// What a run learns for: the primary inverter, its arrays as the model reads them, its total PV metric and the
/// arrays that learn from their own string.
struct Target {
    device: i64,
    model: ForecastConfig,
    pv_key: String,
    strings: Vec<Wired>,
}

/// An array of the target's model wired to a string that reports `pv.string.power`.
#[derive(Debug)]
struct Wired {
    /// Position in the target's model.
    array: usize,
    mppt: u32,
    /// The string's `pv.string.power` metric.
    key: String,
}

/// The record over only the arrays wired into the inverter `slug`: its model's nameplate is theirs alone.
fn own_arrays(config: &WeatherConfig, slug: &str) -> WeatherConfig {
    let mut own = config.clone();
    own.forecast.arrays.retain(|a| a.device_slug.as_deref() == Some(slug));
    own
}

/// Each array whose `mppt` names a string in `power` (`index`, `pv.string.power` key), in array order.
fn wired(arrays: &[weather::PvArray], power: &[(u32, &str)]) -> Vec<Wired> {
    arrays
        .iter()
        .enumerate()
        .filter_map(|(array, a)| {
            let mppt = a.mppt?;
            let &(_, key) = power.iter().find(|(index, _)| *index == mppt)?;
            Some(Wired { array, mppt, key: key.to_owned() })
        })
        .collect()
}

/// None while the primary inverter has no arrays or no total PV power.
async fn target(core: &Core, config: &WeatherConfig) -> Result<Option<Target>, StoreError> {
    let devices = core.store.devices().await?;
    let Some(device) = primary(&devices) else { return Ok(None) };
    let own = own_arrays(config, &device.id.to_string());
    let model = own.model();
    let profile = core.profile(&device.profile_id).await?;
    let metrics = profile.as_ref().map(|p| p.metrics.as_slice()).unwrap_or_default();
    let pv = metrics.iter().find(|m| m.role.as_deref() == Some(PV_ROLE));
    let power: Vec<(u32, &str)> = metrics
        .iter()
        .filter(|m| m.role.as_deref() == Some(STRING_ROLE))
        .filter_map(|m| Some((m.index?, m.key.as_str())))
        .collect();
    let strings = wired(&own.forecast.arrays, &power);
    Ok(pv.filter(|_| !model.arrays.is_empty()).map(|pv| Target {
        device: device.id,
        model,
        pv_key: pv.key.clone(),
        strings,
    }))
}

/// The modelled hours (UTC labels) over `days` in the plant `zone`: the inverter's total, then each wired
/// array's own; none when they cannot be had, logged.
async fn modelled(
    core: &Core,
    target: &Target,
    location: Location,
    (start, end): (Date, Date),
    zone: &TimeZone,
) -> Option<(Vec<Point>, Vec<Vec<Point>>)> {
    let planes: Vec<open_meteo::Plane> = target.model.arrays.iter().map(|a| (a.tilt, a.azimuth)).collect();
    let days = (start, end, zone.iana_name().unwrap_or("UTC"));
    let fetched = open_meteo::fetch_archive(&core.archive_url, &core.roots, location, &planes, days).await;
    let fetched = fetched
        .inspect_err(|error| tracing::warn!(%error, %start, %end, "correction archive fetch failed"))
        .ok()?;
    let run = Run {
        time_zone: &TimeZone::UTC,
        now_ms: 0,
        sim: SimInputs::default(),
        correction: None,
        array_corrections: &[],
    };
    let series = |model: &ForecastConfig, data: &Irradiance| {
        let built = forecast::build(model, data, OPEN_METEO, &run);
        built.inspect_err(|error| tracing::warn!(%error, "correction archive series unusable")).ok()
    };
    let total = series(&target.model, &fetched)?.raw.series;
    let mut arrays = Vec::with_capacity(target.strings.len());
    for wired in &target.strings {
        let model =
            ForecastConfig { arrays: vec![target.model.arrays[wired.array].clone()], ..target.model.clone() };
        let gti = fetched.gti.get(wired.array).cloned().unwrap_or_default();
        arrays.push(series(&model, &Irradiance { gti: vec![gti], ..fetched.clone() })?.raw.series);
    }
    Some((total, arrays))
}

/// One learn run over the days due at the core's clock.
pub async fn learn_once(core: &Core) -> Result<Outcome, StoreError> {
    let config = weather::read(&core.store).await?;
    let Some(location) = config.forecast_ready() else { return Ok(Outcome::Idle) };
    let Some(target) = target(core, &config).await? else { return Ok(Outcome::Idle) };
    let (mut model, state) = core.store.correction(target.device).await?;
    let Some(days) = window(state.map(|s| s.learned_through), core.now_ms()) else {
        return Ok(Outcome::UpToDate);
    };
    let zone = plant_zone::plant_zone(&core.store).await?;
    let Some((series, arrays)) = modelled(core, &target, location, days, &zone).await else {
        return Ok(Outcome::FetchFailed);
    };
    let measured = measured_hours(&core.store, target.device, &target.pv_key, &series).await?;
    let paired = observations(&series, &measured, &zone, days);
    let Some(&(through, _)) = paired.last() else { return Ok(Outcome::NoMeasuredHours) };
    let hours: Vec<Observation> = paired.into_iter().map(|(_, o)| o).collect();
    let nameplate_w = target.model.arrays.iter().map(|a| a.kwp).sum::<f64>() * 1000.0;
    let skill = state.map(|s| s.skill).unwrap_or_default();
    let fold = model.learn(skill, &hours, nameplate_w, target.model.max_output_w);
    let modelled = Modelled { total: &series, arrays: &arrays, zone: &zone, days };
    save_with_strings(&core.store, &target, &modelled, &measured, (&model, &fold, through)).await?;
    tracing::info!(hours = hours.len(), %through, cells = fold.touched.len(), "forecast correction learned");
    Ok(Outcome::Learned { hours: hours.len(), through })
}

/// A run's modelled hours: the inverter's total and each wired array's, cut to `days` in `zone`.
struct Modelled<'a> {
    total: &'a [Point],
    arrays: &'a [Vec<Point>],
    zone: &'a TimeZone,
    days: (Date, Date),
}

/// Folds each wired string's measured hours into its stored grid and saves them with the inverter's fold.
async fn save_with_strings(
    store: &Store,
    target: &Target,
    modelled: &Modelled<'_>,
    total_w: &BTreeMap<i64, f64>,
    (model, fold, through): (&CorrectionModel, &Learned, Date),
) -> Result<(), StoreError> {
    let state = LearnState { learned_through: through, skill: fold.skill };
    let mut grids = store.string_corrections(target.device).await?;
    let touched = fold_strings(store, target, modelled, total_w, &mut grids).await?;
    let strings: Vec<StringGrid> = touched
        .iter()
        .filter_map(|(mppt, cells)| Some(StringGrid { mppt: *mppt, model: grids.get(mppt)?, touched: cells }))
        .collect();
    store.save_correction(target.device, (model, &fold.touched), &strings, &state).await
}

/// Folds each wired string's measured hours into its grid in `grids`; the cells each string wrote, by `mppt`.
async fn fold_strings(
    store: &Store,
    target: &Target,
    modelled: &Modelled<'_>,
    total_w: &BTreeMap<i64, f64>,
    grids: &mut BTreeMap<u32, CorrectionModel>,
) -> Result<Vec<(u32, BTreeSet<(i8, i8)>)>, StoreError> {
    let nameplate_w = target.model.arrays.iter().map(|a| a.kwp).sum::<f64>() * 1000.0;
    let mut touched = Vec::with_capacity(target.strings.len());
    for (wired, array) in target.strings.iter().zip(modelled.arrays) {
        let string_w = measured_hours(store, target.device, &wired.key, array).await?;
        let paired =
            string_observations((array, modelled.total), (&string_w, total_w), modelled.zone, modelled.days);
        let array_w = target.model.arrays[wired.array].kwp * 1000.0;
        let grid = grids.entry(wired.mppt).or_default();
        touched
            .push((wired.mppt, grid.learn_string(&paired, array_w, nameplate_w, target.model.max_output_w)));
    }
    Ok(touched)
}

/// The UTC instant a series label (UTC) starts at.
fn slot_ms(label: &str) -> Option<i64> {
    let label: jiff::civil::DateTime = label.parse().ok()?;
    Some(label.to_zoned(TimeZone::UTC).ok()?.timestamp().as_millisecond())
}

/// Measured hourly averages over the series, by bucket start.
async fn measured_hours(
    store: &Store,
    device: i64,
    metric: &str,
    series: &[Point],
) -> Result<BTreeMap<i64, f64>, StoreError> {
    let (Some(first), Some(last)) =
        (series.first().and_then(|p| slot_ms(&p.time)), series.last().and_then(|p| slot_ms(&p.time)))
    else {
        return Ok(BTreeMap::new());
    };
    let at = |ms| jiff::Timestamp::from_millisecond(ms).unwrap_or(jiff::Timestamp::UNIX_EPOCH);
    let limit = u32::try_from(series.len()).unwrap_or(u32::MAX);
    let window = BucketWindow { from: at(first), to: at(last + HOUR_MS), limit };
    let buckets = store.buckets_between(Tier::Hour, device, metric, window).await?;
    Ok(buckets.into_iter().map(|b| (b.start.as_millisecond(), b.avg)).collect())
}

/// Days reanalysis must age before it is stable enough to learn from.
const SETTLE_DAYS: i64 = 3;
/// How far a first run reaches back.
const BACKFILL_DAYS: i64 = 90;

/// The settled days not yet learned, `[start, end]`; none when nothing is due. The last settled day is the UTC
/// date [`SETTLE_DAYS`] back, as in 3.x: the settling margin absorbs the plant zone's offset.
fn window(learned_through: Option<Date>, now_ms: i64) -> Option<(Date, Date)> {
    let now = jiff::Timestamp::from_millisecond(now_ms).ok()?;
    let end = now.to_zoned(TimeZone::UTC).date().checked_sub(jiff::Span::new().days(SETTLE_DAYS)).ok()?;
    let start = match learned_through {
        Some(day) => day.tomorrow().ok()?,
        None => end.checked_sub(jiff::Span::new().days(BACKFILL_DAYS)).ok()?,
    };
    (start <= end).then_some((start, end))
}

/// Each hour of `series` (UTC labels) on its plant-local day within `days`: its position, UTC start, plant-local
/// day, month and hour.
fn local_hours<'a>(
    series: &'a [Point],
    zone: &'a TimeZone,
    (start, end): (Date, Date),
) -> impl Iterator<Item = (usize, i64, Date, i8, i8)> + 'a {
    series.iter().enumerate().filter_map(move |(i, point)| {
        let start_ms = slot_ms(&point.time)?;
        let local = jiff::Timestamp::from_millisecond(start_ms).ok()?.to_zoned(zone.clone());
        (start..=end)
            .contains(&local.date())
            .then(|| (i, start_ms, local.date(), local.month(), local.hour()))
    })
}

/// Each modelled hour of `series` (UTC labels) with a measured hourly average starting at the same instant,
/// on its plant-local day within `days`.
fn observations(
    series: &[Point],
    measured: &BTreeMap<i64, f64>,
    zone: &TimeZone,
    days: (Date, Date),
) -> Vec<(Date, Observation)> {
    local_hours(series, zone, days)
        .filter_map(|(i, start_ms, day, month, hour)| {
            let &actual_w = measured.get(&start_ms)?;
            Some((day, Observation { month, hour, expected_w: series[i].watts, actual_w }))
        })
        .collect()
}

/// Each hour of a wired array's modelled `array` series with its string measured, beside the inverter's
/// modelled `total` and measured total of the same instant.
fn string_observations(
    (array, total): (&[Point], &[Point]),
    (string_w, total_w): (&BTreeMap<i64, f64>, &BTreeMap<i64, f64>),
    zone: &TimeZone,
    days: (Date, Date),
) -> Vec<StringObservation> {
    local_hours(array, zone, days)
        .filter_map(|(i, start_ms, _, month, hour)| {
            let &actual_w = string_w.get(&start_ms)?;
            Some(StringObservation {
                array: Observation { month, hour, expected_w: array[i].watts, actual_w },
                inverter_expected_w: total.get(i)?.watts,
                inverter_actual_w: total_w.get(&start_ms).copied(),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Duration;

    use jiff::civil::date;
    use tokio::sync::watch;

    use super::*;

    fn at(instant: &str) -> i64 {
        instant.parse::<jiff::Timestamp>().expect("instant").as_millisecond()
    }

    fn berlin() -> TimeZone {
        jiff::tz::db().get("Europe/Berlin").expect("bundled zone")
    }

    fn point(time: &str, watts: f64) -> Point {
        Point { time: time.into(), watts, peak_watts: watts }
    }

    /// Counts the job's runs; each one finishes at once.
    fn counted() -> (Arc<AtomicUsize>, impl FnMut() -> Option<std::future::Ready<()>>) {
        let runs = Arc::new(AtomicUsize::new(0));
        let counter = Arc::clone(&runs);
        (runs, move || {
            counter.fetch_add(1, Ordering::SeqCst);
            Some(std::future::ready(()))
        })
    }

    #[tokio::test(start_paused = true)]
    async fn the_job_first_runs_after_two_minutes_then_every_twelve_hours_and_never_after_a_stop() {
        let (runs, job) = counted();
        let (stop, stopped) = watch::channel(false);
        let task = tokio::spawn(schedule(job, stopped));
        tokio::time::sleep(Duration::from_secs(119)).await;
        assert_eq!(runs.load(Ordering::SeqCst), 0, "before 2 min");
        tokio::time::sleep(Duration::from_secs(2)).await;
        assert_eq!(runs.load(Ordering::SeqCst), 1, "at 2 min");
        tokio::time::sleep(Duration::from_secs(12 * 3600 - 2)).await;
        assert_eq!(runs.load(Ordering::SeqCst), 1, "before 12 h later");
        tokio::time::sleep(Duration::from_secs(2)).await;
        assert_eq!(runs.load(Ordering::SeqCst), 2, "12 h later");
        stop.send_replace(true);
        task.await.expect("schedule");
        tokio::time::sleep(Duration::from_hours(48)).await;
        assert_eq!(runs.load(Ordering::SeqCst), 2, "after the stop");
    }

    #[tokio::test(start_paused = true)]
    async fn a_stop_before_the_first_run_ends_the_task_with_no_run() {
        let (runs, job) = counted();
        let (stop, stopped) = watch::channel(false);
        let task = tokio::spawn(schedule(job, stopped));
        tokio::time::sleep(Duration::from_secs(60)).await;
        stop.send_replace(true);
        task.await.expect("schedule");
        assert_eq!(runs.load(Ordering::SeqCst), 0);
    }

    #[tokio::test(start_paused = true)]
    async fn a_stop_during_a_stalled_run_ends_the_task() {
        let runs = Arc::new(AtomicUsize::new(0));
        let counter = Arc::clone(&runs);
        let stalled = move || {
            counter.fetch_add(1, Ordering::SeqCst);
            Some(std::future::pending::<()>())
        };
        let (stop, stopped) = watch::channel(false);
        let task = tokio::spawn(schedule(stalled, stopped));
        tokio::time::sleep(Duration::from_secs(180)).await;
        assert_eq!(runs.load(Ordering::SeqCst), 1, "a run is in flight");
        stop.send_replace(true);
        let ended = tokio::time::timeout(Duration::from_hours(1), task).await;
        assert!(matches!(ended, Ok(Ok(()))), "the stop drops the stalled run");
    }

    #[tokio::test(start_paused = true)]
    async fn a_job_with_nothing_to_run_ends_the_task() {
        let (_stop, stopped) = watch::channel(false);
        let task = tokio::spawn(schedule(|| None::<std::future::Ready<()>>, stopped));
        let ended = tokio::time::timeout(Duration::from_hours(1), task).await;
        assert!(matches!(ended, Ok(Ok(()))));
    }

    static CORE_RUNS: AtomicUsize = AtomicUsize::new(0);

    fn count_core_run(_: &Core) -> Pin<Box<dyn Future<Output = ()> + Send + '_>> {
        Box::pin(async {
            CORE_RUNS.fetch_add(1, Ordering::SeqCst);
        })
    }

    #[tokio::test]
    async fn a_core_learns_once_per_tick_however_often_its_settings_are_applied() {
        let dir = std::env::temp_dir().join(format!("sunreye-learn-core-{}", std::process::id()));
        drop(std::fs::remove_dir_all(&dir));
        let core = Core::open_learning(&dir, count_core_run).await.expect("core");
        core.apply().await.expect("apply");
        core.apply().await.expect("apply");
        // Paused only now: the store's pool times out on a clock that leaps while it opens.
        tokio::time::pause();
        tokio::time::sleep(Duration::from_secs(150)).await;
        assert_eq!(CORE_RUNS.load(Ordering::SeqCst), 1, "one run at 2 min");
        core.stop().await;
        tokio::time::sleep(Duration::from_hours(24)).await;
        assert_eq!(CORE_RUNS.load(Ordering::SeqCst), 1, "none after the stop");
        drop(std::fs::remove_dir_all(&dir));
    }

    fn array(slug: &str, kwp: f64, azimuth: f64) -> weather::PvArray {
        weather::PvArray {
            kwp,
            tilt: 30.0,
            azimuth,
            device_slug: Some(slug.into()),
            temp_coefficient: None,
            system_loss: None,
            mppt: None,
        }
    }

    #[test]
    fn a_run_models_only_the_arrays_wired_into_its_inverter() {
        let mut config = weather::compose(weather::PlantSettings::default(), &[], &BTreeMap::new());
        config.forecast.arrays = vec![array("2", 3.0, -90.0), array("1", 5.0, 0.0), array("1", 2.0, 90.0)];
        let model = own_arrays(&config, "1").model();
        let own: Vec<_> = model.arrays.iter().map(|a| (a.kwp, a.azimuth)).collect();
        assert_eq!(own, [(5.0, 0.0), (2.0, 90.0)]);
        assert_eq!(own_arrays(&config, "3").model().arrays, []);
    }

    #[test]
    fn a_first_run_reaches_back_90_days_from_the_last_settled_day() {
        assert_eq!(window(None, at("2026-07-23T10:00:00Z")), Some((date(2026, 4, 21), date(2026, 7, 20))));
        assert_eq!(window(None, at("2026-07-23T00:00:00Z")), Some((date(2026, 4, 21), date(2026, 7, 20))));
        assert_eq!(window(None, at("2026-07-22T23:59:59Z")), Some((date(2026, 4, 20), date(2026, 7, 19))));
    }

    #[test]
    fn a_later_run_starts_after_the_learned_day_and_is_idle_once_caught_up() {
        let now = at("2026-07-23T10:00:00Z");
        assert_eq!(window(Some(date(2026, 7, 18)), now), Some((date(2026, 7, 19), date(2026, 7, 20))));
        assert_eq!(window(Some(date(2026, 7, 19)), now), Some((date(2026, 7, 20), date(2026, 7, 20))));
        assert_eq!(window(Some(date(2026, 7, 20)), now), None);
        assert_eq!(window(Some(date(2026, 8, 1)), now), None, "a cursor past the clock waits for it");
    }

    #[test]
    fn hours_pair_by_utc_instant_and_take_the_plant_local_month_and_hour() {
        let series = [
            point("2026-07-20T10:00", 4000.0),
            point("2026-07-20T11:00", 4200.0),
            point("2026-07-20T12:00", 4100.0),
        ];
        let measured =
            BTreeMap::from([(at("2026-07-20T10:00:00Z"), 3600.0), (at("2026-07-20T12:00:00Z"), -5.0)]);
        let days = (date(2026, 7, 20), date(2026, 7, 20));
        assert_eq!(
            observations(&series, &measured, &berlin(), days),
            [
                (date(2026, 7, 20), Observation { month: 7, hour: 12, expected_w: 4000.0, actual_w: 3600.0 }),
                (date(2026, 7, 20), Observation { month: 7, hour: 14, expected_w: 4100.0, actual_w: -5.0 }),
            ]
        );
    }

    #[test]
    fn the_autumn_repeated_hour_folds_twice_and_the_spring_gap_is_skipped() {
        let measured: BTreeMap<i64, f64> =
            ["2025-10-26T00:00:00Z", "2025-10-26T01:00:00Z", "2026-03-29T00:00:00Z", "2026-03-29T01:00:00Z"]
                .into_iter()
                .map(|t| (at(t), 300.0))
                .collect();
        let autumn = [point("2025-10-26T00:00", 400.0), point("2025-10-26T01:00", 500.0)];
        let hours = |series: &[Point], day| {
            observations(series, &measured, &berlin(), (day, day))
                .iter()
                .map(|(_, o)| (o.month, o.hour))
                .collect::<Vec<_>>()
        };
        assert_eq!(hours(&autumn, date(2025, 10, 26)), [(10, 2), (10, 2)]);
        let spring = [point("2026-03-29T00:00", 400.0), point("2026-03-29T01:00", 500.0)];
        assert_eq!(hours(&spring, date(2026, 3, 29)), [(3, 1), (3, 3)]);
    }

    #[test]
    fn hours_outside_the_plant_local_days_are_left_out() {
        let series =
            [point("2025-10-25T21:00", 1.0), point("2025-10-25T22:00", 1.0), point("2025-10-26T23:00", 1.0)];
        let measured: BTreeMap<i64, f64> =
            ["2025-10-25T21:00:00Z", "2025-10-25T22:00:00Z", "2025-10-26T23:00:00Z"]
                .into_iter()
                .map(|t| (at(t), 1.0))
                .collect();
        let kept = observations(&series, &measured, &berlin(), (date(2025, 10, 26), date(2025, 10, 26)));
        assert_eq!(kept.iter().map(|(day, o)| (*day, o.hour)).collect::<Vec<_>>(), [(date(2025, 10, 26), 0)]);
    }

    /// The plant-local hours kept for `day` in `zone` from `count` measured UTC hours starting at `from`.
    fn day_cut(zone: &str, from: &str, count: i64, day: Date) -> Vec<i8> {
        let start = at(from);
        let instants: Vec<i64> = (0..count).map(|h| start + h * HOUR_MS).collect();
        let label = |ms: i64| {
            jiff::Timestamp::from_millisecond(ms).expect("instant").strftime("%Y-%m-%dT%H:%M").to_string()
        };
        let series: Vec<Point> = instants.iter().map(|&ms| point(&label(ms), 1.0)).collect();
        let measured: BTreeMap<i64, f64> = instants.iter().map(|&ms| (ms, 1.0)).collect();
        let zone = plant_zone::lookup(zone).expect("bundled zone");
        observations(&series, &measured, &zone, (day, day)).iter().map(|(_, o)| o.hour).collect()
    }

    #[test]
    fn a_spring_forward_day_has_23_hours_from_local_midnight_to_midnight() {
        let hours = day_cut("Europe/Berlin", "2026-03-28T22:00:00Z", 25, date(2026, 3, 29));
        assert_eq!(hours.len(), 23);
        assert_eq!((hours[0], hours[1], hours[2], hours[22]), (0, 1, 3, 23));
    }

    #[test]
    fn a_fall_back_day_has_25_hours_from_local_midnight_to_midnight() {
        let hours = day_cut("Europe/Berlin", "2025-10-25T21:00:00Z", 27, date(2025, 10, 26));
        assert_eq!(hours.len(), 25);
        assert_eq!(&hours[..5], [0, 1, 2, 2, 3]);
        assert_eq!(hours[24], 23);
    }

    #[test]
    fn a_half_hour_and_a_45_minute_zone_cut_the_day_at_their_own_midnight() {
        // 2026-07-19T18:00Z is 23:30 in Kolkata and 23:45 in Kathmandu, still the 19th.
        for zone in ["Asia/Kolkata", "Asia/Kathmandu"] {
            let hours = day_cut(zone, "2026-07-19T18:00:00Z", 26, date(2026, 7, 20));
            assert_eq!(hours, (0..24).collect::<Vec<i8>>(), "{zone}");
        }
    }

    fn wired_array(mppt: Option<u32>) -> weather::PvArray {
        weather::PvArray { mppt, ..array("1", 2.0, 0.0) }
    }

    #[test]
    fn only_an_array_on_a_string_that_reports_power_learns_from_that_string() {
        let arrays = [None, Some(2), Some(3), Some(1), Some(9)].map(wired_array);
        let power = [(1, "dc.pv1.power"), (2, "dc.pv2.power")];
        let got: Vec<_> = wired(&arrays, &power).into_iter().map(|w| (w.array, w.mppt, w.key)).collect();
        assert_eq!(got, [(1, 2, "dc.pv2.power".to_owned()), (3, 1, "dc.pv1.power".to_owned())]);
        assert!(wired(&arrays, &[]).is_empty(), "no string power: every array learns from the total");
    }

    #[test]
    fn a_string_hour_pairs_with_the_inverter_total_of_the_same_instant_and_lacks_it_when_unmeasured() {
        let array = [
            point("2026-07-20T10:00", 2000.0),
            point("2026-07-20T11:00", 2100.0),
            point("2026-07-20T12:00", 2200.0),
        ];
        let total = [
            point("2026-07-20T10:00", 5000.0),
            point("2026-07-20T11:00", 5100.0),
            point("2026-07-20T12:00", 5200.0),
        ];
        let string_w =
            BTreeMap::from([(at("2026-07-20T10:00:00Z"), 1500.0), (at("2026-07-20T11:00:00Z"), 0.0)]);
        let total_w =
            BTreeMap::from([(at("2026-07-20T10:00:00Z"), 4000.0), (at("2026-07-20T12:00:00Z"), 4100.0)]);
        let days = (date(2026, 7, 20), date(2026, 7, 20));
        let hour = |hour, expected_w, actual_w| Observation { month: 7, hour, expected_w, actual_w };
        assert_eq!(
            string_observations((&array, &total), (&string_w, &total_w), &berlin(), days),
            [
                StringObservation {
                    array: hour(12, 2000.0, 1500.0),
                    inverter_expected_w: 5000.0,
                    inverter_actual_w: Some(4000.0),
                },
                StringObservation {
                    array: hour(13, 2100.0, 0.0),
                    inverter_expected_w: 5100.0,
                    inverter_actual_w: None
                },
            ]
        );
    }

    #[test]
    fn each_array_takes_the_grid_of_its_own_string_on_the_primary_inverter_only() {
        let mut one = CorrectionModel::default();
        one.set(7, 12, forecast::CorrectionCell { ratio: 0.8, weight: 3.0 });
        let strings = BTreeMap::from([(1, one.clone())]);
        let on = |slug, mppt| weather::PvArray { mppt, ..array(slug, 1.0, 0.0) };
        let arrays = [on("1", Some(1)), on("2", Some(1)), on("1", None), on("1", Some(2))];
        assert_eq!(string_grids(&arrays, "1", &strings), vec![Some(one), None, None, None]);
    }

    #[test]
    fn an_unreadable_label_is_left_out() {
        let measured = BTreeMap::from([(at("2026-07-20T10:00:00Z"), 1.0)]);
        let days = (date(2026, 7, 20), date(2026, 7, 20));
        assert_eq!(observations(&[point("noon", 1.0)], &measured, &berlin(), days), []);
    }
}
