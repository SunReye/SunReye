/**
 * THE 3.0.x → 3.1.0 UPGRADE, rehearsed end to end against a real Postgres.
 *
 * A production instance upgraded 3.0.1 → 3.1.0 and its EVCC integration
 * vanished from the settings page. Every existing spec passed, and the reason
 * they could is the shape they start from: `integrations-migration.test.ts`
 * seeds a POST-0006 world — `app_settings.evcc` already carrying a
 * `connectionId`, the loadpoints already bound to a broker row — and then runs
 * 0007 against it. That shape is real for a database created at 3.1.0. It is
 * NOT the shape an upgrade produces, and the upgrade is the only way anyone
 * arrives here with data.
 *
 * At 3.0.1 (`packages/db/src/evcc-config.ts` at `web-v3.0.1`) the EVCC setting
 * had exactly three keys — `enabled`, `topicRoot`, `subtractFromHome` — and no
 * `connectionId` at all: the ingest borrowed the Home Assistant export's broker,
 * which is the conflation #217 was written to undo. So this file starts from the
 * 0005 schema with a 3.0.1 settings document and runs the REAL migration chain
 * over it, which is the only way to catch a migration that reads a key its
 * predecessor never wrote.
 */

import { describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";

import { databaseReachable, resetMigrationDatabase } from "./harness";

const reachable = await databaseReachable();
if (!reachable) {
  const message = "db-tests: no Postgres reachable via DB_TEST_URL/DATABASE_URL.";
  if (process.env.CI) throw new Error(`${message} CI must never skip this layer.`);
  console.warn(`${message} Skipping.`);
}

const suite = reachable ? describe : describe.skip;

type Db = Awaited<ReturnType<typeof openDb>>;

async function openDb(url: string) {
  const { createDbAt } = await import("@SunReye/db");
  return createDbAt(url);
}

async function migrate(url: string): Promise<void> {
  const { runMigrations } = await import("@SunReye/db/migrate");
  await runMigrations(url);
}

/**
 * Put the schema back to 0005 — what a 3.0.1 instance actually has on disk.
 * Mirrors `connection-kind-migration.test.ts`'s rewind, plus 0007's table, and
 * truncates the journal to the six entries 3.0.1 shipped with.
 */
async function rewindTo301(db: Db): Promise<void> {
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

/**
 * A 3.0.1 plant as the field has one: an inverter on a gateway, the Home
 * Assistant bridge ON, EVCC ingesting, and two loadpoints the ingest discovered
 * — unbound and both at `unit_id = 0`, which is where 3.0.x left them.
 *
 * `evcc` carries NO `connectionId`, because that key did not exist yet. That
 * single absence is what this file is about.
 */
async function seed301(): Promise<{ db: Db; url: string; plantId: number }> {
  const url = await resetMigrationDatabase();
  const db = await openDb(url);
  await rewindTo301(db);

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
        insert into connections (plant_id, name, host, port) values (${plantId}, 'Inverter', '10.20.0.62', 502)
        returning id`)
    ).rows[0] as { id: number }
  ).id;
  await db.execute(sql`
    insert into devices (plant_id, connection_id, unit_id, slug, name, profile_id, role)
    values (${plantId}, ${gatewayId}, 1, 'inverter', 'Deye', 'deye-sun-12k', 'inverter')`);
  // Both loadpoints unbound and colliding on unit 0 — tolerated only because
  // Postgres treats NULLs as distinct, which is why 0006 rebinds them.
  for (const index of [1, 2]) {
    await db.execute(sql`
      insert into devices (plant_id, connection_id, unit_id, slug, name, profile_id, role)
      values (${plantId}, null, 0, ${`evcc-loadpoint-${index}`},
              ${`Loadpoint ${index}`}, 'evcc-loadpoint', 'charger')`);
  }
  await db.execute(sql`
    insert into app_settings (key, value) values ('mqtt', ${JSON.stringify({
      enabled: true,
      brokerUrl: "mqtt://hass.ee.lan:1883",
      username: "mqtt",
      password: "secret",
      topicPrefix: "sunreye",
      haDiscoveryEnabled: true,
      haDiscoveryPrefix: "homeassistant",
    })}::jsonb)`);
  // The 3.0.1 document, key for key. No `connectionId`.
  await db.execute(sql`
    insert into app_settings (key, value) values ('evcc', ${JSON.stringify({
      enabled: true,
      topicRoot: "evcc",
      subtractFromHome: false,
    })}::jsonb)`);
  return { db, url, plantId };
}

type IntegrationRow = {
  kind: string;
  connection_id: number | null;
  enabled: boolean;
  params: Record<string, unknown>;
};

const integrations = async (db: Db) =>
  (
    await db.execute(sql`
      select kind, connection_id, enabled, params from integrations order by kind`)
  ).rows as IntegrationRow[];

const brokerId = async (db: Db) =>
  (
    (await db.execute(sql`select id from connections where kind = 'mqtt'`)).rows[0] as
      | { id: number }
      | undefined
  )?.id ?? null;

suite("upgrading a 3.0.1 plant to 3.1.0", () => {
  test("the EVCC ingest becomes a row, bound to the broker its loadpoints were moved to", async () => {
    const { db, url } = await seed301();
    await migrate(url);

    const broker = await brokerId(db);
    expect(broker).not.toBeNull();

    const evcc = (await integrations(db)).find((row) => row.kind === "evcc-ingest");
    expect(evcc).toBeDefined();
    expect(evcc?.enabled).toBe(true);
    expect(evcc?.params).toEqual({ topicRoot: "evcc" });
    // THE REGRESSION. 0006 rebinds the loadpoint DEVICES onto the new broker
    // row but never writes `connectionId` into `app_settings.evcc` — the key
    // did not exist at 3.0.1 — so 0007 resolved it to NULL and filed the
    // integration under "Internal", away from the broker it actually runs over
    // and away from the loadpoints it provides.
    expect(evcc?.connection_id).toBe(broker);
  });

  // NOT a display bug. `rebuildEvcc` resolves its broker through
  // `app_settings.evcc.connectionId` and `evccReady` refuses a null one, so an
  // upgraded instance stopped SUBSCRIBING: the EV card went dark and no
  // loadpoint reading arrived, which is the half an operator notices first.
  test("the running config gets its broker back, so the ingest can subscribe again", async () => {
    const { db, url } = await seed301();
    await migrate(url);
    const broker = await brokerId(db);
    const evcc = (await db.execute(sql`select value from app_settings where key = 'evcc'`))
      .rows[0] as { value: Record<string, unknown> };
    expect(evcc.value.connectionId).toBe(broker);
    // The rest of the 3.0.1 document is untouched — `subtractFromHome` is a
    // plant-level rule and has been argued twice.
    expect(evcc.value.enabled).toBe(true);
    expect(evcc.value.topicRoot).toBe("evcc");
    expect(evcc.value.subtractFromHome).toBe(false);
  });

  // 0007 gated its whole EVCC branch on `app_settings.evcc` existing, and ANDed
  // the "loadpoints exist, so the ingest ran" evidence INSIDE that guard — so
  // the evidence could never rescue a plant whose setting row was absent (an
  // env-configured instance, or one that never saved the form). The loadpoints
  // in the spine are proof enough on their own.
  test("loadpoints with no settings row still prove the ingest was configured", async () => {
    const { db, url } = await seed301();
    await db.execute(sql`delete from app_settings where key = 'evcc'`);
    await migrate(url);
    const evcc = (await integrations(db)).find((row) => row.kind === "evcc-ingest");
    expect(evcc).toBeDefined();
    expect(evcc?.enabled).toBe(true);
    expect(evcc?.connection_id).toBe(await brokerId(db));
    expect(evcc?.params).toEqual({ topicRoot: "evcc" });
  });

  // The mirror of the rule above: no loadpoints and no setting is a plant that
  // never had EVCC, and inventing a row would put an integration on someone's
  // settings page that they cannot explain.
  test("a plant that never ran EVCC gains no row", async () => {
    const { db, url } = await seed301();
    await db.execute(sql`delete from app_settings where key = 'evcc'`);
    await db.execute(sql`delete from devices where profile_id = 'evcc-loadpoint'`);
    await migrate(url);
    expect((await integrations(db)).map((r) => r.kind)).toEqual(["ha-export"]);
  });

  test("the Home Assistant export lands on the same broker", async () => {
    const { db, url } = await seed301();
    await migrate(url);
    const broker = await brokerId(db);
    const ha = (await integrations(db)).find((row) => row.kind === "ha-export");
    expect(ha?.connection_id).toBe(broker);
  });

  test("the loadpoints end up on that broker too, so the ingest and its devices agree", async () => {
    const { db, url } = await seed301();
    await migrate(url);
    const broker = await brokerId(db);
    const rows = (
      await db.execute(sql`
        select connection_id, unit_id from devices where profile_id = 'evcc-loadpoint' order by unit_id`)
    ).rows as { connection_id: number | null; unit_id: number }[];
    expect(rows.map((r) => r.connection_id)).toEqual([broker, broker]);
    expect(rows.map((r) => r.unit_id)).toEqual([1, 2]);
  });

  // The repair acts on evidence and stops where the evidence stops. Two brokers
  // with the loadpoints split between them is a plant no migration can read the
  // intent of, and a guess would point an ingest at a stranger's topics — so the
  // row stays unbound and the operator picks.
  test("two brokers with the loadpoints split leaves the binding to a human", async () => {
    const { db, url, plantId } = await seed301();
    await migrate(url);
    const second = (
      (
        await db.execute(sql`
          insert into connections (plant_id, name, kind, params)
          values (${plantId}, 'Other broker', 'mqtt',
                  ${JSON.stringify({ brokerUrl: "mqtt://other.lan:1883" })}::jsonb)
          returning id`)
      ).rows[0] as { id: number }
    ).id;
    // Undo the repair and split the loadpoints, then re-run only 0008.
    await db.execute(sql`update integrations set connection_id = null where kind = 'evcc-ingest'`);
    await db.execute(sql`
      update app_settings set value = value - 'connectionId' where key in ('evcc', 'mqtt')`);
    await db.execute(sql`
      update devices set connection_id = ${second} where slug = 'evcc-loadpoint-2'`);
    await db.execute(sql`
      delete from drizzle.__drizzle_migrations
        where id > (select id from drizzle.__drizzle_migrations order by id limit 1 offset 7)`);
    await migrate(url);

    const evcc = (await integrations(db)).find((row) => row.kind === "evcc-ingest");
    expect(evcc?.connection_id).toBeNull();
    const setting = (await db.execute(sql`select value from app_settings where key = 'evcc'`))
      .rows[0] as { value: Record<string, unknown> };
    expect(setting.value.connectionId).toBeUndefined();
  });

  test("running the whole chain twice changes nothing", async () => {
    const { db, url } = await seed301();
    await migrate(url);
    const first = await integrations(db);
    await migrate(url);
    expect(await integrations(db)).toEqual(first);
  });
});
