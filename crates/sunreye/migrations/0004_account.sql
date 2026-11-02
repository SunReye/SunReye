-- Who signs in to the core. `password_hash` is an Argon2id PHC string; sessions live in `tower_sessions`,
-- which tower-sessions-sqlx-store creates itself.
CREATE TABLE account (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  admin INTEGER NOT NULL CHECK (admin IN (0, 1))
) STRICT;
