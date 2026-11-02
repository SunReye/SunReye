//! Rollup tiers (ADR 0004), rolled up in the transaction that appends a minute. A minute's bucket is
//! rolled up on every append; an hour and its day once the device's next stored minute is in a later one.
//! Until then the readings are their only record.

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
        rows.into_iter()
            .map(|row| {
                let start = Timestamp::from_microsecond(row.start_us)
                    .map_err(|_| StoreError::Corrupt("bucket start"))?;
                Ok(Bucket { start, avg: row.avg, max: row.max, min: row.min })
            })
            .collect()
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

    /// Drops every device's minutes of readings that ended at or before `ended_by`; returns how many.
    /// Batched as [`Store::drop_buckets`]. A device whose last minute goes gets its open hour and day first.
    pub async fn drop_readings(&self, ended_by: Timestamp) -> Result<u64, StoreError> {
        let first_kept = ended_by.as_millisecond().div_euclid(MINUTE_MS);
        let devices = sqlx::query_scalar!("SELECT id FROM device").fetch_all(&self.pool).await?;
        let pool = &self.pool;
        let mut dropped = 0;
        for device in devices {
            self.close_last_before(device, first_kept).await?;
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

    /// Rolls up the hour and day of the device's last minute when it is before `first_kept`: no later
    /// minute is left to close them once that minute is dropped.
    async fn close_last_before(&self, device_id: i64, first_kept: i64) -> Result<(), StoreError> {
        let mut tx = self.pool.begin().await?;
        let last = sqlx::query_scalar!(
            r#"SELECT max(minute) AS "minute: i64" FROM reading_minute WHERE device_id = ?"#,
            device_id
        )
        .fetch_one(&mut *tx)
        .await?;
        if let Some(last) = last.filter(|last| *last < first_kept) {
            let ids = super::metric_ids(&mut *tx).await?;
            let hour = last.div_euclid(MINUTES_PER_HOUR) * MINUTES_PER_HOUR;
            roll_up_hour(&mut tx, device_id, hour, &ids).await?;
            roll_up_day(&mut tx, device_id, last.div_euclid(MINUTES_PER_DAY) * MINUTES_PER_DAY, &ids).await?;
        }
        tx.commit().await?;
        Ok(())
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
    for (metric, readings) in by_metric(&samples, ids) {
        append(conn, Tier::Hour, device_id, metric, &partials(Tier::Hour, &readings)).await?;
    }
    Ok(())
}

async fn roll_up_day(
    conn: &mut SqliteConnection,
    device_id: i64,
    first_minute: i64,
    ids: &BTreeMap<String, u32>,
) -> Result<(), StoreError> {
    let from = first_minute * MINUTE_MS * US_PER_MS;
    let to = from + Tier::Day.width_us() - 1;
    let hour = code(Tier::Hour);
    for &metric in ids.values() {
        let hours: Vec<Partial> = sqlx::query!(
            "SELECT start_us, first_us, first, last_us, last, weighted, max, min FROM rollup
             WHERE device_id = ? AND metric_id = ? AND tier = ? AND start_us BETWEEN ? AND ? ORDER BY start_us",
            device_id,
            metric,
            hour,
            from,
            to
        )
        .fetch_all(&mut *conn)
        .await?
        .into_iter()
        .map(|row| Partial {
            start: row.start_us,
            first: (row.first_us, row.first),
            last: (row.last_us, row.last),
            weighted: row.weighted,
            max: row.max,
            min: row.min,
        })
        .collect();
        append(conn, Tier::Day, device_id, metric, &days(&hours)).await?;
    }
    Ok(())
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
        let carried = sqlx::query!(
            "SELECT last FROM rollup WHERE tier = ? AND device_id = ? AND metric_id = ? AND start_us < ?
             ORDER BY start_us DESC LIMIT 1",
            code,
            device_id,
            metric,
            partial.start
        )
        .fetch_optional(&mut *conn)
        .await?
        .map(|row| row.last);
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
        let started = std::time::Instant::now();
        store.append_minute(second, &poll(late)).await.expect("append");
        let took = started.elapsed();
        assert!(took < std::time::Duration::from_millis(100), "{took:?}");
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

    async fn append_each(store: &Store, device: i64, minutes: &[ClosedMinute]) {
        for minute in minutes {
            store.append_minute(device, minute).await.expect("append");
            tokio::task::yield_now().await;
        }
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
