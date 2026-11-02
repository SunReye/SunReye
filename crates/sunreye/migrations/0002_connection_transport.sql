-- connection.transport also accepts rtu_over_tcp. SQLite cannot alter a CHECK, so the table is rebuilt.
-- Store::open runs migrations with foreign keys off: dropping the old table with them on would cascade
-- into device and, through it, reading_minute.
CREATE TABLE connection_new (
  id INTEGER PRIMARY KEY,
  transport TEXT NOT NULL CHECK (transport IN ('tcp', 'rtu_over_tcp')),
  host TEXT NOT NULL,
  port INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535)
) STRICT;

INSERT INTO connection_new (id, transport, host, port) SELECT id, transport, host, port FROM connection;

DROP TABLE connection;

ALTER TABLE connection_new RENAME TO connection;
