-- Settings writes (ADR 7). A device's writes are off until the admin turns them on.
ALTER TABLE device ADD COLUMN writes INTEGER NOT NULL DEFAULT 0 CHECK (writes IN (0, 1));
