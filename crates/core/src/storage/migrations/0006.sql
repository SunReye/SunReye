-- Connections and devices (ADR 6), owned by the devices module. Ids are AUTOINCREMENT so a removed
-- id is never reused: history is keyed by device id.
CREATE TABLE connection (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  -- `modbus-tcp`; a later transport adds its own nullable columns.
  transport TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535)
) STRICT;

-- A connection's credentials by name, such as an unlock code a recipe names (ADR 7). The API
-- reports only which are set.
CREATE TABLE secret (
  connection INTEGER NOT NULL REFERENCES connection (id),
  name TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (connection, name)
) STRICT, WITHOUT ROWID;

-- A device behind a connection, read through a profile by id. `unit` is its device address, the
-- Modbus unit id; nullable for a later binding addressed otherwise.
CREATE TABLE device (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  connection INTEGER NOT NULL REFERENCES connection (id),
  profile TEXT NOT NULL,
  unit INTEGER CHECK (unit BETWEEN 0 AND 255)
) STRICT;

-- The change log (ADR 19), owned by the change-log module: each configuration change, appended.
-- Instants are Unix seconds. `state` is the subject's state after the change as the API reads it,
-- so it never holds a secret; NULL after a removal.
CREATE TABLE change (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  changed INTEGER NOT NULL,
  applies_from INTEGER NOT NULL,
  actor TEXT NOT NULL,
  subject TEXT NOT NULL,
  subject_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  state TEXT
) STRICT;
