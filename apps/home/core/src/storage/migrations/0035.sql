-- A series' poll cadence in seconds beside its kind and step (ADR 3): one at an hourly cadence
-- stores no hourly rollups, and its hours read from its change points, declared or not. NULL for a
-- forecast, and until the series is next declared.
ALTER TABLE step ADD COLUMN cadence INTEGER;

-- Archive weather (ADR 17) is the hourly series stored so far: every weather series but the
-- measured clear-sky index, which is cut in quarters.
UPDATE step SET cadence = 3600
WHERE device = 4294967295
  AND series IN (SELECT id FROM series WHERE name LIKE 'weather.%' AND name <> 'weather.clearness');

DELETE FROM rollup_hour
WHERE (device, series) IN (SELECT device, series FROM step WHERE cadence >= 3600);
