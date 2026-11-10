-- The write log's refusals (ADR 7): an attempt refused before the device is logged with outcome
-- `refused` and the code it was refused with; NULL for every other outcome.
ALTER TABLE write_log ADD COLUMN refusal TEXT;
