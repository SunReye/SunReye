-- Rollups (ADR 3), in the series' steps and 100 ms ticks. A measurement fills duration, sum
-- (Σ value·duration), min and max; a counter fills first, last and delta (its rises, resets
-- excluded).

-- One UTC hour; `hour` counts hours since the epoch.
CREATE TABLE rollup_hour (
  device INTEGER NOT NULL,
  series INTEGER NOT NULL,
  hour INTEGER NOT NULL,
  duration INTEGER,
  sum INTEGER,
  min INTEGER,
  max INTEGER,
  first INTEGER,
  last INTEGER,
  delta INTEGER,
  PRIMARY KEY (device, series, hour)
) STRICT, WITHOUT ROWID;

-- One plant-local day, keyed by its date as YYYYMMDD and cut in `zone`, from `start` to `end`.
CREATE TABLE rollup_day (
  device INTEGER NOT NULL,
  series INTEGER NOT NULL,
  day INTEGER NOT NULL,
  zone TEXT NOT NULL,
  start INTEGER NOT NULL,
  end INTEGER NOT NULL,
  duration INTEGER,
  sum INTEGER,
  min INTEGER,
  max INTEGER,
  first INTEGER,
  last INTEGER,
  delta INTEGER,
  PRIMARY KEY (device, series, day)
) STRICT, WITHOUT ROWID;
