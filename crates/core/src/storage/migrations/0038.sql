-- Each forecast target keeps only its latest issue (ADR 15).
DELETE FROM forecast AS old
WHERE issued < (
  SELECT max(issued) FROM forecast
  WHERE device = old.device AND series = old.series AND target = old.target
);
