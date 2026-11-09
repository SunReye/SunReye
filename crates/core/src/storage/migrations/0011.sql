-- Profile distribution (ADR 8), owned by the profiles module.

-- The indexes an admin added; the official one is built in.
CREATE TABLE profile_index (
  id INTEGER PRIMARY KEY,
  url TEXT NOT NULL UNIQUE
) STRICT;

-- The last good copy of each fetched profile: its exact bytes, and its signature when signed.
CREATE TABLE fetched_profile (
  id TEXT PRIMARY KEY,
  document BLOB NOT NULL,
  signature BLOB
) STRICT;

-- One row once a revocation of the active profile key, signed by the backup, has been seen.
CREATE TABLE profile_key_revoked (
  id INTEGER PRIMARY KEY CHECK (id = 0)
) STRICT;
