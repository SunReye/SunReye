-- The write log's `via` (ADR 7, 16): the trusted device key a remote write came through; NULL for
-- a write made at home.
ALTER TABLE write_log ADD COLUMN via TEXT;
