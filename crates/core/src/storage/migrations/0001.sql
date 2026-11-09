-- Change points (ADR 3). Times are 100 ms ticks since the Unix epoch; values are integer steps.

-- Key-value facts of the store, such as the instant of the last flush.
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value ANY NOT NULL
) STRICT, WITHOUT ROWID;

-- A series is the interned pair of role and index, named like `pv.mppt.power[2]`.
CREATE TABLE series (
  name TEXT PRIMARY KEY,
  id INTEGER NOT NULL
) STRICT, WITHOUT ROWID;

-- The quantisation step a device's series is stored in, in the role's unit.
CREATE TABLE step (
  device INTEGER NOT NULL,
  series INTEGER NOT NULL,
  step REAL NOT NULL,
  PRIMARY KEY (device, series)
) STRICT, WITHOUT ROWID;

-- Change points of hours not yet packed; a NULL value is a gap.
CREATE TABLE hot (
  device INTEGER NOT NULL,
  series INTEGER NOT NULL,
  time INTEGER NOT NULL,
  value INTEGER,
  PRIMARY KEY (device, series, time)
) STRICT, WITHOUT ROWID;

-- One closed UTC hour of one series, in the block format; `hour` counts hours since the epoch.
CREATE TABLE block (
  device INTEGER NOT NULL,
  series INTEGER NOT NULL,
  hour INTEGER NOT NULL,
  data BLOB NOT NULL,
  PRIMARY KEY (device, series, hour)
) STRICT, WITHOUT ROWID;
