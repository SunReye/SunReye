-- The core's identity (ADR 16), owned by the identity module: one row, created at first run. The
-- static key is the private half of the core's X25519 Noise key; it never leaves this table but in
-- a backup.
CREATE TABLE identity (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  install TEXT NOT NULL,
  static_key BLOB NOT NULL CHECK (length(static_key) = 32)
) STRICT;

-- The accounts the core trusts (ADR 16), owned by the identity module: each an Ed25519 public key
-- with its role. A revoked key stays, so a replayed grant cannot bring it back.
CREATE TABLE trusted_key (
  key BLOB PRIMARY KEY CHECK (length(key) = 32),
  role TEXT NOT NULL CHECK (role IN ('admin', 'viewer')),
  revoked INTEGER NOT NULL DEFAULT 0 CHECK (revoked IN (0, 1))
) STRICT, WITHOUT ROWID;
