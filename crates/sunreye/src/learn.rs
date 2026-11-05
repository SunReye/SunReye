//! The forecast correction's learn run (3.x `forecast-correction-job.ts`): settled days of reanalysis
//! irradiance through the forecast model, each hour against the measured hourly average of `pv.total.power`,
//! folded into the plant's primary inverter's grid. Learns whenever the forecast is configured; the forecast
//! applies the grid only while `forecast.correction.enabled`.
//!
//! The learning unit is the inverter and its total PV power, as in 3.x. A per-array unit fed from a string's
//! power (#448) changes which arrays a run models and which metric it pairs them with, not the fold.

use std::collections::BTreeMap;

use jiff::civil::Date;
use jiff::tz::TimeZone;

use crate::forecast::{
    self, CorrectionModel, ForecastConfig, Location, Observation, Point, Run, SimInputs, Skill,
};
use crate::open_meteo;
use crate::rollup::Tier;
use crate::run::Core;
use crate::store::{BucketWindow, DeviceRow, Store, StoreError};
use crate::weather::{self, OPEN_METEO, WeatherConfig};

const PV_ROLE: &str = "pv.total.power";
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

/// What a run learns for: the primary inverter, its arrays as the model reads them and its total PV metric.
struct Unit {
    device: i64,
    model: ForecastConfig,
    pv_key: String,
}

/// None while the primary inverter has no arrays or no total PV power.
async fn unit(core: &Core, config: &WeatherConfig) -> Result<Option<Unit>, StoreError> {
    let devices = core.store.devices().await?;
    let Some(device) = primary(&devices) else { return Ok(None) };
    let slug = device.id.to_string();
    let own = config.forecast.arrays.iter().map(|a| a.device_slug.as_deref() == Some(slug.as_str()));
    let mut model = config.model();
    model.arrays = model.arrays.into_iter().zip(own).filter(|(_, own)| *own).map(|(a, _)| a).collect();
    let profile = core.profile(&device.profile_id).await?;
    let pv = profile.as_ref().and_then(|p| p.metrics.iter().find(|m| m.role.as_deref() == Some(PV_ROLE)));
    Ok(pv.filter(|_| !model.arrays.is_empty()).map(|pv| Unit {
        device: device.id,
        model,
        pv_key: pv.key.clone(),
    }))
}

/// The modelled hours over `days` (UTC labels) and the plant zone the archive names; none when it cannot
/// be had, logged.
async fn modelled(
    core: &Core,
    unit: &Unit,
    location: Location,
    days: (Date, Date),
) -> Option<(Vec<Point>, TimeZone)> {
    let planes: Vec<open_meteo::Plane> = unit.model.arrays.iter().map(|a| (a.tilt, a.azimuth)).collect();
    let fetched = open_meteo::fetch_archive(&core.archive_url, &core.roots, location, &planes, days).await;
    let fetched = fetched
        .inspect_err(
            |error| tracing::warn!(%error, start = %days.0, end = %days.1, "correction archive fetch failed"),
        )
        .ok()?;
    let zone = fetched.time_zone.as_deref().and_then(|name| jiff::tz::db().get(name).ok());
    let Some(zone) = zone else {
        tracing::warn!(zone = fetched.time_zone, "correction archive names no known time zone");
        return None;
    };
    let run = Run { time_zone: &TimeZone::UTC, now_ms: 0, sim: SimInputs::default(), correction: None };
    let built = forecast::build(&unit.model, &fetched.irradiance, OPEN_METEO, &run);
    let built =
        built.inspect_err(|error| tracing::warn!(%error, "correction archive series unusable")).ok()?;
    Some((built.raw.series, zone))
}

/// One learn run over the days due at the core's clock.
pub async fn learn_once(core: &Core) -> Result<Outcome, StoreError> {
    let config = weather::read(&core.store).await?;
    let Some(location) = config.forecast_ready() else { return Ok(Outcome::Idle) };
    let Some(unit) = unit(core, &config).await? else { return Ok(Outcome::Idle) };
    let (mut model, state) = core.store.correction(unit.device).await?;
    let Some(days) = window(state.map(|s| s.learned_through), core.now_ms()) else {
        return Ok(Outcome::UpToDate);
    };
    let Some((series, zone)) = modelled(core, &unit, location, days).await else {
        return Ok(Outcome::FetchFailed);
    };
    let measured = measured(&core.store, unit.device, &unit.pv_key, &series).await?;
    let paired = observations(&series, &measured, &zone, days);
    let Some(&(through, _)) = paired.last() else { return Ok(Outcome::NoMeasuredHours) };
    let hours: Vec<Observation> = paired.into_iter().map(|(_, o)| o).collect();
    let nameplate_w = unit.model.arrays.iter().map(|a| a.kwp).sum::<f64>() * 1000.0;
    let skill = state.map(|s| s.skill).unwrap_or_default();
    let fold = model.learn(skill, &hours, nameplate_w, unit.model.max_output_w);
    let state = LearnState { learned_through: through, skill: fold.skill };
    core.store.save_correction(unit.device, &model, &fold.touched, &state).await?;
    tracing::info!(hours = hours.len(), %through, cells = fold.touched.len(), "forecast correction learned");
    Ok(Outcome::Learned { hours: hours.len(), through })
}

/// The UTC instant a series label (UTC) starts at.
fn slot_ms(label: &str) -> Option<i64> {
    let label: jiff::civil::DateTime = label.parse().ok()?;
    Some(label.to_zoned(TimeZone::UTC).ok()?.timestamp().as_millisecond())
}

/// Measured hourly averages over the series, by bucket start.
async fn measured(
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

/// Each modelled hour of `series` (UTC labels) with a measured hourly average starting at the same instant,
/// on its plant-local day within `days`.
fn observations(
    series: &[Point],
    measured: &BTreeMap<i64, f64>,
    zone: &TimeZone,
    (start, end): (Date, Date),
) -> Vec<(Date, Observation)> {
    let mut out = Vec::new();
    for point in series {
        let Some(start_ms) = slot_ms(&point.time) else { continue };
        let Some(&actual_w) = measured.get(&start_ms) else { continue };
        let Ok(local) = jiff::Timestamp::from_millisecond(start_ms).map(|t| t.to_zoned(zone.clone())) else {
            continue;
        };
        if (start..=end).contains(&local.date()) {
            let (month, hour) = (local.month(), local.hour());
            out.push((local.date(), Observation { month, hour, expected_w: point.watts, actual_w }));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use jiff::civil::date;

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

    #[test]
    fn an_unreadable_label_is_left_out() {
        let measured = BTreeMap::from([(at("2026-07-20T10:00:00Z"), 1.0)]);
        let days = (date(2026, 7, 20), date(2026, 7, 20));
        assert_eq!(observations(&[point("noon", 1.0)], &measured, &berlin(), days), []);
    }
}
