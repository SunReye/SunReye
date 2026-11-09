-- Snapshot toggles (ADR 7), owned by the settings module: the value a toggle's target held when it
-- engaged, kept until a release restores it. `device` outlives its device row.
CREATE TABLE snapshot (
  device INTEGER NOT NULL,
  setting TEXT NOT NULL,
  value REAL NOT NULL,
  PRIMARY KEY (device, setting)
) STRICT, WITHOUT ROWID;
