//! Ten years inserted through the core's history import (ADR 18, 24).
//!
//! The years past change-point retention as hourly values, the recent ones as readings at each series' cadence, written
//! newest first so each import lands before the history already stored. The physics runs once
//! forward to keep a checkpoint at each chunk's start, then again over each chunk.

use std::time::{Instant, SystemTime};

use sunreye_core::storage::{Backfill, Held, Storage};
use sunreye_profile::RoleKind;

use crate::Error;
use crate::home::{Home, POLL};
use crate::model::Model;
use crate::providers::Prices;
use crate::series::{Frame, Plant, Stored};
use crate::sky::Sky;

const HOUR: i64 = 3600;
const QUARTER: i64 = 900;
/// Readings are imported a week at a time, to bound memory.
pub const CHUNK: i64 = 7 * 86_400;
/// Degrees: the clear-sky index is null with the sun lower (ADR 23).
const SUN_ELEVATION: f64 = 5.0;

/// What drives the physics and what is derived from it at each poll.
pub struct Physics<'a> {
    pub sky: Sky,
    pub model: &'a Model,
    pub prices: &'a Prices,
    pub plant: &'a Plant,
}

impl Physics<'_> {
    /// The plant at the poll `unix`, `home` stepped to it.
    pub fn frame(&self, home: &mut Home, unix: i64) -> Frame {
        let now = home.step(unix, self.model);
        let balance = self.plant.balance(&now);
        let quarter = unix.rem_euclid(QUARTER) == 0;
        let price = quarter.then(|| self.prices.price(unix));
        let clearness = if quarter {
            let middle = unix + QUARTER / 2;
            let sun = sunreye_pv::sun_position(middle, self.sky.location());
            (90.0 - sun.zenith >= SUN_ELEVATION).then(|| self.sky.clearness(middle))
        } else {
            None
        };
        Frame {
            now,
            balance,
            price,
            clearness,
        }
    }
}

/// What the generation wrote and how long each part took.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Written {
    pub series: usize,
    pub polls: u64,
    pub points: usize,
    pub hours: usize,
    pub days: usize,
    /// Seconds per part.
    pub seconds: Vec<(&'static str, f64)>,
}

impl Written {
    fn took(&mut self, part: &'static str, began: Instant) {
        self.seconds.push((part, began.elapsed().as_secs_f64()));
    }
}

/// Hourly values of one series over the years past retention.
#[derive(Debug, Clone, Default)]
struct Hours {
    values: Vec<(SystemTime, f64)>,
    sum: f64,
    count: u32,
    last: Option<f64>,
}

/// Inserts the history of every series of `plant` from `from` to `to`, readings from `raw` on.
///
/// # Errors
/// An import failed.
pub async fn history(
    storage: &Storage,
    physics: &Physics<'_>,
    mut home: Home,
    (from, raw, to): (i64, i64, i64),
    written: &mut Written,
) -> Result<(), Error> {
    let stored = &physics.plant.stored;
    written.series = stored.len();
    let began = Instant::now();
    let starts: Vec<i64> = chunks(raw, to).iter().map(|c| c.0).collect();
    let mut checkpoints = Vec::new();
    let mut hours = vec![Hours::default(); stored.len()];
    let mut t = from;
    while t < to {
        if starts.contains(&t) {
            checkpoints.push((t, home.clone()));
        }
        let frame = physics.frame(&mut home, t);
        if t < raw {
            hourly(stored, &frame, t, &mut hours);
        }
        written.polls += 1;
        t += POLL;
    }
    written.took("physics forward", began);
    let began = Instant::now();
    for (start, end) in chunks(raw, to).into_iter().rev() {
        let Some(home) = checkpoints
            .iter()
            .find(|c| c.0 == start)
            .map(|c| c.1.clone())
        else {
            continue;
        };
        let readings = readings(physics, home, (start, end));
        for (series, raw) in stored.iter().zip(readings) {
            let backfill = Backfill {
                raw,
                ..Backfill::default()
            };
            let done = storage
                .import(series.device, series.series, series.policy, backfill)
                .await
                .map_err(|e| Error::Core(format!("{}: {e}", series.name)))?;
            written.points += done.points;
        }
    }
    written.took("readings", began);
    let began = Instant::now();
    import_hours(storage, stored, hours, written).await?;
    written.took("hours", began);
    Ok(())
}

/// Imports each series' hourly values; daily values are rolled up from them.
async fn import_hours(
    storage: &Storage,
    stored: &[Stored],
    hours: Vec<Hours>,
    written: &mut Written,
) -> Result<(), Error> {
    for (series, hours) in stored.iter().zip(hours) {
        if hours.values.is_empty() {
            continue;
        }
        let backfill = Backfill {
            hours: hours.values,
            ..Backfill::default()
        };
        let done = storage
            .import(series.device, series.series, series.policy, backfill)
            .await
            .map_err(|e| Error::Core(format!("{}: {e}", series.name)))?;
        written.hours += done.hours;
        written.days += done.days;
    }
    Ok(())
}

/// The chunks of readings from `raw` to `to`, oldest first; the first may be short.
fn chunks(raw: i64, to: i64) -> Vec<(i64, i64)> {
    let mut chunks = Vec::new();
    let mut end = to;
    while end > raw {
        let start = (end - CHUNK).max(raw);
        chunks.push((start, end));
        end = start;
    }
    chunks.reverse();
    chunks
}

/// Folds the poll at `t` into each series' hour: a measurement's mean, a counter's value at the
/// hour's end. Statuses and held values keep no rollups.
fn hourly(stored: &[Stored], frame: &Frame, t: i64, hours: &mut [Hours]) {
    let poll = t / POLL;
    let closes = (t + POLL).rem_euclid(HOUR) == 0;
    let hour = crate::instant(t.div_euclid(HOUR) * HOUR);
    for (series, acc) in stored.iter().zip(hours.iter_mut()) {
        if poll % series.every == 0
            && let Some(value) = series.read(frame)
        {
            acc.sum += value;
            acc.count += 1;
            acc.last = Some(value);
        }
        if !closes {
            continue;
        }
        let value = match series.policy.kind {
            RoleKind::Measurement if acc.count > 0 => Some(acc.sum / f64::from(acc.count)),
            RoleKind::Counter => acc.last,
            RoleKind::Measurement | RoleKind::Status | RoleKind::Held => None,
        };
        if let Some(value) = value {
            acc.values.push((hour, value));
        }
        acc.sum = 0.0;
        acc.count = 0;
    }
}

/// Each series' readings from `start` to `end`, from the physics at `home`: a run of readings that
/// store the same value becomes one reading held until the next, which stores the same change
/// points with fewer rows to send.
fn readings(physics: &Physics<'_>, mut home: Home, (start, end): (i64, i64)) -> Vec<Vec<Held>> {
    let stored = &physics.plant.stored;
    let mut runs: Vec<Vec<Held>> = vec![Vec::new(); stored.len()];
    // Each series' last stored value, in steps, while its run is open.
    let mut open: Vec<Option<i64>> = vec![None; stored.len()];
    let mut t = start;
    while t < end {
        let frame = physics.frame(&mut home, t);
        let poll = t / POLL;
        for ((series, held), last) in stored.iter().zip(runs.iter_mut()).zip(open.iter_mut()) {
            if poll % series.every != 0 {
                continue;
            }
            let until = t + series.every * POLL;
            let Some(value) = series.read(&frame).filter(|v| v.is_finite()) else {
                *last = None;
                continue;
            };
            #[expect(clippy::cast_possible_truncation, reason = "steps of a reading")]
            let steps = (value / series.policy.step).round() as i64;
            match (last.as_mut(), held.last_mut()) {
                (Some(same), Some(run)) if *same == steps => {
                    run.hold = Some(crate::seconds(until - crate::unix(run.time)));
                }
                _ => {
                    held.push(Held {
                        time: crate::instant(t),
                        value,
                        hold: Some(crate::seconds(until - t)),
                    });
                    *last = Some(steps);
                }
            }
        }
        t += POLL;
    }
    runs
}
