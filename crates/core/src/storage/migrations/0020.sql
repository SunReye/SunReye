-- Whether a broker connection runs the publisher (ADR 10): NULL for none, else whether it sends
-- Home Assistant discovery.
ALTER TABLE connection ADD COLUMN publish INTEGER CHECK (publish IN (0, 1));
