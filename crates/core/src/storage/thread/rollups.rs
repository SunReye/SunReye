//! Rollups: the hours and days of every declared series, rolled up as their hours close.

use std::collections::HashMap;
use std::ops::Range;
use std::time::{Duration, SystemTime};

use rusqlite::{Connection, params};
use sunreye_profile::RoleKind;

use super::{HOUR, Store, lookup, points, tick, time};
use crate::bus::{DeviceId, SeriesId};
use crate::storage::encode::{Point, Tick};
use crate::storage::rollup::{self, Day, Sums};
use crate::storage::{Aggregate, Error, Rollup, Tier};

/// Stored columns: duration, sum, min, max, first, last, delta.
type Columns = [Option<i64>; 7];

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
            let series = (device.0, stored.id, stored.kind);
            self.recompute(db, series, from..frontier, frontier)?;
        }
        db.execute(
            "INSERT INTO meta (key, value) VALUES ('rolled', ?1)
             ON CONFLICT (key) DO UPDATE SET value = excluded.value",
            [frontier],
        )?;
        Ok(Some(frontier))
    }

    /// Rewrites the hours from `from` to `to` and the days they touch, each cut off at `limit`.
    fn recompute(
        &self,
        db: &Connection,
        (device, series, kind): (u32, i64, RoleKind),
        Range {
            start: from,
            end: to,
        }: Range<Tick>,
        limit: Tick,
    ) -> Result<(), Error> {
        if from >= to || kind == RoleKind::Status {
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
        let hours = from.div_euclid(HOUR)..ceil(to);
        let hourly: Vec<_> = hours
            .clone()
            .filter_map(|index| roll(index * HOUR, (index + 1) * HOUR).map(|sums| (index, sums)))
            .collect();
        let daily: Vec<_> = days
            .iter()
            .filter_map(|day| roll(day.start, day.end).map(|sums| (*day, sums)))
            .collect();
        write_hours(db, (device, series), hours, &hourly)?;
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
        let from = floor(tick(from).unwrap_or(0));
        let to = tick(to).unwrap_or(0).min(limit);
        let tx = self.db.unchecked_transaction()?;
        self.recompute(&tx, (device.0, stored.id, stored.kind), from..to, limit)?;
        tx.commit()?;
        Ok(())
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
        let (from, to) = (tick(from).unwrap_or(0), tick(to).unwrap_or(0));
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
        let rows = statement.query_map(params![device.0, series, from, to], |row| {
            let mut columns: Columns = [None; 7];
            for (index, column) in (2..).zip(&mut columns) {
                *column = row.get(index)?;
            }
            Ok((row.get::<_, Tick>(0)?, row.get::<_, Tick>(1)?, columns))
        })?;
        let mut rollups = Vec::new();
        for row in rows {
            let (start, end, columns) = row?;
            if let Some(aggregate) = aggregate(step, columns) {
                rollups.push(Rollup {
                    start: time(start),
                    end: time(end),
                    aggregate,
                });
            }
        }
        Ok(rollups)
    }
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
const fn floor(time: Tick) -> Tick {
    time.div_euclid(HOUR) * HOUR
}

/// The index of the first hour starting at or after `time`.
fn ceil(time: Tick) -> Tick {
    time.div_euclid(HOUR) + Tick::from(time.rem_euclid(HOUR) != 0)
}

const fn columns(sums: Sums) -> Columns {
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
