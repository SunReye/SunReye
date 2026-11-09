-- Deadband overrides (ADR 4), owned by the devices module: the admin's, per device and role, in the
-- role's unit; the change log records each change.
CREATE TABLE deadband_override (
  device INTEGER NOT NULL,
  role TEXT NOT NULL,
  deadband REAL NOT NULL,
  PRIMARY KEY (device, role)
) STRICT, WITHOUT ROWID;
