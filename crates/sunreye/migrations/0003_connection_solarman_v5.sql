-- connection.transport also accepts solarman_v5, and the connection gains the logger serial its frames
-- carry. SQLite cannot alter a CHECK, so the table is rebuilt. Store::open runs migrations with foreign
-- keys off: dropping the old table with them on would cascade into device and reading_minute.
-- The serial is optional: the stick names it in the reply to a probe. Only solarman_v5 has one.
CREATE TABLE connection_new (
  id INTEGER PRIMARY KEY,
  transport TEXT NOT NULL CHECK (transport IN ('tcp', 'rtu_over_tcp', 'solarman_v5')),
  host TEXT NOT NULL,
  port INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535),
  logger_serial INTEGER CHECK (logger_serial BETWEEN 1 AND 4294967295),
  CHECK (logger_serial IS NULL OR transport = 'solarman_v5')
) STRICT;

INSERT INTO connection_new (id, transport, host, port) SELECT id, transport, host, port FROM connection;

DROP TABLE connection;

ALTER TABLE connection_new RENAME TO connection;
