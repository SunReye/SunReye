//! Lands a checked archive in one transaction. Readings are staged in a temporary table first, because an
//! archive's rows come in no promised order; each metric is then read back in time order a page at a time,
//! so memory holds one page and one open bucket per tier, whatever the archive's size.
//!
//! An archive row is one reading at its bucket's start: a bucket of `value` stores `first = last = max = min
//! = avg = value` with no hold inside it, the shape `rollup::Partial` gives a lone reading. Counter energy
//! then chains bucket to bucket as 2.x chained its replayed rows (`fixtures/oracle/archives`,
//! `energyPerDay`). Raw rows roll up into every tier as polled readings do; minute buckets and stored
//! readings older than the target's retention are not kept, hours and days are.

use std::collections::BTreeMap;

use jiff::Timestamp;
use sqlx::{Row, SqliteConnection};

use super::config::{self, Config};
use super::container::{Container, Lines};
use super::plan::{Bucketed, Plan, Window, plan};
use super::{Checked, Conflict, Gap, ImportError, READINGS, Reading, SourceTier};
use crate::events::Changed;
use crate::rollup::{Partial, Tier};
use crate::samples::{MINUTE_MS, Sample, encode, minute_of};
use crate::store::tiers::append;
use crate::store::{
    NewConnection, NewDevice, Store, StoreError, insert_connection, insert_device, intern_metric, put_minute,
    replace_device_pv, save_plant, save_time_zone,
};

const PAGE: i64 = 4096;
const PAGE_ROWS: usize = 4096;
const DAY_MS: i64 = 86_400_000;

/// The oldest instant, Unix milliseconds, each kind of row is kept from; none keeps it forever.
#[derive(Debug, Clone, Copy)]
pub struct Cutoffs {
    pub raw: i64,
    pub minute: Option<i64>,
    pub hour: Option<i64>,
    pub day: Option<i64>,
}

impl Cutoffs {
    /// Whether the `tier` bucket starting at `start_us` ends after its cutoff, as the retention pass keeps it.
    fn keeps(&self, tier: Tier, start_us: i64) -> bool {
        let cutoff = match tier {
            Tier::Minute => self.minute,
            Tier::Hour => self.hour,
            Tier::Day => self.day,
        };
        cutoff.is_none_or(|ms| start_us + tier.width_us() > ms * 1000)
    }
}

const fn code(tier: SourceTier) -> i64 {
    match tier {
        SourceTier::Raw => 0,
        SourceTier::Minute => 1,
        SourceTier::Hourly => 2,
        SourceTier::Daily => 3,
    }
}

fn bucketed(code: i64) -> Option<Bucketed> {
    match code {
        1 => Some(Bucketed::Minute),
        2 => Some(Bucketed::Hourly),
        3 => Some(Bucketed::Daily),
        _ => None,
    }
}

pub struct Landed {
    pub gaps: Vec<Gap>,
    pub conflicts: u64,
    pub first_conflict: Option<Conflict>,
}

pub async fn land(
    store: &Store,
    checked: &Checked,
    archive: &mut Container,
    cut: Cutoffs,
) -> Result<Landed, ImportError> {
    let mut tx = store.begin().await?;
    let devices = graph(&mut tx, &checked.config, checked.zone.as_deref()).await?;
    activate_first_profile(&mut tx, &checked.config).await?;
    let mut metrics = BTreeMap::new();
    let (conflicts, first_conflict) = stage(&mut tx, archive, &devices, &mut metrics).await?;
    let mut gaps = Vec::new();
    for (slug, &device) in &devices {
        gaps.extend(land_device(&mut tx, slug, device, &metrics, cut).await?);
    }
    sqlx::query("DROP TABLE temp.import_point").execute(&mut *tx).await.map_err(StoreError::from)?;
    store.commit(tx, Changed::Archive).await?;
    gaps.sort_by_key(|g| g.start);
    Ok(Landed { gaps, conflicts, first_conflict })
}

/// The first-run gate reads the active profile; setting it directly keeps the archive's unit ids, which
/// choosing the profile through the API would rewrite. A plant of retired devices only has none to pick.
async fn activate_first_profile(conn: &mut SqliteConnection, config: &Config) -> Result<(), StoreError> {
    let first = config.plant.devices.iter().find(|d| config::retired(d).ok().flatten().is_none());
    if let Some(device) = first {
        sqlx::query(
            "INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        )
        .bind(crate::settings::PROFILE_KEY)
        .bind(&device.profile_id)
        .execute(conn)
        .await?;
    }
    Ok(())
}

/// One device's readings into its tiers; returns its gaps.
async fn land_device(
    conn: &mut SqliteConnection,
    slug: &str,
    device: i64,
    metrics: &BTreeMap<String, u32>,
    cut: Cutoffs,
) -> Result<Vec<Gap>, ImportError> {
    let planned = plan(&windows(conn, device).await?);
    for &metric in metrics.values() {
        roll_up(conn, device, metric, &planned, cut).await?;
    }
    minutes(conn, device, cut.raw, metrics).await?;
    let gap = |&(start, end): &(i64, i64)| {
        Ok(Gap { device: slug.to_owned(), start: instant(start)?, end: instant(end)? })
    };
    planned.gaps.iter().map(gap).collect()
}

fn instant(ms: i64) -> Result<Timestamp, StoreError> {
    Timestamp::from_millisecond(ms).map_err(|_| StoreError::Corrupt("archive instant"))
}

/// The plant zone, location, connections and devices; each device's id by its archive slug.
async fn graph(
    conn: &mut SqliteConnection,
    config: &Config,
    zone: Option<&str>,
) -> Result<BTreeMap<String, i64>, ImportError> {
    if let Some(zone) = zone {
        save_time_zone(&mut *conn, zone).await?;
    }
    save_plant(&mut *conn, &config.plant_settings()).await?;
    let mut connections = Vec::new();
    for c in &config.plant.connections {
        let endpoint = NewConnection {
            transport: c.params.transport.unwrap_or(crate::settings::Transport::Tcp).wire(),
            host: c.params.host.clone().unwrap_or_default(),
            port: c.params.port.unwrap_or_default(),
            logger_serial: c.params.logger_serial,
        };
        connections.push(insert_connection(&mut *conn, &c.name, &endpoint).await?);
    }
    let mut devices = BTreeMap::new();
    for d in &config.plant.devices {
        let connection_id = config.connection(d).map_or(0, |i| connections[i]);
        let new = NewDevice { connection_id, profile_id: d.profile_id.clone(), unit_id: d.unit_id };
        let retired = config::retired(d).ok().flatten();
        let id = insert_device(&mut *conn, &new, d.name.as_deref(), &d.role, retired.as_deref()).await?;
        replace_device_pv(conn, id, &config::pv(d)).await?;
        devices.insert(d.slug.clone(), id);
    }
    Ok(devices)
}

fn store_error(error: sqlx::Error) -> ImportError {
    ImportError::Store(error.into())
}

/// Every reading into `temp.import_point`, its metric interned; a second row at the same instant and tier
/// is the same reading, and is counted when its value differs.
async fn stage(
    conn: &mut SqliteConnection,
    archive: &mut Container,
    devices: &BTreeMap<String, i64>,
    metrics: &mut BTreeMap<String, u32>,
) -> Result<(u64, Option<Conflict>), ImportError> {
    let (mut conflicts, mut first) = (0, None);
    sqlx::query(
        "CREATE TEMP TABLE import_point (device INTEGER NOT NULL, metric INTEGER NOT NULL, at_ms INTEGER NOT NULL,
           tier INTEGER NOT NULL, value REAL NOT NULL, PRIMARY KEY (device, metric, at_ms, tier)) WITHOUT ROWID",
    )
    .execute(&mut *conn)
    .await
    .map_err(store_error)?;
    while let Some(member) = archive.next_member()? {
        if member.name != READINGS {
            continue;
        }
        let mut lines: Lines<'_> = member.lines();
        while let Some((_, line)) = lines.next_line()? {
            let reading = Reading::parse(line).map_err(|reason| lines.at(reason))?;
            let device = devices[&reading.device_slug];
            let metric = if let Some(&id) = metrics.get(&reading.metric_key) {
                id
            } else {
                let id = intern_metric(&mut *conn, &reading.metric_key).await?;
                metrics.insert(reading.metric_key.clone(), id);
                id
            };
            let kept = put(conn, device, metric, &reading).await?;
            if kept.to_bits() != reading.value.to_bits() {
                conflicts += 1;
                first.get_or_insert(Conflict {
                    device: reading.device_slug,
                    metric: reading.metric_key,
                    at: instant(reading.at_ms)?,
                    kept,
                    dropped: reading.value,
                });
            }
        }
    }
    sqlx::query("CREATE INDEX temp.import_raw ON import_point (device, tier, at_ms, metric)")
        .execute(&mut *conn)
        .await
        .map_err(store_error)?;
    Ok((conflicts, first))
}

/// Stages `reading`; returns the value staged at its key, the first line's.
async fn put(
    conn: &mut SqliteConnection,
    device: i64,
    metric: u32,
    reading: &Reading,
) -> Result<f64, ImportError> {
    sqlx::query_scalar(
        "INSERT INTO temp.import_point VALUES (?, ?, ?, ?, ?) ON CONFLICT DO UPDATE SET value = value RETURNING value",
    )
    .bind(device)
    .bind(metric)
    .bind(reading.at_ms)
    .bind(code(reading.source_tier))
    .bind(reading.value)
    .fetch_one(conn)
    .await
    .map_err(store_error)
}

/// What each bucket tier holds for the device, and on which UTC days.
async fn windows(conn: &mut SqliteConnection, device: i64) -> Result<Vec<Window>, ImportError> {
    let rows = sqlx::query(
        "SELECT tier, (at_ms - ((at_ms % ?1) + ?1) % ?1) / ?1, min(at_ms), max(at_ms) FROM temp.import_point
         WHERE device = ?2 AND tier > 0 GROUP BY 1, 2 ORDER BY 1, 2",
    )
    .bind(DAY_MS)
    .bind(device)
    .fetch_all(&mut *conn)
    .await
    .map_err(store_error)?;
    let mut windows: Vec<Window> = Vec::new();
    for row in &rows {
        let Some(tier) = bucketed(row.get(0)) else { continue };
        let (day, first, last): (i64, i64, i64) = (row.get(1), row.get(2), row.get(3));
        match windows.last_mut().filter(|w| w.tier == tier) {
            Some(w) => {
                w.to = last + tier.width_ms();
                w.days.insert(day);
            }
            None => {
                windows.push(Window { tier, from: first, to: last + tier.width_ms(), days: [day].into() });
            }
        }
    }
    Ok(windows)
}

/// One metric's landing rows in time order into its minute, hour and day buckets.
async fn roll_up(
    conn: &mut SqliteConnection,
    device: i64,
    metric: u32,
    planned: &Plan,
    cut: Cutoffs,
) -> Result<(), ImportError> {
    let mut folder = Folder::new(device, metric, cut);
    let mut after = (i64::MIN, -1_i64);
    loop {
        let page = sqlx::query(
            "SELECT at_ms, tier, value FROM temp.import_point WHERE device = ? AND metric = ? AND (at_ms, tier) > (?, ?)
             ORDER BY at_ms, tier LIMIT ?",
        )
        .bind(device)
        .bind(metric)
        .bind(after.0)
        .bind(after.1)
        .bind(PAGE)
        .fetch_all(&mut *conn)
        .await
        .map_err(store_error)?;
        for row in &page {
            let (at, tier, value): (i64, i64, f64) = (row.get(0), row.get(1), row.get(2));
            after = (at, tier);
            if bucketed(tier).is_none_or(|t| planned.lands(t, at)) {
                folder.push(conn, tier, at * 1000, value).await?;
            }
        }
        if page.len() < PAGE_ROWS {
            break;
        }
    }
    folder.finish(conn).await
}

/// One metric's open bucket per tier. Hours fold from readings, a day from its closed hours, as polling
/// rolls them up; an archive's day bucket is a day's only reading.
struct Folder {
    device: i64,
    metric: u32,
    cut: Cutoffs,
    open: [Option<Partial>; 3],
    /// Per tier, the start of the last bucket opened: storing a bucket at or before it would replace one.
    latest: [i64; 3],
}

const TIERS: [Tier; 3] = [Tier::Minute, Tier::Hour, Tier::Day];

const fn slot(tier: Tier) -> usize {
    match tier {
        Tier::Minute => 0,
        Tier::Hour => 1,
        Tier::Day => 2,
    }
}

impl Folder {
    const fn new(device: i64, metric: u32, cut: Cutoffs) -> Self {
        Self { device, metric, cut, open: [None; 3], latest: [i64::MIN; 3] }
    }

    async fn push(
        &mut self,
        conn: &mut SqliteConnection,
        source: i64,
        at_us: i64,
        value: f64,
    ) -> Result<(), ImportError> {
        self.close_before(conn, at_us).await?;
        let reading = Partial::new(at_us, at_us, value);
        if source <= code(SourceTier::Minute) {
            self.add(conn, Tier::Minute, reading).await?;
        }
        if source <= code(SourceTier::Hourly) {
            if let Some(hour) = self.add(conn, Tier::Hour, reading).await? {
                self.add(conn, Tier::Day, hour).await?;
            }
        } else {
            self.add(conn, Tier::Day, reading).await?;
        }
        Ok(())
    }

    /// Adds `part` to its `tier` bucket; returns the bucket it closed.
    async fn add(
        &mut self,
        conn: &mut SqliteConnection,
        tier: Tier,
        part: Partial,
    ) -> Result<Option<Partial>, ImportError> {
        let width = tier.width_us();
        let start = part.start.div_euclid(width) * width;
        if let Some(open) = &mut self.open[slot(tier)]
            && open.start == start
        {
            open.append(&part);
            return Ok(None);
        }
        if start <= self.latest[slot(tier)] {
            return Err(StoreError::Corrupt("archive bucket out of time order").into());
        }
        let closed = self.close(conn, tier).await?;
        self.open[slot(tier)] = Some(Partial { start, ..part });
        self.latest[slot(tier)] = start;
        Ok(closed)
    }

    /// Closes the open hour once `at_us` reaches its end and folds it into its day, so a later row opening
    /// another day finds it whole. A minute or day closes when the next one opens.
    async fn close_before(&mut self, conn: &mut SqliteConnection, at_us: i64) -> Result<(), ImportError> {
        let ended = self.open[slot(Tier::Hour)].is_some_and(|p| p.start + Tier::Hour.width_us() <= at_us);
        if ended && let Some(hour) = self.close(conn, Tier::Hour).await? {
            self.add(conn, Tier::Day, hour).await?;
        }
        Ok(())
    }

    /// Stores the open `tier` bucket when retention keeps it, and returns it.
    async fn close(
        &mut self,
        conn: &mut SqliteConnection,
        tier: Tier,
    ) -> Result<Option<Partial>, ImportError> {
        let Some(partial) = self.open[slot(tier)].take() else { return Ok(None) };
        if self.cut.keeps(tier, partial.start) {
            append(conn, tier, self.device, self.metric, &[partial]).await?;
        }
        Ok(Some(partial))
    }

    async fn finish(mut self, conn: &mut SqliteConnection) -> Result<(), ImportError> {
        self.close(conn, TIERS[0]).await?;
        if let Some(hour) = self.close(conn, TIERS[1]).await? {
            self.add(conn, Tier::Day, hour).await?;
        }
        self.close(conn, TIERS[2]).await?;
        Ok(())
    }
}

/// The device's raw readings from `from_ms` on, packed one row per minute as polling stores them.
async fn minutes(
    conn: &mut SqliteConnection,
    device: i64,
    from_ms: i64,
    ids: &BTreeMap<String, u32>,
) -> Result<(), ImportError> {
    let keys: BTreeMap<u32, String> = ids.iter().map(|(k, id)| (*id, k.clone())).collect();
    let from_ms = minute_of(from_ms) * MINUTE_MS;
    let mut after = (from_ms - 1, i64::MAX);
    let mut minute: Option<(i64, Vec<Sample>)> = None;
    loop {
        let page = sqlx::query(
            "SELECT at_ms, metric, value FROM temp.import_point WHERE device = ? AND tier = 0 AND (at_ms, metric) > (?, ?)
             ORDER BY at_ms, metric LIMIT ?",
        )
        .bind(device)
        .bind(after.0)
        .bind(after.1)
        .bind(PAGE)
        .fetch_all(&mut *conn)
        .await
        .map_err(store_error)?;
        for row in &page {
            let (at_ms, metric, value): (i64, i64, f64) = (row.get(0), row.get(1), row.get(2));
            after = (at_ms, metric);
            let key = u32::try_from(metric)
                .ok()
                .and_then(|id| keys.get(&id))
                .ok_or(StoreError::Corrupt("metric id"))?;
            if minute.as_ref().is_some_and(|(m, _)| *m != minute_of(at_ms))
                && let Some((m, samples)) = minute.take()
            {
                put_minute(&mut *conn, device, m, &encode(m, &samples, ids).map_err(StoreError::from)?)
                    .await?;
            }
            let (_, samples) = minute.get_or_insert_with(|| (minute_of(at_ms), Vec::new()));
            match samples.last_mut() {
                Some(sample) if sample.at_ms == at_ms => sample.values.push((key.clone(), value)),
                _ => samples.push(Sample { at_ms, values: vec![(key.clone(), value)] }),
            }
        }
        if page.len() < PAGE_ROWS {
            break;
        }
    }
    if let Some((m, samples)) = minute {
        put_minute(&mut *conn, device, m, &encode(m, &samples, ids).map_err(StoreError::from)?).await?;
    }
    Ok(())
}

pub fn cutoffs(
    now: Timestamp,
    raw_days: u64,
    minute: Option<u64>,
    hour: Option<u64>,
    day: Option<u64>,
) -> Cutoffs {
    let back = |days: u64| {
        now.as_millisecond().saturating_sub(i64::try_from(days).unwrap_or(i64::MAX).saturating_mul(DAY_MS))
    };
    Cutoffs { raw: back(raw_days), minute: minute.map(back), hour: hour.map(back), day: day.map(back) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_bucket_before_one_already_open_is_refused_not_stored_over_it() {
        let store = Store::in_memory().await.expect("store");
        let mut conn = store.hold().await;
        let cut = Cutoffs { raw: 0, minute: None, hour: None, day: None };
        let mut folder = Folder::new(1, 1, cut);
        let hour = |h: i64| h * 3_600_000_000;
        folder.push(&mut conn, code(SourceTier::Hourly), hour(5), 1.0).await.expect("first hour");
        let late = folder.push(&mut conn, code(SourceTier::Hourly), hour(4), 2.0).await;
        assert!(matches!(late, Err(ImportError::Store(StoreError::Corrupt(_)))), "{late:?}");
    }

    #[tokio::test]
    async fn a_reading_in_the_last_microsecond_of_an_hour_stays_in_it() {
        let store = Store::in_memory().await.expect("store");
        let mut conn = store.hold().await;
        let never = Some(i64::MAX / 1000);
        let cut = Cutoffs { raw: 0, minute: never, hour: never, day: never };
        let mut folder = Folder::new(1, 1, cut);
        let hour = |h: i64| h * 3_600_000_000;
        folder.push(&mut conn, code(SourceTier::Hourly), hour(5), 1.0).await.expect("hour");
        let inside = folder.push(&mut conn, code(SourceTier::Minute), hour(6) - 1, 2.0).await;
        assert!(inside.is_ok(), "{inside:?}");
        folder.push(&mut conn, code(SourceTier::Minute), hour(6), 3.0).await.expect("next hour");
    }

    #[tokio::test]
    async fn a_bucket_already_stored_is_refused_not_stored_again() {
        let store = Store::in_memory().await.expect("store");
        let mut conn = store.hold().await;
        let never = Some(i64::MAX / 1000);
        let cut = Cutoffs { raw: 0, minute: never, hour: never, day: never };
        let mut folder = Folder::new(1, 1, cut);
        let hour = |h: i64| h * 3_600_000_000;
        folder.push(&mut conn, code(SourceTier::Hourly), hour(5), 1.0).await.expect("hour");
        folder.push(&mut conn, code(SourceTier::Daily), hour(48), 2.0).await.expect("a later day closes it");
        let again = folder.push(&mut conn, code(SourceTier::Hourly), hour(5), 3.0).await;
        assert!(matches!(again, Err(ImportError::Store(StoreError::Corrupt(_)))), "{again:?}");
    }
}
