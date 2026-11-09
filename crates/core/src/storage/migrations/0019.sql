-- A broker connection's topic root (ADR 10): its profiles' topics sit under it. NULL for any
-- other transport.
ALTER TABLE connection ADD COLUMN topic_root TEXT;
