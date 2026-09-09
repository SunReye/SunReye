-- TimescaleDB policies (refresh, compression, retention) and other tunables.
-- Unlike the numbered structural migrations, this file is re-applied on EVERY
-- migrate run, so editing an interval here updates existing deployments on
-- their next start. Everything in it must therefore stay idempotent — either
-- `if_not_exists => TRUE` or the authoritative remove+add pattern.
--
-- This file runs AFTER the numbered structural files in the same migrate
-- invocation (src/migrate.ts), and depends on that order: a compression policy
-- on an aggregate whose columnstore is not enabled raises ("columnstore not
-- enabled on continuous aggregate"). Do not run this file on its own against a
-- database 0000_baseline.sql has not reached.
--
-- ONE GENERATION. 1.x carried six aggregates (three unweighted, three
-- dur_ms-weighted) and this file had to keep both families refreshed forever,
-- because an aggregate's SELECT list cannot be corrected in place. 2.0.0's
-- baseline replaced them with three that are right from birth, so every policy
-- below names a tier exactly once and there is no per-bucket source preference
-- for the read layer to arbitrate.

-- create_hypertable only sets chunk_time_interval for a *new* hypertable; make
-- it authoritative for existing deployments too (affects future chunks only —
-- any pre-existing wide chunk ages out via the retention policy below).
SELECT set_chunk_time_interval('metrics_raw', INTERVAL '1 day');
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- REFRESH. The offsets are a CHAIN, not three independent tunings.
--
-- daily_rollups is materialized from hourly_rollups (a hierarchical continuous
-- aggregate), so a daily bucket must never be built from an hourly bucket the
-- hourly policy has not finished. The daily policy's `end_offset` (1 day) is
-- therefore an order of magnitude past the hourly policy's (1 hour), and the two
-- may not be tuned separately: shrinking daily's end_offset below hourly's would
-- silently materialize partial days that no later refresh is guaranteed to
-- correct. minute_rollups feeds nothing and is free of the constraint.
--
-- THE MINUTE TIER IS REFRESHED AGAIN, and that reverses a 1.x decision, so here
-- is the reasoning rather than a silent change. 1.x FROZE the minute pair
-- (`remove_continuous_aggregate_policy`) after measuring, on 30 days of
-- change-only traffic at the authored deadbands, compressed, one device:
-- metrics_raw 361 MB/device-year against 174 + 159 MB for the two minute
-- aggregates — a tier that had existed because it was ~15x cheaper per day of
-- coverage than raw, costing about the same as raw, while ALSO capping raw's
-- retention. Raw answered minute reads instead.
--
-- Two of the three premises are gone. There is now ONE minute aggregate, not
-- two, and its row is a 49 B TimeWeightSummary plus two doubles rather than six
-- doubles — so the comparison is against roughly a quarter of that 333 MB, not
-- against all of it. And raw is now kept 1825 days, so "raw answers minute
-- reads" means every short-horizon chart scans a five-year hypertable. The tier
-- is cheap again and it is now the thing that keeps a six-hour chart off raw.
--
-- That is a re-derivation from measured components, not a fresh measurement of
-- the new shape — the honest status is "expected to be ~85 MB/device-year, to be
-- confirmed on the first month of 2.0.0 traffic". If it disappoints, freezing it
-- again is an edit to THIS file, which reaches every deployment on the next
-- start, and the retention below already means the tier decays rather than
-- holding a record nothing else has.
-- ---------------------------------------------------------------------------

SELECT add_continuous_aggregate_policy('minute_rollups',
  start_offset => INTERVAL '3 hours',
  end_offset   => INTERVAL '1 minute',
  schedule_interval => INTERVAL '5 minutes',
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

-- remove+add (rather than add-if-not-exists) so re-running is authoritative
-- when the interval changes on an already-configured deployment;
-- add_compression_policy(if_not_exists) would silently keep the old interval.
SELECT remove_compression_policy('metrics_raw', if_exists => TRUE);
--> statement-breakpoint

SELECT add_compression_policy('metrics_raw', INTERVAL '2 hours', if_not_exists => TRUE);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- RETENTION.
--
-- Raw at **1825 days (5 years)**. The two constraints it is derived from:
--
--   * It must exceed the widest refresh window that reaches into it
--     (daily_rollups' 3-day start_offset, via hourly), or a refresh reaches for a
--     chunk retention has dropped. 1825 is ample.
--   * It is no longer capped by the shortest aggregate retention. That cap
--     existed because raw was fully materialized into the rollups, which made
--     raw excludable from a backup; with the minute tier now DELIBERATELY
--     shorter than raw (below), raw is the only second-resolution record past 90
--     days and the backup must include it. `dump.sh` derives exactly that from
--     the live policies rather than from an assumption — see
--     `safe_to_exclude_raw`, which compares the retentions AND asks whether the
--     minute tier is refreshed at all.
--
-- Cost, measured (30 days of change-only traffic at the authored deadbands,
-- compressed, one device): 361 MB/device-year, so 1.8 GB per device over the
-- five years, against the 5 GB/device/10-year budget. That figure assumes the
-- deadbands are actually authored in the installed profile — without them raw
-- runs ~5.5x heavier and five years does NOT fit the budget.
--
-- The tiers: minute 90 days, hourly 10 years, daily FOREVER.
--
-- Minute is a RESOLUTION window, not a coverage horizon: past 90 days a
-- minute-resolution read goes to raw (which reaches 5 years) and a longer-horizon
-- read goes to hourly (10 years). Deliberately shorter than raw, which is why
-- scripts/storage-tuning.ts lists it as a tier raw is allowed to outlive instead
-- of failing the coverage check.
--
-- Hourly at 3650 days is what every long-horizon chart reads, and at ~4.9
-- kB/metric/year compressed the whole extension costs tens of megabytes per
-- device.
--
-- remove+add, not add-if-not-exists: on an already-configured deployment
-- `if_not_exists => TRUE` is a NO-OP and silently keeps the old interval.
-- Measured on an upgraded 1.x database: without the remove, an instance that
-- upgraded straight past the hourly change stayed on 730 days while this file
-- said 3650.
-- ---------------------------------------------------------------------------

SELECT remove_retention_policy('metrics_raw', if_exists => TRUE);
--> statement-breakpoint

SELECT add_retention_policy('metrics_raw', INTERVAL '1825 days', if_not_exists => TRUE);
--> statement-breakpoint

SELECT remove_retention_policy('minute_rollups', if_exists => TRUE);
--> statement-breakpoint

SELECT add_retention_policy('minute_rollups', INTERVAL '90 days', if_not_exists => TRUE);
--> statement-breakpoint

SELECT remove_retention_policy('hourly_rollups', if_exists => TRUE);
--> statement-breakpoint

SELECT add_retention_policy('hourly_rollups', INTERVAL '3650 days', if_not_exists => TRUE);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- ROLLUP COMPRESSION INTERVALS.
--
-- The segmentby lives in 0000_baseline.sql (it is structure); the intervals live
-- here so a retune reaches existing deployments. Both halves are needed and
-- neither is any use alone — a segmentby with no policy never compresses, and a
-- policy with no segmentby compresses into a shape a per-metric scan cannot use.
-- That is exactly how the 1.x defect survived: minute_rollups had the policy,
-- hourly and daily had neither.
--
-- 7 days for minute and hourly keeps the short-horizon window uncompressed for
-- fast reads; 30 days for daily, whose buckets keep being touched by the 3-day
-- refresh window for far longer than a minute bucket is.
-- ---------------------------------------------------------------------------

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
