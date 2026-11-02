-- Rollup buckets (ADR 0004), one row per tier, bucket, device and metric; `tier` is 0 minute, 1 hour, 2 day.
-- Times are UTC microseconds since the Unix epoch. `first_us`, `first`, `last_us`, `last` and `weighted` are
-- the bucket's partial (src/rollup.rs): `last` carries into the next bucket and a day folds from its hours.
-- The key leads with device and metric: every read and delete is one metric's range of one tier.
CREATE TABLE rollup (
  tier INTEGER NOT NULL CHECK (tier IN (0, 1, 2)),
  start_us INTEGER NOT NULL,
  device_id INTEGER NOT NULL REFERENCES device (id) ON DELETE CASCADE,
  metric_id INTEGER NOT NULL REFERENCES metric (id),
  avg REAL NOT NULL,
  max REAL NOT NULL,
  min REAL NOT NULL,
  first_us INTEGER NOT NULL,
  first REAL NOT NULL,
  last_us INTEGER NOT NULL,
  last REAL NOT NULL,
  weighted REAL NOT NULL,
  PRIMARY KEY (device_id, metric_id, tier, start_us)
) STRICT, WITHOUT ROWID;
