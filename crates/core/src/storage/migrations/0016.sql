-- The tariff (ADR 12), owned by the tariff module. Prices are EUR/kWh and signed. Each version and
-- the instant it applies from, in Unix seconds; the change log records who made it and when. The
-- version in force at an instant is the latest applying by then, ties to the later.
CREATE TABLE tariff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  applies_from INTEGER NOT NULL,
  import_price REAL NOT NULL,
  export_price REAL NOT NULL
) STRICT;

-- A version's time-of-use bands for one flow, in the admin's order. `days` holds a bit per ISO
-- weekday, Monday the lowest; `start` and `end` are minutes of the plant-local wall-clock day.
-- Bands of one flow never overlap.
CREATE TABLE tariff_band (
  tariff INTEGER NOT NULL REFERENCES tariff (id),
  flow TEXT NOT NULL CHECK (flow IN ('import', 'export')),
  position INTEGER NOT NULL,
  days INTEGER NOT NULL CHECK (days BETWEEN 1 AND 127),
  start INTEGER NOT NULL CHECK (start >= 0),
  end INTEGER NOT NULL CHECK (end > start AND end <= 1440),
  price REAL NOT NULL,
  PRIMARY KEY (tariff, flow, position)
) STRICT, WITHOUT ROWID;
