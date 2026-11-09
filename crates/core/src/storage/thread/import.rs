//! History from an older release (ADR 18), written before a series' first change point.

use std::collections::BTreeSet;
use std::time::{Duration, SystemTime};

use jiff::tz::TimeZone;
use rusqlite::{Connection, OptionalExtension, params};

use super::rollups::{ceil, columns, floor};
use super::{HOUR, Store, tick, write_block};
use crate::bus::DeviceId;
use crate::storage::encode::{Point, Tick, Track, quantise, ticks};
use crate::storage::rollup::{self, Sums};
use crate::storage::{Backfill, Backfilled, Error, Held, Policy, block};

/// A UTC day in ticks: an older release cut its days on UTC (ADR 18).
const DAY: Tick = 24 * HOUR;

/// The encoder's cadence for imported readings. A reading is held to the end its row records, so
/// a gap begins where a hold ended; the gap threshold is then the 15 s floor, as in v3's encoder.
const HELD: Duration = Duration::from_millis(100);

impl Store {
    pub(super) fn import(
        &mut self,
        device: DeviceId,
        name: &str,
        policy: &Policy,
        backfill: &Backfill,
    ) -> Result<Backfilled, Error> {
        let id = self.series_id(name)?;
        self.step(device, id, policy.step)?;
        let cutoff = first(&self.db, device.0, id)?;
        let points = encode(policy, &backfill.raw, cutoff);
        let tx = self.db.unchecked_transaction()?;
        for hour in points.chunk_by(|a, b| a.time.div_euclid(HOUR) == b.time.div_euclid(HOUR)) {
            if let Some(first) = hour.first() {
                let at = first.time.div_euclid(HOUR);
                write_block(&tx, i64::from(device.0), id, at, hour.iter().copied())?;
            }
        }
        let mut rolled = self.rolled;
        if let (Some(first), Some(last)) = (points.first(), points.last()) {
            // A value still held at the cutoff lasts until it.
            let end = match (last.value, cutoff) {
                (Some(_), Some(cutoff)) => cutoff,
                _ => last.time + 1,
            };
            let limit = *rolled.get_or_insert_with(|| ceil(end) * HOUR);
            let series = (device.0, id, policy.kind);
            self.recompute(&tx, series, floor(first.time)..end.min(limit), limit)?;
        }
        let (hours, days) = buckets(&tx, (device.0, id), policy, backfill, cutoff)?;
        if rolled != self.rolled {
            tx.execute(
                "INSERT INTO meta (key, value) VALUES ('rolled', ?1)
                 ON CONFLICT (key) DO UPDATE SET value = excluded.value",
                [rolled],
            )?;
        }
        tx.commit()?;
        self.rolled = rolled;
        Ok(Backfilled {
            points: points.len(),
            hours,
            days,
        })
    }
}

/// `raw` as change points before `cutoff`, through the encoder and the deadband of `policy`.
fn encode(policy: &Policy, raw: &[Held], cutoff: Option<Tick>) -> Vec<Point> {
    let end = cutoff.unwrap_or(Tick::MAX);
    let mut rows: Vec<(Tick, f64, Option<Tick>)> = raw
        .iter()
        .filter_map(|held| Some((tick(held.time)?, held.value, held.hold.map(ticks))))
        .filter(|row| row.0 < end)
        .collect();
    rows.sort_by_key(|row| row.0);
    let mut track = Track::new(&Policy {
        cadence: HELD,
        ..*policy
    });
    let mut points = Vec::new();
    for (time, value, hold) in rows {
        track.reading(time, value, &mut points);
        // The hold's last tick, so the next row may begin where it ends.
        if let Some(hold) = hold {
            track.held((time + hold - 1).min(end - 1));
        }
    }
    track.silence(Tick::MAX, &mut points);
    points.retain(|point| point.time < end);
    points
}

/// Writes the hours and days of `backfill` that end by `cutoff` and hold no raw reading, keeping
/// any rollup already stored. Returns the hours and days written.
fn buckets(
    tx: &Connection,
    (device, series): (u32, i64),
    policy: &Policy,
    backfill: &Backfill,
    cutoff: Option<Tick>,
) -> Result<(usize, usize), Error> {
    let (hourly, daily) = windows(policy, backfill, cutoff);
    let mut insert = tx.prepare_cached(
        "INSERT INTO rollup_hour (device, series, hour, duration, sum, min, max, first, last, delta)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) ON CONFLICT DO NOTHING",
    )?;
    let mut hours = 0;
    for &(start, sums) in &hourly {
        let [duration, sum, min, max, first, last, delta] = columns(sums);
        hours += insert.execute(params![
            device,
            series,
            start / HOUR,
            duration,
            sum,
            min,
            max,
            first,
            last,
            delta
        ])?;
    }
    let mut insert = tx.prepare_cached(
        "INSERT INTO rollup_day
         (device, series, day, zone, start, end, duration, sum, min, max, first, last, delta)
         VALUES (?1, ?2, ?3, 'UTC', ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12) ON CONFLICT DO NOTHING",
    )?;
    let mut days = 0;
    for &(start, sums) in &daily {
        let Some(day) = rollup::days(&TimeZone::UTC, start, start + 1)
            .first()
            .copied()
        else {
            continue;
        };
        let [duration, sum, min, max, first, last, delta] = columns(sums);
        days += insert.execute(params![
            device, series, day.key, day.start, day.end, duration, sum, min, max, first, last,
            delta
        ])?;
    }
    Ok((hours, days))
}

/// Rollups by the start of their window.
type Windows = Vec<(Tick, Sums)>;

/// The hourly and daily rollups of `backfill` that end by `cutoff` and hold no raw reading. A
/// UTC day of hours and no day of its own is summed from them: whole hours make it exact.
fn windows(policy: &Policy, backfill: &Backfill, cutoff: Option<Tick>) -> (Windows, Windows) {
    let raw: BTreeSet<Tick> = backfill
        .raw
        .iter()
        .filter_map(|held| tick(held.time))
        .map(|time| time.div_euclid(HOUR))
        .collect();
    let free = |start: Tick, width: Tick| {
        start + width <= cutoff.unwrap_or(Tick::MAX)
            && raw
                .range(start / HOUR..(start + width) / HOUR)
                .next()
                .is_none()
    };
    let rolled = |values: &[(SystemTime, f64)], width: Tick| {
        let values = quantised(values, policy.step, width, free);
        rollup::buckets(policy.kind, &values, width)
    };
    let hourly = rolled(&backfill.hours, HOUR);
    let mut daily = rolled(&backfill.days, DAY);
    for hours in hourly.chunk_by(|a, b| a.0.div_euclid(DAY) == b.0.div_euclid(DAY)) {
        let Some(start) = hours.first().map(|hour| hour.0.div_euclid(DAY) * DAY) else {
            continue;
        };
        let sums: Vec<Sums> = hours.iter().map(|hour| hour.1).collect();
        if let Some(day) = rollup::fold(&sums)
            && free(start, DAY)
            && !daily.iter().any(|d| d.0 == start)
        {
            daily.push((start, day));
        }
    }
    daily.sort_by_key(|day| day.0);
    (hourly, daily)
}

/// The windows of `width` among `values` that `free` allows, in steps and time order.
fn quantised(
    values: &[(SystemTime, f64)],
    step: f64,
    width: Tick,
    free: impl Fn(Tick, Tick) -> bool,
) -> Vec<(Tick, i64)> {
    let mut windows: Vec<(Tick, i64)> = values
        .iter()
        .filter_map(|&(start, value)| Some((tick(start)?, quantise(value, step)?)))
        .filter(|&(start, _)| start.rem_euclid(width) == 0 && free(start, width))
        .collect();
    windows.sort_by_key(|window| window.0);
    windows.dedup_by_key(|window| window.0);
    windows
}

/// The instant of a series' first stored change point.
fn first(db: &Connection, device: u32, series: i64) -> Result<Option<Tick>, Error> {
    let hot: Option<Tick> = db.query_row(
        "SELECT min(time) FROM hot WHERE device = ?1 AND series = ?2",
        params![device, series],
        |row| row.get(0),
    )?;
    let earliest: Option<(Tick, Vec<u8>)> = db
        .query_row(
            "SELECT hour, data FROM block WHERE device = ?1 AND series = ?2
             ORDER BY hour LIMIT 1",
            params![device, series],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let blocked = match earliest {
        Some((hour, data)) => block::decode(hour * HOUR, &data)
            .ok_or(Error::Corrupt)?
            .first()
            .map(|point| point.time),
        None => None,
    };
    Ok(hot.into_iter().chain(blocked).min())
}
