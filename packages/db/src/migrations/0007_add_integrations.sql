-- MIGRATION 0007 — AN `integrations` TABLE.
--
-- An INTEGRATION is a coded thing attached to a connection: the EVCC ingest
-- (subscribes on an MQTT connection, yields loadpoint devices) and the Home
-- Assistant export (publishes on one, yields nothing). Both lived in
-- `app_settings.mqtt` / `app_settings.evcc`, which cost two things a row does
-- not: `readSetting` safe-parses a drifted document to its DEFAULT with no log
-- (the settings-schema-silent-reset trap), and `mqtt.connectionId` is a SOFT
-- reference — an id inside a JSONB document with no foreign key, which
-- `apps/server/src/settings/mqtt-broker.ts` carries a whole
-- re-bind-on-dangling policy for. `connection_id` below is a REAL reference
-- with `ON DELETE RESTRICT`: an integration row PINS its connection, so the
-- dangling state is not a policy anyone has to agree on — it is
-- unrepresentable. That re-bind logic is therefore DELETED BY THIS TABLE, but
-- not by this migration: the readers still resolve through `app_settings`
-- until the later step that moves them, and removing it now would take the
-- running export down mid-upgrade.
--
-- CHECK, NOT AN ENUM, on `kind` — the repo's documented doctrine (0006,
-- `../connection-kinds.ts`): admitting `weather` later is a CHECK rewrite
-- inside this transaction, where `ALTER TYPE … ADD VALUE` cannot be rolled back
-- and, on older servers, cannot run in a transaction block at all.
--
-- A ROW'S PRESENCE MEANS "CONFIGURED". `enabled = false` is the off switch for
-- a configured integration; "not configured" is the ABSENCE of a row. There is
-- no null sentinel — which is exactly what `mqtt.connectionId = null`, meaning
-- both "the export is off" and "no broker was ever picked", had become.
--
-- WHICHEVER OF THIS AND #197 (the MPC optimizer) LANDS FIRST TAKES 0007. The
-- journal held six entries when this was written, so this is 0007; the other
-- takes the next free index.

CREATE TABLE "integrations" (
	"id" smallint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "integrations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 32767 START WITH 1 CACHE 1),
	"plant_id" smallint NOT NULL,
	"connection_id" smallint,
	"kind" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integrations_kind_check" CHECK ("integrations"."kind" in ('evcc-ingest', 'ha-export'))
);
--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_plant_id_plants_id_fk" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_ha_export_connection_idx" ON "integrations" USING btree ("connection_id") WHERE "integrations"."kind" = 'ha-export';--> statement-breakpoint
-- THE TWO CONFIGURED INTEGRATIONS BECOME ROWS.
--
-- Hand-written data move; drizzle-kit generates only the DDL above.
--
-- IDEMPOTENT BY CONSTRUCTION, BUT NOT 0006's WAY. 0006 keyed its guard on
-- `value ? 'brokerUrl'` — a key the same block then REMOVED, so a re-run
-- matched nothing. That trick cannot transfer: this migration deliberately
-- leaves both `app_settings` documents exactly as they are (the readers still
-- use them; a second migration retires them once they move), so there is no
-- key to consume. The guard is therefore `NOT EXISTS (… FROM integrations …)`
-- per kind: a restored backup migrated twice finds its own row already there
-- and inserts nothing. It is keyed on the ROW rather than on the connection,
-- so an operator who deletes an integration afterwards does not have it
-- resurrected on the next run.
--
-- NOTHING IS INVENTED. A row's presence means "configured", so a branch that
-- guessed would switch an integration ON for an operator who never set one up
-- — and it would be a row on their settings page they cannot explain.
DO $$
DECLARE
  v_mqtt jsonb;
  v_evcc jsonb;
  v_plant smallint;
  v_broker smallint;
BEGIN
  -- The lowest plant id, which is the plant: there is one row (see
  -- `../schema/plants.ts`), and 0006 resolved it the same way. An
  -- onboarding-only database has none, and `plant_id` is NOT NULL — so the
  -- alternative to returning is a migration that fails the upgrade on a
  -- database that has simply not been set up yet.
  SELECT min("id") INTO v_plant FROM "plants";
  IF v_plant IS NULL THEN
    RETURN;
  END IF;

  -- ── The Home Assistant export ──────────────────────────────────────────────
  SELECT "value" INTO v_mqtt FROM "app_settings" WHERE "key" = 'mqtt';
  IF v_mqtt IS NOT NULL
     AND (v_mqtt ->> 'connectionId') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM "integrations" WHERE "plant_id" = v_plant AND "kind" = 'ha-export'
     )
  THEN
    -- RESOLVE the soft reference exactly as `mqtt-broker.ts`'s `brokerFrom`
    -- does — the id must name a row, and that row must be a broker. Every way
    -- of not resolving means "the export is off", which is "not configured",
    -- which is no row. This is also what keeps the new foreign key from turning
    -- a dangling id (legal today) into a failed upgrade.
    SELECT "id" INTO v_broker
    FROM "connections"
    WHERE "id" = (v_mqtt ->> 'connectionId')::smallint AND "kind" = 'mqtt';

    IF v_broker IS NOT NULL THEN
      -- `enabled` is TRUE: a setting that names a resolvable broker IS the
      -- running export. The flag `app_settings.mqtt` used to carry was removed
      -- by 0006 precisely because a null `connectionId` already meant "off".
      -- Key for key with `../integrations.ts`'s `haExportParamsSchema`; the
      -- defaults are that schema's, so a document missing a field lands on the
      -- same value the reader would have produced.
      INSERT INTO "integrations" ("plant_id", "connection_id", "kind", "enabled", "params")
      VALUES (
        v_plant,
        v_broker,
        'ha-export',
        true,
        jsonb_build_object(
          'topicPrefix', coalesce(nullif(v_mqtt ->> 'topicPrefix', ''), 'sunreye'),
          'haDiscoveryEnabled', to_jsonb(coalesce((v_mqtt ->> 'haDiscoveryEnabled')::boolean, false)),
          'haDiscoveryPrefix', coalesce(nullif(v_mqtt ->> 'haDiscoveryPrefix', ''), 'homeassistant')
        )
      );
    END IF;
  END IF;

  -- ── The EVCC ingest ────────────────────────────────────────────────────────
  SELECT "value" INTO v_evcc FROM "app_settings" WHERE "key" = 'evcc';
  IF v_evcc IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM "integrations" WHERE "plant_id" = v_plant AND "kind" = 'evcc-ingest'
     )
     AND (
       coalesce((v_evcc ->> 'enabled')::boolean, false)
       -- OR: the ingest RAN once and left evidence. `'evcc-loadpoint'` is
       -- `EVCC_LOADPOINT_PROFILE` from
       -- `apps/server/src/evcc/evcc-devices.ts`, hard-coded here because SQL
       -- cannot import it — a rename there must be mirrored in a new
       -- migration, never by editing this one.
       --
       -- Dropping the row for a switched-off ingest would leave loadpoint
       -- devices in the spine that nothing feeds, and no way back on short of
       -- reconfiguring from scratch. The row is created DISABLED instead, which
       -- is what `enabled = false` is for.
       OR EXISTS (
         SELECT 1 FROM "devices"
         WHERE "plant_id" = v_plant AND "profile_id" = 'evcc-loadpoint'
       )
     )
  THEN
    -- Resolved the same way, but the outcome differs: `connection_id` is
    -- NULLABLE, so an ingest whose broker never resolved is still a configured
    -- integration — merely one with no endpoint bound yet.
    SELECT "id" INTO v_broker
    FROM "connections"
    WHERE "id" = (v_evcc ->> 'connectionId')::smallint AND "kind" = 'mqtt';

    -- `subtractFromHome` STAYS a plant-level setting, as 0006 already decided:
    -- it is a rule about how the house-load figure is composed (is the charger
    -- metered inside `load.power`?), not a property of an integration, and two
    -- ingests must not be able to disagree about one plant's load model.
    INSERT INTO "integrations" ("plant_id", "connection_id", "kind", "enabled", "params")
    VALUES (
      v_plant,
      v_broker,
      'evcc-ingest',
      coalesce((v_evcc ->> 'enabled')::boolean, false),
      jsonb_build_object('topicRoot', coalesce(nullif(v_evcc ->> 'topicRoot', ''), 'evcc'))
    );
  END IF;
END $$;
