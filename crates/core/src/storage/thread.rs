//! The storage thread: the one owner of the SQLite connection.

use std::collections::HashMap;
use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, OptionalExtension, Transaction, params};
use tokio::sync::{mpsc, oneshot};

use super::encode::{Point, Tick, Track, ticks};
use super::{ChangePoint, Error, Policy, Problem, block};
use crate::bus::{DeviceId, Reading, SeriesId};

/// A bucket: 60 s in ticks.
const BUCKET: Tick = 600;
/// An hour in ticks.
const HOUR: Tick = 36_000;
/// Forward-only, applied in order; `user_version` counts those applied.
const MIGRATIONS: &[&str] = &[
    include_str!("migrations/0001.sql"),
    include_str!("migrations/0002.sql"),
];

/// SQL a feature module runs on its own tables.
pub type Job = Box<dyn FnOnce(&Connection) + Send>;

pub enum Command {
    Reading(Reading),
    Tick(SystemTime),
    Request(Request),
}

pub enum Request {
    Declare {
        device: DeviceId,
        series: SeriesId,
        name: String,
        policy: Policy,
        reply: oneshot::Sender<Result<(), Error>>,
    },
    History {
        device: DeviceId,
        name: String,
        from: SystemTime,
        to: SystemTime,
        reply: oneshot::Sender<Result<Vec<ChangePoint>, Error>>,
    },
    Problems(oneshot::Sender<Vec<Problem>>),
    Run(Job),
    Shutdown(oneshot::Sender<Result<(), Error>>),
}

/// Opens the file and starts the thread; the returned sender feeds it.
pub fn spawn(path: &Path, build: SystemTime, queue: usize) -> Result<mpsc::Sender<Command>, Error> {
    let db = open(path)?;
    let flushed: Tick = db
        .query_row("SELECT value FROM meta WHERE key = 'flushed'", [], |row| {
            row.get(0)
        })
        .optional()?
        .unwrap_or(0);
    let store = Store {
        db,
        tracks: HashMap::new(),
        pending: Vec::new(),
        scratch: Vec::new(),
        bucket: Tick::MIN,
        packed: Tick::MIN,
        floor: tick(build).unwrap_or(0).max(flushed),
        restart: flushed,
        clock: flushed,
        unsynced: false,
    };
    let (sender, receiver) = mpsc::channel(queue);
    std::thread::Builder::new()
        .name("storage".into())
        .spawn(move || store.run(receiver))
        .map_err(|_| Error::Stopped)?;
    Ok(sender)
}

fn open(path: &Path) -> Result<Connection, Error> {
    let mut db = Connection::open(path)?;
    // Page size and auto-vacuum take effect only before the first table exists.
    db.execute_batch(
        "PRAGMA page_size = 4096;
         PRAGMA auto_vacuum = INCREMENTAL;
         PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA cache_size = -2048;",
    )?;
    let applied: i64 = db.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    let tx = db.transaction()?;
    for (version, sql) in (1..).zip(MIGRATIONS).skip_while(|(v, _)| *v <= applied) {
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", version)?;
    }
    tx.commit()?;
    Ok(db)
}

fn tick(time: SystemTime) -> Option<Tick> {
    time.duration_since(UNIX_EPOCH).ok().map(ticks)
}

fn time(tick: Tick) -> SystemTime {
    let millis = u64::try_from(tick).unwrap_or(0).saturating_mul(100);
    UNIX_EPOCH + Duration::from_millis(millis)
}

/// One declared series of one device.
struct Stored {
    /// Its id in the `series` table.
    id: i64,
    track: Track,
}

struct Store {
    db: Connection,
    tracks: HashMap<(DeviceId, SeriesId), Stored>,
    /// The open bucket's change points: device, series id, point.
    pending: Vec<(u32, i64, Point)>,
    scratch: Vec<Point>,
    /// The open bucket, in buckets since the epoch.
    bucket: Tick,
    /// Hours before this one are packed.
    packed: Tick,
    /// History is held until the clock passes this: the build time or the last flush.
    floor: Tick,
    /// The last flush before this start.
    restart: Tick,
    /// The latest instant history has been written up to.
    clock: Tick,
    /// The last instant offered was not past `floor`.
    unsynced: bool,
}

impl Store {
    fn run(mut self, mut receiver: mpsc::Receiver<Command>) {
        while let Some(command) = receiver.blocking_recv() {
            match command {
                Command::Reading(reading) => self.reading(&reading),
                Command::Tick(now) => self.tick(now),
                Command::Request(Request::Shutdown(reply)) => {
                    let flushed = self.flush();
                    // The connection closes before the caller hears back.
                    drop(self);
                    reply.send(flushed).ok();
                    return;
                }
                Command::Request(request) => self.answer(request),
            }
        }
        // Every sender is gone without a shutdown: the open bucket is lost, as in a crash.
    }

    fn answer(&mut self, request: Request) {
        match request {
            Request::Declare {
                device,
                series,
                name,
                policy,
                reply,
            } => {
                reply
                    .send(self.declare(device, series, &name, &policy))
                    .ok();
            }
            Request::History {
                device,
                name,
                from,
                to,
                reply,
            } => {
                reply.send(self.history(device, &name, from, to)).ok();
            }
            Request::Problems(reply) => {
                let unsynced = self.unsynced.then_some(Problem::ClockUnsynced);
                reply.send(unsynced.into_iter().collect()).ok();
            }
            Request::Run(job) => job(&self.db),
            // Handled by `run`, which stops.
            Request::Shutdown(_) => {}
        }
    }

    fn tick(&mut self, now: SystemTime) {
        if let Some(now) = self.synced(now) {
            self.advance(now);
            self.clock = self.clock.max(now);
        }
    }

    /// `time` as a tick if the clock is synced, else `None` with the problem raised.
    fn synced(&mut self, time: SystemTime) -> Option<Tick> {
        let now = tick(time).filter(|now| *now > self.floor);
        self.unsynced = now.is_none();
        now
    }

    fn reading(&mut self, reading: &Reading) {
        let Some(now) = self.synced(reading.time) else {
            return;
        };
        if !self.tracks.contains_key(&(reading.device, reading.series)) {
            return;
        }
        self.advance(now);
        self.clock = self.clock.max(now);
        if let Some(stored) = self.tracks.get_mut(&(reading.device, reading.series)) {
            stored.track.reading(now, reading.value, &mut self.scratch);
            let (device, id) = (reading.device.0, stored.id);
            self.pending
                .extend(self.scratch.drain(..).map(|point| (device, id, point)));
        }
    }

    /// Closes the open bucket once `now` is past it: gaps for silent series, then one write.
    fn advance(&mut self, now: Tick) {
        let bucket = now.div_euclid(BUCKET);
        if bucket <= self.bucket {
            return;
        }
        self.bucket = bucket;
        for ((device, _), stored) in &mut self.tracks {
            stored.track.silence(now, &mut self.scratch);
            let id = stored.id;
            self.pending
                .extend(self.scratch.drain(..).map(|point| (device.0, id, point)));
        }
        // A failed write loses the bucket: memory stays bounded.
        self.flush().ok();
        let hour = now.div_euclid(HOUR);
        if hour > self.packed && self.pack(hour).is_ok() {
            self.packed = hour;
        }
    }

    fn flush(&mut self) -> Result<(), Error> {
        let pending = std::mem::take(&mut self.pending);
        let tx = self.db.transaction()?;
        {
            let mut insert = tx.prepare_cached(
                "INSERT INTO hot (device, series, time, value) VALUES (?1, ?2, ?3, ?4)",
            )?;
            for (device, series, point) in &pending {
                insert.execute(params![device, series, point.time, point.value])?;
            }
        }
        tx.execute(
            "INSERT INTO meta (key, value) VALUES ('flushed', ?1)
             ON CONFLICT (key) DO UPDATE SET value = excluded.value",
            [self.clock],
        )?;
        tx.commit()?;
        self.pending = pending;
        self.pending.clear();
        self.db
            .query_row("PRAGMA wal_checkpoint(PASSIVE)", [], |_| Ok(()))?;
        Ok(())
    }

    /// Packs every hot row before `hour` into its hour's block.
    fn pack(&mut self, hour: Tick) -> Result<(), Error> {
        let limit = hour.saturating_mul(HOUR);
        let tx = self.db.transaction()?;
        let rows = tx
            .prepare(
                "SELECT device, series, time, value FROM hot WHERE time < ?1
                 ORDER BY device, series, time",
            )?
            .query_map([limit], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    Point {
                        time: row.get(2)?,
                        value: row.get(3)?,
                    },
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        for group in rows.chunk_by(|a, b| {
            (a.0, a.1, a.2.time.div_euclid(HOUR)) == (b.0, b.1, b.2.time.div_euclid(HOUR))
        }) {
            if let Some(&(device, series, first)) = group.first() {
                let points = group.iter().map(|row| row.2);
                write_block(&tx, device, series, first.time.div_euclid(HOUR), points)?;
            }
        }
        tx.execute("DELETE FROM hot WHERE time < ?1", [limit])?;
        tx.commit()?;
        Ok(())
    }

    fn declare(
        &mut self,
        device: DeviceId,
        series: SeriesId,
        name: &str,
        policy: &Policy,
    ) -> Result<(), Error> {
        if self.tracks.contains_key(&(device, series)) {
            // Points pending under the old policy are written before it changes.
            self.flush()?;
        }
        let id = self.series_id(name)?;
        let step: Option<f64> = self
            .db
            .query_row(
                "SELECT step FROM step WHERE device = ?1 AND series = ?2",
                params![device.0, id],
                |row| row.get(0),
            )
            .optional()?;
        match step {
            Some(step) if (step - policy.step).abs() > step * 1e-9 => {
                return Err(Error::StepChanged);
            }
            Some(_) => {}
            None => {
                self.db.execute(
                    "INSERT INTO step (device, series, step) VALUES (?1, ?2, ?3)",
                    params![device.0, id, policy.step],
                )?;
            }
        }
        let last = self.last(device.0, id)?;
        let track = Track::resume(policy, last, self.restart);
        self.tracks.insert((device, series), Stored { id, track });
        Ok(())
    }

    fn series_id(&self, name: &str) -> Result<i64, Error> {
        let id = self
            .db
            .query_row("SELECT id FROM series WHERE name = ?1", [name], |row| {
                row.get(0)
            })
            .optional()?;
        if let Some(id) = id {
            return Ok(id);
        }
        let id: i64 = self
            .db
            .query_row("SELECT count(*) FROM series", [], |row| row.get(0))?;
        self.db.execute(
            "INSERT INTO series (name, id) VALUES (?1, ?2)",
            params![name, id],
        )?;
        Ok(id)
    }

    /// The last stored point of a series.
    fn last(&self, device: u32, series: i64) -> Result<Option<Point>, Error> {
        let hot = self
            .db
            .query_row(
                "SELECT time, value FROM hot WHERE device = ?1 AND series = ?2
                 ORDER BY time DESC LIMIT 1",
                params![device, series],
                |row| {
                    Ok(Point {
                        time: row.get(0)?,
                        value: row.get(1)?,
                    })
                },
            )
            .optional()?;
        if hot.is_some() {
            return Ok(hot);
        }
        Ok(self
            .block_before(device, series, Tick::MAX)?
            .last()
            .copied())
    }

    /// The points of the last block before `hour`.
    fn block_before(&self, device: u32, series: i64, hour: Tick) -> Result<Vec<Point>, Error> {
        self.decode_blocks(
            "SELECT hour, data FROM block WHERE device = ?1 AND series = ?2 AND hour < ?3
             ORDER BY hour DESC LIMIT 1",
            params![device, series, hour],
        )
    }

    /// The points of the blocks from hour `from` to hour `to`, inclusive.
    fn blocks(&self, device: u32, series: i64, from: Tick, to: Tick) -> Result<Vec<Point>, Error> {
        self.decode_blocks(
            "SELECT hour, data FROM block WHERE device = ?1 AND series = ?2
             AND hour >= ?3 AND hour <= ?4 ORDER BY hour",
            params![device, series, from, to],
        )
    }

    fn decode_blocks(
        &self,
        sql: &str,
        params: &[&dyn rusqlite::ToSql],
    ) -> Result<Vec<Point>, Error> {
        let mut statement = self.db.prepare_cached(sql)?;
        let mut rows = statement.query(params)?;
        let mut points = Vec::new();
        while let Some(row) = rows.next()? {
            let hour: Tick = row.get(0)?;
            let data: Vec<u8> = row.get(1)?;
            points.extend(block::decode(hour * HOUR, &data).ok_or(Error::Corrupt)?);
        }
        Ok(points)
    }

    fn history(
        &self,
        device: DeviceId,
        name: &str,
        from: SystemTime,
        to: SystemTime,
    ) -> Result<Vec<ChangePoint>, Error> {
        let found = self
            .db
            .query_row(
                "SELECT series.id, step.step FROM series JOIN step ON step.series = series.id
                 WHERE series.name = ?1 AND step.device = ?2",
                params![name, device.0],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, f64>(1)?)),
            )
            .optional()?;
        let Some((series, step)) = found else {
            return Ok(Vec::new());
        };
        let from = tick(from).unwrap_or(0);
        let to = tick(to).unwrap_or(0);
        let device = device.0;
        let mut points = self.block_before(device, series, from.div_euclid(HOUR))?;
        points.extend(self.blocks(device, series, from.div_euclid(HOUR), to.div_euclid(HOUR))?);
        let hot = self
            .db
            .prepare_cached(
                "SELECT time, value FROM hot WHERE device = ?1 AND series = ?2 AND time < ?3
                 ORDER BY time",
            )?
            .query_map(params![device, series, to], |row| {
                Ok(Point {
                    time: row.get(0)?,
                    value: row.get(1)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        points.extend(hot);
        // A late gap waits in `hot` while its hour is already a block.
        points.sort_by_key(|p| p.time);
        let start = points.partition_point(|p| p.time < from).saturating_sub(1);
        Ok(points
            .get(start..)
            .unwrap_or_default()
            .iter()
            .filter(|p| p.time < to)
            .map(|p| ChangePoint {
                time: time(p.time),
                #[expect(clippy::cast_precision_loss, reason = "values are bounded to ±2^53")]
                value: p.value.map(|v| v as f64 * step),
            })
            .collect())
    }
}

/// Writes one hour's points, merged with any block already stored for that hour.
fn write_block(
    tx: &Transaction<'_>,
    device: i64,
    series: i64,
    hour: Tick,
    points: impl Iterator<Item = Point>,
) -> Result<(), Error> {
    let existing: Option<Vec<u8>> = tx
        .query_row(
            "SELECT data FROM block WHERE device = ?1 AND series = ?2 AND hour = ?3",
            params![device, series, hour],
            |row| row.get(0),
        )
        .optional()?;
    let mut merged = match existing {
        Some(data) => block::decode(hour * HOUR, &data).ok_or(Error::Corrupt)?,
        None => Vec::new(),
    };
    merged.extend(points);
    merged.sort_by_key(|p| p.time);
    tx.execute(
        "INSERT INTO block (device, series, hour, data) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT DO UPDATE SET data = excluded.data",
        params![device, series, hour, block::encode(hour * HOUR, &merged)],
    )?;
    Ok(())
}
