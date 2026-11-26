-- The bidding zone the spot-price device fetches for (ADR 12), owned by the spot module: one row
-- while the admin has chosen one; the change log records each change.
CREATE TABLE spot_zone (
  id INTEGER PRIMARY KEY CHECK (id = 0),
  zone TEXT NOT NULL
) STRICT;
