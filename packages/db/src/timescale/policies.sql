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

-- FROZEN: minute_rollups and weighted_minute_rollups are no longer refreshed.
--
-- Once a raw row became an interval rather than a sample (#117), the minute tier
-- stopped paying for itself. Measured on 30 days of change-only traffic at the
-- authored deadbands, compressed, one device: metrics_raw costs 361 MB/year
-- against 174 + 159 MB for the minute pair — the tier that existed because it
-- was ~15x cheaper per day of coverage than raw now costs about the same as raw,
-- and it was ALSO the ceiling on raw retention, since raw may not outlive the
-- shortest aggregate (see the retention section below).
--
-- Frozen rather than dropped, deliberately. A drop would take every minute
-- bucket with it, and on a deployment whose raw is still at an older, shorter
-- retention those buckets are the only minute-resolution record of the days raw
-- no longer covers — hourly would be all that survived. Freezing loses nothing:
-- each materialized bucket keeps answering reads until its own retention policy
-- ages it out, and the read layer prefers raw wherever raw reaches
-- (apps/server/src/shared/rollup-sql.ts).
--
-- `remove_`, not merely "stop adding". Omitting the `add_` is enough for a fresh
-- install and does NOTHING to a deployment that already has the policy — the
-- same trap `if_not_exists => TRUE` sets for the compression and retention
-- policies below, and the reason this file is re-applied on every start.
SELECT remove_continuous_aggregate_policy('minute_rollups', if_not_exists => TRUE);
--> statement-breakpoint

SELECT remove_continuous_aggregate_policy('weighted_minute_rollups', if_not_exists => TRUE);
--> statement-breakpoint

-- Keep the remaining rollups current in the background.
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
-- be materialized as far back as metrics_raw reaches, so a bucket older than
-- that exists only in the legacy view and the read layer must be able to serve
-- it. A period of double materialization is correct, cheap and reversible; the
-- read layer prefers the weighted row per bucket
-- (apps/server/src/shared/rollup-sql.ts). The minute pair is exempt — frozen
-- above, and answered from raw.
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
-- Re-derived at **1825 days (5 years)**, now that the second of the two
-- constraints that pinned it to 90 has been removed:
--
--   * It must exceed the widest continuous-aggregate refresh window
--     (daily_rollups start_offset = 3 days), so neither a refresh nor the
--     real-time union ever reaches a chunk retention has dropped. Unchanged, and
--     1825d is ample.
--   * It must not EXCEED the shortest retention among the aggregates raw is
--     materialized into. That used to be minute_rollups at 90 days, which is
--     exactly what the previous revision of this comment called the gate on
--     going further: "either minute_rollups' retention grows with it, or
--     minute-resolution reads move to raw and that tier is dropped". The second
--     of those is what happened — the minute pair is frozen above and raw
--     answers minute reads — so the binding tier is now hourly_rollups at 3650
--     days, and 1825 sits comfortably inside it.
--
-- Cost, measured (30 days of change-only traffic at the authored deadbands,
-- compressed, one device): 361 MB/device-year, so 1.8 GB per device over the
-- five years, against the 5 GB/device/10-year budget. That figure assumes the
-- deadbands are actually authored in the installed profile — without them raw
-- runs ~5.5x heavier and five years does NOT fit the budget.
--
-- What this DOES change is the backup default. Raw was excludable because it was
-- fully materialized into the rollups; with the minute tier frozen, raw is the
-- only minute-resolution record and excluding it would silently restore an
-- hourly-only history. `dump.sh` derives that too — see safe_to_exclude_raw.
SELECT remove_retention_policy('metrics_raw', if_exists => TRUE);
--> statement-breakpoint

SELECT add_retention_policy('metrics_raw', INTERVAL '1825 days', if_not_exists => TRUE);
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
-- before the compression was measured.
--
-- Minute stays at 90 days, but the number now means the opposite of what it did:
-- these two aggregates are frozen (see the top of this file), so their retention
-- is not a coverage horizon, it is how long the last materialized buckets take
-- to decay. Raw covers the tier from here on. Shortening it is safe; lengthening
-- it only delays the decay.
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
