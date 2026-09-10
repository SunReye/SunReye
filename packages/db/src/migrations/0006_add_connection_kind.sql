ALTER TABLE "connections" DROP CONSTRAINT "connections_transport_check";--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "kind" text DEFAULT 'modbus' NOT NULL;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "params" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "params" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_kind_check" CHECK ("connections"."kind" in ('modbus', 'mqtt'));--> statement-breakpoint
-- Hand-written data move (drizzle-kit generates only DDL). Every existing
-- connection IS a Modbus endpoint — the table held nothing else — so its five
-- typed columns become the `modbus` arm of `params`, key for key with
-- `../connection-kinds.ts`'s `modbusParamsSchema`. The `kind` default already
-- says `'modbus'`, so nothing has to be set here.
--
-- Unconditional, and it must be: the columns are dropped two statements later,
-- and a row this UPDATE skipped would lose its address with nothing left to
-- read it from.
UPDATE "connections"
SET "params" = jsonb_build_object(
  'host', "host",
  'port', "port",
  'transport', "transport",
  'timeoutMs', "timeout_ms",
  'pollIntervalMs', "poll_interval_ms"
);--> statement-breakpoint
ALTER TABLE "connections" DROP COLUMN "host";--> statement-breakpoint
ALTER TABLE "connections" DROP COLUMN "port";--> statement-breakpoint
ALTER TABLE "connections" DROP COLUMN "transport";--> statement-breakpoint
ALTER TABLE "connections" DROP COLUMN "timeout_ms";--> statement-breakpoint
ALTER TABLE "connections" DROP COLUMN "poll_interval_ms";--> statement-breakpoint
-- THE BROKER BECOMES A CONNECTION.
--
-- `app_settings.mqtt` conflated two things: an outbound EXPORT (which entities
-- to publish, whether to announce Home Assistant discovery) and the BROKER
-- ENDPOINT the EVCC ingest reused ("Broker parameters are deliberately absent —
-- they come from the MQTT config"). Only the endpoint is connection-shaped, so
-- the endpoint half moves into a `kind = 'mqtt'` row and the setting keeps only
-- the export half plus the id of the connection it dials.
--
-- IDEMPOTENT BY CONSTRUCTION. The guard is `value ? 'brokerUrl'`: after this
-- block runs, the shrunken setting no longer HAS that key, so a re-run — a
-- restored backup migrated twice, a re-applied journal entry — matches nothing
-- and does nothing. It is not keyed on the connection existing, because an
-- operator may legitimately delete that connection afterwards and a re-run must
-- not resurrect it.
--
-- `subtractFromHome` STAYS a plant-level setting. It is a rule about how the
-- house-load figure is composed (is the charger metered inside `load.power`?),
-- not a property of a device or of a broker, and moving it onto the loadpoint
-- would make two loadpoints able to disagree about one plant's load model.
DO $$
DECLARE
  v_mqtt jsonb;
  v_evcc jsonb;
  v_plant smallint;
  v_connection smallint;
BEGIN
  SELECT "value" INTO v_mqtt FROM "app_settings" WHERE "key" = 'mqtt';
  -- Not configured, or already migrated: nothing to move.
  IF v_mqtt IS NULL OR NOT (v_mqtt ? 'brokerUrl') THEN
    RETURN;
  END IF;

  -- A DISABLED bridge leaves no broker behind. There is no endpoint the
  -- operator ever confirmed, so inventing a connection out of the env-seeded
  -- default would put a row in the settings page for a broker nobody named.
  -- The setting is still shrunk, so the shape is uniform and the guard above
  -- holds on a re-run.
  IF coalesce((v_mqtt ->> 'enabled')::boolean, false) THEN
    -- The lowest plant id, which is the plant: there is one row (see
    -- `../schema/plants.ts`). An onboarding-only database has none, and then
    -- there is nothing to hang a connection on — the setting is still shrunk,
    -- and `connectionId` stays null until the operator picks a broker.
    SELECT min("id") INTO v_plant FROM "plants";
    IF v_plant IS NOT NULL THEN
      INSERT INTO "connections" ("plant_id", "name", "kind", "params")
      VALUES (
        v_plant,
        'MQTT broker',
        'mqtt',
        jsonb_strip_nulls(jsonb_build_object(
          'brokerUrl', v_mqtt ->> 'brokerUrl',
          'username', nullif(v_mqtt ->> 'username', ''),
          'password', nullif(v_mqtt ->> 'password', '')
        ))
      )
      RETURNING "id" INTO v_connection;

      -- REBIND THE LOADPOINTS, which is the whole reason the broker had to
      -- become a connection: every `evcc-loadpoint-*` device sat at
      -- `connection_id = null` with `unit_id = 0`, so two of them collided on
      -- the addressing the `devices(connection_id, unit_id)` unique index is
      -- supposed to express — and were tolerated only because Postgres treats
      -- NULLs as distinct. The unit id becomes the loadpoint's own index, which
      -- the slug already carries, and the topic root travels onto the device.
      --
      -- Only rows still unbound are touched: an operator who already pointed a
      -- loadpoint somewhere keeps their choice.
      SELECT "value" INTO v_evcc FROM "app_settings" WHERE "key" = 'evcc';
      UPDATE "devices"
      SET "connection_id" = v_connection,
          "unit_id" = (substring("slug" from 'evcc-loadpoint-([0-9]+)$'))::smallint,
          "params" = "params" || jsonb_build_object(
            'topicRoot', coalesce(nullif(v_evcc ->> 'topicRoot', ''), 'evcc')
          )
      WHERE "plant_id" = v_plant
        AND "connection_id" IS NULL
        AND "profile_id" = 'evcc-loadpoint'
        AND "slug" ~ '^evcc-loadpoint-[0-9]+$';
    END IF;
  END IF;

  -- The export half, plus the id of the broker it dials. `enabled` is gone: a
  -- null `connectionId` IS "off", so the two can no longer disagree about
  -- whether the bridge should be publishing.
  UPDATE "app_settings"
  SET "value" = jsonb_build_object(
        'connectionId', to_jsonb(v_connection),
        'topicPrefix', coalesce(nullif(v_mqtt ->> 'topicPrefix', ''), 'sunreye'),
        'haDiscoveryEnabled', coalesce((v_mqtt -> 'haDiscoveryEnabled')::jsonb, 'false'::jsonb),
        'haDiscoveryPrefix', coalesce(nullif(v_mqtt ->> 'haDiscoveryPrefix', ''), 'homeassistant')
      ),
      "updated_at" = now()
  WHERE "key" = 'mqtt';
END $$;
