//! The storage thread: the one owner of the SQLite connection.

use std::collections::HashMap;
use std::ops::Range;
use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use jiff::tz::TimeZone;
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use sunreye_profile::RoleKind;
use tokio::sync::{mpsc, oneshot};

use super::encode::{Point, Tick, Track, quantise, ticks};
use super::{ChangePoint, Error, Forecast, Issue, Policy, Problem, Rollup, Tier, block, forecast};
use crate::bus::{DeviceId, Reading, SeriesId};

mod rollups;

/// A bucket: 60 s in ticks.
const BUCKET: Tick = 600;
/// An hour in ticks.
const HOUR: Tick = 36_000;
/// Forward-only, applied in order; `user_version` counts those applied.
const MIGRATIONS: &[&str] = &[
    include_str!("migrations/0001.sql"),
    include_str!("migrations/0002.sql"),
    include_str!("migrations/0003.sql"),
    include_str!("migrations/0004.sql"),
    include_str!("migrations/0005.sql"),
    include_str!("migrations/0006.sql"),
    include_str!("migrations/0007.sql"),
    include_str!("migrations/0008.sql"),
    include_str!("migrations/0009.sql"),
    include_str!("migrations/0010.sql"),
    include_str!("migrations/0011.sql"),
    include_str!("migrations/0012.sql"),
    include_str!("migrations/0013.sql"),
    include_str!("migrations/0014.sql"),
    include_str!("migrations/0015.sql"),
    include_str!("migrations/0016.sql"),
    include_str!("migrations/0017.sql"),
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
    Rollups {
        device: DeviceId,
        name: String,
        tier: Tier,
        range: Range<SystemTime>,
        reply: oneshot::Sender<Result<Vec<Rollup>, Error>>,
    },
    Rewriting(Rewriting),
    Forecasting(Forecasting),
    Problems(oneshot::Sender<Vec<Problem>>),
    Run(Job),
    Shutdown(oneshot::Sender<Result<(), Error>>),
}

/// Stored history rewritten: rollups rebuilt, a derived series replaced (ADR 3).
pub enum Rewriting {
    Rebuild {
        device: DeviceId,
        series: SeriesId,
        range: Range<SystemTime>,
        reply: oneshot::Sender<Result<(), Error>>,
    },
    Replace {
        device: DeviceId,
        series: SeriesId,
        range: Range<SystemTime>,
        points: Vec<ChangePoint>,
        reply: oneshot::Sender<Result<(), Error>>,
    },
}

/// Forecasts (ADR 15).
pub enum Forecasting {
    Forecast {
        device: DeviceId,
        name: String,
        issue: Issue,
        reply: oneshot::Sender<Result<(), Error>>,
    },
    Forecasts {
        device: DeviceId,
        name: String,
        from: SystemTime,
        to: SystemTime,
        reply: oneshot::Sender<Result<Vec<Forecast>, Error>>,
    },
}

/// Opens the file and starts the thread; the returned sender feeds it.
/// `zone` is the plant timezone, by name and resolved.
pub fn spawn(
    path: &Path,
    build: SystemTime,
    zone: (String, TimeZone),
    queue: usize,
) -> Result<mpsc::Sender<Command>, Error> {
    let db = open(path)?;
    let meta = |key: &str| -> Result<Option<Tick>, Error> {
        Ok(db
            .query_row("SELECT value FROM meta WHERE key = ?1", [key], |row| {
                row.get(0)
            })
            .optional()?)
    };
    let flushed = meta("flushed")?.unwrap_or(0);
    let rolled = meta("rolled")?;
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
        zone,
        rolled,
    };
    let (sender, receiver) = mpsc::channel(queue);
    std::thread::Builder::new()
        .name("storage".into())
        .spawn(move || store.run(receiver))
        .map_err(|_| Error::Stopped)?;
    Ok(sender)
}

fn open(path: &Path) -> Result<Connection, Error> {
    private(path).map_err(Error::Io)?;
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

/// Makes the file and its WAL readable by the core alone (ADR 7): it holds the connections'
/// secrets. SQLite gives the WAL it creates the file's mode; one left by an earlier build is
/// closed here.
fn private(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::{OpenOptionsExt as _, PermissionsExt as _};
    std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .mode(0o600)
        .open(path)?;
    for suffix in ["", "-wal", "-shm"] {
        let mut file = path.as_os_str().to_owned();
        file.push(suffix);
        match std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o600)) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            other => other?,
        }
    }
    Ok(())
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
    kind: RoleKind,
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
    /// The plant timezone days are cut in: its name and the zone.
    zone: (String, TimeZone),
    /// Hours before this instant are rolled up; `None` before any history.
    rolled: Option<Tick>,
}

impl Store {
    fn run(mut self, mut receiver: mpsc::Receiver<Command>) {
        while let Some(command) = receiver.blocking_recv() {
            match command {
                Command::Reading(reading) => self.reading(&reading),
                Command::Tick(now) => self.tick(now),
                Command::Request(Request::Shutdown(reply)) => {
                    let flushed = self.flush(self.clock);
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
            Request::Rollups {
                device,
                name,
                tier,
                range,
                reply,
            } => {
                reply.send(self.rollups(device, &name, tier, range)).ok();
            }
            Request::Rewriting(request) => self.rewriting(request),
            Request::Forecasting(request) => self.forecasting(request),
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
        self.flush(now).ok();
        let hour = now.div_euclid(HOUR);
        if hour > self.packed && self.pack(hour).is_ok() {
            self.packed = hour;
        }
    }

    /// Writes the pending points and rolls up every hour closed before `now`, in one
    /// transaction.
    fn flush(&mut self, now: Tick) -> Result<(), Error> {
        let pending = std::mem::take(&mut self.pending);
        let mut tx = self.db.unchecked_transaction()?;
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
        // A rollup that fails is retried on the next flush; the points are written regardless.
        let rollup = tx.savepoint()?;
        let rolled = if let Ok(rolled) = self.roll(&rollup, &pending, now) {
            rollup.commit()?;
            rolled
        } else {
            drop(rollup);
            self.rolled
        };
        tx.commit()?;
        self.rolled = rolled;
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
            self.flush(self.clock)?;
        }
        let id = self.series_id(name)?;
        self.step(device, id, policy.step)?;
        let last = self.last(device.0, id)?;
        let track = Track::resume(policy, last, self.restart);
        let kind = policy.kind;
        self.tracks
            .insert((device, series), Stored { id, kind, track });
        Ok(())
    }

    /// Records the step `series` of `device` is stored in, refusing another.
    fn step(&self, device: DeviceId, series: i64, step: f64) -> Result<(), Error> {
        let stored: Option<f64> = self
            .db
            .query_row(
                "SELECT step FROM step WHERE device = ?1 AND series = ?2",
                params![device.0, series],
                |row| row.get(0),
            )
            .optional()?;
        match stored {
            Some(stored) if (stored - step).abs() > stored * 1e-9 => Err(Error::StepChanged),
            Some(_) => Ok(()),
            None => {
                self.db.execute(
                    "INSERT INTO step (device, series, step) VALUES (?1, ?2, ?3)",
                    params![device.0, series, step],
                )?;
                Ok(())
            }
        }
    }

    fn rewriting(&mut self, request: Rewriting) {
        match request {
            Rewriting::Rebuild {
                device,
                series,
                range,
                reply,
            } => {
                reply.send(self.rebuild(device, series, range)).ok();
            }
            Rewriting::Replace {
                device,
                series,
                range,
                points,
                reply,
            } => {
                reply
                    .send(self.replace(device, series, range, &points))
                    .ok();
            }
        }
    }

    fn forecasting(&mut self, request: Forecasting) {
        match request {
            Forecasting::Forecast {
                device,
                name,
                issue,
                reply,
            } => {
                reply.send(self.forecast(device, &name, &issue)).ok();
            }
            Forecasting::Forecasts {
                device,
                name,
                from,
                to,
                reply,
            } => {
                reply.send(self.forecasts(device, &name, from, to)).ok();
            }
        }
    }

    fn forecast(&mut self, device: DeviceId, name: &str, issue: &Issue) -> Result<(), Error> {
        let series = self.series_id(name)?;
        self.step(device, series, issue.step)?;
        let issued = tick(issue.issued).unwrap_or(0);
        let points = issue
            .values
            .iter()
            .filter_map(|&(target, value)| Some((tick(target)?, quantise(value, issue.step)?)));
        let tx = self.db.transaction()?;
        forecast::write(&tx, device.0, series, issued, points)?;
        tx.commit()?;
        Ok(())
    }

    fn forecasts(
        &self,
        device: DeviceId,
        name: &str,
        from: SystemTime,
        to: SystemTime,
    ) -> Result<Vec<Forecast>, Error> {
        let Some((series, step)) = lookup(&self.db, device, name)? else {
            return Ok(Vec::new());
        };
        let from = tick(from).unwrap_or(0);
        let to = tick(to).unwrap_or(0);
        Ok(forecast::read(&self.db, device.0, series, from, to)?
            .into_iter()
            .map(|(target, issued, value)| Forecast {
                target: time(target),
                issued: time(issued),
                #[expect(clippy::cast_precision_loss, reason = "values are bounded to ±2^53")]
                value: value as f64 * step,
            })
            .collect())
    }

    /// The id and step of a series stored for `device`.
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
        Ok(block_before(&self.db, device, series, Tick::MAX)?
            .last()
            .copied())
    }

    fn history(
        &self,
        device: DeviceId,
        name: &str,
        from: SystemTime,
        to: SystemTime,
    ) -> Result<Vec<ChangePoint>, Error> {
        let Some((series, step)) = lookup(&self.db, device, name)? else {
            return Ok(Vec::new());
        };
        let from = tick(from).unwrap_or(0);
        let to = tick(to).unwrap_or(0);
        Ok(points(&self.db, device.0, series, from, to)?
            .iter()
            .map(|p| ChangePoint {
                time: time(p.time),
                #[expect(clippy::cast_precision_loss, reason = "values are bounded to ±2^53")]
                value: p.value.map(|v| v as f64 * step),
            })
            .collect())
    }
}

/// The id and step of a device's series, if it has history.
fn lookup(db: &Connection, device: DeviceId, name: &str) -> Result<Option<(i64, f64)>, Error> {
    Ok(db
        .query_row(
            "SELECT series.id, step.step FROM series JOIN step ON step.series = series.id
             WHERE series.name = ?1 AND step.device = ?2",
            params![name, device.0],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?)
}

/// The points of a series from `from` to `to`, led by the one in force at `from`.
fn points(
    db: &Connection,
    device: u32,
    series: i64,
    from: Tick,
    to: Tick,
) -> Result<Vec<Point>, Error> {
    let mut points = block_before(db, device, series, from.div_euclid(HOUR))?;
    points.extend(blocks(
        db,
        device,
        series,
        from.div_euclid(HOUR),
        to.div_euclid(HOUR),
    )?);
    let hot = db
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
    points.drain(..start);
    points.retain(|p| p.time < to);
    Ok(points)
}

/// The points of the last block before `hour`.
fn block_before(
    db: &Connection,
    device: u32,
    series: i64,
    hour: Tick,
) -> Result<Vec<Point>, Error> {
    decode_blocks(
        db,
        "SELECT hour, data FROM block WHERE device = ?1 AND series = ?2 AND hour < ?3
             ORDER BY hour DESC LIMIT 1",
        params![device, series, hour],
    )
}

/// The points of the blocks from hour `from` to hour `to`, inclusive.
fn blocks(
    db: &Connection,
    device: u32,
    series: i64,
    from: Tick,
    to: Tick,
) -> Result<Vec<Point>, Error> {
    decode_blocks(
        db,
        "SELECT hour, data FROM block WHERE device = ?1 AND series = ?2
             AND hour >= ?3 AND hour <= ?4 ORDER BY hour",
        params![device, series, from, to],
    )
}

fn decode_blocks(
    db: &Connection,
    sql: &str,
    params: &[&dyn rusqlite::ToSql],
) -> Result<Vec<Point>, Error> {
    let mut statement = db.prepare_cached(sql)?;
    let mut rows = statement.query(params)?;
    let mut points = Vec::new();
    while let Some(row) = rows.next()? {
        let hour: Tick = row.get(0)?;
        let data: Vec<u8> = row.get(1)?;
        points.extend(block::decode(hour * HOUR, &data).ok_or(Error::Corrupt)?);
    }
    Ok(points)
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
