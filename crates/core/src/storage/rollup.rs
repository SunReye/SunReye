//! Rollup arithmetic (ADR 3): one window of one series, from its change points.

use jiff::Timestamp;
use jiff::civil::Date;
use jiff::tz::TimeZone;
use sunreye_profile::RoleKind;

use super::encode::{Point, Tick};

/// One window's aggregate, in steps and ticks.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Sums {
    Measurement {
        /// Time with a value; gaps excluded.
        duration: Tick,
        /// `Σ value·duration`.
        sum: i64,
        min: i64,
        max: i64,
    },
    Counter {
        first: i64,
        last: i64,
        delta: i64,
    },
}

/// The window `[start, end)` of a series; `points` are in time order and include the one in
/// force at `start`. `None` when no value falls in the window, and always for a status.
pub fn roll(kind: RoleKind, points: &[Point], start: Tick, end: Tick) -> Option<Sums> {
    match kind {
        RoleKind::Measurement => measurement(points, start, end),
        RoleKind::Counter => counter(points, start, end),
        RoleKind::Status => None,
    }
}

fn measurement(points: &[Point], start: Tick, end: Tick) -> Option<Sums> {
    let (mut duration, mut sum, mut extremes): (Tick, i128, Option<(i64, i64)>) = (0, 0, None);
    let ends = points.iter().skip(1).map(|p| p.time).chain([end]);
    for (point, until) in points.iter().zip(ends) {
        let span = until.min(end) - point.time.max(start);
        let Some(value) = point.value.filter(|_| span > 0) else {
            continue;
        };
        duration += span;
        sum += i128::from(value) * i128::from(span);
        let (min, max) = extremes.get_or_insert((value, value));
        *min = value.min(*min);
        *max = value.max(*max);
    }
    let (min, max) = extremes?;
    Some(Sums::Measurement {
        duration,
        // Out of range only past 2^53 steps held for a day: clamped, never wrapped.
        #[expect(clippy::cast_possible_truncation, reason = "clamped to the i64 range")]
        sum: sum.clamp(i128::from(i64::MIN), i128::from(i64::MAX)) as i64,
        min,
        max,
    })
}

/// Energy is the sum of rises between consecutive values: a drop is a reset, and nothing is
/// gained across a gap. A counter that climbs back to its value before a drop had a low reading,
/// not a reset: what it gained on the way back is taken back, and only the rise past that value
/// counts. Points before the window only set the value in force and any drop before it.
fn counter(points: &[Point], start: Tick, end: Tick) -> Option<Sums> {
    let (mut first, mut last, mut delta, mut previous) = (None, None, 0, None::<i64>);
    // After a drop: the value before it, and what the window counted since.
    let mut low: Option<(i64, i64)> = None;
    for point in points.iter().take_while(|p| p.time < end) {
        let inside = point.time >= start;
        if inside {
            if let Some(value) = point.value {
                first.get_or_insert(value);
            }
        } else {
            // Only the value in force at the start counts; a gap there leaves no first value.
            first = point.value;
        }
        let Some((before, value)) = previous.zip(point.value) else {
            low = None;
            last = point.value.or(last);
            previous = point.value;
            continue;
        };
        let counted = |rise: i64| if inside { rise } else { 0 };
        match &mut low {
            _ if value < before => {
                low.get_or_insert((before, 0));
            }
            Some((peak, gained)) if value >= *peak => {
                delta += counted(value - *peak) - *gained;
                low = None;
            }
            Some((_, gained)) => {
                *gained += counted(value - before);
                delta += counted(value - before);
            }
            None => delta += counted(value - before),
        }
        last = Some(value);
        previous = Some(value);
    }
    Some(Sums::Counter {
        first: first?,
        last: last?,
        delta,
    })
}

/// Rollups of values each held for a whole window of `width` from its start, as an older
/// release's buckets are (ADR 18); `values` are in time order. A counter rises from the window
/// before when that one adjoins, and a drop is a reset.
pub fn buckets(kind: RoleKind, values: &[(Tick, i64)], width: Tick) -> Vec<(Tick, Sums)> {
    let mut previous: Option<(Tick, i64)> = None;
    let mut rolled = Vec::new();
    for &(start, value) in values {
        let sums = match kind {
            RoleKind::Measurement => Sums::Measurement {
                duration: width,
                sum: value.saturating_mul(width),
                min: value,
                max: value,
            },
            RoleKind::Counter => {
                let before = previous.filter(|p| p.0 + width == start).map(|p| p.1);
                let first = before.unwrap_or(value);
                Sums::Counter {
                    first,
                    last: value,
                    delta: (value - first).max(0),
                }
            }
            RoleKind::Status => return Vec::new(),
        };
        rolled.push((start, sums));
        previous = Some((start, value));
    }
    rolled
}

/// The rollup of adjoining windows, in time order; `None` for none, or for windows of both kinds.
pub fn fold(windows: &[Sums]) -> Option<Sums> {
    let (first, rest) = windows.split_first()?;
    rest.iter()
        .try_fold(*first, |total, window| match (total, *window) {
            (
                Sums::Measurement {
                    duration,
                    sum,
                    min,
                    max,
                },
                Sums::Measurement {
                    duration: d,
                    sum: s,
                    min: lo,
                    max: hi,
                },
            ) => Some(Sums::Measurement {
                duration: duration + d,
                sum: sum.saturating_add(s),
                min: min.min(lo),
                max: max.max(hi),
            }),
            (Sums::Counter { first, delta, .. }, Sums::Counter { last, delta: d, .. }) => {
                Some(Sums::Counter {
                    first,
                    last,
                    delta: delta + d,
                })
            }
            _ => None,
        })
}

/// One plant-local day.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Day {
    /// The local date as YYYYMMDD.
    pub key: i64,
    pub start: Tick,
    pub end: Tick,
}

/// The local days of `zone` that overlap `[from, to)`. Cut from UTC instants, a day lasts 23,
/// 24 or 25 hours as the zone's offset changes.
pub fn days(zone: &TimeZone, from: Tick, to: Tick) -> Vec<Day> {
    let mut days = Vec::new();
    let Some(mut date) = date(zone, from) else {
        return days;
    };
    while let (Some(start), Some(next)) = (midnight(zone, date), date.tomorrow().ok()) {
        let Some(end) = midnight(zone, next) else {
            break;
        };
        if start >= to {
            break;
        }
        let key =
            i64::from(date.year()) * 10_000 + i64::from(date.month()) * 100 + i64::from(date.day());
        days.push(Day { key, start, end });
        date = next;
    }
    days
}

fn date(zone: &TimeZone, tick: Tick) -> Option<Date> {
    let instant = Timestamp::from_millisecond(tick.checked_mul(100)?).ok()?;
    Some(instant.to_zoned(zone.clone()).date())
}

/// The first instant of `date`, which a DST change may move off 00:00.
fn midnight(zone: &TimeZone, date: Date) -> Option<Tick> {
    let start = date.to_zoned(zone.clone()).ok()?.start_of_day().ok()?;
    Some(start.timestamp().as_millisecond().div_euclid(100))
}

#[cfg(test)]
mod tests;
