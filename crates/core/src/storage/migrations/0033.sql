-- Explore's saved views (ADR 22): a name and the route query, opaque to the core, in the order
-- saved. AUTOINCREMENT keeps that order and never reuses a removed view's id in the change log.
CREATE TABLE saved_view (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  query TEXT NOT NULL
) STRICT;
