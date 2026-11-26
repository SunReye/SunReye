-- The write log (ADR 7), owned by the settings module: every write attempt that reached a device,
-- kept long and never rolled up. `time` is Unix seconds; `device` outlives its device row.
CREATE TABLE write_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  time INTEGER NOT NULL,
  device INTEGER NOT NULL,
  setting TEXT NOT NULL,
  before REAL,
  requested REAL NOT NULL,
  after REAL,
  outcome TEXT NOT NULL,
  failed_step INTEGER,
  actor TEXT NOT NULL
) STRICT;

-- The minimum interval looks up a setting's last write.
CREATE INDEX write_log_setting ON write_log (device, setting, time);
