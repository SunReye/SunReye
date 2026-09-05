-- Time-weighted continuous aggregates (#116), compressed correctly from birth
-- (#134).
--
-- WHY NEW AGGREGATES RATHER THAN A FIX IN PLACE
--
-- `avg(value)` in minute_rollups / hourly_rollups / daily_rollups is an
-- *unweighted* mean. Over a complete 3-second series that is implicitly
-- time-weighted, because every stored sample stands for an equal slice of time.
-- The change-only writer (#117) destroys that property: a signal flat at 0 for
-- 50 minutes contributes one row and a 10-minute excursion contributes
-- hundreds, so `avg` reports something close to the excursion. The error is
-- largest exactly where the data matters most — grid.import_power,
-- battery.power, every *.ct.* reading. (`min`/`max` survive: an extreme is by
-- definition a change, so it is always stored.)
--
-- Correcting an aggregate's SELECT list means recreating it, and 0000_bootstrap
-- forbids that: metrics_raw has 7-day retention, so a drop/recreate can only
-- re-materialize the last 7 days and silently destroys every older bucket. So
-- these are NEW aggregates under NEW names. The legacy three keep being
-- refreshed and keep their history; the read layer serves each bucket from
-- exactly one source, preferring the weighted one where it exists
-- (apps/server/src/shared/rollup-sql.ts).
--
-- `timescaledb_toolkit` is not installed in the shipped image
-- (pg_available_extensions holds `timescaledb` only), so `time_weight('LOCF',…)`
-- is unavailable and the weight is carried by metrics_raw.dur_ms instead.
--
-- WHY THE TWO SUMS AND NOT THEIR QUOTIENT
--
-- An expression over aggregates inside a continuous-aggregate definition is a
-- portability risk across TimescaleDB versions, and materializing the parts
-- keeps the aggregates composable later (a coarser tier can be rolled up from a
-- finer one by summing both columns). The read layer divides.
--
-- `coalesce(dur_ms, 1000)`: every row written before #117 has dur_ms = NULL and
-- must read as an equal weight, which makes the weighted mean *exactly* equal to
-- the legacy plain mean over a complete series — this migration's safety
-- property, and true for any constant. NULL is not a duration, which is why the
-- column itself has no default; see packages/db/src/schema/metrics.ts.
--
-- The constant is 1000 rather than 1 because of the one bucket per tier that
-- SPANS the upgrade: it holds NULL-weighted rows from before it and real
-- intervals from after. 1000 is the shipped `POLL_INTERVAL_MS` — what a pre-#117
-- row actually represented — so that bucket is exact at a 1 s cadence and off by
-- the cadence ratio elsewhere, instead of off by 3000x.
--
-- Measured on a fabricated upgrade day (12 h at 100, then 12 h at 200 stored as
-- 60 s intervals; truth 150), on a 3 s instance:
--
--   weight 1000 (this file)              175.000
--   weight 1                             199.967   <- the day reports its afternoon
--   weight 3000 (a 3 s row's true span)  150.000
--   the LEGACY unweighted arm            104.762   <- worse than either, see below
--
-- The legacy figure is why the read layer still prefers the weighted arm for this
-- bucket: an unweighted mean over a partly-thinned day counts 14,400 morning
-- samples against 720 afternoon rows and is further from the truth than anything
-- the weighted arm produces. There is no correct source for that one bucket; the
-- weighted arm is the least wrong, and it is exactly three buckets — the minute,
-- hour and day containing the upgrade. Every earlier bucket is uniformly
-- NULL-weighted (so exact), every later one fully weighted.
--
-- Names must end in `_rollups`: drizzle.config.ts's `tablesFilter: ["!*_rollups"]`
-- is what stops drizzle emitting `DROP VIEW` for a continuous aggregate, and a
-- name outside that pattern breaks every push/pull.
--
-- Statements are separated by the drizzle statement-breakpoint marker; each runs
-- on its own (continuous aggregates cannot be created inside a transaction
-- block). Every statement is idempotent because a mid-file failure re-runs the
-- whole file.

CREATE MATERIALIZED VIEW IF NOT EXISTS weighted_minute_rollups
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 minute', time) AS bucket,
  inverter_id,
  metric,
  sum(value * coalesce(dur_ms, 1000)) AS weighted_sum,
  sum(coalesce(dur_ms, 1000))      AS weight,
  max(value) AS max_value,
  min(value) AS min_value
FROM metrics_raw
GROUP BY bucket, inverter_id, metric
WITH NO DATA;
--> statement-breakpoint

CREATE MATERIALIZED VIEW IF NOT EXISTS weighted_hourly_rollups
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 hour', time) AS bucket,
  inverter_id,
  metric,
  sum(value * coalesce(dur_ms, 1000)) AS weighted_sum,
  sum(coalesce(dur_ms, 1000))      AS weight,
  max(value) AS max_value,
  min(value) AS min_value
FROM metrics_raw
GROUP BY bucket, inverter_id, metric
WITH NO DATA;
--> statement-breakpoint

CREATE MATERIALIZED VIEW IF NOT EXISTS weighted_daily_rollups
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 day', time) AS bucket,
  inverter_id,
  metric,
  sum(value * coalesce(dur_ms, 1000)) AS weighted_sum,
  sum(coalesce(dur_ms, 1000))      AS weight,
  max(value) AS max_value,
  min(value) AS min_value
FROM metrics_raw
GROUP BY bucket, inverter_id, metric
WITH NO DATA;
--> statement-breakpoint

-- Real-time aggregation, matching the legacy three: the view unions
-- materialized buckets with the not-yet-materialized tail computed on the fly,
-- so a chart always includes the latest data without waiting for the refresh
-- policy.
ALTER MATERIALIZED VIEW weighted_minute_rollups SET (timescaledb.materialized_only = false);
--> statement-breakpoint

ALTER MATERIALIZED VIEW weighted_hourly_rollups SET (timescaledb.materialized_only = false);
--> statement-breakpoint

ALTER MATERIALIZED VIEW weighted_daily_rollups SET (timescaledb.materialized_only = false);
--> statement-breakpoint

-- #134, from birth. Rollup rows are materialized grouped by *bucket*, so
-- without a segmentby a per-metric range scan touches essentially every page in
-- the range: measured 1 row per 8 KB block against ~143 rows/block in
-- metrics_raw, which is a 1-year single-metric hourly chart reading ~68 MB to
-- return ~200 KB. `segmentby = 'metric, inverter_id'` mirrors metrics_raw and
-- stores the repeated text once per segment, so a per-metric query decompresses
-- only the batches it needs.
--
-- The `compress_after` intervals live in policies.sql (re-applied every run), not
-- here — an interval is tuning, not structure.
ALTER MATERIALIZED VIEW weighted_minute_rollups SET (
  timescaledb.compress = true,
  timescaledb.compress_segmentby = 'metric, inverter_id'
);
--> statement-breakpoint

ALTER MATERIALIZED VIEW weighted_hourly_rollups SET (
  timescaledb.compress = true,
  timescaledb.compress_segmentby = 'metric, inverter_id'
);
--> statement-breakpoint

ALTER MATERIALIZED VIEW weighted_daily_rollups SET (
  timescaledb.compress = true,
  timescaledb.compress_segmentby = 'metric, inverter_id'
);
