-- REPAIR: give the EVCC ingest back the broker an upgrade took from it.
--
-- A plant upgraded 3.0.1 → 3.1.0 and stopped receiving EVCC data. Both 0006 and
-- 0007 ran, both reported success, and between them they left the ingest
-- pointing at nothing:
--
--   * At 3.0.1 `app_settings.evcc` had three keys — `enabled`, `topicRoot`,
--     `subtractFromHome`. There was no `connectionId`, because there were no
--     connections: the ingest borrowed whatever broker the Home Assistant
--     export dialled, which is the conflation #217 was written to undo.
--   * 0006 turned that broker into a `kind = 'mqtt'` row and rebound the
--     loadpoint DEVICES onto it — but it wrote `connectionId` only into
--     `app_settings.mqtt`, the export's half. The `evcc` document was left
--     exactly as it was, still with no such key.
--   * 0007 then read `v_evcc ->> 'connectionId'`, got NULL, and filed the
--     integration row with `connection_id = NULL`.
--
-- THE VISIBLE HALF IS THE SMALLER HALF. A connection-less integration renders
-- under "Internal" instead of under its broker, which is merely wrong. The
-- functional half is that `rebuildEvcc` resolves its broker through
-- `app_settings.evcc.connectionId` and `evccReady` refuses a null one, so the
-- upgraded instance never SUBSCRIBED again: no loadpoint reading, no EV card,
-- no error — the config still says "enabled" and looks entirely correct.
--
-- WHY A NEW MIGRATION RATHER THAN A FIX TO 0007. 0007 shipped in 3.1.0. Editing
-- an applied migration changes nothing on any database that already ran it, and
-- those are exactly the databases that are broken.
--
-- WHY THIS INVENTS NOTHING. Every branch below acts on evidence already in the
-- spine: a loadpoint device's own `connection_id` (0006 put it there), the
-- export's resolved broker (the same one 3.0.x shared), or a single unambiguous
-- MQTT row. Where the evidence is absent or ambiguous, nothing happens — a
-- guessed broker would point an ingest at a stranger's topics.
DO $$
DECLARE
  v_plant smallint;
  v_broker smallint;
  v_evcc jsonb;
  v_loadpoints int;
BEGIN
  SELECT min("id") INTO v_plant FROM "plants";
  IF v_plant IS NULL THEN
    RETURN;
  END IF;

  SELECT "value" INTO v_evcc FROM "app_settings" WHERE "key" = 'evcc';

  -- ── Which broker the ingest belongs on ─────────────────────────────────────
  --
  -- 1. THE LOADPOINTS' OWN. The strongest evidence there is: 0006 moved these
  --    devices onto the broker the ingest was reading when the upgrade ran, so
  --    the row they sit on is the row the ingest was using. Only when they all
  --    agree — a plant whose loadpoints somehow straddle two brokers has no
  --    single answer, and this migration must not pick one.
  SELECT DISTINCT d."connection_id" INTO v_broker
  FROM "devices" d
  JOIN "connections" c ON c."id" = d."connection_id" AND c."kind" = 'mqtt'
  WHERE d."plant_id" = v_plant AND d."profile_id" = 'evcc-loadpoint';
  -- `SELECT DISTINCT … INTO` takes the first row and leaves `FOUND` true even
  -- when several differ, so the ambiguity is checked rather than assumed.
  IF (
    SELECT count(DISTINCT d."connection_id")
    FROM "devices" d
    WHERE d."plant_id" = v_plant AND d."profile_id" = 'evcc-loadpoint'
      AND d."connection_id" IS NOT NULL
  ) > 1 THEN
    v_broker := NULL;
  END IF;

  -- 2. THE EXPORT'S BROKER. Before #217 the two shared one, by construction —
  --    `evcc-config.ts` at 3.0.1 said so in as many words ("Broker parameters
  --    are deliberately absent — they come from the MQTT config").
  IF v_broker IS NULL THEN
    SELECT c."id" INTO v_broker
    FROM "app_settings" s
    JOIN "connections" c
      ON c."id" = (s."value" ->> 'connectionId')::smallint AND c."kind" = 'mqtt'
    WHERE s."key" = 'mqtt';
  END IF;

  -- 3. THE ONLY BROKER THERE IS. Unambiguous by arithmetic: with exactly one
  --    `kind = 'mqtt'` row there is nothing else the ingest could have used.
  IF v_broker IS NULL
     AND (
       SELECT count(*) FROM "connections"
       WHERE "plant_id" = v_plant AND "kind" = 'mqtt'
     ) = 1
  THEN
    SELECT "id" INTO v_broker FROM "connections"
    WHERE "plant_id" = v_plant AND "kind" = 'mqtt';
  END IF;

  -- ── The running config, which is what stopped the data ─────────────────────
  --
  -- Only fills a key that is absent or null; an operator who has since picked a
  -- broker keeps their choice. `||` merges, so `topicRoot`, `enabled` and the
  -- plant-level `subtractFromHome` are carried through untouched.
  IF v_evcc IS NOT NULL AND v_broker IS NOT NULL
     AND coalesce(v_evcc ->> 'connectionId', '') = '' THEN
    UPDATE "app_settings"
    SET "value" = "value" || jsonb_build_object('connectionId', to_jsonb(v_broker))
    WHERE "key" = 'evcc';
  END IF;

  -- ── The integration row ────────────────────────────────────────────────────
  UPDATE "integrations"
  SET "connection_id" = v_broker
  WHERE "plant_id" = v_plant AND "kind" = 'evcc-ingest' AND "connection_id" IS NULL
    AND v_broker IS NOT NULL;

  -- 0007 gated its whole EVCC branch on `app_settings.evcc` existing, and put
  -- the "loadpoints exist, so the ingest ran" evidence INSIDE that guard with an
  -- AND — so the evidence could never rescue the case it was written for: a
  -- plant configured from the environment, or one that never saved the form,
  -- has loadpoint devices in the spine and no settings row at all, and came out
  -- of 3.1.0 with no integration and no way to make one without deleting its
  -- devices first. Here the devices stand on their own.
  SELECT count(*) INTO v_loadpoints
  FROM "devices" WHERE "plant_id" = v_plant AND "profile_id" = 'evcc-loadpoint';
  IF v_loadpoints > 0
     AND NOT EXISTS (
       SELECT 1 FROM "integrations" WHERE "plant_id" = v_plant AND "kind" = 'evcc-ingest'
     )
  THEN
    -- ENABLED. Devices in the spine mean the ingest was subscribed and
    -- discovering, whatever a missing document does or does not say; a row
    -- created switched off would reproduce the very silence this repairs.
    INSERT INTO "integrations" ("plant_id", "connection_id", "kind", "enabled", "params")
    VALUES (
      v_plant,
      v_broker,
      'evcc-ingest',
      true,
      jsonb_build_object('topicRoot', coalesce(nullif(v_evcc ->> 'topicRoot', ''), 'evcc'))
    );
  END IF;
END $$;
