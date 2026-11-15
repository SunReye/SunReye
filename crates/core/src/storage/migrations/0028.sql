-- A series' kind beside its step, so a held or status series still reads carried forward once
-- no device declares it (ADR 3). NULL for a forecast, and until the series is next declared.
ALTER TABLE step ADD COLUMN kind TEXT;
