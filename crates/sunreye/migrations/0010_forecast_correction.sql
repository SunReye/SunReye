-- The learned forecast correction (3.x `forecast_correction_cells` / `_state`): one grid of (month, hour) cells
-- per inverter, and its learn state.
CREATE TABLE forecast_correction_cell (
  device_id INTEGER NOT NULL REFERENCES device (id) ON DELETE CASCADE,
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  hour INTEGER NOT NULL CHECK (hour BETWEEN 0 AND 23),
  ratio REAL NOT NULL,
  weight REAL NOT NULL CHECK (weight >= 0),
  PRIMARY KEY (device_id, month, hour)
) STRICT, WITHOUT ROWID;

-- `learned_through` is the last plant-local day folded in, `YYYY-MM-DD`.
CREATE TABLE forecast_correction_state (
  device_id INTEGER PRIMARY KEY REFERENCES device (id) ON DELETE CASCADE,
  learned_through TEXT NOT NULL,
  mae_raw REAL NOT NULL,
  mae_corrected REAL NOT NULL,
  samples REAL NOT NULL
) STRICT;
