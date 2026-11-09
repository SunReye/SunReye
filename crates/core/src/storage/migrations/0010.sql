-- Bearer tokens (ADR 9), owned by auth. A token is shown once; only its SHA-256 is kept.
CREATE TABLE token (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('read', 'admin')),
  hash TEXT NOT NULL UNIQUE
) STRICT;
