-- A series' unit beside its kind and step, so the series catalog (ADR 22) names it once no
-- device declares it (ADR 3). Its symbol, such as `W`; NULL for a unitless series, a forecast, and
-- until the series is next declared.
ALTER TABLE step ADD COLUMN unit TEXT;

-- A removed device (ADR 3), so its history stays named. `removed` is Unix seconds.
CREATE TABLE device_tombstone (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  removed INTEGER NOT NULL
) STRICT, WITHOUT ROWID;

-- Devices removed before tombstones: the name of their last logged state (ADR 19).
INSERT INTO device_tombstone (id, name, removed)
SELECT
  r.subject_id,
  (
    SELECT json_extract(s.state, '$.name') FROM change s
    WHERE s.subject = 'device' AND s.subject_id = r.subject_id AND s.state IS NOT NULL
    ORDER BY s.id DESC LIMIT 1
  ),
  r.changed
FROM change r
WHERE r.subject = 'device' AND r.action = 'remove'
  AND r.id = (
    SELECT max(id) FROM change WHERE subject = 'device' AND subject_id = r.subject_id
  )
  AND (
    SELECT json_extract(s.state, '$.name') FROM change s
    WHERE s.subject = 'device' AND s.subject_id = r.subject_id AND s.state IS NOT NULL
    ORDER BY s.id DESC LIMIT 1
  ) IS NOT NULL;
