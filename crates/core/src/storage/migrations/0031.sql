-- A version's standing charge (ADR 12), in EUR a month; none is 0.
ALTER TABLE tariff ADD COLUMN standing_charge REAL NOT NULL DEFAULT 0 CHECK (standing_charge >= 0);
