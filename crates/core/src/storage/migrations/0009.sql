-- Viewer accounts (ADR 9), owned by auth: read-only sign-ins the admin creates. `hash` is bcrypt.
CREATE TABLE viewer (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  hash TEXT NOT NULL
) STRICT;
