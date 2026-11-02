-- Core settings: one text value per key.
CREATE TABLE setting (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE TABLE connection (
  id INTEGER PRIMARY KEY,
  transport TEXT NOT NULL CHECK (transport IN ('tcp')),
  host TEXT NOT NULL,
  port INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535)
) STRICT;

CREATE TABLE device (
  id INTEGER PRIMARY KEY,
  connection_id INTEGER NOT NULL REFERENCES connection (id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL,
  unit_id INTEGER NOT NULL CHECK (unit_id BETWEEN 0 AND 255)
) STRICT;

-- Metric keys, interned: minute blobs carry these ids (encoding in src/samples.rs).
CREATE TABLE metric (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE
) STRICT;

-- One row per device per minute; `minute` counts from the Unix epoch.
CREATE TABLE reading_minute (
  device_id INTEGER NOT NULL REFERENCES device (id) ON DELETE CASCADE,
  minute INTEGER NOT NULL,
  samples BLOB NOT NULL,
  PRIMARY KEY (device_id, minute)
) STRICT, WITHOUT ROWID;
