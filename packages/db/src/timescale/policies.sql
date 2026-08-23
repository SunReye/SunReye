-- TimescaleDB policies (refresh, compression, retention) and other tunables.
-- Unlike the numbered structural migrations, this file is re-applied on EVERY
-- migrate run, so editing an interval here updates existing deployments on
-- their next start. Everything in it must therefore stay idempotent — either
-- `if_not_exists => TRUE` or the authoritative remove+add pattern.

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

-- remove+add (rather than add-if-not-exists) so re-running is authoritative
-- when the interval changes on an already-configured deployment;
-- add_compression_policy(if_not_exists) would silently keep the old interval.
SELECT remove_compression_policy('metrics_raw', if_exists => TRUE);
--> statement-breakpoint

SELECT add_compression_policy('metrics_raw', INTERVAL '2 hours', if_not_exists => TRUE);
--> statement-breakpoint

-- Retention (cleanup). Drop raw 1 Hz rows after 7 days — the feasible floor.
-- It must comfortably exceed the widest continuous-aggregate refresh window
-- (daily_rollups start_offset = 3 days) so neither the refresh nor the
-- real-time union ever reaches a chunk retention has dropped; 7d leaves margin.
-- By 7 days rows are compressed (>2h) and fully materialized into every rollup,
-- so nothing that reads the aggregates loses data. 7d = ~1 day uncompressed
-- (chunks are 1 day wide, so the current one is always hot) + ~6 days
-- compressed; long-horizon history lives in the rollups, not here. Shorten
-- further per-inverter as inverters are added.
SELECT remove_retention_policy('metrics_raw', if_exists => TRUE);
--> statement-breakpoint

SELECT add_retention_policy('metrics_raw', INTERVAL '7 days', if_not_exists => TRUE);
--> statement-breakpoint

-- Keep the recent 7 days of minute buckets uncompressed for fast short-horizon
-- reads, compress the rest.
SELECT add_compression_policy('minute_rollups', INTERVAL '7 days', if_not_exists => TRUE);
--> statement-breakpoint

-- Tiered rollup retention. Each aggregate is built directly from metrics_raw
-- (not from a coarser rollup), so these policies are independent and drop only
-- their own already-materialized buckets. daily_rollups has no policy — kept
-- forever as the cheap long-horizon record.
SELECT add_retention_policy('minute_rollups', INTERVAL '90 days', if_not_exists => TRUE);
--> statement-breakpoint

SELECT add_retention_policy('hourly_rollups', INTERVAL '730 days', if_not_exists => TRUE);
