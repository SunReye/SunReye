-- The admin's password (ADR 9), owned by auth. At most one row.
CREATE TABLE admin (
  id INTEGER PRIMARY KEY CHECK (id = 0),
  hash TEXT NOT NULL
) STRICT, WITHOUT ROWID;
