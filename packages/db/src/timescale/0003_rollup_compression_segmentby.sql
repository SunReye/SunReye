-- #134: give the three legacy rollups the compression design metrics_raw
-- already has — in place, without recreating or decompressing anything.
--
-- MEASURED PROBLEM
--
--   _materialized_hypertable_2  (minute_rollups)  compress = true, segmentby NONE
--   _materialized_hypertable_3  (hourly_rollups)  no compression settings at all
--   _materialized_hypertable_4  (daily_rollups)   no compression settings at all
--   metrics_raw                                   segmentby = inverter_id, metric
--
-- Rollup rows are materialized grouped by *bucket* — every metric for a bucket
-- lands together — so a per-metric range scan over an uncompressed rollup
-- touches essentially every page in the range. Measured on the dev instance: 126
-- rows in 126 heap blocks, one row per 8 KB page, against ~143 rows per block in
-- compressed metrics_raw. A 1-year single-metric hourly chart (8,760 rows) reads
-- ~68 MB to return ~200 KB.
--
-- WHY THIS IS SAFE WITHOUT A RECREATE
--
-- Nothing here is a continuous-aggregate definition change, so 0000_bootstrap's
-- never-DROP rule is not engaged: no `DROP MATERIALIZED VIEW`, no re-materializing
-- from a metrics_raw that only reaches back 7 days, and every already-materialized
-- bucket keeps its exact value. Only the *storage* of those buckets changes.
--
--   * hourly_rollups / daily_rollups have no compression configuration at all,
--     so setting one is purely additive.
--   * minute_rollups has compression enabled with no segmentby. Verified on
--     TimescaleDB 2.28.2-pg17: changing `compress_segmentby` succeeds whether or
--     not compressed chunks exist — it does NOT error and does NOT require a
--     decompression. What it does instead is quieter and worse:
--
--       NOTICE: updated compression settings will only apply to future compressions
--       DETAIL: Existing compressed chunks will not be recompressed.
--
--     so on a deployment old enough to have compressed minute buckets the fix
--     would silently miss exactly the data it was written for. The recompress
--     below closes that. `compress_chunk(…, recompress => true)` rewrites the
--     chunk through the *new* settings (verified: the compressed chunks move to a
--     fresh internal compressed hypertable whose `metric`/`inverter_id` are plain
--     segmentby columns), and it rewrites unconditionally, so re-running this
--     file after a partial failure is safe. Measured cost: 3 chunks / 86k
--     materialized rows in 57 ms; a 90-day minute tier at ~100 metrics
--     extrapolates to single-digit seconds, once, at one server start.
--
--     It is deliberately filtered to `is_compressed` chunks. `compress_chunk` on
--     an *un*compressed chunk would compress it, which is the compression
--     policy's decision to make, not a structural migration's.
--
-- Statements run outside a transaction and must each stay idempotent.

-- Purely additive: these two have never had compression settings.
ALTER MATERIALIZED VIEW hourly_rollups SET (
  timescaledb.compress = true,
  timescaledb.compress_segmentby = 'metric, inverter_id'
);
--> statement-breakpoint

ALTER MATERIALIZED VIEW daily_rollups SET (
  timescaledb.compress = true,
  timescaledb.compress_segmentby = 'metric, inverter_id'
);
--> statement-breakpoint

-- Compression was already enabled here; only the segmentby is new.
ALTER MATERIALIZED VIEW minute_rollups SET (
  timescaledb.compress = true,
  timescaledb.compress_segmentby = 'metric, inverter_id'
);
--> statement-breakpoint

-- Rewrite the chunks that were already compressed under the old, segmentby-less
-- settings. On a fresh database this matches nothing and is a no-op.
DO $$
DECLARE
  chunk regclass;
BEGIN
  FOR chunk IN
    SELECT format('%I.%I', c.chunk_schema, c.chunk_name)::regclass
    FROM timescaledb_information.chunks c
    JOIN timescaledb_information.continuous_aggregates a
      ON a.materialization_hypertable_name = c.hypertable_name
     AND a.materialization_hypertable_schema = c.hypertable_schema
    WHERE c.is_compressed
      AND a.view_name IN ('minute_rollups', 'hourly_rollups', 'daily_rollups')
  LOOP
    PERFORM compress_chunk(chunk, recompress => true);
  END LOOP;
END $$;
