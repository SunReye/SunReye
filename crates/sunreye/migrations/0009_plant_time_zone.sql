-- The plant time zone (ADR 0004): an IANA name the core validated against its bundled database. One row,
-- absent until first saved; a read without it uses the host's zone or UTC.
CREATE TABLE plant_time_zone (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 64)
) STRICT;
