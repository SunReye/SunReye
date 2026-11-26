-- Identify-probe variants (ADR 5): a device stores its family's profile id and the variant's id,
-- NULL for the base.
ALTER TABLE device ADD COLUMN variant TEXT;
