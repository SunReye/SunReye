//! Rollups: the hours and days of every declared series, rolled up as their hours close.

use std::collections::HashMap;
use std::ops::Range;
use std::time::{Duration, SystemTime};

use rusqlite::{Connection, OptionalExtension, Transaction, params};
use sunreye_profile::RoleKind;

use super::catalog::kind_of;
use super::{HOUR, Store, blocks, lookup, points, tick, time, write_block};
use crate::bus::{DeviceId, SeriesId};
use crate::storage::encode::{Point, Tick, quantise};
use crate::storage::rollup::{self, Day, Sums};
use crate::storage::{Aggregate, ChangePoint, Error, Rollup, Tier};

/// Stored columns: duration, sum, min, max, first, last, delta.
type Columns = [Option<i64>; 7];

/// One series whose rollups are rewritten.
#[derive(Debug, Clone, Copy)]
pub(super) struct Roll {
    pub device: u32,
    pub series: i64,
    pub kind: RoleKind,
    /// False for a series at an hourly cadence, which stores no hourly rollups (ADR 3).
    pub hours: bool,
}

impl Store {
    /// Rolls up every hour closed before `now`, and again each rolled window `pending` wrote a
    /// late point into. Returns the instant hours are rolled up to.
    pub(super) fn roll(
        &self,
        db: &Connection,
        pending: &[(u32, i64, Point)],
        now: Tick,
    ) -> Result<Option<Tick>, Error> {
        let rolled = match self.rolled {
            Some(rolled) => rolled,
            None => match earliest(db)? {
                Some(earliest) => earliest,
                None => return Ok(None),
            },
        };
        let frontier = floor(now).max(rolled);
        let mut late: HashMap<(u32, i64), Tick> = HashMap::new();
        for &(device, series, point) in pending.iter().filter(|p| p.2.time < rolled) {
            let from = late.entry((device, series)).or_insert(point.time);
            *from = (*from).min(point.time);
        }
        for ((device, _), stored) in &self.tracks {
            let from = late
                .get(&(device.0, stored.id))
                .map_or(rolled, |&time| floor(time));
            self.recompute(db, stored.roll(*device), from..frontier, frontier)?;
        }
        db.execute(
            "INSERT INTO meta (key, value) VALUES ('rolled', ?1)
             ON CONFLICT (key) DO UPDATE SET value = excluded.value",
            [frontier],
        )?;
        Ok(Some(frontier))
    }

    /// Rewrites the hours from `from` to `to`, where the series stores them, and the days they
    /// touch, each cut off at `limit`.
    pub(super) fn recompute(
        &self,
        db: &Connection,
        Roll {
            device,
            series,
            kind,
            hours: stored,
        }: Roll,
        Range {
            start: from,
            end: to,
        }: Range<Tick>,
        limit: Tick,
    ) -> Result<(), Error> {
        if from >= to || matches!(kind, RoleKind::Status | RoleKind::Held) {
            return Ok(());
        }
        let days = rollup::days(&self.zone.1, from, to);
        let first = days.first().map_or(from, |day| day.start.min(from));
        let points = points(db, device, series, first, limit)?;
        let roll = |start: Tick, end: Tick| {
            let end = end.min(limit);
            (end > start)
                .then(|| rollup::roll(kind, window(&points, start, end), start, end))
                .flatten()
        };
        if stored {
            let hours = from.div_euclid(HOUR)..ceil(to);
            let hourly: Vec<_> = hours
                .clone()
                .filter_map(|index| {
                    roll(index * HOUR, (index + 1) * HOUR).map(|sums| (index, sums))
                })
                .collect();
            write_hours(db, (device, series), hours, &hourly)?;
        }
        let daily: Vec<_> = days
            .iter()
            .filter_map(|day| roll(day.start, day.end).map(|sums| (*day, sums)))
            .collect();
        write_days(db, (device, series), &self.zone.0, &days, &daily)?;
        Ok(())
    }

    pub(super) fn rebuild(
        &self,
        device: DeviceId,
        series: SeriesId,
        Range {
            start: from,
            end: to,
        }: Range<SystemTime>,
    ) -> Result<(), Error> {
        let stored = self
            .tracks
            .get(&(device, series))
            .ok_or(Error::UnknownSeries)?;
        let Some(limit) = self.rolled else {
            return Ok(());
        };
        let from = floor(tick(from).unwrap_or(0)).max(self.rebuildable());
        let to = tick(to).unwrap_or(0).min(limit);
        let tx = self.db.unchecked_transaction()?;
        self.recompute(&tx, stored.roll(device), from..to, limit)?;
        tx.commit()?;
        Ok(())
    }

    /// Replaces the change points of a declared series within `range`, then rebuilds its rollups
    /// from the first replaced hour.
    pub(super) fn replace(
        &mut self,
        device: DeviceId,
        series: SeriesId,
        Range {
            start: from,
            end: to,
        }: Range<SystemTime>,
        replacement: &[ChangePoint],
    ) -> Result<(), Error> {
        let stored = self
            .tracks
            .get(&(device, series))
            .ok_or(Error::UnknownSeries)?;
        let (id, roll) = (stored.id, stored.roll(device));
        let (from, to) = (tick(from).unwrap_or(0), tick(to).unwrap_or(0));
        let step: f64 = self.db.query_row(
            "SELECT step FROM step WHERE device = ?1 AND series = ?2",
            params![device.0, id],
            |row| row.get(0),
        )?;
        let mut new = quantised(replacement, step, from..to);
        // A first value equal to the one already in force is no change either.
        let before = points(&self.db, device.0, id, from, from)?;
        if !new.is_empty() && before.first().map(|p| p.value) == new.first().map(|p| p.value) {
            new.remove(0);
        }
        let inside = |time: Tick| (from..to).contains(&time);
        self.pending
            .retain(|&(d, s, p)| !(d == device.0 && s == id && inside(p.time)));
        let tx = self.db.unchecked_transaction()?;
        rewrite(&tx, (device.0, id), from..to, &new)?;
        if let Some(limit) = self.rolled {
            self.recompute(&tx, roll, floor(from)..to.min(limit), limit)?;
        }
        tx.commit()?;
        // The deadband compares against the value now last stored.
        let last = self.last(device.0, id)?;
        if let Some(stored) = self.tracks.get_mut(&(device, series)) {
            stored.track.rebase(last.and_then(|p| p.value));
        }
        Ok(())
    }

    /// The first day start from which every hour and day still has the change points it was
    /// rolled up from, the value in force at its start included: rollups before it are kept.
    fn rebuildable(&self) -> Tick {
        let hour = (self.horizon() + 1) * HOUR;
        rollup::days(&self.zone.1, hour, hour + 1)
            .first()
            .map_or(hour, |day| if day.start == hour { hour } else { day.end })
    }

    pub(super) fn rollups(
        &self,
        device: DeviceId,
        name: &str,
        tier: Tier,
        Range {
            start: from,
            end: to,
        }: Range<SystemTime>,
    ) -> Result<Vec<Rollup>, Error> {
        let Some((series, step)) = lookup(&self.db, device, name)? else {
            return Ok(Vec::new());
        };
        let range = tick(from).unwrap_or(0)..tick(to).unwrap_or(0);
        if self.carries(device, series)? {
            return self.carried(device.0, (series, step), tier, range);
        }
        let mut rows = if tier == Tier::Hour && self.hourly(device, series)? {
            self.hours(device.0, series, range.clone())?
        } else {
            self.stored(device.0, series, tier, range.clone())?
        };
        for (window, sums) in self.open(device, series, tier, range)? {
            rows.retain(|&(start, ..)| start != window.start);
            rows.push((window.start, window.end, columns(sums)));
        }
        rows.sort_by_key(|&(start, ..)| start);
        Ok(rows
            .into_iter()
            .filter_map(|(start, end, columns)| {
                Some(Rollup {
                    start: time(start),
                    end: time(end),
                    aggregate: aggregate(step, columns)?,
                })
            })
            .collect())
    }

    /// The stored rollups of `tier` starting within `range`, as start, end and columns.
    fn stored(
        &self,
        device: u32,
        series: i64,
        tier: Tier,
        Range {
            start: from,
            end: to,
        }: Range<Tick>,
    ) -> Result<Vec<(Tick, Tick, Columns)>, Error> {
        let (sql, from, to) = match tier {
            Tier::Hour => (
                "SELECT hour * 36000, hour * 36000 + 36000,
                 duration, sum, min, max, first, last, delta
                 FROM rollup_hour WHERE device = ?1 AND series = ?2 AND hour >= ?3 AND hour < ?4
                 ORDER BY hour",
                ceil(from),
                ceil(to),
            ),
            Tier::Day => (
                "SELECT start, end, duration, sum, min, max, first, last, delta
                 FROM rollup_day WHERE device = ?1 AND series = ?2 AND start >= ?3 AND start < ?4
                 ORDER BY day",
                from,
                to,
            ),
        };
        let mut statement = self.db.prepare_cached(sql)?;
        let rows = statement.query_map(params![device, series, from, to], |row| {
            let mut columns: Columns = [None; 7];
            for (index, column) in (2..).zip(&mut columns) {
                *column = row.get(index)?;
            }
            Ok((row.get::<_, Tick>(0)?, row.get::<_, Tick>(1)?, columns))
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    /// The closed hours starting within `range` of a series at an hourly cadence, rolled up from
    /// its change points as they would have been stored (ADR 3).
    fn hours(
        &self,
        device: u32,
        series: i64,
        range: Range<Tick>,
    ) -> Result<Vec<(Tick, Tick, Columns)>, Error> {
        let (Some(kind), Some(rolled)) = (self.stored_kind(device, series)?, self.rolled) else {
            return Ok(Vec::new());
        };
        let hours = ceil(range.start)..ceil(range.end).min(rolled.div_euclid(HOUR));
        if hours.is_empty() {
            return Ok(Vec::new());
        }
        let points = points(
            &self.db,
            device,
            series,
            hours.start * HOUR,
            hours.end * HOUR,
        )?;
        Ok(hours
            .filter_map(|hour| {
                let (start, end) = (hour * HOUR, (hour + 1) * HOUR);
                let sums = rollup::roll(kind, window(&points, start, end), start, end)?;
                Some((start, end, columns(sums)))
            })
            .collect())
    }

    /// Whether `series` was declared at an hourly cadence, so it stores no hourly rollups.
    fn hourly(&self, device: DeviceId, series: i64) -> Result<bool, Error> {
        let cadence: Option<i64> = self
            .db
            .prepare_cached("SELECT cadence FROM step WHERE device = ?1 AND series = ?2")?
            .query_row(params![device.0, series], |row| row.get(0))
            .optional()?
            .flatten();
        Ok(cadence.is_some_and(|seconds| seconds >= 3600))
    }

    /// The kind stored for a series, as storage last saw it declared.
    fn stored_kind(&self, device: u32, series: i64) -> Result<Option<RoleKind>, Error> {
        let kind: Option<String> = self
            .db
            .prepare_cached("SELECT kind FROM step WHERE device = ?1 AND series = ?2")?
            .query_row(params![device, series], |row| row.get(0))
            .optional()?
            .flatten();
        Ok(kind.as_deref().and_then(kind_of))
    }

    /// Whether `device`'s series `name` is a status or a held value; false without history.
    pub(super) fn carries_named(&self, device: DeviceId, name: &str) -> Result<bool, Error> {
        match lookup(&self.db, device, name)? {
            Some((series, _)) => self.carries(device, series),
            None => Ok(false),
        }
    }

    /// Whether `series` is a status or a held value. Read from storage, so it holds for a
    /// device that is removed or whose profile is gone (ADR 3).
    fn carries(&self, device: DeviceId, series: i64) -> Result<bool, Error> {
        Ok(matches!(
            self.stored_kind(device.0, series)?,
            Some(RoleKind::Status | RoleKind::Held)
        ))
    }

    /// The kind of `device`'s declared `series`.
    fn kind(&self, device: DeviceId, series: i64) -> Option<RoleKind> {
        self.tracks
            .iter()
            .find(|((d, _), stored)| *d == device && stored.id == series)
            .map(|(_, stored)| stored.kind)
    }

    /// The hours or days starting within `range` that the open hour reaches into, rolled up from
    /// their change points, the unflushed ones included, to the latest reading (ADR 3).
    fn open(
        &self,
        device: DeviceId,
        series: i64,
        tier: Tier,
        range: Range<Tick>,
    ) -> Result<Vec<(Range<Tick>, Sums)>, Error> {
        let (Some(kind), Some(rolled)) = (self.kind(device, series), self.rolled) else {
            return Ok(Vec::new());
        };
        let limit = self.clock;
        let windows: Vec<Range<Tick>> = match tier {
            Tier::Hour => (floor(rolled)..limit)
                .step_by(usize::try_from(HOUR).unwrap_or(usize::MAX))
                .map(|start| start..start + HOUR)
                .collect(),
            Tier::Day => rollup::days(&self.zone.1, rolled, limit)
                .into_iter()
                .map(|day| day.start..day.end)
                .collect(),
        };
        let mut open = Vec::new();
        for open_window in windows {
            let (start, end) = (open_window.start, limit.min(open_window.end));
            if !range.contains(&start) {
                continue;
            }
            let mut points = points(&self.db, device.0, series, start, end)?;
            points.extend(
                self.pending
                    .iter()
                    .filter(|&&(d, s, p)| (d, s) == (device.0, series) && p.time < end)
                    .map(|&(.., p)| p),
            );
            points.sort_by_key(|p| p.time);
            if let Some(sums) = rollup::roll(kind, window(&points, start, end), start, end) {
                open.push((open_window, sums));
            }
        }
        Ok(open)
    }
}

impl Store {
    /// The windows of `tier` starting within `range`, each as the last value the series held
    /// in it: a status or held value stores no rollup row (ADR 3). The window in progress is
    /// the last; nothing is carried past it.
    fn carried(
        &self,
        device: u32,
        (series, step): (i64, f64),
        tier: Tier,
        Range {
            start: from,
            end: to,
        }: Range<Tick>,
    ) -> Result<Vec<Rollup>, Error> {
        let windows: Vec<(Tick, Tick)> = match tier {
            Tier::Hour => (ceil(from)..ceil(to))
                .map(|hour| (hour * HOUR, (hour + 1) * HOUR))
                .collect(),
            Tier::Day => rollup::days(&self.zone.1, from, to)
                .into_iter()
                .filter(|day| day.start >= from)
                .map(|day| (day.start, day.end))
                .collect(),
        };
        let Some(open) = self.rolled else {
            return Ok(Vec::new());
        };
        let windows: Vec<(Tick, Tick)> = windows.into_iter().filter(|w| w.0 <= open).collect();
        let (Some(first), Some(last)) = (windows.first(), windows.last()) else {
            return Ok(Vec::new());
        };
        let points = points(&self.db, device, series, first.0, last.1)?;
        let held = |&(start, end): &(Tick, Tick)| {
            let in_force = points
                .partition_point(|p| p.time <= start)
                .saturating_sub(1);
            let until = points.partition_point(|p| p.time < end);
            let value = points
                .get(in_force..until)?
                .iter()
                .rev()
                .find_map(|p| p.value)?;
            #[expect(clippy::cast_precision_loss, reason = "values are bounded to ±2^53")]
            let value = value as f64 * step;
            Some(Rollup {
                start: time(start),
                end: time(end),
                aggregate: Aggregate::Held { value },
            })
        };
        Ok(windows.iter().filter_map(held).collect())
    }
}

/// `points` within `range` in whole steps, in time order, a repeated value dropped.
fn quantised(points: &[ChangePoint], step: f64, range: Range<Tick>) -> Vec<Point> {
    let mut quantised: Vec<Point> = points
        .iter()
        .filter_map(|p| {
            let time = tick(p.time).filter(|t| range.contains(t))?;
            let value = match p.value {
                Some(value) => Some(quantise(value, step)?),
                None => None,
            };
            Some(Point { time, value })
        })
        .collect();
    quantised.sort_by_key(|p| p.time);
    quantised.dedup_by(|b, a| a.value == b.value);
    quantised
}

/// Replaces the stored points of a series within `range` with `points`.
fn rewrite(
    tx: &Transaction<'_>,
    (device, series): (u32, i64),
    range: Range<Tick>,
    points: &[Point],
) -> Result<(), Error> {
    tx.execute(
        "DELETE FROM hot WHERE device = ?1 AND series = ?2 AND time >= ?3 AND time < ?4",
        params![device, series, range.start, range.end],
    )?;
    for hour in range.start.div_euclid(HOUR)..ceil(range.end) {
        let kept = blocks(tx, device, series, hour, hour)?
            .into_iter()
            .filter(|p| !range.contains(&p.time));
        let new = points.iter().filter(|p| p.time.div_euclid(HOUR) == hour);
        let merged: Vec<Point> = kept.chain(new.copied()).collect();
        tx.execute(
            "DELETE FROM block WHERE device = ?1 AND series = ?2 AND hour = ?3",
            params![device, series, hour],
        )?;
        if !merged.is_empty() {
            write_block(tx, i64::from(device), series, hour, merged.into_iter())?;
        }
    }
    Ok(())
}

/// Replaces the rollups of `hours` with `hourly`.
fn write_hours(
    db: &Connection,
    (device, series): (u32, i64),
    hours: Range<Tick>,
    hourly: &[(Tick, Sums)],
) -> Result<(), Error> {
    db.execute(
        "DELETE FROM rollup_hour WHERE device = ?1 AND series = ?2 AND hour >= ?3 AND hour < ?4",
        params![device, series, hours.start, hours.end],
    )?;
    let mut insert = db.prepare_cached(
        "INSERT INTO rollup_hour (device, series, hour, duration, sum, min, max, first, last, delta)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
    )?;
    for &(index, sums) in hourly {
        let [duration, sum, min, max, first, last, delta] = columns(sums);
        insert.execute(params![
            device, series, index, duration, sum, min, max, first, last, delta
        ])?;
    }
    Ok(())
}

/// Replaces the rollups of `days` with `daily`, cut in `zone`.
fn write_days(
    db: &Connection,
    (device, series): (u32, i64),
    zone: &str,
    days: &[Day],
    daily: &[(Day, Sums)],
) -> Result<(), Error> {
    if let (Some(first), Some(last)) = (days.first(), days.last()) {
        db.execute(
            "DELETE FROM rollup_day WHERE device = ?1 AND series = ?2 AND day >= ?3 AND day <= ?4",
            params![device, series, first.key, last.key],
        )?;
    }
    let mut insert = db.prepare_cached(
        "INSERT INTO rollup_day
         (device, series, day, zone, start, end, duration, sum, min, max, first, last, delta)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
    )?;
    for &(day, sums) in daily {
        let [duration, sum, min, max, first, last, delta] = columns(sums);
        insert.execute(params![
            device, series, day.key, zone, day.start, day.end, duration, sum, min, max, first,
            last, delta
        ])?;
    }
    Ok(())
}

/// The hour of the earliest stored point.
fn earliest(db: &Connection) -> Result<Option<Tick>, Error> {
    let earliest: Option<Tick> = db.query_row(
        "SELECT min(time) FROM (
           SELECT min(hour) * 36000 AS time FROM block UNION ALL SELECT min(time) FROM hot
         )",
        [],
        |row| row.get(0),
    )?;
    Ok(earliest.map(floor))
}

/// The points that matter to `[start, end)`: the one in force at `start` and the one before it,
/// which shows a counter's drop into the window, then those inside.
fn window(points: &[Point], start: Tick, end: Tick) -> &[Point] {
    let first = points.partition_point(|p| p.time < start).saturating_sub(2);
    let last = points.partition_point(|p| p.time < end);
    points.get(first..last).unwrap_or_default()
}

/// The start of the hour `time` falls in.
pub(super) const fn floor(time: Tick) -> Tick {
    time.div_euclid(HOUR) * HOUR
}

/// The index of the first hour starting at or after `time`.
pub(super) fn ceil(time: Tick) -> Tick {
    time.div_euclid(HOUR) + Tick::from(time.rem_euclid(HOUR) != 0)
}

pub(super) const fn columns(sums: Sums) -> Columns {
    match sums {
        Sums::Measurement {
            duration,
            sum,
            min,
            max,
        } => [
            Some(duration),
            Some(sum),
            Some(min),
            Some(max),
            None,
            None,
            None,
        ],
        Sums::Counter { first, last, delta } => {
            [None, None, None, None, Some(first), Some(last), Some(delta)]
        }
    }
}

#[expect(
    clippy::cast_precision_loss,
    reason = "values are bounded to ±2^53 steps"
)]
fn aggregate(step: f64, columns: Columns) -> Option<Aggregate> {
    match columns {
        [Some(duration), Some(sum), Some(min), Some(max), ..] if duration > 0 => {
            let seconds = duration as f64 / 10.0;
            let integral = sum as f64 * step / 10.0;
            Some(Aggregate::Measurement {
                duration: Duration::from_millis(u64::try_from(duration).unwrap_or(0) * 100),
                mean: integral / seconds,
                min: min as f64 * step,
                max: max as f64 * step,
                integral: integral / 3600.0,
            })
        }
        [.., Some(first), Some(last), Some(delta)] => Some(Aggregate::Counter {
            first: first as f64 * step,
            last: last as f64 * step,
            delta: delta as f64 * step,
        }),
        _ => None,
    }
}
