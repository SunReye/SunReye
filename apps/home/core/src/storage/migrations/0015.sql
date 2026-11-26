-- Profile updates (ADR 8), owned by the profiles module.

-- A verified newer copy of a served profile, waiting for the admin to apply it.
CREATE TABLE profile_update (
  id TEXT PRIMARY KEY,
  document BLOB NOT NULL,
  signature BLOB
) STRICT;

-- Settings an applied update added or changed: verified or not, each needs the admin's enable.
CREATE TABLE profile_setting_changed (
  profile TEXT NOT NULL,
  setting TEXT NOT NULL,
  PRIMARY KEY (profile, setting)
) STRICT, WITHOUT ROWID;
