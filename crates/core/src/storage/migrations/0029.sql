-- The poll cycle of a Modbus TCP, RTU over TCP or Solarman connection in seconds (ADR 6); a broker
-- or an HTTP host keeps the default and never reads it.
ALTER TABLE connection
ADD COLUMN poll_seconds INTEGER NOT NULL DEFAULT 5 CHECK (poll_seconds BETWEEN 1 AND 60);
