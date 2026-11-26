-- The weather device keeps only its latest issue of any target (ADR 15): the earlier issues
-- stored before go.
DELETE FROM forecast AS old
WHERE device = 4294967295
  AND issued < (
    SELECT max(issued) FROM forecast
    WHERE device = old.device AND series = old.series AND target = old.target
  );
