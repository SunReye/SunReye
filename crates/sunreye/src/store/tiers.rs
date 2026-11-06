//! Rollup tiers (ADR 0004): a minute rolls up on append; its hour and day once a later minute or retention
//! closes them. Until then the readings are their only record, and a read rolls them up from there.

use std::collections::BTreeMap;

use jiff::Timestamp;
use sqlx::SqliteConnection;
use sqlx::sqlite::SqliteQueryResult;

use super::{Store, StoreError};
use crate::rollup::{Bucket, Partial, Tier, close, days, partials};
use crate::samples::{MINUTE_MS, Sample, decode};

const MINUTES_PER_HOUR: i64 = 60;
const MINUTES_PER_DAY: i64 = 24 * MINUTES_PER_HOUR;
const US_PER_MS: i64 = 1_000;
/// Rows one retention statement deletes; bounds how long a poll waits behind the pass.
const DROP_BATCH: i64 = 1_000;

const fn code(tier: Tier) -> i64 {
    match tier {
        Tier::Minute => 0,
        Tier::Hour => 1,
        Tier::Day => 2,
    }
}

/// The buckets a read takes: those starting in `[from, to)`, the first `limit` of them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BucketWindow {
    pub from: Timestamp,
    pub to: Timestamp,
    pub limit: u32,
}

fn bucket(start_us: i64, avg: f64, max: f64, min: f64) -> Result<Bucket, StoreError> {
    let start = Timestamp::from_microsecond(start_us).map_err(|_| StoreError::Corrupt("bucket start"))?;
    Ok(Bucket { start, avg, max, min })
}

impl Store {
    /// The `tier` buckets of `metric` on the device, oldest first. The history endpoints (#385) read through it.
    pub async fn buckets(&self, tier: Tier, device_id: i64, metric: &str) -> Result<Vec<Bucket>, StoreError> {
        let tier = code(tier);
        let rows = sqlx::query!(
            r#"SELECT start_us, avg, max, min FROM rollup JOIN metric ON metric.id = rollup.metric_id
               WHERE tier = ? AND device_id = ? AND metric.key = ? ORDER BY start_us"#,
            tier,
            device_id,
            metric
        )
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter().map(|row| bucket(row.start_us, row.avg, row.max, row.min)).collect()
    }

    /// The first `window.limit` `tier` buckets of `metric` on the device that start in `[window.from, window.to)`,
    /// oldest first, the unstored open hour or day last.
    pub async fn buckets_between(
        &self,
        tier: Tier,
        device_id: i64,
        metric: &str,
        window: BucketWindow,
    ) -> Result<Vec<Bucket>, StoreError> {
        let mut tx = self.pool.begin().await?;
        let code = code(tier);
        let (from, to, limit) =
            (window.from.as_microsecond(), window.to.as_microsecond(), i64::from(window.limit));
        let rows = sqlx::query!(
            r#"SELECT start_us, avg, max, min FROM rollup JOIN metric ON metric.id = rollup.metric_id
               WHERE tier = ? AND device_id = ? AND metric.key = ? AND start_us >= ? AND start_us < ?
               ORDER BY start_us LIMIT ?"#,
            code,
            device_id,
            metric,
            from,
            to,
            limit
        )
        .fetch_all(&mut *tx)
        .await?;
        let mut buckets: Vec<Bucket> = rows
            .into_iter()
            .map(|row| bucket(row.start_us, row.avg, row.max, row.min))
            .collect::<Result<_, _>>()?;
        let open = open_bucket(&mut tx, tier, device_id, metric).await?;
        let room = buckets.len() < usize::try_from(window.limit).unwrap_or(usize::MAX);
        // Retention stores the bucket from every reading before it drops them; a stored one wins.
        let stored = |open: &Bucket| buckets.last().is_some_and(|last| last.start == open.start);
        if let Some(open) =
            open.filter(|open| room && (window.from..window.to).contains(&open.start) && !stored(open))
        {
            buckets.push(open);
        }
        Ok(buckets)
    }

    /// The newest stored `tier` bucket of `metric` on the device that starts before `before`: the bucket a
    /// counter's first rise in a window chains from. An unstored open bucket is never one.
    pub async fn bucket_before(
        &self,
        tier: Tier,
        device_id: i64,
        metric: &str,
        before: Timestamp,
    ) -> Result<Option<Bucket>, StoreError> {
        let (tier, before) = (code(tier), before.as_microsecond());
        let row = sqlx::query!(
            r#"SELECT start_us, avg, max, min FROM rollup JOIN metric ON metric.id = rollup.metric_id
               WHERE tier = ? AND device_id = ? AND metric.key = ? AND start_us < ?
               ORDER BY start_us DESC LIMIT 1"#,
            tier,
            device_id,
            metric,
            before
        )
        .fetch_optional(&self.pool)
        .await?;
        row.map(|row| bucket(row.start_us, row.avg, row.max, row.min)).transpose()
    }

    /// Drops every `tier` bucket that ended at or before `ended_by`, for every device; returns how many.
    /// Deletes in batches and frees the connection between them, so a poll waits for one batch only.
    pub async fn drop_buckets(&self, tier: Tier, ended_by: Timestamp) -> Result<u64, StoreError> {
        let last_start = ended_by.as_microsecond().saturating_sub(tier.width_us());
        let tier = code(tier);
        let series =
            sqlx::query!(r#"SELECT device.id AS "device!", metric.id AS "metric!" FROM device, metric"#)
                .fetch_all(&self.pool)
                .await?;
        let pool = &self.pool;
        let mut dropped = 0;
        for row in series {
            let (device, metric) = (row.device, row.metric);
            dropped += in_batches(|| async move {
                sqlx::query!(
                    "DELETE FROM rollup WHERE device_id = ? AND metric_id = ? AND tier = ? AND start_us IN
                       (SELECT start_us FROM rollup WHERE device_id = ? AND metric_id = ? AND tier = ? AND start_us <= ? LIMIT ?)",
                    device,
                    metric,
                    tier,
                    device,
                    metric,
                    tier,
                    last_start,
                    DROP_BATCH
                )
                .execute(pool)
                .await
            })
            .await?;
        }
        Ok(dropped)
    }

    /// Drops every device's minutes of readings that ended at or before `ended_by`, keeping an open hour whole
    /// until it is rolled up; returns how many. Batched as [`Store::drop_buckets`].
    pub async fn drop_readings(&self, ended_by: Timestamp) -> Result<u64, StoreError> {
        let cutoff = ended_by.as_millisecond().div_euclid(MINUTE_MS);
        let devices = sqlx::query_scalar!("SELECT id FROM device").fetch_all(&self.pool).await?;
        let pool = &self.pool;
        let mut dropped = 0;
        for device in devices {
            let first_kept = self.close_last_before(device, cutoff).await?;
            dropped += in_batches(|| async move {
                sqlx::query!(
                    "DELETE FROM reading_minute WHERE device_id = ? AND minute IN
                       (SELECT minute FROM reading_minute WHERE device_id = ? AND minute < ? LIMIT ?)",
                    device,
                    device,
                    first_kept,
                    DROP_BATCH
                )
                .execute(pool)
                .await
            })
            .await?;
        }
        Ok(dropped)
    }

    /// Rolls up the device's last hour and day once the hour ends by `cutoff`; returns the first minute to keep.
    async fn close_last_before(&self, device_id: i64, cutoff: i64) -> Result<i64, StoreError> {
        let mut tx = self.pool.begin().await?;
        let last = sqlx::query_scalar!(
            r#"SELECT max(minute) AS "minute: i64" FROM reading_minute WHERE device_id = ?"#,
            device_id
        )
        .fetch_one(&mut *tx)
        .await?;
        let Some(last) = last else { return Ok(cutoff) };
        let hour = last.div_euclid(MINUTES_PER_HOUR) * MINUTES_PER_HOUR;
        if hour + MINUTES_PER_HOUR > cutoff {
            return Ok(cutoff.min(hour));
        }
        let ids = super::metric_ids(&mut *tx).await?;
        roll_up_hour(&mut tx, device_id, hour, &ids).await?;
        roll_up_day(&mut tx, device_id, last.div_euclid(MINUTES_PER_DAY) * MINUTES_PER_DAY, &ids).await?;
        tx.commit().await?;
        Ok(cutoff)
    }
}

/// Runs `delete` until a run removes fewer than [`DROP_BATCH`] rows, yielding between runs; returns the total.
async fn in_batches<F, Run>(mut delete: F) -> Result<u64, StoreError>
where
    F: FnMut() -> Run,
    Run: Future<Output = Result<SqliteQueryResult, sqlx::Error>>,
{
    let mut dropped = 0;
    loop {
        let done = delete().await?.rows_affected();
        dropped += done;
        tokio::task::yield_now().await;
        if done < DROP_BATCH.unsigned_abs() {
            return Ok(dropped);
        }
    }
}

/// Rolls up `minute`, now holding `samples`, and the hour and day the device's previous minute closes.
pub(super) async fn roll_up(
    conn: &mut SqliteConnection,
    device_id: i64,
    minute: i64,
    samples: &[Sample],
    ids: &BTreeMap<String, u32>,
) -> Result<(), StoreError> {
    for (metric, readings) in by_metric(samples, ids) {
        append(conn, Tier::Minute, device_id, metric, &partials(Tier::Minute, &readings)).await?;
    }
    let previous = sqlx::query!(
        r#"SELECT max(minute) AS "minute: i64" FROM reading_minute WHERE device_id = ? AND minute < ?"#,
        device_id,
        minute
    )
    .fetch_one(&mut *conn)
    .await?
    .minute;
    let Some(previous) = previous else { return Ok(()) };
    let hour = previous.div_euclid(MINUTES_PER_HOUR);
    if hour < minute.div_euclid(MINUTES_PER_HOUR) {
        roll_up_hour(conn, device_id, hour * MINUTES_PER_HOUR, ids).await?;
    }
    let day = previous.div_euclid(MINUTES_PER_DAY);
    if day < minute.div_euclid(MINUTES_PER_DAY) {
        roll_up_day(conn, device_id, day * MINUTES_PER_DAY, ids).await?;
    }
    Ok(())
}

fn by_metric(samples: &[Sample], ids: &BTreeMap<String, u32>) -> BTreeMap<u32, Vec<(Timestamp, f64)>> {
    let mut out: BTreeMap<u32, Vec<(Timestamp, f64)>> = BTreeMap::new();
    for sample in samples {
        let Ok(at) = Timestamp::from_millisecond(sample.at_ms) else { continue };
        for (key, value) in &sample.values {
            if let Some(id) = ids.get(key) {
                out.entry(*id).or_default().push((at, *value));
            }
        }
    }
    out
}

async fn roll_up_hour(
    conn: &mut SqliteConnection,
    device_id: i64,
    first_minute: i64,
    ids: &BTreeMap<String, u32>,
) -> Result<(), StoreError> {
    for (metric, readings) in hour_readings(conn, device_id, first_minute, ids).await? {
        append(conn, Tier::Hour, device_id, metric, &partials(Tier::Hour, &readings)).await?;
    }
    Ok(())
}

/// The readings of the hour starting at `first_minute`, by metric.
async fn hour_readings(
    conn: &mut SqliteConnection,
    device_id: i64,
    first_minute: i64,
    ids: &BTreeMap<String, u32>,
) -> Result<BTreeMap<u32, Vec<(Timestamp, f64)>>, StoreError> {
    let last_minute = first_minute + MINUTES_PER_HOUR - 1;
    let rows = sqlx::query!(
        "SELECT minute, samples FROM reading_minute WHERE device_id = ? AND minute BETWEEN ? AND ? ORDER BY minute",
        device_id,
        first_minute,
        last_minute
    )
    .fetch_all(&mut *conn)
    .await?;
    let keys: BTreeMap<u32, String> = ids.iter().map(|(key, id)| (*id, key.clone())).collect();
    let mut samples = Vec::new();
    for row in rows {
        samples.extend(decode(row.minute, &row.samples, &keys)?);
    }
    Ok(by_metric(&samples, ids))
}

async fn roll_up_day(
    conn: &mut SqliteConnection,
    device_id: i64,
    first_minute: i64,
    ids: &BTreeMap<String, u32>,
) -> Result<(), StoreError> {
    let from = first_minute * MINUTE_MS * US_PER_MS;
    for &metric in ids.values() {
        let hours = stored_hours(conn, device_id, metric, from, from + Tier::Day.width_us() - 1).await?;
        append(conn, Tier::Day, device_id, metric, &days(&hours)).await?;
    }
    Ok(())
}

/// The stored hours of `metric` starting from `from_us` through `to_us`, oldest first.
async fn stored_hours(
    conn: &mut SqliteConnection,
    device_id: i64,
    metric: u32,
    from_us: i64,
    to_us: i64,
) -> Result<Vec<Partial>, StoreError> {
    let hour = code(Tier::Hour);
    let rows = sqlx::query!(
        "SELECT start_us, first_us, first, last_us, last, weighted, max, min FROM rollup
             WHERE device_id = ? AND metric_id = ? AND tier = ? AND start_us BETWEEN ? AND ? ORDER BY start_us",
        device_id,
        metric,
        hour,
        from_us,
        to_us
    )
    .fetch_all(&mut *conn)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| Partial {
            start: row.start_us,
            first: (row.first_us, row.first),
            last: (row.last_us, row.last),
            weighted: row.weighted,
            max: row.max,
            min: row.min,
        })
        .collect())
}

/// The unstored `tier` bucket of `metric` holding the device's last minute, rolled up from readings; none for minutes.
async fn open_bucket(
    conn: &mut SqliteConnection,
    tier: Tier,
    device_id: i64,
    metric: &str,
) -> Result<Option<Bucket>, StoreError> {
    if tier == Tier::Minute {
        return Ok(None);
    }
    let last = sqlx::query_scalar!(
        r#"SELECT max(minute) AS "minute: i64" FROM reading_minute WHERE device_id = ?"#,
        device_id
    )
    .fetch_one(&mut *conn)
    .await?;
    let ids = super::metric_ids(&mut *conn).await?;
    let (Some(last), Some(&id)) = (last, ids.get(metric)) else { return Ok(None) };
    let first_minute = last.div_euclid(MINUTES_PER_HOUR) * MINUTES_PER_HOUR;
    let mut readings = hour_readings(conn, device_id, first_minute, &ids).await?;
    let mut open = partials(Tier::Hour, &readings.remove(&id).unwrap_or_default());
    if tier == Tier::Day {
        let hour_us = first_minute * MINUTE_MS * US_PER_MS;
        let day_us = hour_us.div_euclid(Tier::Day.width_us()) * Tier::Day.width_us();
        let mut hours = stored_hours(conn, device_id, id, day_us, hour_us - 1).await?;
        hours.append(&mut open);
        open = days(&hours);
    }
    let Some(partial) = open.first() else { return Ok(None) };
    let carried = carried_in(conn, tier, device_id, id, partial.start).await?;
    Ok(Some(close(tier, partial, carried)))
}

/// The last reading of `metric`'s stored `tier` bucket before the one starting at `start_us`.
async fn carried_in(
    conn: &mut SqliteConnection,
    tier: Tier,
    device_id: i64,
    metric: u32,
    start_us: i64,
) -> Result<Option<f64>, StoreError> {
    let code = code(tier);
    let row = sqlx::query!(
        "SELECT last FROM rollup WHERE tier = ? AND device_id = ? AND metric_id = ? AND start_us < ?
             ORDER BY start_us DESC LIMIT 1",
        code,
        device_id,
        metric,
        start_us
    )
    .fetch_optional(&mut *conn)
    .await?;
    Ok(row.map(|row| row.last))
}

/// Closes each partial with the last reading of the metric's bucket before it, and stores it in place
/// of any bucket already there.
async fn append(
    conn: &mut SqliteConnection,
    tier: Tier,
    device_id: i64,
    metric: u32,
    partials: &[Partial],
) -> Result<(), StoreError> {
    let code = code(tier);
    for partial in partials {
        let carried = carried_in(conn, tier, device_id, metric, partial.start).await?;
        let bucket = close(tier, partial, carried);
        sqlx::query!(
            "INSERT INTO rollup (tier, start_us, device_id, metric_id, avg, max, min, first_us, first, last_us, last, weighted)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (device_id, metric_id, tier, start_us) DO UPDATE SET
               avg = excluded.avg, max = excluded.max, min = excluded.min, first_us = excluded.first_us,
               first = excluded.first, last_us = excluded.last_us, last = excluded.last, weighted = excluded.weighted",
            code,
            partial.start,
            device_id,
            metric,
            bucket.avg,
            bucket.max,
            bucket.min,
            partial.first.0,
            partial.first.1,
            partial.last.0,
            partial.last.1,
            partial.weighted
        )
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

/// A counter's stored buckets, for a read test that needs years of them: bucket `i` holds the rise
/// `step` from `min = (i % resets_every) * step`.
#[cfg(test)]
#[derive(Debug, Clone, Copy)]
pub(crate) struct CounterFill {
    pub tier: Tier,
    pub from: Timestamp,
    pub count: i64,
    pub step: f64,
    pub resets_every: i64,
}

#[cfg(test)]
impl Store {
    pub(crate) async fn fill_counter(&self, device_id: i64, metric: &str, fill: CounterFill) {
        sqlx::query("INSERT OR IGNORE INTO metric (key) VALUES (?)")
            .bind(metric)
            .execute(&self.pool)
            .await
            .expect("metric");
        let width = fill.tier.width_us();
        sqlx::query(
            "WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i + 1 < ?)
             INSERT INTO rollup (tier, start_us, device_id, metric_id, avg, max, min, first_us, first, last_us, last, weighted)
             SELECT ?, ? + i * ?, ?, metric.id, (i % ? + 1) * ?, (i % ? + 1) * ?, (i % ?) * ?,
                    ? + i * ?, (i % ?) * ?, ? + i * ?, (i % ? + 1) * ?, 0
             FROM n, metric WHERE metric.key = ?",
        )
        .bind(fill.count)
        .bind(code(fill.tier))
        .bind(fill.from.as_microsecond())
        .bind(width)
        .bind(device_id)
        .bind(fill.resets_every)
        .bind(fill.step)
        .bind(fill.resets_every)
        .bind(fill.step)
        .bind(fill.resets_every)
        .bind(fill.step)
        .bind(fill.from.as_microsecond())
        .bind(width)
        .bind(fill.resets_every)
        .bind(fill.step)
        .bind(fill.from.as_microsecond())
        .bind(width)
        .bind(fill.resets_every)
        .bind(fill.step)
        .bind(metric)
        .execute(&self.pool)
        .await
        .expect("fill");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modbus::Transport;
    use crate::samples::{ClosedMinute, minute_of};
    use crate::store::{NewConnection, NewDevice};

    fn at(instant: &str) -> Timestamp {
        instant.parse().expect("instant")
    }

    fn bucket(start: &str, avg: f64, max: f64, min: f64) -> Bucket {
        Bucket { start: at(start), avg, max, min }
    }

    /// One minute holding a reading of `power` at each instant.
    fn minute(readings: &[(&str, f64)]) -> ClosedMinute {
        let samples: Vec<Sample> = readings
            .iter()
            .map(|(instant, value)| Sample {
                at_ms: at(instant).as_millisecond(),
                values: vec![("power".to_owned(), *value)],
            })
            .collect();
        ClosedMinute { minute: minute_of(samples[0].at_ms), samples }
    }

    async fn with_device() -> (Store, i64) {
        let store = Store::in_memory().await.expect("store");
        let connection =
            NewConnection { transport: Transport::Tcp, host: "h".into(), port: 502, logger_serial: None };
        let connection = store.add_connection(&connection).await.expect("connection");
        let device = NewDevice { connection_id: connection, profile_id: "p".into(), unit_id: 1 };
        let device = store.add_device(&device).await.expect("device");
        (store, device)
    }

    async fn append(store: &Store, device: i64, readings: &[(&str, f64)]) {
        store.append_minute(device, &minute(readings)).await.expect("append");
    }

    async fn power(store: &Store, tier: Tier, device: i64) -> Vec<Bucket> {
        store.buckets(tier, device, "power").await.expect("buckets")
    }

    const METRICS: usize = 50;

    fn poll(at_ms: i64) -> ClosedMinute {
        let values = (0..METRICS).map(|m| (format!("m{m}"), 1.0)).collect();
        ClosedMinute { minute: minute_of(at_ms), samples: vec![Sample { at_ms, values }] }
    }

    /// `device`'s minute tier holding `minutes` buckets of every metric, from the epoch on.
    async fn fill_minutes(store: &Store, device: i64, minutes: i64) {
        sqlx::query(
            "WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i + 1 < ?)
             INSERT INTO rollup (tier, start_us, device_id, metric_id, avg, max, min, first_us, first, last_us, last, weighted)
             SELECT 0, i * 60000000, ?, metric.id, 1, 1, 1, i * 60000000, 1, i * 60000000, 1, 60000000 FROM n, metric",
        )
        .bind(minutes)
        .bind(device)
        .execute(&store.pool)
        .await
        .expect("fill");
    }

    #[tokio::test]
    async fn a_new_devices_first_minute_on_a_full_store_reads_only_its_own_buckets() {
        let (store, first) = with_device().await;
        let late = 20_000 * MINUTE_MS;
        store.append_minute(first, &poll(late)).await.expect("intern the metrics");
        fill_minutes(&store, first, 4_000).await;
        let connection =
            NewConnection { transport: Transport::Tcp, host: "g".into(), port: 502, logger_serial: None };
        let connection = store.add_connection(&connection).await.expect("connection");
        let device = NewDevice { connection_id: connection, profile_id: "p".into(), unit_id: 2 };
        let second = store.add_device(&device).await.expect("device");
        // 3 from half a minute in; the first device's buckets end on 1, so carrying one in would average 2.
        let values = (0..METRICS).map(|m| (format!("m{m}"), 3.0)).collect();
        let half =
            ClosedMinute { minute: minute_of(late), samples: vec![Sample { at_ms: late + 30_000, values }] };
        store.append_minute(second, &half).await.expect("append");
        let (buckets, newest, low, high): (i64, i64, f64, f64) = sqlx::query_as(
            "SELECT COUNT(*), MAX(start_us), MIN(avg), MAX(avg) FROM rollup WHERE tier = 0 AND device_id = ?",
        )
        .bind(second)
        .fetch_one(&store.pool)
        .await
        .expect("count");
        assert_eq!(
            (buckets, newest, low, high),
            (i64::try_from(METRICS).expect("metrics"), 1_200_000_000_000, 3.0, 3.0)
        );
    }

    async fn plan(store: &Store, query: &str) -> String {
        let rows: Vec<(i64, i64, i64, String)> = sqlx::query_as(&format!("EXPLAIN QUERY PLAN {query}"))
            .fetch_all(&store.pool)
            .await
            .expect("plan");
        rows.into_iter().map(|row| row.3).collect::<Vec<_>>().join("; ")
    }

    #[tokio::test]
    async fn every_tier_query_searches_a_key_and_scans_no_table() {
        let (store, _) = with_device().await;
        let device_metric = "USING PRIMARY KEY (device_id=? AND metric_id=? AND tier=?";
        // The text of each `rollup` query and of the reading drop in this file.
        for (query, uses) in [
            (
                "SELECT last FROM rollup WHERE tier = ? AND device_id = ? AND metric_id = ? AND start_us < ?
                 ORDER BY start_us DESC LIMIT 1",
                device_metric,
            ),
            (
                "SELECT start_us, avg, max, min FROM rollup JOIN metric ON metric.id = rollup.metric_id
                 WHERE tier = ? AND device_id = ? AND metric.key = ? ORDER BY start_us",
                device_metric,
            ),
            (
                "SELECT start_us, avg, max, min FROM rollup JOIN metric ON metric.id = rollup.metric_id
                 WHERE tier = ? AND device_id = ? AND metric.key = ? AND start_us < ?
                 ORDER BY start_us DESC LIMIT 1",
                device_metric,
            ),
            (
                "SELECT start_us, avg, max, min FROM rollup JOIN metric ON metric.id = rollup.metric_id
                 WHERE tier = ? AND device_id = ? AND metric.key = ? AND start_us >= ? AND start_us < ?
                 ORDER BY start_us LIMIT ?",
                device_metric,
            ),
            (
                "SELECT start_us, first_us, first, last_us, last, weighted, max, min FROM rollup
                 WHERE device_id = ? AND metric_id = ? AND tier = ? AND start_us BETWEEN ? AND ? ORDER BY start_us",
                device_metric,
            ),
            (
                "DELETE FROM rollup WHERE device_id = ? AND metric_id = ? AND tier = ? AND start_us IN
                   (SELECT start_us FROM rollup WHERE device_id = ? AND metric_id = ? AND tier = ? AND start_us <= ? LIMIT ?)",
                device_metric,
            ),
            (
                "DELETE FROM reading_minute WHERE device_id = ? AND minute IN
                   (SELECT minute FROM reading_minute WHERE device_id = ? AND minute < ? LIMIT ?)",
                "USING PRIMARY KEY (device_id=? AND minute<?)",
            ),
        ] {
            let plan = plan(&store, query).await;
            assert!(plan.contains(uses) && !plan.contains("SCAN "), "{query}\n{plan}");
        }
    }

    async fn rows_before(store: &Store, start_us: i64) -> i64 {
        sqlx::query_scalar("SELECT count(*) FROM rollup WHERE start_us < ?")
            .bind(start_us)
            .fetch_one(&store.pool)
            .await
            .expect("count")
    }

    #[tokio::test]
    async fn an_append_during_a_large_drop_of_one_series_waits_for_one_batch_not_the_whole_drop() {
        let (store, device) = with_device().await;
        append(&store, device, &[("2026-05-10T12:00:00Z", 1.0)]).await;
        fill_minutes(&store, device, 4_000).await;
        let cutoff = Timestamp::from_millisecond(4_000 * MINUTE_MS).expect("cutoff");
        let appended = async {
            tokio::task::yield_now().await;
            append(&store, device, &[("2026-05-10T12:01:00Z", 1.0)]).await;
            rows_before(&store, cutoff.as_microsecond()).await
        };
        let (dropped, left) = tokio::join!(store.drop_buckets(Tier::Minute, cutoff), appended);
        assert_eq!(dropped.expect("drop"), 4_000);
        assert!(left > 0, "the append waited for the whole drop");
        assert_eq!(rows_before(&store, cutoff.as_microsecond()).await, 0);
    }

    #[tokio::test]
    async fn dropping_readings_keeps_every_tier_and_the_minutes_after_the_cutoff() {
        let (store, first) = with_device().await;
        let connection =
            NewConnection { transport: Transport::Tcp, host: "g".into(), port: 502, logger_serial: None };
        let connection = store.add_connection(&connection).await.expect("connection");
        let device = NewDevice { connection_id: connection, profile_id: "p".into(), unit_id: 2 };
        let second = store.add_device(&device).await.expect("device");
        let instants = ["2026-05-10T12:00:30Z", "2026-05-10T12:01:30Z", "2026-05-10T13:00:30Z"];
        for (device, instant) in [first, second].into_iter().flat_map(|device| instants.map(|i| (device, i)))
        {
            append(&store, device, &[(instant, 1.0)]).await;
        }
        let mut tiers = Vec::new();
        for tier in [Tier::Minute, Tier::Hour, Tier::Day] {
            tiers.push(power(&store, tier, first).await);
        }
        assert_eq!(store.drop_readings(at("2026-05-10T12:01:00Z")).await.expect("drop"), 2);
        assert_eq!(store.drop_readings(at("2026-05-10T12:01:59.999Z")).await.expect("drop"), 0);
        for device in [first, second] {
            let left: Vec<i64> = store
                .readings(device, 0, i64::MAX)
                .await
                .expect("readings")
                .iter()
                .map(|s| s.at_ms)
                .collect();
            let kept =
                [at("2026-05-10T12:01:30Z"), at("2026-05-10T13:00:30Z")].map(Timestamp::as_millisecond);
            assert_eq!(left, kept);
        }
        for (tier, kept) in [Tier::Minute, Tier::Hour, Tier::Day].into_iter().zip(tiers) {
            assert_eq!(power(&store, tier, first).await, kept, "{tier:?}");
        }
    }

    #[tokio::test]
    async fn an_append_during_a_large_reading_drop_waits_for_one_batch_not_the_whole_drop() {
        let (store, device) = with_device().await;
        sqlx::query(
            "WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i + 1 < 20000)
             INSERT INTO reading_minute (device_id, minute, samples) SELECT ?, i, x'010000' FROM n",
        )
        .bind(device)
        .execute(&store.pool)
        .await
        .expect("fill");
        let cutoff = Timestamp::from_millisecond(20_000 * MINUTE_MS).expect("cutoff");
        let count = || {
            sqlx::query_scalar::<_, i64>("SELECT count(*) FROM reading_minute WHERE minute < 20000")
                .fetch_one(&store.pool)
        };
        let append = async {
            tokio::task::yield_now().await;
            store.append_minute(device, &poll(30_000 * MINUTE_MS)).await.expect("append");
            count().await.expect("count")
        };
        let (dropped, left) = tokio::join!(store.drop_readings(cutoff), append);
        assert_eq!(dropped.expect("drop"), 20_000);
        assert!(left > 0, "the append waited for the whole drop");
        assert_eq!(count().await.expect("count"), 0);
    }

    #[tokio::test]
    async fn an_empty_tier_reads_as_no_buckets_and_drops_nothing() {
        let (store, device) = with_device().await;
        for tier in [Tier::Minute, Tier::Hour, Tier::Day] {
            assert_eq!(power(&store, tier, device).await, []);
            assert_eq!(store.drop_buckets(tier, at("2100-01-01T00:00:00Z")).await.expect("drop"), 0);
        }
    }

    #[tokio::test]
    async fn a_minute_appended_in_two_parts_across_a_restart_rolls_up_as_one() {
        // 10 held from :10 to :40, then 40 to the end: (10·30 + 40·20) / 50.
        let (store, device) = with_device().await;
        append(&store, device, &[("2026-05-10T12:00:10Z", 10.0)]).await;
        assert_eq!(
            power(&store, Tier::Minute, device).await,
            [bucket("2026-05-10T12:00:00Z", 10.0, 10.0, 10.0)]
        );
        append(&store, device, &[("2026-05-10T12:00:40Z", 40.0)]).await;
        assert_eq!(
            power(&store, Tier::Minute, device).await,
            [bucket("2026-05-10T12:00:00Z", 22.0, 40.0, 10.0)]
        );
    }

    #[tokio::test]
    async fn zero_and_negative_readings_are_readings() {
        // 0 for 30 s, then -20 for 30 s.
        let (store, device) = with_device().await;
        append(&store, device, &[("2026-05-10T12:00:00Z", 0.0), ("2026-05-10T12:00:30Z", -20.0)]).await;
        assert_eq!(
            power(&store, Tier::Minute, device).await,
            [bucket("2026-05-10T12:00:00Z", -10.0, 0.0, -20.0)]
        );
    }

    #[tokio::test]
    async fn a_minute_appended_twice_counts_each_reading_once() {
        let (store, device) = with_device().await;
        let twice = [("2026-05-10T12:00:10Z", 10.0), ("2026-05-10T12:00:40Z", 40.0)];
        append(&store, device, &twice).await;
        append(&store, device, &twice).await;
        assert_eq!(store.readings(device, 0, i64::MAX).await.expect("readings").len(), 2);
        assert_eq!(
            power(&store, Tier::Minute, device).await,
            [bucket("2026-05-10T12:00:00Z", 22.0, 40.0, 10.0)]
        );
    }

    #[tokio::test]
    async fn a_minute_carries_the_last_reading_of_the_minute_before_it() {
        // 4 from :30 of the minute before, then 8 from :15: (4·15 + 8·45) / 60.
        let (store, device) = with_device().await;
        append(&store, device, &[("2026-05-10T11:59:30Z", 4.0)]).await;
        append(&store, device, &[("2026-05-10T12:00:15Z", 8.0)]).await;
        assert_eq!(
            power(&store, Tier::Minute, device).await,
            [bucket("2026-05-10T11:59:00Z", 4.0, 4.0, 4.0), bucket("2026-05-10T12:00:00Z", 7.0, 8.0, 8.0)]
        );
    }

    #[tokio::test]
    async fn an_hour_is_appended_once_a_minute_of_a_later_hour_is() {
        // 6 held from 12:10 to 12:40, then 2 to 13:00: (6·30 + 2·20) / 50.
        let (store, device) = with_device().await;
        append(&store, device, &[("2026-05-10T12:10:00Z", 6.0)]).await;
        append(&store, device, &[("2026-05-10T12:40:00Z", 2.0)]).await;
        assert_eq!(power(&store, Tier::Hour, device).await, []);
        append(&store, device, &[("2026-05-10T13:05:00Z", 2.0)]).await;
        assert_eq!(power(&store, Tier::Hour, device).await, [bucket("2026-05-10T12:00:00Z", 4.4, 6.0, 2.0)]);
        assert_eq!(power(&store, Tier::Day, device).await, []);
    }

    #[tokio::test]
    async fn the_bucket_before_an_instant_is_the_newest_that_starts_strictly_earlier() {
        let (store, device) = with_device().await;
        append(&store, device, &[("2026-05-10T10:10:00Z", 1.0)]).await;
        append(&store, device, &[("2026-05-10T12:10:00Z", 6.0)]).await;
        append(&store, device, &[("2026-05-10T14:10:00Z", 3.0)]).await;
        let before = |instant: &str| store.bucket_before(Tier::Hour, device, "power", at(instant));
        assert_eq!(before("2026-05-10T10:00:00Z").await.expect("read"), None);
        let ten = Some(bucket("2026-05-10T10:00:00Z", 1.0, 1.0, 1.0));
        assert_eq!(before("2026-05-10T10:00:00.001Z").await.expect("read"), ten);
        assert_eq!(before("2026-05-10T12:00:00Z").await.expect("read"), ten);
        let twelve = before("2026-05-10T13:00:00Z").await.expect("read").map(|b| b.start);
        assert_eq!(twelve, Some(at("2026-05-10T12:00:00Z")));
        let day = store.bucket_before(Tier::Day, device, "power", at("2026-05-11T00:00:00Z")).await;
        assert_eq!(day.expect("read"), None, "the day is not stored until the next one starts");
    }

    #[tokio::test]
    async fn a_restart_on_an_hour_boundary_appends_the_hour_once_and_the_day_when_it_ends() {
        let (store, device) = with_device().await;
        append(&store, device, &[("2026-05-10T23:30:00Z", 6.0)]).await;
        // Stopped with the next day's first minute open, started again inside it.
        append(&store, device, &[("2026-05-11T00:00:00Z", 2.0)]).await;
        append(&store, device, &[("2026-05-11T00:00:30Z", 4.0)]).await;
        assert_eq!(power(&store, Tier::Hour, device).await, [bucket("2026-05-10T23:00:00Z", 6.0, 6.0, 6.0)]);
        assert_eq!(power(&store, Tier::Day, device).await, [bucket("2026-05-10T00:00:00Z", 6.0, 6.0, 6.0)]);
        // 2 for 30 s, then 4 for 30 s.
        assert_eq!(
            power(&store, Tier::Minute, device).await[1],
            bucket("2026-05-11T00:00:00Z", 3.0, 4.0, 2.0)
        );
    }

    #[tokio::test]
    async fn a_day_carries_the_last_reading_of_the_day_before() {
        // 5 held from 00:00 to 06:00, then 1 to midnight: (5·6 + 1·18) / 24.
        let (store, device) = with_device().await;
        append(&store, device, &[("2026-05-10T22:00:00Z", 5.0)]).await;
        append(&store, device, &[("2026-05-11T06:00:00Z", 1.0)]).await;
        append(&store, device, &[("2026-05-12T00:10:00Z", 1.0)]).await;
        assert_eq!(
            power(&store, Tier::Day, device).await,
            [bucket("2026-05-10T00:00:00Z", 5.0, 5.0, 5.0), bucket("2026-05-11T00:00:00Z", 2.0, 1.0, 1.0)]
        );
    }

    #[tokio::test]
    async fn retention_drops_the_buckets_that_ended_by_the_cutoff_in_that_tier_only() {
        let (store, device) = with_device().await;
        for instant in
            ["2026-05-10T12:00:30Z", "2026-05-10T12:01:30Z", "2026-05-10T12:02:30Z", "2026-05-10T13:00:30Z"]
        {
            append(&store, device, &[(instant, 1.0)]).await;
        }
        let hours = power(&store, Tier::Hour, device).await;
        assert_eq!(hours.len(), 1);
        assert_eq!(store.drop_buckets(Tier::Minute, at("2026-05-10T12:02:00Z")).await.expect("drop"), 2);
        let left: Vec<Timestamp> =
            power(&store, Tier::Minute, device).await.iter().map(|b| b.start).collect();
        assert_eq!(left, [at("2026-05-10T12:02:00Z"), at("2026-05-10T13:00:00Z")]);
        assert_eq!(power(&store, Tier::Hour, device).await, hours, "another tier keeps its buckets");
        assert_eq!(
            store.drop_buckets(Tier::Minute, at("2026-05-10T12:02:59.999999Z")).await.expect("drop"),
            0
        );
        assert_eq!(store.readings(device, 0, i64::MAX).await.expect("readings").len(), 4);
    }

    /// A retention pass a week after the device went offline.
    const WEEK_LATER: &str = "2026-05-18T12:00:00Z";

    async fn drop_readings(store: &Store, ended_by: &str) -> u64 {
        store.drop_readings(at(ended_by)).await.expect("drop")
    }

    #[tokio::test]
    async fn an_offline_devices_last_hour_starting_before_the_cutoff_is_rolled_up_from_all_its_readings() {
        // 4 from 23:00 to 23:30, then 10 to midnight: (4·30 + 10·30) / 60.
        let (store, device) = with_device().await;
        append(&store, device, &[("2026-05-10T23:00:00Z", 4.0)]).await;
        append(&store, device, &[("2026-05-10T23:30:00Z", 10.0)]).await;
        drop_readings(&store, "2026-05-10T23:15:00Z").await;
        drop_readings(&store, WEEK_LATER).await;
        assert_eq!(power(&store, Tier::Hour, device).await, [bucket("2026-05-10T23:00:00Z", 7.0, 10.0, 4.0)]);
        assert_eq!(power(&store, Tier::Day, device).await, [bucket("2026-05-10T00:00:00Z", 7.0, 10.0, 4.0)]);
        assert_eq!(store.readings(device, 0, i64::MAX).await.expect("readings"), []);
        drop_readings(&store, WEEK_LATER).await;
        assert_eq!(power(&store, Tier::Hour, device).await, [bucket("2026-05-10T23:00:00Z", 7.0, 10.0, 4.0)]);
        assert_eq!(power(&store, Tier::Day, device).await, [bucket("2026-05-10T00:00:00Z", 7.0, 10.0, 4.0)]);
    }

    #[tokio::test]
    async fn a_cutoff_on_the_hour_drops_the_hour_before_and_keeps_the_last_hour_whole() {
        // Day: 4 from 22:30 to 23:30, then 10 to midnight: (4·60 + 10·30) / 90.
        let (store, device) = with_device().await;
        for (instant, value) in
            [("2026-05-10T22:30:00Z", 4.0), ("2026-05-10T23:00:00Z", 4.0), ("2026-05-10T23:30:00Z", 10.0)]
        {
            append(&store, device, &[(instant, value)]).await;
        }
        assert_eq!(drop_readings(&store, "2026-05-10T23:00:00Z").await, 1);
        drop_readings(&store, WEEK_LATER).await;
        assert_eq!(
            power(&store, Tier::Hour, device).await,
            [bucket("2026-05-10T22:00:00Z", 4.0, 4.0, 4.0), bucket("2026-05-10T23:00:00Z", 7.0, 10.0, 4.0)]
        );
        assert_eq!(power(&store, Tier::Day, device).await, [bucket("2026-05-10T00:00:00Z", 6.0, 10.0, 4.0)]);
    }

    #[tokio::test]
    async fn a_last_hour_that_ends_on_the_cutoff_is_closed_and_its_readings_dropped() {
        let (store, device) = with_device().await;
        append(&store, device, &[("2026-05-10T22:30:00Z", 4.0)]).await;
        assert_eq!(drop_readings(&store, "2026-05-10T23:00:00Z").await, 1);
        assert_eq!(power(&store, Tier::Hour, device).await, [bucket("2026-05-10T22:00:00Z", 4.0, 4.0, 4.0)]);
    }

    #[tokio::test]
    async fn a_last_hour_is_kept_until_the_cutoff_reaches_its_end() {
        // 0 from 23:00 to 23:59:30, then 60 for the last half minute: (0·59.5 + 60·0.5) / 60.
        let (store, device) = with_device().await;
        append(&store, device, &[("2026-05-10T23:00:00Z", 0.0)]).await;
        append(&store, device, &[("2026-05-10T23:59:30Z", 60.0)]).await;
        assert_eq!(drop_readings(&store, "2026-05-10T23:59:59.999999Z").await, 0);
        assert_eq!(power(&store, Tier::Hour, device).await, []);
        assert_eq!(store.readings(device, 0, i64::MAX).await.expect("readings").len(), 2);
        assert_eq!(drop_readings(&store, "2026-05-11T00:00:00Z").await, 2);
        assert_eq!(power(&store, Tier::Hour, device).await, [bucket("2026-05-10T23:00:00Z", 0.5, 60.0, 0.0)]);
        assert_eq!(power(&store, Tier::Day, device).await, [bucket("2026-05-10T00:00:00Z", 0.5, 60.0, 0.0)]);
        assert_eq!(store.readings(device, 0, i64::MAX).await.expect("readings"), []);
    }

    #[tokio::test]
    async fn an_online_devices_hour_straddling_the_cutoff_closes_from_all_its_readings() {
        let (store, device) = with_device().await;
        append(&store, device, &[("2026-05-10T23:00:00Z", 4.0)]).await;
        append(&store, device, &[("2026-05-10T23:30:00Z", 10.0)]).await;
        drop_readings(&store, "2026-05-10T23:15:00Z").await;
        append(&store, device, &[("2026-05-11T00:10:00Z", 1.0)]).await;
        assert_eq!(power(&store, Tier::Hour, device).await, [bucket("2026-05-10T23:00:00Z", 7.0, 10.0, 4.0)]);
        assert_eq!(power(&store, Tier::Day, device).await, [bucket("2026-05-10T00:00:00Z", 7.0, 10.0, 4.0)]);
    }

    #[tokio::test]
    async fn a_restart_mid_hour_after_a_pass_rolls_the_hour_up_from_all_its_readings() {
        let (store, device) = with_device().await;
        append(&store, device, &[("2026-05-10T23:00:00Z", 4.0)]).await;
        drop_readings(&store, "2026-05-10T23:15:00Z").await;
        append(&store, device, &[("2026-05-10T23:30:00Z", 10.0)]).await;
        drop_readings(&store, WEEK_LATER).await;
        assert_eq!(power(&store, Tier::Hour, device).await, [bucket("2026-05-10T23:00:00Z", 7.0, 10.0, 4.0)]);
    }

    #[tokio::test]
    async fn zero_readings_in_a_straddling_hour_count_toward_its_bucket() {
        // 0 from 23:00 to 23:30, then 10 to midnight.
        let (store, device) = with_device().await;
        append(&store, device, &[("2026-05-10T23:00:00Z", 0.0)]).await;
        append(&store, device, &[("2026-05-10T23:30:00Z", 10.0)]).await;
        drop_readings(&store, "2026-05-10T23:15:00Z").await;
        drop_readings(&store, WEEK_LATER).await;
        assert_eq!(power(&store, Tier::Hour, device).await, [bucket("2026-05-10T23:00:00Z", 5.0, 10.0, 0.0)]);
    }

    #[tokio::test]
    async fn a_pass_over_a_device_with_no_readings_drops_and_stores_nothing() {
        let (store, device) = with_device().await;
        assert_eq!(drop_readings(&store, WEEK_LATER).await, 0);
        for tier in [Tier::Minute, Tier::Hour, Tier::Day] {
            assert_eq!(power(&store, tier, device).await, []);
        }
    }

    async fn append_each(store: &Store, device: i64, minutes: &[ClosedMinute]) {
        for minute in minutes {
            store.append_minute(device, minute).await.expect("append");
            tokio::task::yield_now().await;
        }
    }

    async fn between(store: &Store, device: i64, metric: &str, window: BucketWindow) -> Vec<Bucket> {
        store.buckets_between(Tier::Minute, device, metric, window).await.expect("buckets")
    }

    fn window(from: &str, to: &str, limit: u32) -> BucketWindow {
        BucketWindow { from: at(from), to: at(to), limit }
    }

    #[tokio::test]
    async fn an_hour_retention_stored_is_read_once_as_stored_when_its_readings_come_back() {
        let (store, device) = with_device().await;
        append(&store, device, &[("2026-05-10T12:00:00Z", 2.0)]).await;
        append(&store, device, &[("2026-05-10T13:00:00Z", 4.0)]).await;
        append(&store, device, &[("2026-05-10T13:30:00Z", 8.0)]).await;
        store.drop_readings(at("2026-05-11T00:00:00Z")).await.expect("drop");
        append(&store, device, &[("2026-05-10T13:30:00Z", 8.0)]).await;
        let every = BucketWindow { from: Timestamp::MIN, to: Timestamp::MAX, limit: u32::MAX };
        let hours = store.buckets_between(Tier::Hour, device, "power", every).await.expect("buckets");
        // 4 for 30 min, then 8: the hour as retention closed it, not as its one remaining reading makes it.
        assert_eq!(
            hours,
            [bucket("2026-05-10T12:00:00Z", 2.0, 2.0, 2.0), bucket("2026-05-10T13:00:00Z", 6.0, 8.0, 4.0)]
        );
    }

    #[tokio::test]
    async fn the_last_hour_and_day_read_once_and_the_same_before_and_after_retention_closes_them() {
        let (store, device) = with_device().await;
        append(&store, device, &[("2026-05-10T23:00:00Z", 4.0)]).await;
        append(&store, device, &[("2026-05-10T23:30:00Z", 10.0)]).await;
        let every = BucketWindow { from: Timestamp::MIN, to: Timestamp::MAX, limit: u32::MAX };
        let read = |tier| store.buckets_between(tier, device, "power", every);
        let hour = [bucket("2026-05-10T23:00:00Z", 7.0, 10.0, 4.0)];
        let day = [bucket("2026-05-10T00:00:00Z", 7.0, 10.0, 4.0)];
        assert_eq!(drop_readings(&store, "2026-05-10T23:30:00Z").await, 0, "the open hour is kept whole");
        assert_eq!(read(Tier::Hour).await.expect("hours"), hour, "open: from the readings");
        assert_eq!(read(Tier::Day).await.expect("days"), day);
        assert_eq!(drop_readings(&store, "2026-05-11T00:00:00Z").await, 2);
        assert_eq!(read(Tier::Hour).await.expect("hours"), hour, "closed: stored");
        assert_eq!(read(Tier::Day).await.expect("days"), day);
    }

    #[tokio::test]
    async fn a_range_of_buckets_runs_from_inclusive_to_exclusive_and_stops_at_the_limit() {
        let (store, device) = with_device().await;
        for (m, value) in [0.0, 1.0, 2.0, 3.0, 4.0].into_iter().enumerate() {
            append(&store, device, &[(&format!("2026-05-10T00:0{m}:00Z"), value)]).await;
        }
        let power = |window| between(&store, device, "power", window);
        let two = bucket("2026-05-10T00:02:00Z", 2.0, 2.0, 2.0);
        let three = bucket("2026-05-10T00:03:00Z", 3.0, 3.0, 3.0);
        assert_eq!(power(window("2026-05-10T00:02:00Z", "2026-05-10T00:04:00Z", 10)).await, [two, three]);
        assert_eq!(power(window("2026-05-10T00:02:00Z", "2026-05-10T00:04:00Z", 1)).await, [two]);
        assert_eq!(power(window("2026-05-10T00:02:01Z", "2026-05-10T00:03:00Z", 10)).await, []);
        assert_eq!(power(window("2026-05-10T00:00:00Z", "2026-05-10T00:00:00Z", 10)).await, []);
        assert_eq!(power(window("2026-05-10T00:04:00Z", "2026-05-10T00:00:00Z", 10)).await, [], "inverted");
        let every = BucketWindow { from: Timestamp::MIN, to: Timestamp::MAX, limit: u32::MAX };
        let all = power(every).await;
        assert_eq!(all, self::power(&store, Tier::Minute, device).await);
        assert_eq!(all.len(), 5);
        let hours = store.buckets_between(Tier::Hour, device, "power", every).await;
        // 0, 1, 2 and 3 a minute each, then 4 to 01:00: (60·6 + 4·3360) / 3600.
        let open = bucket("2026-05-10T00:00:00Z", 13800.0 / 3600.0, 4.0, 0.0);
        assert_eq!(hours.expect("buckets"), [open], "the open hour, from the readings");
        assert_eq!(between(&store, device, "nothing", every).await, []);
    }

    async fn drop_repeatedly(store: &Store, cutoff: Timestamp, times: usize) {
        for _ in 0..times {
            store.drop_buckets(Tier::Minute, cutoff).await.expect("drop");
            tokio::task::yield_now().await;
        }
    }

    #[tokio::test]
    async fn retention_running_beside_appends_drops_only_what_ended_by_the_cutoff() {
        let (store, device) = with_device().await;
        let first = at("2026-05-10T00:00:00Z").as_millisecond();
        let minutes: Vec<ClosedMinute> = (0..120)
            .map(|i| {
                let sample = Sample { at_ms: first + i * MINUTE_MS, values: vec![("power".into(), 1.0)] };
                ClosedMinute { minute: minute_of(sample.at_ms), samples: vec![sample] }
            })
            .collect();
        let cutoff = at("2026-05-10T00:30:00Z");
        let appends = append_each(&store, device, &minutes);
        let retention = drop_repeatedly(&store, cutoff, 120);
        tokio::join!(appends, retention);
        store.drop_buckets(Tier::Minute, cutoff).await.expect("drop");
        let left = power(&store, Tier::Minute, device).await;
        assert_eq!(left.len(), 90);
        assert_eq!(left[0].start, cutoff);
        assert_eq!(power(&store, Tier::Hour, device).await.len(), 1, "the first hour, closed by the second");
    }
}
