-- The forecast correction learned per MPPT string: one grid of (month, hour) cells per inverter string, the
-- `index` of its `pv.string.*` metrics. Shares the inverter's learn state.
CREATE TABLE forecast_correction_string_cell (
  device_id INTEGER NOT NULL REFERENCES device (id) ON DELETE CASCADE,
  mppt INTEGER NOT NULL CHECK (mppt >= 0),
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  hour INTEGER NOT NULL CHECK (hour BETWEEN 0 AND 23),
  ratio REAL NOT NULL,
  weight REAL NOT NULL CHECK (weight >= 0),
  PRIMARY KEY (device_id, mppt, month, hour)
) STRICT, WITHOUT ROWID;
