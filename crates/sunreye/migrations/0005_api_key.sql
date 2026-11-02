-- Credentials for `/api/v1`, issued by an admin to an account. Only the SHA-256 of a key is stored; `start`
-- is its non-secret head, shown so keys can be told apart. Times are UTC ISO 8601 with milliseconds.
CREATE TABLE api_key (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES account (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  start TEXT NOT NULL,
  key_hash BLOB NOT NULL UNIQUE,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX api_key_account ON api_key (account_id);
