-- The investment payback is measured against (ADR 12), owned by the tariff module: one row, in EUR,
-- entered by the admin; the change log records each change.
CREATE TABLE investment (
  id INTEGER PRIMARY KEY CHECK (id = 0),
  amount REAL NOT NULL CHECK (amount > 0)
) STRICT;
