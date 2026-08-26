-- TimescaleDB policies (refresh, compression, retention) and other tunables.
-- Unlike the numbered structural migrations, this file is re-applied on EVERY
-- migrate run, so editing an interval here updates existing deployments on
-- their next start. Everything in it must therefore stay idempotent — either
-- `if_not_exists => TRUE` or the authoritative remove+add pattern.
--
-- This file runs AFTER the numbered structural files in the same migrate
-- invocation (src/migrate.ts), and depends on that order: a compression policy
-- on an aggregate whose columnstore is not enabled raises
-- ("columnstore not enabled on continuous aggregate"), and hourly_rollups /
-- daily_rollups only gain theirs in 0003. Do not run this file on its own
-- against a database the structural files have not reached.

-- create_hypertable only sets chunk_time_interval for a *new* hypertable; make
-- it authoritative for existing deployments too (affects future chunks only —
-- any pre-existing wide chunk ages out via the retention policy below).
SELECT set_chunk_time_interval('metrics_raw', INTERVAL '1 day');
--> statement-breakpoint

-- Keep the rollups current in the background.
SELECT add_continuous_aggregate_policy('minute_rollups',
  start_offset => INTERVAL '10 minutes',
  end_offset   => INTERVAL '1 minute',
  schedule_interval => INTERVAL '1 minute',
  if_not_exists => TRUE);
--> statement-breakpoint

SELECT add_continuous_aggregate_policy('hourly_rollups',
  start_offset => INTERVAL '3 hours',
  end_offset   => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour',
  if_not_exists => TRUE);
--> statement-breakpoint

SELECT add_continuous_aggregate_policy('daily_rollups',
  start_offset => INTERVAL '3 days',
  end_offset   => INTERVAL '1 day',
  schedule_interval => INTERVAL '1 day',
  if_not_exists => TRUE);
--> statement-breakpoint

-- The time-weighted aggregates (#116), on the same offsets as the tier they
-- shadow. Both sets are refreshed on purpose: the weighted views can only ever
-- be materialized as far back as metrics_raw reaches (7 days), so a year-old
-- bucket exists only in the legacy view and the read layer must be able to serve
-- it. A period of double materialization is correct, cheap and reversible; the
-- read layer prefers the weighted row per bucket
-- (apps/server/src/shared/rollup-sql.ts).
SELECT add_continuous_aggregate_policy('weighted_minute_rollups',
  start_offset => INTERVAL '10 minutes',
  end_offset   => INTERVAL '1 minute',
  schedule_interval => INTERVAL '1 minute',
  if_not_exists => TRUE);
--> statement-breakpoint

SELECT add_continuous_aggregate_policy('weighted_hourly_rollups',
  start_offset => INTERVAL '3 hours',
  end_offset   => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour',
  if_not_exists => TRUE);
--> statement-breakpoint

SELECT add_continuous_aggregate_policy('weighted_daily_rollups',
  start_offset => INTERVAL '3 days',
  end_offset   => INTERVAL '1 day',
  schedule_interval => INTERVAL '1 day',
  if_not_exists => TRUE);
--> statement-breakpoint

-- remove+add (rather than add-if-not-exists) so re-running is authoritative
-- when the interval changes on an already-configured deployment;
-- add_compression_policy(if_not_exists) would silently keep the old interval.
SELECT remove_compression_policy('metrics_raw', if_exists => TRUE);
--> statement-breakpoint

SELECT add_compression_policy('metrics_raw', INTERVAL '2 hours', if_not_exists => TRUE);
--> statement-breakpoint

-- Retention (cleanup). Raw was 7 days: "the feasible floor", derived when a day
-- of raw cost 5-9 GB uncompressed and nothing thinned it. Both halves of that
-- premise are gone — compression is measured at 55x (4.1 B/row) and the writer
-- stores changes rather than samples — so 7 days was throwing away
-- second-resolution replay to save single-digit megabytes.
--
-- Re-derived at **90 days**, which is not a compromise between two numbers but
-- the answer to two constraints:
--
--   * It must exceed the widest continuous-aggregate refresh window
--     (daily_rollups start_offset = 3 days), so neither a refresh nor the
--     real-time union ever reaches a chunk retention has dropped. 90d is ample.
--   * It must not EXCEED the shortest aggregate retention (minute_rollups, 90
--     days). Past that, a time range exists that only raw covers — and the
--     addon's default backup excludes raw precisely because raw is fully
--     materialized into the rollups. `dump.sh` now derives that from these two
--     policies rather than assuming it, so raw outliving a rollup makes the
--     default backup include raw instead of silently dropping the range. Keeping
--     the two equal keeps backups small AND lossless.
--
-- Going further (the 4-year raw tier the storage decision sketches) is therefore
-- gated on the minute tier, not on footprint: either minute_rollups' retention
-- grows with it, or minute-resolution reads move to raw and that tier is
-- dropped. Neither is this change.
SELECT remove_retention_policy('metrics_raw', if_exists => TRUE);
--> statement-breakpoint

SELECT add_retention_policy('metrics_raw', INTERVAL '90 days', if_not_exists => TRUE);
--> statement-breakpoint

-- Rollup compression, every tier (#134). Before this, policies.sql armed
-- minute_rollups alone, so hourly_rollups and daily_rollups would never compress
-- no matter what compress_after said — and minute_rollups had no
-- `compress_segmentby`, so even once compressed a per-metric query decompressed
-- batches it did not need. The segmentby lives in the numbered structural files
-- (0002 for the weighted views, 0003 for the legacy three); the intervals live
-- here so they reach existing deployments.
--
-- remove+add rather than add-if-not-exists, matching metrics_raw above: on an
-- already-configured deployment `if_not_exists => TRUE` is a no-op and would
-- silently keep the old interval. The remove is `if_exists`, so re-running the
-- file converges.
--
-- 7 days for the minute and hourly tiers keeps the short-horizon window
-- uncompressed for fast reads; 30 days for the daily tiers, which are tiny and
-- whose buckets keep being touched by the 3-day refresh window for far longer
-- than a minute bucket is.
SELECT remove_compression_policy('minute_rollups', if_exists => TRUE);
--> statement-breakpoint

SELECT add_compression_policy('minute_rollups', INTERVAL '7 days', if_not_exists => TRUE);
--> statement-breakpoint

SELECT remove_compression_policy('hourly_rollups', if_exists => TRUE);
--> statement-breakpoint

SELECT add_compression_policy('hourly_rollups', INTERVAL '7 days', if_not_exists => TRUE);
--> statement-breakpoint

SELECT remove_compression_policy('daily_rollups', if_exists => TRUE);
--> statement-breakpoint

SELECT add_compression_policy('daily_rollups', INTERVAL '30 days', if_not_exists => TRUE);
--> statement-breakpoint

SELECT remove_compression_policy('weighted_minute_rollups', if_exists => TRUE);
--> statement-breakpoint

SELECT add_compression_policy('weighted_minute_rollups', INTERVAL '7 days', if_not_exists => TRUE);
--> statement-breakpoint

SELECT remove_compression_policy('weighted_hourly_rollups', if_exists => TRUE);
--> statement-breakpoint

SELECT add_compression_policy('weighted_hourly_rollups', INTERVAL '7 days', if_not_exists => TRUE);
--> statement-breakpoint

SELECT remove_compression_policy('weighted_daily_rollups', if_exists => TRUE);
--> statement-breakpoint

SELECT add_compression_policy('weighted_daily_rollups', INTERVAL '30 days', if_not_exists => TRUE);
--> statement-breakpoint

-- Tiered rollup retention. Each aggregate is built directly from metrics_raw
-- (not from a coarser rollup), so these policies are independent and drop only
-- their own already-materialized buckets. daily_rollups has no policy — kept
-- forever as the cheap long-horizon record.
--
-- Hourly goes from 730 days to 10 years. It is the tier every long-horizon chart
-- reads, and at ~4.9 kB/metric/year compressed the whole extension costs tens of
-- megabytes per device — the 2-year figure was inherited from a budget written
-- before the compression was measured. Minute stays at 90 days: it is the most
-- expensive tier per day of coverage (15x fewer rows than raw, each ~52x wider),
-- and it is also the ceiling on raw retention above.
-- remove+add, not add-if-not-exists: on an already-configured deployment
-- `if_not_exists => TRUE` is a NO-OP and silently keeps the old interval — the
-- same trap this file documents for the compression policies. Measured: without
-- the remove, an existing database upgraded straight past the hourly change and
-- stayed on 730 days while the file said 3650.
SELECT remove_retention_policy('minute_rollups', if_exists => TRUE);
--> statement-breakpoint

SELECT add_retention_policy('minute_rollups', INTERVAL '90 days', if_not_exists => TRUE);
--> statement-breakpoint

SELECT remove_retention_policy('hourly_rollups', if_exists => TRUE);
--> statement-breakpoint

SELECT add_retention_policy('hourly_rollups', INTERVAL '3650 days', if_not_exists => TRUE);
--> statement-breakpoint

-- The weighted tiers mirror them, so the two sources age out together and the
-- read layer's per-bucket preference never has to reach past the horizon the
-- legacy tier keeps. weighted_daily_rollups, like daily_rollups, is kept forever.
SELECT remove_retention_policy('weighted_minute_rollups', if_exists => TRUE);
--> statement-breakpoint

SELECT add_retention_policy('weighted_minute_rollups', INTERVAL '90 days', if_not_exists => TRUE);
--> statement-breakpoint

SELECT remove_retention_policy('weighted_hourly_rollups', if_exists => TRUE);
--> statement-breakpoint

SELECT add_retention_policy('weighted_hourly_rollups', INTERVAL '3650 days', if_not_exists => TRUE);
