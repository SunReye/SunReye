-- Retune the metrics_raw compression policy: compress_after 1 day -> 2 hours.
--
-- At 1 Hz the uncompressed hot window is the largest storage line item:
-- compression is ~55x on this data (226.6 B/row raw vs 4.1 B/row compressed),
-- so `compress_after => 1 day` left roughly two full days uncompressed — 1011
-- of 1232 MB measured — and an uncompressed chunk carries ~412 MB of index
-- against 32-280 kB compressed. Chunks are 1 day wide (see 0000_bootstrap.sql),
-- so a chunk still only compresses once its whole range is 2 h old; this halves
-- the uncompressed set rather than shrinking it to two hours.
--
-- A compression policy is not a continuous aggregate, so the never-drop rule in
-- 0000_bootstrap.sql's header is not engaged here: nothing is materialized and
-- no history can be lost. Recorded as a numbered file so the retune has a point
-- in history; policies.sql keeps it authoritative on every later start.
--
-- remove+add, not add-if-not-exists: on an already-configured deployment
-- add_compression_policy(if_not_exists => TRUE) is a no-op and would silently
-- keep the old 1-day interval. The remove is `if_exists` so the file is
-- idempotent — it runs outside a transaction and may re-run after a partial
-- failure.
SELECT remove_compression_policy('metrics_raw', if_exists => TRUE);
--> statement-breakpoint

SELECT add_compression_policy('metrics_raw', INTERVAL '2 hours', if_not_exists => TRUE);
