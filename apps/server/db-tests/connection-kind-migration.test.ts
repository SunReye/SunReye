/**
 * MIGRATION 0006 — the broker becomes a connection — against a real Postgres.
 *
 * `packages/db/src/connection-kinds.test.ts` proves the Zod arms and
 * `plant-spine.test.ts` proves the repository statements. Neither can tell you
 * whether the migration FILE does what its comments claim: it is a `DO $$`
 * block, a jsonb backfill and five `DROP COLUMN`s, and a SQL-text assertion over
 * it would prove only that the text is the text. Two 500s have already shipped
 * behind a green suite that way (AGENTS.md).
 *
 * ## The properties, and how each fails silently without this file
 *
 *  1. THE MODBUS BACKFILL LOSES NOTHING. The five columns are dropped two
 *     statements after the `UPDATE` that reads them. A `WHERE` clause that
 *     skipped a row, or a key spelled `poll_interval_ms` instead of
 *     `pollIntervalMs`, leaves an endpoint with no address and nothing left to
 *     recover it from — and the plant simply goes quiet.
 *  2. THE BROKER MOVES, AND THE LOADPOINTS FOLLOW. If the rebind is missed, the
 *     loadpoints stay at `connection_id = null, unit_id = 0` and the whole point
 *     of the change is gone; if `unit_id` is not the loadpoint index,
 *     `devices_connection_unit_key` rejects the second one and the migration
 *     dies mid-release.
 *  3. A RE-RUN IS A NO-OP. A restored backup migrated twice must not gain a
 *     second broker connection or re-point anything.
 *  4. THE CHECK REFUSES `http`. That is the seam the issue leaves open, and a
 *     CHECK that admitted it would let a row exist that no tier can open — never
 *     polled, never subscribed, no error anyone reads.
 *  5. A DISABLED BRIDGE INVENTS NO BROKER. There is no endpoint the operator
 *     ever confirmed; a connection conjured from the env-seeded default would
 *     appear on the settings page as a broker nobody named.
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
 * REWIND the schema to what migration 0006 expects to find.
 *
 * The runner has no down-migrations, so the pre-0006 shape has to be
 * reconstructed: the five typed columns back, the `transport` CHECK back,
 * `kind`/`params` gone, and 0006's journal row removed so the runner applies it
 * again. Everything here is the exact inverse of the shipped file — which is
 * also why it is the one part of this spec that could go wrong without the
 * migration being wrong; each assertion below therefore names a fact about the
 * FORWARD direction only.
 *
 * IT REWINDS PAST 0006, NOT "ONE STEP". The journal row was found by
 * `max(created_at)`, which silently became the NEXT migration's the moment 0007
 * shipped: every case here then re-ran 0007 against a schema still holding
 * `connections.host`, and the whole file went red for a reason that had nothing
 * to do with 0006. Keeping the first SIX rows (0000–0005) and dropping whatever
 * follows says what is meant and does not rot. `integrations` goes with them —
 * it is 0007's table, and its `ON DELETE RESTRICT` on `connection_id` would
 * otherwise refuse the broker delete below.
 */
async function rewind(db: Db): Promise<void> {
  // `sql.raw`, so pg sends this as ONE simple-protocol query: the extended
  // protocol accepts exactly one statement per message, and a parameterised
  // multi-statement script fails (or, with some clients, never resolves).
  await db.execute(
    sql.raw(`
    drop table if exists integrations;
    alter table connections
      add column host text,
      add column port integer not null default 502,
      add column transport text not null default 'tcp',
      add column timeout_ms integer not null default 2000,
      add column poll_interval_ms integer not null default 1000;
    update connections set
      host = params ->> 'host',
      port = coalesce((params ->> 'port')::int, 502),
      transport = coalesce(params ->> 'transport', 'tcp'),
      timeout_ms = coalesce((params ->> 'timeoutMs')::int, 2000),
      poll_interval_ms = coalesce((params ->> 'pollIntervalMs')::int, 1000)
      where kind = 'modbus';
    delete from connections where kind <> 'modbus';
    update connections set host = '' where host is null;
    alter table connections alter column host set not null;
    alter table connections drop constraint connections_kind_check;
    alter table connections drop column kind, drop column params;
    alter table devices drop column params;
    alter table connections add constraint connections_transport_check
      check (transport in ('tcp', 'rtu-over-tcp'));
    delete from drizzle.__drizzle_migrations
      where id > (select id from drizzle.__drizzle_migrations order by id limit 1 offset 5);
  `),
  );
}

/** Apply the pending journal entries — here, 0006 and nothing else. */
async function migrate(url: string): Promise<void> {
  const { runMigrations } = await import("@SunReye/db/migrate");
  await runMigrations(url);
}

interface MqttSetting {
  enabled?: boolean;
  brokerUrl?: string;
  username?: string;
  password?: string;
  topicPrefix?: string;
  haDiscoveryEnabled?: boolean;
  haDiscoveryPrefix?: string;
}

/**
 * A 2.0.0 install as it stands the moment before the upgrade: a plant, its
 * Modbus gateway with an inverter on it, two EVCC loadpoints at
 * `(connection_id = null, unit_id = 0)`, and the `mqtt`/`evcc` settings.
 *
 * The two loadpoints are the load-bearing part of the fixture. They are the only
 * reason `unit_id` had to become the loadpoint index: with the connection null,
 * Postgres treats the pairs as distinct and the unique index never noticed.
 */
async function seeded(options: { mqtt?: MqttSetting | null; evccRoot?: string } = {}) {
  const url = await resetMigrationDatabase();
  const { createDbAt } = await import("@SunReye/db");
  const db = createDbAt(url);
  await rewind(db);

  const plantId = (
    (
      await db.execute(sql`
        insert into plants (name, slug, time_zone) values ('Plant', 'plant', 'Europe/Berlin')
        returning id`)
    ).rows[0] as { id: number }
  ).id;
  const gatewayId = (
    (
      await db.execute(sql`
        insert into connections (plant_id, name, host, port, transport, timeout_ms,
                                 poll_interval_ms)
        values (${plantId}, 'Inverter', '10.20.0.62', 8899, 'rtu-over-tcp', 3000, 2000)
        returning id`)
    ).rows[0] as { id: number }
  ).id;
  await db.execute(sql`
    insert into devices (plant_id, connection_id, unit_id, slug, name, profile_id, role)
    values (${plantId}, ${gatewayId}, 1, 'inverter', 'Deye', 'deye-sun-12k', 'inverter')`);
  for (const index of [1, 2]) {
    await db.execute(sql`
      insert into devices (plant_id, connection_id, unit_id, slug, name, profile_id, role)
      values (${plantId}, null, 0, ${`evcc-loadpoint-${index}`},
              ${`EVCC loadpoint ${index}`}, 'evcc-loadpoint', 'charger')`);
  }
  if (options.mqtt !== null) {
    const mqtt: MqttSetting = {
      enabled: true,
      brokerUrl: "mqtt://hass.ee.lan:1883",
      username: "mqtt",
      password: "s3cret",
      topicPrefix: "sunreye",
      haDiscoveryEnabled: true,
      haDiscoveryPrefix: "homeassistant",
      ...options.mqtt,
    };
    await db.execute(sql`
      insert into app_settings (key, value)
      values ('mqtt', ${JSON.stringify(mqtt)}::jsonb)`);
  }
  await db.execute(sql`
    insert into app_settings (key, value)
    values ('evcc', ${JSON.stringify({
      enabled: true,
      topicRoot: options.evccRoot ?? "evcc",
      subtractFromHome: true,
    })}::jsonb)`);
  return { url, db, plantId, gatewayId };
}

interface ConnectionRow {
  id: number;
  name: string;
  kind: string;
  params: Record<string, unknown>;
}

interface DeviceRow {
  slug: string;
  connection_id: number | null;
  unit_id: number;
  params: Record<string, unknown>;
}

async function connections(db: Db): Promise<ConnectionRow[]> {
  const { rows } = await db.execute(
    sql`select id, name, kind, params from connections order by id asc`,
  );
  return rows as unknown as ConnectionRow[];
}

async function devices(db: Db): Promise<DeviceRow[]> {
  const { rows } = await db.execute(
    sql`select slug, connection_id, unit_id, params from devices order by slug asc`,
  );
  return rows as unknown as DeviceRow[];
}

async function setting(db: Db, key: string): Promise<unknown> {
  const { rows } = await db.execute(sql`select value from app_settings where key = ${key}`);
  return (rows[0] as { value: unknown } | undefined)?.value;
}

/** The broker row the migration inserted, or undefined when it inserted none. */
const brokerOf = (rows: readonly ConnectionRow[]) => rows.find((row) => row.kind === "mqtt");
const loadpointsOf = (rows: readonly DeviceRow[]) =>
  rows.filter((row) => row.slug.startsWith("evcc-loadpoint-"));

suite("migration 0006: connections get a kind and params", () => {
  describe("an install with the MQTT bridge on", () => {
    let db: Db;
    let url: string;
    let gatewayId: number;

    beforeAll(async () => {
      const fixture = await seeded();
      db = fixture.db;
      url = fixture.url;
      gatewayId = fixture.gatewayId;
      await migrate(url);
    });

    test("the Modbus endpoint keeps its id and every one of its five values", async () => {
      // Property 1. The columns are gone two statements later, so a row this
      // UPDATE skipped has lost its address for good — and the id has to survive
      // because `devices.connection_id` is what binds the inverter to it.
      const gateway = (await connections(db)).find((row) => row.id === gatewayId);
      expect(gateway?.kind).toBe("modbus");
      expect(gateway?.params).toEqual({
        host: "10.20.0.62",
        port: 8899,
        transport: "rtu-over-tcp",
        timeoutMs: 3000,
        pollIntervalMs: 2000,
      });
    });

    test("the five columns are gone from the table", async () => {
      const { rows } = await db.execute(sql`
        select column_name from information_schema.columns
        where table_name = 'connections'`);
      const names = (rows as unknown as Array<{ column_name: string }>).map(
        (row) => row.column_name,
      );
      expect(names).toContain("kind");
      expect(names).toContain("params");
      for (const dropped of ["host", "port", "transport", "timeout_ms", "poll_interval_ms"]) {
        expect(names).not.toContain(dropped);
      }
    });

    test("the broker is now a connection, carrying its credentials", async () => {
      const rows = await connections(db);
      const broker = brokerOf(rows);
      expect(broker).toBeDefined();
      expect(broker?.params).toEqual({
        brokerUrl: "mqtt://hass.ee.lan:1883",
        username: "mqtt",
        password: "s3cret",
      });
      expect(rows).toHaveLength(2);
    });

    test("both loadpoints are BOUND to it, with the loadpoint index as the unit id", async () => {
      // Property 2, and the reason the whole change exists: two loadpoints used
      // to be `(null, 0)` and `(null, 0)`, which `devices_connection_unit_key`
      // tolerated only because Postgres treats NULLs as distinct. That the
      // migration's own INSERTs are accepted IS the proof the key now holds.
      const broker = brokerOf(await connections(db));
      const loadpoints = loadpointsOf(await devices(db));
      const brokerId = broker?.id ?? null;
      expect(loadpoints.map((row) => row.connection_id)).toEqual([brokerId, brokerId]);
      expect(loadpoints.map((row) => row.unit_id)).toEqual([1, 2]);
    });

    test("each loadpoint carries the EVCC topic root in its own params", async () => {
      const loadpoints = loadpointsOf(await devices(db));
      expect(loadpoints.map((row) => row.params)).toEqual([
        { topicRoot: "evcc" },
        { topicRoot: "evcc" },
      ]);
    });

    test("the inverter is untouched — it was never the migration's business", async () => {
      const inverter = (await devices(db)).find((row) => row.slug === "inverter");
      expect(inverter?.connection_id).toBe(gatewayId);
      expect(inverter?.unit_id).toBe(1);
      expect(inverter?.params).toEqual({});
    });

    test("the mqtt setting keeps only the EXPORT half, plus the connection it dials", async () => {
      const broker = brokerOf(await connections(db));
      expect(await setting(db, "mqtt")).toEqual({
        connectionId: broker?.id,
        topicPrefix: "sunreye",
        haDiscoveryEnabled: true,
        haDiscoveryPrefix: "homeassistant",
      });
    });

    test("no broker credential is left in app_settings", async () => {
      // The endpoint half MOVED; a copy left behind would be a second writable
      // home for one fact, which is the defect this migration exists to remove
      // — and a password sitting in a table the archive export reads.
      expect(JSON.stringify(await setting(db, "mqtt"))).not.toContain("s3cret");
      expect(JSON.stringify(await setting(db, "mqtt"))).not.toContain("brokerUrl");
    });

    test("`subtractFromHome` STAYS a plant-level setting", async () => {
      // It is a rule about how the house-load figure is composed, not a property
      // of a device: moving it onto a loadpoint would let two loadpoints
      // disagree about one plant's load model.
      expect(await setting(db, "evcc")).toMatchObject({ subtractFromHome: true });
      for (const row of await devices(db)) {
        expect(row.params.subtractFromHome).toBeUndefined();
      }
    });

    test("re-running the migration changes nothing", async () => {
      // Property 3. The guard is `value ? 'brokerUrl'`, which the shrunken
      // setting no longer satisfies — so a restored backup migrated twice must
      // not gain a second broker or re-point anything.
      const before = {
        connections: await connections(db),
        devices: await devices(db),
        mqtt: await setting(db, "mqtt"),
      };
      await migrate(url);
      expect(await connections(db)).toEqual(before.connections);
      expect(await devices(db)).toEqual(before.devices);
      expect(await setting(db, "mqtt")).toEqual(before.mqtt);
    });

    test("the CHECK refuses `http` until the migration that admits it", async () => {
      // Property 4, and the seam #217 leaves open: `http` costs an entry in
      // `CONNECTION_KINDS`, a zod arm, a tier and a CHECK rewrite — no column
      // change. Until then the engine must refuse the row.
      for (const kind of ["http", "", "Modbus"]) {
        const message = await failure(
          db,
          sql`insert into connections (plant_id, name, kind, params)
              values (1, 'X', ${kind}, '{}'::jsonb)`,
        );
        expect(message).toContain("connections_kind_check");
      }
    });

    test("a second loadpoint on the same broker with a taken index is refused BY THE ENGINE", async () => {
      // The unique index finally MEANS something for a pushed device. Before
      // this migration the same statement was accepted twice.
      const broker = brokerOf(await connections(db));
      const message = await failure(
        db,
        sql`insert into devices (plant_id, connection_id, unit_id, slug, name, profile_id, role)
            values (1, ${broker?.id}, 1, 'evcc-loadpoint-9', 'Clash', 'evcc-loadpoint',
                    'charger')`,
      );
      expect(message).toContain("devices_connection_unit_key");
    });
  });

  describe("an install with the MQTT bridge OFF", () => {
    test("no broker connection is invented, and the setting is still shrunk", async () => {
      // Property 5. There is no endpoint the operator ever confirmed — the
      // brokerUrl in the row is the env-seeded default — so a connection here
      // would appear on the settings page as a broker nobody named. Shrinking
      // the setting anyway is what makes the re-run guard hold.
      const { db, url } = await seeded({ mqtt: { enabled: false } });
      await migrate(url);
      expect((await connections(db)).map((row) => row.kind)).toEqual(["modbus"]);
      expect(await setting(db, "mqtt")).toEqual({
        connectionId: null,
        topicPrefix: "sunreye",
        haDiscoveryEnabled: true,
        haDiscoveryPrefix: "homeassistant",
      });
      const loadpoints = loadpointsOf(await devices(db));
      expect(loadpoints.map((row) => row.connection_id)).toEqual([null, null]);
    });
  });

  describe("an install that never configured MQTT at all", () => {
    test("the migration touches nothing but the Modbus backfill", async () => {
      const { db, url } = await seeded({ mqtt: null });
      await migrate(url);
      const rows = await connections(db);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.params).toMatchObject({ host: "10.20.0.62" });
      expect(await setting(db, "mqtt")).toBeUndefined();
    });
  });

  describe("a non-default EVCC topic root", () => {
    test("travels onto the loadpoints rather than being defaulted away", async () => {
      const { db, url } = await seeded({ evccRoot: "garage" });
      await migrate(url);
      const loadpoints = loadpointsOf(await devices(db));
      expect(loadpoints.map((row) => row.params)).toEqual([
        { topicRoot: "garage" },
        { topicRoot: "garage" },
      ]);
    });
  });
});
