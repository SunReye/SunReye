-- TimescaleDB structural bootstrap: extension, hypertable, continuous
-- aggregates, compression settings. Applied exactly once per file by the
-- journaled runner in src/migrate.ts (table `timescale_migrations`); pre-journal
-- databases that already have the rollup views get this file *stamped* as
-- applied instead of re-executed.
--
-- Structural changes belong in a NEW numbered file (0001_*.sql, …). Never DROP
-- an existing continuous aggregate in a migration: metrics_raw has 7-day
-- retention, so a drop/recreate can only re-materialize the last 7 days and
-- silently loses all long-horizon history. Additive changes create a new
-- aggregate under a new name. Policy/interval tuning belongs in policies.sql
-- (re-applied on every run), not here.
--
-- Statements are separated by the drizzle statement-breakpoint marker; each runs
-- on its own (continuous aggregates cannot be created inside a transaction block).

CREATE EXTENSION IF NOT EXISTS timescaledb;
--> statement-breakpoint

-- Promote metrics_raw to a hypertable partitioned on the time column.
-- migrate_data handles the case where the poll loop already wrote rows before
-- the table was promoted to a hypertable.
-- create_default_indexes => FALSE: the time index (`metrics_raw_time_idx`) is
-- declared in the drizzle schema instead, so drizzle owns it and won't drop an
-- out-of-band index it doesn't know about.
-- chunk_time_interval => 1 day: small chunks so the compression policy can
-- compress everything but the current day. The uncompressed hot window is the
-- single largest storage line item at 1 Hz, so keeping it to ~1 day is what
-- makes the long-horizon budget work.
SELECT create_hypertable('metrics_raw', 'time', if_not_exists => TRUE, migrate_data => TRUE, create_default_indexes => FALSE, chunk_time_interval => INTERVAL '1 day');
--> statement-breakpoint

-- Per-minute rollup, per (inverter, metric). Powers short-horizon history
-- (last hours) at fine resolution without scanning raw 1 Hz rows.
CREATE MATERIALIZED VIEW IF NOT EXISTS minute_rollups
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 minute', time) AS bucket,
  inverter_id,
  metric,
  avg(value) AS avg_value,
  max(value) AS max_value,
  min(value) AS min_value
FROM metrics_raw
GROUP BY bucket, inverter_id, metric
WITH NO DATA;
--> statement-breakpoint

-- Hourly rollup, per (inverter, metric). Long form generalizes across every
-- inverter profile without per-metric DDL.
CREATE MATERIALIZED VIEW IF NOT EXISTS hourly_rollups
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 hour', time) AS bucket,
  inverter_id,
  metric,
  avg(value) AS avg_value,
  max(value) AS max_value,
  min(value) AS min_value
FROM metrics_raw
GROUP BY bucket, inverter_id, metric
WITH NO DATA;
--> statement-breakpoint

-- Daily rollup.
CREATE MATERIALIZED VIEW IF NOT EXISTS daily_rollups
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 day', time) AS bucket,
  inverter_id,
  metric,
  avg(value) AS avg_value,
  max(value) AS max_value,
  min(value) AS min_value
FROM metrics_raw
GROUP BY bucket, inverter_id, metric
WITH NO DATA;
--> statement-breakpoint

-- Real-time aggregation: the view unions materialized buckets with the most
-- recent (not-yet-materialized) window computed on the fly from raw rows, so a
-- chart always includes the latest data without waiting for the refresh policy.
ALTER MATERIALIZED VIEW minute_rollups SET (timescaledb.materialized_only = false);
--> statement-breakpoint

ALTER MATERIALIZED VIEW hourly_rollups SET (timescaledb.materialized_only = false);
--> statement-breakpoint

ALTER MATERIALIZED VIEW daily_rollups SET (timescaledb.materialized_only = false);
--> statement-breakpoint

-- Compress everything older than the current day. Measured ~45x on this 1 Hz
-- narrow-form data: compress_segmentby stores the repeated inverter_id/metric
-- text once per segment, and time+value delta-compress to almost nothing. A
-- compressed day is ~0.1-0.2 GB vs ~5-9 GB uncompressed. The nightly
-- daily_rollups refresh (start_offset 3 days) decompresses a couple of chunks
-- once per day on read — negligible.
ALTER TABLE metrics_raw SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'inverter_id, metric',
  timescaledb.compress_orderby = 'time DESC'
);
--> statement-breakpoint

-- Compress the minute rollups. At 90 days of per-minute buckets per series this
-- is the only rollup large enough to matter; hourly/daily are trivially small
-- and left uncompressed.
ALTER MATERIALIZED VIEW minute_rollups SET (timescaledb.compress = true);
