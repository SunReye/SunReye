-- Forecasts (ADR 15): a value issued at one time about a later target time, both 100 ms ticks.
CREATE TABLE forecast (
  device INTEGER NOT NULL,
  series INTEGER NOT NULL,
  target INTEGER NOT NULL,
  issued INTEGER NOT NULL,
  value INTEGER NOT NULL,
  PRIMARY KEY (device, series, target, issued)
) STRICT, WITHOUT ROWID;

-- The plant's location in degrees, entered at first-run setup (ADR 17); at most one row.
CREATE TABLE location (
  id INTEGER PRIMARY KEY CHECK (id = 0),
  latitude REAL NOT NULL,
  longitude REAL NOT NULL
) STRICT, WITHOUT ROWID;
