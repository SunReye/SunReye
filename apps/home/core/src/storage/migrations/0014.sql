-- Per-setting write enables (ADR 8), owned by the settings module: the admin enabled `setting` of
-- `device` as declared with `fingerprint`. A changed declaration no longer matches, so it is off
-- again. `device` outlives its device row.
CREATE TABLE setting_enable (
  device INTEGER NOT NULL,
  setting TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  PRIMARY KEY (device, setting)
) STRICT, WITHOUT ROWID;
