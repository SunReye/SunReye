-- The correction learned per MPPT input (ADR 17), owned by the correction module: one cell per
-- plant-local month and hour of an inverter's input.
CREATE TABLE correction_cell (
  device INTEGER NOT NULL,
  input INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  hour INTEGER NOT NULL CHECK (hour BETWEEN 0 AND 23),
  ratio REAL NOT NULL,
  weight REAL NOT NULL CHECK (weight >= 0),
  PRIMARY KEY (device, input, month, hour)
) STRICT, WITHOUT ROWID;

-- The last UTC day learned, `YYYY-MM-DD`: one row once a day is.
CREATE TABLE correction_state (
  id INTEGER PRIMARY KEY CHECK (id = 0),
  learned_through TEXT NOT NULL
) STRICT;
