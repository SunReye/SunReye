-- SunReye 2.0.0 — the clean baseline. TimescaleDB structural objects: the
-- extensions, the hypertable, ONE generation of continuous aggregates, and the
-- compression layout of every one of them.
--
-- Applied exactly once by the journaled runner in src/migrate.ts (table
-- `timescale_migrations`). Policy and interval tuning belongs in policies.sql,
-- which is re-applied on EVERY migrate run; nothing here is tuning.
--
-- ===========================================================================
-- THE NEVER-DROP RULE IS SUSPENDED, ONCE, ON 2026-08-27. THIS IS NOT PRECEDENT.
-- ===========================================================================
--
-- The rule this file replaces read: "Never DROP an existing continuous aggregate
-- in a migration. metrics_raw has 7-day retention, so a drop/recreate can only
-- re-materialize the last 7 days and silently loses all long-horizon history.
-- Additive changes create a new aggregate under a new name." It was correct, it
-- was obeyed, and obeying it is why 1.x shipped TWO generations of aggregates
-- (`minute/hourly/daily_rollups` with an unweighted `avg(value)`, and
-- `weighted_*_rollups` with the `sum(value*dur_ms)` / `sum(dur_ms)` pair), both
-- refreshed forever, with a per-bucket source preference in
-- apps/server/src/shared/rollup-sql.ts deciding which answered a bucket.
--
-- 2.0.0 deletes both generations and starts over, because the identity of a
-- reading is changing and no aggregate can survive that. The break is legal
-- exactly once and exactly now, for reasons that are facts about this moment and
-- will not be true again:
--
--   * there are no public users;
--   * there is ONE production instance, and it is migrated in place by a
--     dedicated later wave rather than by a drop/recreate here;
--   * every drop is of an aggregate whose IDENTITY COLUMNS are being retired.
--     `inverter_id` held the PROFILE id (packages/inverter-core/src/driver.ts
--     stamped `inverterId = this.profile.id`), so those buckets cannot be
--     carried forward under the new key by any mechanical rule — the mapping
--     from a profile id to a device id is exactly what the migration wave has to
--     supply by hand, per install.
--
-- What does NOT follow from this file: that a future release may recreate an
-- aggregate. From 2.0.0 on the rule is back in force, and it is now cheaper to
-- obey — a tier carries `time_weight` and `counter_agg` PARTIALS rather than
-- finished numbers, so most future needs (a percentile, a longer window, a
-- coarser tier) are answered by a new accessor or a new hierarchical child over
-- the existing partials, with no re-materialization at all. The 1.x generation
-- split happened because a finished `avg` cannot be corrected; a partial can be
-- re-read.
--
-- CRITICAL, and the reason this is a NEW FILE NAME rather than an edit of
-- 0000_bootstrap.sql: `timescale_migrations` records a file hash and NEVER
-- VERIFIES it. Editing an already-applied file is silently ignored on every
-- database that has already run it. A structural change must always arrive as a
-- name that has never been recorded.
--
-- Statements are separated by the drizzle statement-breakpoint marker and each
-- runs on its own, OUTSIDE any transaction (a continuous aggregate cannot be
-- created inside one). A mid-file failure leaves the file unrecorded and RE-RUNS
-- THE WHOLE FILE on the next start, so every statement here must be idempotent.

CREATE EXTENSION IF NOT EXISTS timescaledb;
--> statement-breakpoint

-- timescaledb_toolkit: `time_weight`, `counter_agg` and `rollup` all come from
-- it, so without it this file cannot be applied at all and the server cannot
-- start. 1.x deliberately did NOT depend on it — 0002_weighted_rollups.sql
-- recorded that "timescaledb_toolkit is not installed in the shipped image
-- (pg_available_extensions holds timescaledb only), so time_weight('LOCF',…) is
-- unavailable and the weight is carried by metrics_raw.dur_ms instead". That is
-- what changed underneath this release: every deployment surface now runs
-- ghcr.io/sunreye/timescaledb:pg17-ts2.28.2, which carries toolkit 1.25.0, and
-- scripts/storage-tuning.ts gates all six surfaces on that one image precisely
-- so the toolkit cannot exist on one side and not the other.
--
-- Wrapped so a missing toolkit fails with an actionable sentence instead of a
-- raw `extension "timescaledb_toolkit" is not available` mid-boot. The message
-- names the image, because "install the extension" is not an action a Home
-- Assistant addon user can take — replacing the image is.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS timescaledb_toolkit;
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION
    'SunReye 2.0.0 requires the timescaledb_toolkit extension, which this PostgreSQL does not offer. The rollups are built on time_weight() and counter_agg() and cannot be created without it. Run a database image that ships the toolkit — ghcr.io/sunreye/timescaledb:pg17-ts2.28.2 (built from docker/timescaledb/Dockerfile) — and start again. Underlying error: %',
    SQLERRM;
END $$;
--> statement-breakpoint

-- Promote metrics_raw to a hypertable partitioned on the time column.
-- migrate_data handles the case where the poll loop already wrote rows before
-- the table was promoted.
-- create_default_indexes => FALSE: the time index (`metrics_raw_time_idx`) is
-- declared in the drizzle schema instead, so drizzle owns it and won't drop an
-- out-of-band index it doesn't know about.
-- chunk_time_interval => 1 day: small chunks so the compression policy can
-- compress everything but the current day. The uncompressed hot window is the
-- single largest storage line item, so keeping it to ~1 day is what makes the
-- long-horizon budget work.
--
-- The table arrives with two FOREIGN KEYS already on it, to `devices` and
-- `metric_keys` (packages/db/src/schema/metrics.ts). Verified on 2.28.2: the
-- promotion keeps them, they are enforced from inside the chunks, and they
-- survive compression. That is why they are real constraints and not a comment:
-- an int2 identity is only meaningful while every value in the column resolves.
SELECT create_hypertable('metrics_raw', 'time', if_not_exists => TRUE, migrate_data => TRUE, create_default_indexes => FALSE, chunk_time_interval => INTERVAL '1 day');
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- THE ROLLUP GENERATION: minute -> hourly -> daily, one source per tier.
--
-- WHAT REPLACES THE dur_ms WEIGHTING
--
-- 1.x weighted a bucket's mean by `sum(value * coalesce(dur_ms, 1000)) /
-- sum(coalesce(dur_ms, 1000))`, because a change-only writer (#117) destroys the
-- property a plain `avg(value)` relies on: that every stored sample stands for an
-- equal slice of time. That pair fixed the big error and left a smaller, sharper
-- one — it attributes a hold to the bucket the ROW is stamped in, not to the
-- buckets the hold actually spans. A value written at 23:50 and held until 00:10
-- had its whole 20 minutes charged to the 23:00 bucket, and the 00:00 bucket saw
-- none of it. Every day boundary, every tariff period boundary, every statistics
-- bucket was wrong by that hold.
--
-- `time_weight('LOCF', time, value)` derives each sample's span from the NEXT
-- sample instead, so the same 20-minute hold lands 10 minutes in each bucket.
-- Measured here (apps/server/db-tests/baseline.test.ts asserts these exact
-- numbers): 100 held from 23:50, 200 from 00:10 reads as 100 for the 23:00
-- bucket and 183.333… for the 00:00 bucket, which is (100*10 + 200*50)/60.
--
-- WHY A PARTIAL AND NOT A FINISHED MEAN
--
-- Each tier materializes the SUMMARY, not the average, for three reasons that
-- all earn their keep:
--
--   1. `average(tw)` over a bucket holding ONE sample is NULL — a point has no
--      duration — and a change-only series leaves most buckets holding one
--      sample or none at all. Reads must therefore use
--      `interpolated_average(tw, bucket, width, lag(tw), lead(tw))`, which needs
--      the NEIGHBOURING partials. A finished mean cannot be interpolated.
--   2. A mean of means is not a mean, so the hierarchy below is only exact
--      because `rollup()` combines partials.
--   3. It is what makes the never-DROP rule affordable again (see the header).
--
-- WHY THE HIERARCHY STOPS WHERE IT DOES
--
-- `daily` is rolled up from `hourly` — not a third scan of raw — and that is
-- EXACT, not an approximation: `average(rollup(tw))` over a day's hours equals
-- `average(time_weight('LOCF', …))` over that day's raw rows to the last bit.
--
-- `hourly` is built from RAW rather than from `minute`, and that is forced, not
-- an oversight. `counter_agg(time, value)` needs the individual samples, and a
-- continuous aggregate over another continuous aggregate has no `value` column
-- to hand it. The alternative — a `CounterSummary` on the minute tier so hourly
-- could roll it up — costs a measured 184 B per partial (against 49 B for a
-- TimeWeightSummary), i.e. ~28 MB per device-day uncompressed at 1440 buckets ×
-- ~108 metrics. That is the hot window this release exists to shrink. So: two
-- scans of raw, not three, and the counters live on the coarsest tiers that can
-- carry them.
--
-- Names MUST end in `_rollups`. drizzle.config.ts sets
-- `tablesFilter: ["!*_rollups"]`, which is the only thing stopping drizzle from
-- emitting `DROP VIEW` for a continuous aggregate — TimescaleDB rejects that
-- ("cannot drop continuous aggregate using DROP VIEW"), breaking every push and
-- pull.
-- ---------------------------------------------------------------------------

-- Per-minute tier, per (device, metric). Short-horizon history at fine
-- resolution without scanning a five-year raw hypertable.
--
-- No `counter_agg` here — see the cost above. Minute-resolution counter reads go
-- to raw, which still holds every sample.
CREATE MATERIALIZED VIEW IF NOT EXISTS minute_rollups
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 minute', time) AS bucket,
  device_id,
  metric_id,
  time_weight('LOCF', time, value) AS tw,
  max(value) AS max_value,
  min(value) AS min_value
FROM metrics_raw
GROUP BY bucket, device_id, metric_id
WITH NO DATA;
--> statement-breakpoint

-- Hourly tier — the long-horizon record every wide chart reads, and the parent
-- of the daily tier.
--
-- `counter_agg` is materialized FROM BIRTH even though no read path uses it yet.
-- Adding an aggregate column later means another GENERATION, which is exactly
-- the debt this release is paying off. It is only meaningful where
-- `metric_keys.is_counter`; on an instantaneous metric it is 184 B an hour of
-- harmless noise, and a continuous aggregate cannot ask another table which is
-- which (which is why `is_counter` lives on the dimension row and not only in
-- the profile).
CREATE MATERIALIZED VIEW IF NOT EXISTS hourly_rollups
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 hour', time) AS bucket,
  device_id,
  metric_id,
  time_weight('LOCF', time, value) AS tw,
  counter_agg(time, value) AS ctr,
  max(value) AS max_value,
  min(value) AS min_value
FROM metrics_raw
GROUP BY bucket, device_id, metric_id
WITH NO DATA;
--> statement-breakpoint

-- Daily tier, HIERARCHICAL: rolled up from hourly_rollups.
--
-- `rollup(ctr)` recovers a counter reset that is invisible inside either hour:
-- 10→40 then 5→25 across a reset reads as delta 55 with num_resets 1 at day
-- scale, against two clean hours of 30 and 20.
--
-- The refresh ORDER matters and lives in policies.sql: the child must never
-- materialize from a parent bucket the parent has not finished. That is why the
-- daily policy's end_offset (1 day) is far larger than the hourly policy's
-- (1 hour), rather than the two being tuned independently the way the six
-- 1.x tiers were.
CREATE MATERIALIZED VIEW IF NOT EXISTS daily_rollups
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 day', bucket) AS bucket,
  device_id,
  metric_id,
  rollup(tw) AS tw,
  rollup(ctr) AS ctr,
  max(max_value) AS max_value,
  min(min_value) AS min_value
FROM hourly_rollups
GROUP BY 1, device_id, metric_id
WITH NO DATA;
--> statement-breakpoint

-- Real-time aggregation on every tier: the view unions materialized buckets with
-- the most recent (not-yet-materialized) window computed on the fly, so a chart
-- always includes the latest data without waiting for the refresh policy.
--
-- Verified on 2.28.2 that a hierarchical child over a real-time parent is
-- accepted and answers correctly; it is not a documented-but-untested corner.
ALTER MATERIALIZED VIEW minute_rollups SET (timescaledb.materialized_only = false);
--> statement-breakpoint

ALTER MATERIALIZED VIEW hourly_rollups SET (timescaledb.materialized_only = false);
--> statement-breakpoint

ALTER MATERIALIZED VIEW daily_rollups SET (timescaledb.materialized_only = false);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- COMPRESSION, FROM BIRTH, EVERYWHERE.
--
-- 1.x arrived at this shape in two later migrations, and the history is worth
-- keeping because it is the reason "from birth" is written into this file's
-- requirements rather than left to a follow-up:
--
--   * metrics_raw compressed ~45-55x on 1 Hz narrow-form data (226.6 B/row raw
--     against 4.1 B/row compressed), and `compress_after` had to come down from
--     1 day to 2 hours — at 1 day, 1011 of 1232 measured MB were uncompressed,
--     and an uncompressed chunk carries ~412 MB of index against 32-280 kB
--     compressed. The interval itself is tuning and lives in policies.sql.
--   * the rollups shipped WITHOUT this. minute_rollups had compression enabled
--     but no segmentby; hourly_rollups and daily_rollups had no compression
--     settings at all, so no `compress_after` could ever apply to them. Rollup
--     rows are materialized grouped by *bucket* — every metric for a bucket
--     lands together — so a per-metric range scan over an uncompressed rollup
--     touches essentially every page: measured 126 rows in 126 heap blocks, one
--     row per 8 kB page, against ~143 rows/block in compressed metrics_raw. A
--     one-year single-metric hourly chart read ~68 MB to return ~200 kB.
--   * fixing minute_rollups in place was worse than it looked: changing
--     `compress_segmentby` on an aggregate that already has compressed chunks
--     succeeds with `NOTICE: updated compression settings will only apply to
--     future compressions`, so the fix silently missed exactly the data it was
--     written for, and a `compress_chunk(…, recompress => true)` sweep was
--     needed to close it.
--
-- None of that repair machinery exists here, and that is the point of a
-- baseline: there are no compressed chunks yet, so the settings simply are what
-- they are from the first chunk on.
--
-- `segmentby = 'device_id, metric_id'` on all four relations. It stores the
-- repeated identity once per segment and lets a per-metric query decompress only
-- the batches it needs. Note what it does NOT do any more: under the old text
-- identity, segmentby was also what kept `inverter_id`/`metric` from costing 30+
-- bytes a row on compressed chunks. The int2 change saves nothing THERE — it
-- saves on the uncompressed path (WAL, the two-hour hot window, both indexes),
-- which is where SSD/eMMC endurance is spent. Measured on 200k rows, one device,
-- 108 metrics: heap 16 MB → 9.95 MB, the (identity, time) index 11 MB → 6.04 MB,
-- total with both indexes 32 MB → 20 MB.
-- ---------------------------------------------------------------------------

ALTER TABLE metrics_raw SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'device_id, metric_id',
  timescaledb.compress_orderby = 'time DESC'
);
--> statement-breakpoint

ALTER MATERIALIZED VIEW minute_rollups SET (
  timescaledb.compress = true,
  timescaledb.compress_segmentby = 'device_id, metric_id'
);
--> statement-breakpoint

ALTER MATERIALIZED VIEW hourly_rollups SET (
  timescaledb.compress = true,
  timescaledb.compress_segmentby = 'device_id, metric_id'
);
--> statement-breakpoint

ALTER MATERIALIZED VIEW daily_rollups SET (
  timescaledb.compress = true,
  timescaledb.compress_segmentby = 'device_id, metric_id'
);
