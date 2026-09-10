/**
 * MIGRATION 0007 — the `integrations` table — against a real Postgres.
 *
 * `packages/db/src/integrations.test.ts` proves the Zod arms. It cannot tell you
 * whether the migration FILE does what its comments claim: it is a `CREATE
 * TABLE`, a partial unique index and a `DO $$` backfill that reads two JSONB
 * documents, and a SQL-text assertion over it would prove only that the text is
 * the text. Two 500s have already shipped behind a green suite that way
 * (AGENTS.md).
 *
 * ## The properties, and how each fails silently without this file
 *
 *  1. THE CHECK REFUSES AN UNKNOWN KIND. A kind outside `INTEGRATION_KINDS` is
 *     an integration no runtime starts — never subscribed, never published, no
 *     error anyone reads. Exactly the failure `connections_kind_check` guards
 *     one level down.
 *  2. ONE `ha-export` PER CONNECTION, ENFORCED BY THE ENGINE. Two exports on one
 *     broker publish the same entities twice under two prefixes and announce two
 *     Home Assistant devices for one plant. A partial index is the only way to
 *     say that while still letting `evcc-ingest` repeat — two EVCC instances on
 *     one broker under different topic roots is a supported shape.
 *  3. THE CONNECTION IS PINNED. `ON DELETE RESTRICT` is what DELETES the
 *     soft-reference re-bind logic in
 *     `apps/server/src/settings/mqtt-broker.ts`: with a real foreign key the
 *     dangling id is not a policy anyone has to agree on, it is unrepresentable.
 *     A `CASCADE` or a `SET NULL` here would quietly re-create it.
 *  4. EVERY BACKFILL BRANCH. A row's PRESENCE means "configured", so an upgrade
 *     that invents one turns an integration on for an operator who never
 *     configured it, and one that misses a row turns off an integration that was
 *     running. Both are silent.
 *  5. A RE-RUN IS A NO-OP. Migration 0006 got that from a guard keyed on a key it
 *     then REMOVED. That trick cannot transfer — this migration leaves
 *     `app_settings` untouched, so its guard is `NOT EXISTS (… FROM
 *     integrations …)` and it has to be proven rather than reasoned about.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";

import { databaseReachable, resetMigrationDatabase } from "./harness";

const reachable = await databaseReachable();
if (!reachable) {
  const message = "db-tests: no Postgres reachable via DB_TEST_URL/DATABASE_URL.";
  if (process.env.CI) throw new Error(`${message} CI must never skip this layer.`);
  console.warn(`${message} Skipping.`);
}

const suite = reachable ? describe : describe.skip;

/** The one client shape this spec needs — drizzle, like every other spec here. */
type Db = Awaited<ReturnType<typeof import("@SunReye/db").createDbAt>>;

/**
 * The error a statement raised, or "".
 *
 * `.rejects` is deliberately not used: the constraint name lives on the pg
 * error's `cause`, one level below the drizzle wrapper, so a matcher on the top
 * message would pass for the wrong violation (see `baseline.test.ts`).
 */
async function failure(db: Db, query: ReturnType<typeof sql>): Promise<string> {
  try {
    await db.execute(query);
    return "";
  } catch (error) {
    const cause = (error as { cause?: unknown }).cause;
    return `${(error as Error).message} ${cause instanceof Error ? cause.message : ""}`;
  }
}

/**
 * REWIND the schema to what migration 0007 expects to find.
 *
 * The runner has no down-migrations, so the pre-0007 shape has to be
 * reconstructed. 0007 is purely ADDITIVE, which makes the inverse a single
 * `DROP TABLE` plus removing its journal row so the runner applies it again —
 * far less rewind than 0006 needed, and correspondingly less that can be wrong
 * here rather than in the migration.
 */
async function rewind(db: Db): Promise<void> {
  // `sql.raw`, so pg sends this as ONE simple-protocol query: the extended
  // protocol accepts exactly one statement per message, and a parameterised
  // multi-statement script fails (or, with some clients, never resolves).
  await db.execute(
    sql.raw(`
    drop table if exists integrations;
    delete from drizzle.__drizzle_migrations
      where created_at = (select max(created_at) from drizzle.__drizzle_migrations);
  `),
  );
}

/** Apply the pending journal entries — here, 0007 and nothing else. */
async function migrate(url: string): Promise<void> {
  const { runMigrations } = await import("@SunReye/db/migrate");
  await runMigrations(url);
}

/** The post-0006 shape of `app_settings.mqtt`: the export half plus a broker id. */
interface MqttSetting {
  connectionId?: number | null;
  topicPrefix?: string;
  haDiscoveryEnabled?: boolean;
  haDiscoveryPrefix?: string;
}

interface EvccSetting {
  enabled?: boolean;
  connectionId?: number | null;
  topicRoot?: string;
  subtractFromHome?: boolean;
}

interface SeedOptions {
  /** null: the install never configured MQTT at all (no row in `app_settings`). */
  mqtt?: MqttSetting | null;
  /** null: the install never configured EVCC at all. */
  evcc?: EvccSetting | null;
  /** How many `evcc-loadpoint` devices the ingest has already provisioned. */
  loadpoints?: number;
  /** false: an onboarding-only database, with no plant to hang anything on. */
  plant?: boolean;
}

/**
 * A post-0006 install as it stands the moment before the upgrade: a plant, its
 * Modbus gateway, a broker connection, EVCC loadpoints bound to that broker, and
 * whichever of the `mqtt` / `evcc` settings the case under test wants.
 *
 * `mqtt.connectionId` defaults to the broker's id — the configured case — and
 * every "not configured" variant is spelled by the caller, because the whole
 * point of properties 4 is that those two are told apart.
 */
async function seeded(options: SeedOptions = {}) {
  const url = await resetMigrationDatabase();
  const { createDbAt } = await import("@SunReye/db");
  const db = createDbAt(url);
  await rewind(db);

  let plantId: number | null = null;
  let brokerId: number | null = null;
  if (options.plant !== false) {
    plantId = (
      (
        await db.execute(sql`
          insert into plants (name, slug, time_zone) values ('Plant', 'plant', 'Europe/Berlin')
          returning id`)
      ).rows[0] as { id: number }
    ).id;
    const gatewayId = (
      (
        await db.execute(sql`
          insert into connections (plant_id, name, kind, params)
          values (${plantId}, 'Inverter', 'modbus',
                  ${JSON.stringify({ host: "10.20.0.62", port: 8899 })}::jsonb)
          returning id`)
      ).rows[0] as { id: number }
    ).id;
    brokerId = (
      (
        await db.execute(sql`
          insert into connections (plant_id, name, kind, params)
          values (${plantId}, 'MQTT broker', 'mqtt',
                  ${JSON.stringify({ brokerUrl: "mqtt://hass.ee.lan:1883" })}::jsonb)
          returning id`)
      ).rows[0] as { id: number }
    ).id;
    await db.execute(sql`
      insert into devices (plant_id, connection_id, unit_id, slug, name, profile_id, role)
      values (${plantId}, ${gatewayId}, 1, 'inverter', 'Deye', 'deye-sun-12k', 'inverter')`);
    for (let index = 1; index <= (options.loadpoints ?? 0); index += 1) {
      await db.execute(sql`
        insert into devices (plant_id, connection_id, unit_id, slug, name, profile_id, role)
        values (${plantId}, ${brokerId}, ${index}, ${`evcc-loadpoint-${index}`},
                ${`EVCC loadpoint ${index}`}, 'evcc-loadpoint', 'charger')`);
    }
  }

  if (options.mqtt !== null) {
    const mqtt: MqttSetting = {
      connectionId: brokerId,
      topicPrefix: "sunreye",
      haDiscoveryEnabled: true,
      haDiscoveryPrefix: "homeassistant",
      ...options.mqtt,
    };
    await db.execute(sql`
      insert into app_settings (key, value) values ('mqtt', ${JSON.stringify(mqtt)}::jsonb)`);
  }
  if (options.evcc !== null) {
    const evcc: EvccSetting = {
      enabled: true,
      connectionId: brokerId,
      topicRoot: "evcc",
      subtractFromHome: true,
      ...options.evcc,
    };
    await db.execute(sql`
      insert into app_settings (key, value) values ('evcc', ${JSON.stringify(evcc)}::jsonb)`);
  }
  return { url, db, plantId, brokerId };
}

interface IntegrationRow {
  id: number;
  plant_id: number;
  connection_id: number | null;
  kind: string;
  enabled: boolean;
  params: Record<string, unknown>;
}

async function integrations(db: Db): Promise<IntegrationRow[]> {
  const { rows } = await db.execute(sql`
    select id, plant_id, connection_id, kind, enabled, params
    from integrations order by id asc`);
  return rows as unknown as IntegrationRow[];
}

const ofKind = (rows: readonly IntegrationRow[], kind: string) =>
  rows.filter((row) => row.kind === kind);

suite("migration 0007: the integrations table", () => {
  describe("an install with both integrations configured", () => {
    let db: Db;
    let url: string;
    let plantId: number;
    let brokerId: number;

    beforeAll(async () => {
      const fixture = await seeded({ loadpoints: 2 });
      db = fixture.db;
      url = fixture.url;
      plantId = fixture.plantId!;
      brokerId = fixture.brokerId!;
      await migrate(url);
    });

    test("the Home Assistant export becomes a row, key for key with the setting", async () => {
      // Property 4. The params are a straight copy of the export half of
      // `app_settings.mqtt` — a key renamed here is an export that publishes at
      // the default prefix after the upgrade, on a topic tree nobody subscribes.
      const rows = ofKind(await integrations(db), "ha-export");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        plant_id: plantId,
        connection_id: brokerId,
        enabled: true,
        params: {
          topicPrefix: "sunreye",
          haDiscoveryEnabled: true,
          haDiscoveryPrefix: "homeassistant",
        },
      });
    });

    test("the EVCC ingest becomes a row carrying its topic root and its own flag", async () => {
      const rows = ofKind(await integrations(db), "evcc-ingest");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        plant_id: plantId,
        connection_id: brokerId,
        enabled: true,
        params: { topicRoot: "evcc" },
      });
    });

    test("`subtractFromHome` does NOT travel onto the integration", async () => {
      // It is a rule about how the house-load figure is composed, not a property
      // of an integration: two ingests must not be able to disagree about one
      // plant's load model. 0006 made the same call for the loadpoint devices.
      for (const row of await integrations(db)) {
        expect(row.params.subtractFromHome).toBeUndefined();
      }
    });

    test("the `app_settings` documents are left EXACTLY as they were", async () => {
      // The readers still resolve through them until the reader move; a second
      // migration retires them. Shrinking either one here would take the running
      // export down mid-upgrade.
      const { rows } = await db.execute(sql`
        select key, value from app_settings where key in ('mqtt', 'evcc') order by key asc`);
      expect(rows).toEqual([
        {
          key: "evcc",
          value: {
            enabled: true,
            connectionId: brokerId,
            topicRoot: "evcc",
            subtractFromHome: true,
          },
        },
        {
          key: "mqtt",
          value: {
            connectionId: brokerId,
            topicPrefix: "sunreye",
            haDiscoveryEnabled: true,
            haDiscoveryPrefix: "homeassistant",
          },
        },
      ] as never);
    });

    test("re-running the migration inserts nothing", async () => {
      // Property 5. 0006's trick — guard on a key the block then removes —
      // cannot transfer, because nothing is removed here. The guard is
      // `NOT EXISTS (… FROM integrations …)`, and this is the only thing that
      // proves it holds.
      const before = await integrations(db);
      await migrate(url);
      expect(await integrations(db)).toEqual(before);
    });

    test("the CHECK refuses a kind no runtime exists for", async () => {
      // Property 1, and the seam this table leaves open: `weather` costs an
      // entry in `INTEGRATION_KINDS`, a zod arm, a runtime and a CHECK rewrite —
      // no column change. Until then the engine must refuse the row.
      for (const kind of ["weather", "", "HA-EXPORT", "mqtt"]) {
        const message = await failure(
          db,
          sql`insert into integrations (plant_id, connection_id, kind)
              values (${plantId}, ${brokerId}, ${kind})`,
        );
        expect(message).toContain("integrations_kind_check");
      }
    });

    test("a SECOND ha-export on the same connection is refused BY THE ENGINE", async () => {
      // Property 2. Two exports on one broker publish every entity twice and
      // announce two Home Assistant devices for one plant.
      const message = await failure(
        db,
        sql`insert into integrations (plant_id, connection_id, kind)
            values (${plantId}, ${brokerId}, 'ha-export')`,
      );
      expect(message).toContain("integrations_ha_export_connection_idx");
    });

    test("a second evcc-ingest on the same connection is ALLOWED", async () => {
      // The partial index is partial precisely so this stays expressible: two
      // EVCC instances on one broker under two topic roots is a supported shape,
      // and a plain unique index would have forbidden it.
      await db.execute(sql`
        insert into integrations (plant_id, connection_id, kind, params)
        values (${plantId}, ${brokerId}, 'evcc-ingest',
                ${JSON.stringify({ topicRoot: "garage" })}::jsonb)`);
      expect(ofKind(await integrations(db), "evcc-ingest")).toHaveLength(2);
      await db.execute(sql`delete from integrations where params ->> 'topicRoot' = 'garage'`);
    });

    test("deleting a connection an integration references is REFUSED", async () => {
      // Property 3, and the whole reason the reference is hard: with `ON DELETE
      // RESTRICT` the dangling id `mqtt-broker.ts` re-binds around cannot exist.
      //
      // A broker of its OWN, because the seeded one already has loadpoint
      // devices on it — `devices_connection_id_connections_id_fk` would refuse
      // the delete first and prove nothing about this table.
      const spare = (
        (
          await db.execute(sql`
            insert into connections (plant_id, name, kind, params)
            values (${plantId}, 'Second broker', 'mqtt',
                    ${JSON.stringify({ brokerUrl: "mqtt://spare:1883" })}::jsonb)
            returning id`)
        ).rows[0] as { id: number }
      ).id;
      await db.execute(sql`
        insert into integrations (plant_id, connection_id, kind) values
          (${plantId}, ${spare}, 'ha-export')`);
      const message = await failure(db, sql`delete from connections where id = ${spare}`);
      expect(message).toContain("integrations_connection_id_connections_id_fk");
      await db.execute(sql`delete from integrations where connection_id = ${spare}`);
      await db.execute(sql`delete from connections where id = ${spare}`);
    });

    test("params defaults to an empty document rather than null", async () => {
      // `parseIntegrationParams` fills the arm's defaults from `{}`; a null would
      // throw at every reader instead.
      const { rows } = await db.execute(sql`
        insert into integrations (plant_id, kind) values (${plantId}, 'evcc-ingest')
        returning params, enabled, connection_id`);
      expect(rows[0]).toEqual({ params: {}, enabled: true, connection_id: null } as never);
      await db.execute(sql`delete from integrations where connection_id is null`);
    });
  });

  describe("an install whose MQTT export names no broker", () => {
    test("gets no ha-export row — a null connectionId was never configured", async () => {
      // Property 4. `connectionId = null` is exactly "the export is off and no
      // broker was ever picked", and a row's PRESENCE means configured.
      const { db, url } = await seeded({ mqtt: { connectionId: null }, evcc: null });
      await migrate(url);
      expect(await integrations(db)).toEqual([]);
    });
  });

  describe("an install that never configured MQTT at all", () => {
    test("gets no ha-export row", async () => {
      const { db, url } = await seeded({ mqtt: null, evcc: null });
      await migrate(url);
      expect(await integrations(db)).toEqual([]);
    });
  });

  describe("an install with EVCC switched off and no loadpoints", () => {
    test("gets no evcc-ingest row", async () => {
      // Nothing was ever configured: the setting is the env-seeded default.
      const { db, url } = await seeded({ mqtt: null, evcc: { enabled: false }, loadpoints: 0 });
      await migrate(url);
      expect(await integrations(db)).toEqual([]);
    });
  });

  describe("an install with EVCC switched off but loadpoints provisioned", () => {
    test("gets a DISABLED evcc-ingest row, because it was configured once", async () => {
      // The loadpoints are the evidence the ingest ran: dropping the row would
      // leave devices in the spine that nothing feeds, and no way to switch the
      // ingest back on other than reconfiguring it from scratch.
      const { db, url, brokerId } = await seeded({
        mqtt: null,
        evcc: { enabled: false, topicRoot: "garage" },
        loadpoints: 1,
      });
      await migrate(url);
      const rows = await integrations(db);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        kind: "evcc-ingest",
        enabled: false,
        connection_id: brokerId,
        params: { topicRoot: "garage" },
      });
    });
  });

  describe("an install whose EVCC names no broker", () => {
    test("still gets a row — connection_id is NULLABLE, unlike the export's", async () => {
      // The ingest is configured (enabled) and simply has no broker bound yet.
      // The column is nullable for the connection-LESS kinds to come anyway, so
      // there is nothing to invent here.
      const { db, url } = await seeded({ mqtt: null, evcc: { connectionId: null } });
      await migrate(url);
      const rows = await integrations(db);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ kind: "evcc-ingest", connection_id: null, enabled: true });
    });
  });

  describe("an onboarding-only database with no plant", () => {
    test("the backfill inserts nothing, because there is nothing to hang a row on", async () => {
      // `plant_id` is NOT NULL, so the alternative to skipping is a migration
      // that fails the upgrade on a database that has simply not been set up.
      const { db, url } = await seeded({ plant: false });
      await migrate(url);
      expect(await integrations(db)).toEqual([]);
    });
  });

  describe("the plant reference", () => {
    test("RESTRICTs, like every other plant reference in the schema", async () => {
      // An integration is CONFIGURATION, not history — nothing in `metrics_raw`
      // is keyed by it — so a CASCADE here would lose nothing, and it was still
      // refused. Invariant C1 ("no ON DELETE CASCADE anywhere near a
      // dimension", `./baseline.test.ts`) is worth more absolute than correct
      // in one case: an invariant with a named exception is a list. It costs
      // nothing — a plant carrying any connection or device is already
      // undeletable, and one carrying only integrations is a plant nobody set up.
      const { db, url } = await seeded({ mqtt: null, evcc: null });
      await migrate(url);
      const spare = (
        (
          await db.execute(sql`
            insert into plants (name, slug, time_zone) values ('Spare', 'spare', 'UTC')
            returning id`)
        ).rows[0] as { id: number }
      ).id;
      await db.execute(sql`
        insert into integrations (plant_id, kind) values (${spare}, 'evcc-ingest')`);
      const message = await failure(db, sql`delete from plants where id = ${spare}`);
      expect(message).toMatch(/foreign key|violates/i);
      expect((await integrations(db)).length).toBe(1);
    });
  });
});
