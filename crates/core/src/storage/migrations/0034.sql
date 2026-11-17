-- The weather backfill (ADR 23), owned by the weather module: once after the upgrade, the archive
-- is fetched for the new weather quantities over the span weather history covered. What is left
-- to fetch runs from `start` to before `until`, unix seconds, both NULL until the span is taken;
-- the row goes once all is fetched.
CREATE TABLE weather_backfill (
  id INTEGER PRIMARY KEY CHECK (id = 0),
  start INTEGER,
  until INTEGER
) STRICT;

INSERT INTO weather_backfill (id) VALUES (0);
