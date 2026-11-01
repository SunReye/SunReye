CREATE TABLE settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
) STRICT;

-- One row per device per minute. `minute` is the Unix time in seconds of the minute's start;
-- `samples` is that minute's readings in the core's packed encoding.
CREATE TABLE readings_minute (
    device_id INTEGER NOT NULL,
    minute INTEGER NOT NULL,
    samples BLOB NOT NULL,
    PRIMARY KEY (device_id, minute)
) STRICT, WITHOUT ROWID;
