-- The PV layout (ADR 17), owned by the layout module. Ids are AUTOINCREMENT so a deleted id is
-- never reused: `pv.string.power` history and forecasts are indexed by string id.
CREATE TABLE module_type (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  pmax REAL NOT NULL,
  vmp REAL NOT NULL,
  imp REAL NOT NULL,
  voc REAL NOT NULL,
  isc REAL NOT NULL,
  power_coefficient REAL NOT NULL,
  voltage_coefficient REAL NOT NULL,
  current_coefficient REAL NOT NULL,
  width REAL NOT NULL,
  height REAL NOT NULL,
  bypass_diodes INTEGER NOT NULL
) STRICT;

-- Every string id ever issued.
CREATE TABLE pv_string (id INTEGER PRIMARY KEY AUTOINCREMENT) STRICT;

-- Each layout change, appended (ADR 19): who, when, and the instant it applies from, in Unix
-- seconds. The version in force at an instant is the latest applying by then, ties to the later.
CREATE TABLE layout (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  applies_from INTEGER NOT NULL,
  changed INTEGER NOT NULL,
  actor TEXT NOT NULL
) STRICT;

-- A version's strings, entered by form: one plane, and a count of optimized modules (ADR 17).
CREATE TABLE layout_string (
  layout INTEGER NOT NULL REFERENCES layout (id),
  string INTEGER NOT NULL REFERENCES pv_string (id),
  name TEXT NOT NULL,
  module_type INTEGER NOT NULL REFERENCES module_type (id),
  device INTEGER NOT NULL,
  input INTEGER NOT NULL,
  modules INTEGER NOT NULL,
  optimized INTEGER NOT NULL,
  tilt REAL NOT NULL,
  azimuth REAL NOT NULL,
  loss REAL NOT NULL,
  PRIMARY KEY (layout, string)
) STRICT, WITHOUT ROWID;
