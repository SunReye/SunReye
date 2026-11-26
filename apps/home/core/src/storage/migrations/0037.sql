-- Once the archive is stored for an hour, its weather forecasts go (ADR 17): those stored before
-- go up to where archive weather ends. Its hours are whole, so its last block holds the closing
-- gap at the block's hour.
DELETE FROM forecast
WHERE device = 4294967295
  AND target < (
    SELECT max(hour) * 36000 FROM block
    WHERE device = 4294967295
      AND series IN (SELECT series FROM step WHERE device = 4294967295 AND cadence >= 3600)
  );
