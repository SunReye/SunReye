-- A device leaves service by `retired_at` and keeps its history: readings and rollups refuse the delete of
-- their device instead of cascading into it, and a device refuses the delete of its connection. SQLite
-- cannot alter a foreign key, so the three tables are rebuilt. Store::open runs migrations with foreign
-- keys off: dropping a parent with them on would cascade into its children.
-- A device without a `name` is shown by its profile's name. `retired_at` is UTC ISO 8601 with milliseconds.
CREATE TABLE device_new (
  id INTEGER PRIMARY KEY,
  connection_id INTEGER NOT NULL REFERENCES connection (id) ON DELETE RESTRICT,
  profile_id TEXT NOT NULL,
  unit_id INTEGER NOT NULL CHECK (unit_id BETWEEN 0 AND 255),
  name TEXT,
  role TEXT NOT NULL DEFAULT 'inverter' CHECK (role IN ('inverter', 'meter', 'charger', 'controller')),
  retired_at TEXT
) STRICT;

INSERT INTO device_new (id, connection_id, profile_id, unit_id)
SELECT id, connection_id, profile_id, unit_id FROM device;

DROP TABLE device;

ALTER TABLE device_new RENAME TO device;

CREATE TABLE reading_minute_new (
  device_id INTEGER NOT NULL REFERENCES device (id) ON DELETE RESTRICT,
  minute INTEGER NOT NULL,
  samples BLOB NOT NULL,
  PRIMARY KEY (device_id, minute)
) STRICT, WITHOUT ROWID;

INSERT INTO reading_minute_new (device_id, minute, samples) SELECT device_id, minute, samples FROM reading_minute;

DROP TABLE reading_minute;

ALTER TABLE reading_minute_new RENAME TO reading_minute;

CREATE TABLE rollup_new (
  tier INTEGER NOT NULL CHECK (tier IN (0, 1, 2)),
  start_us INTEGER NOT NULL,
  device_id INTEGER NOT NULL REFERENCES device (id) ON DELETE RESTRICT,
  metric_id INTEGER NOT NULL REFERENCES metric (id),
  avg REAL NOT NULL,
  max REAL NOT NULL,
  min REAL NOT NULL,
  first_us INTEGER NOT NULL,
  first REAL NOT NULL,
  last_us INTEGER NOT NULL,
  last REAL NOT NULL,
  weighted REAL NOT NULL,
  PRIMARY KEY (device_id, metric_id, tier, start_us)
) STRICT, WITHOUT ROWID;

INSERT INTO rollup_new (tier, start_us, device_id, metric_id, avg, max, min, first_us, first, last_us, last, weighted)
SELECT tier, start_us, device_id, metric_id, avg, max, min, first_us, first, last_us, last, weighted FROM rollup;

DROP TABLE rollup;

ALTER TABLE rollup_new RENAME TO rollup;

ALTER TABLE connection ADD COLUMN name TEXT NOT NULL DEFAULT 'Inverter';
