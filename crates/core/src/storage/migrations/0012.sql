-- Plant topology (ADR 14), owned by the topology module. Point ids are AUTOINCREMENT so a removed
-- point's id is never reused: the plant device's per-point history is indexed by point id.
CREATE TABLE point (id INTEGER PRIMARY KEY AUTOINCREMENT) STRICT;

-- Each topology version and the instant it applies from, in Unix seconds; the change log records
-- who made it and when. The version in force at an instant is the latest applying by then, ties
-- to the later.
CREATE TABLE topology (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  applies_from INTEGER NOT NULL
) STRICT;

-- A version's points in the admin's order, each parent before its children; the root alone has no
-- parent.
CREATE TABLE topology_point (
  topology INTEGER NOT NULL REFERENCES topology (id),
  point INTEGER NOT NULL REFERENCES point (id),
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  parent INTEGER REFERENCES point (id),
  PRIMARY KEY (topology, point)
) STRICT, WITHOUT ROWID;

-- The devices measuring a point, each by the power role it measures there, in the admin's order:
-- the first with a reading is read.
CREATE TABLE topology_claim (
  topology INTEGER NOT NULL,
  point INTEGER NOT NULL,
  position INTEGER NOT NULL,
  device INTEGER NOT NULL,
  role TEXT NOT NULL,
  PRIMARY KEY (topology, point, position),
  FOREIGN KEY (topology, point) REFERENCES topology_point (topology, point)
) STRICT, WITHOUT ROWID;
