/**
 * `packages/db/src/integrations-store.ts`'s STATEMENTS, against a real Postgres.
 *
 * `../../packages/db/src/integrations-store.test.ts` renders each of them through
 * the dialect and proves the mapping either side. It cannot tell you whether any
 * of them RUNS, and every claim below is a claim about what the engine does:
 *
 *  1. THE `::jsonb` CAST. `params` is JSONB and the value is handed over as a
 *     `JSON.stringify`'d string; without the cast Postgres refuses the insert,
 *     and what comes back out is whatever the driver decides. A SQL-text
 *     assertion proves neither half.
 *  2. THE SMALLINT COERCION. `id` and `connection_id` are `smallint` and arrive
 *     as STRINGS through node-postgres. A roster keyed by "3" instead of 3 finds
 *     no connection and reports every integration as unattached — silently.
 *  3. THE PARTIAL UNIQUE INDEX. One `ha-export` per connection, while
 *     `evcc-ingest` may repeat. Whether a partial index really discriminates on
 *     the predicate is engine behaviour, and getting it wrong either duplicates
 *     every Home Assistant entity or makes two EVCC instances inexpressible.
 *  4. `ON DELETE RESTRICT`. An integration PINS its connection — that is what
 *     replaced the soft reference and its re-bind policy. A `CASCADE` or a
 *     `SET NULL` slipped in later would re-create the dangling state, and
 *     nothing but this would notice.
 *  5. "AN EMPTY PATCH RUNS NO UPDATE". `update … set where id = 1` is a syntax
 *     error, so the guard is not an optimisation. The engine is also the only
 *     witness to `updated_at` NOT moving.
 *  6. `params` REPLACES rather than merging. JSONB assignment is whole-document;
 *     a `||` slipped in would leave a removed key in place forever.
 */

import { describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";

import { databaseReachable, resetTestDatabase } from "./harness";

const reachable = await databaseReachable();
if (!reachable) {
  const message = "db-tests: no Postgres reachable via DB_TEST_URL/DATABASE_URL.";
  if (process.env.CI) throw new Error(`${message} In CI this layer must never be skipped.`);
  console.warn(`${message} Skipping.`);
}
const suite = reachable ? describe : describe.skip;

suite("the integrations store", () => {
  let db: Awaited<ReturnType<typeof client>>;
  let store: typeof import("@SunReye/db/integrations-store");
  let repo: typeof import("@SunReye/db/plant-repo");

  async function client() {
    const url = await resetTestDatabase();
    const { createDbAt } = await import("@SunReye/db");
    return createDbAt(url);
  }

  /** The error a statement raised, or "" — see baseline.test.ts on `.rejects`. */
  async function failure(query: Promise<unknown>): Promise<string> {
    try {
      await query;
      return "";
    } catch (error) {
      const cause = (error as { cause?: unknown }).cause;
      // The constraint name lives ONLY on the cause.
      return `${(error as Error).message} ${cause instanceof Error ? cause.message : ""}`;
    }
  }

  /** A plant of this spec's own — the directory shares one database. */
  async function freshPlant(slug: string) {
    await db.execute(sql`insert into plants (name, slug) values (${slug}, ${slug})`);
    const { rows } = await db.execute(sql`select id from plants where slug = ${slug}`);
    return { id: Number((rows[0] as { id: number }).id) };
  }

  async function freshBroker(plantId: number, name: string) {
    return repo.createConnection(db, plantId, {
      name,
      kind: "mqtt",
      params: { brokerUrl: "mqtt://broker.test:1883" },
    });
  }

  test("setup", async () => {
    db = await client();
    store = await import("@SunReye/db/integrations-store");
    repo = await import("@SunReye/db/plant-repo");
    expect(store.readIntegrations).toBeInstanceOf(Function);
  });

  test("createIntegration writes the row, casts params, and hands back real numbers", async () => {
    const plant = await freshPlant("int-create");
    const broker = await freshBroker(plant.id, "int-create broker");
    const created = await store.createIntegration(db, plant.id, {
      connectionId: broker.id,
      kind: "evcc-ingest",
      params: { topicRoot: "garage" },
    });
    expect(created).toEqual({
      id: created.id,
      connectionId: broker.id,
      kind: "evcc-ingest",
      enabled: true,
      params: { topicRoot: "garage" },
    });
    expect(typeof created.id).toBe("number");
    expect(typeof created.connectionId).toBe("number");
    // The cast landed: the column really holds a JSON object, not a string.
    const { rows } = await db.execute(
      sql`select jsonb_typeof(params) as kind from integrations where id = ${created.id}`,
    );
    expect((rows[0] as { kind: string }).kind).toBe("object");
  });

  test("a connection-LESS row inserts and reads back a real null", async () => {
    const plant = await freshPlant("int-null-conn");
    const created = await store.createIntegration(db, plant.id, {
      connectionId: null,
      kind: "ha-export",
      params: { topicPrefix: "sunreye", haDiscoveryEnabled: false, haDiscoveryPrefix: "ha" },
    });
    expect(created.connectionId).toBeNull();
    const [read] = await store.readIntegrations(db, plant.id);
    expect(read?.connectionId).toBeNull();
  });

  test("readIntegrations is plant-scoped and ordered by id", async () => {
    const mine = await freshPlant("int-scope-mine");
    const other = await freshPlant("int-scope-other");
    const mineBroker = await freshBroker(mine.id, "int-scope-mine broker");
    const otherBroker = await freshBroker(other.id, "int-scope-other broker");
    const first = await store.createIntegration(db, mine.id, {
      connectionId: mineBroker.id,
      kind: "evcc-ingest",
      params: { topicRoot: "house" },
    });
    const second = await store.createIntegration(db, mine.id, {
      connectionId: mineBroker.id,
      kind: "evcc-ingest",
      params: { topicRoot: "garage" },
    });
    await store.createIntegration(db, other.id, {
      connectionId: otherBroker.id,
      kind: "evcc-ingest",
      params: { topicRoot: "elsewhere" },
    });
    const rows = await store.readIntegrations(db, mine.id);
    expect(rows.map((r) => r.id)).toEqual([first.id, second.id]);
    expect(rows.map((r) => r.params)).toEqual([{ topicRoot: "house" }, { topicRoot: "garage" }]);
  });

  test("an empty params document reads back as the arm's DEFAULTS", async () => {
    const plant = await freshPlant("int-defaults");
    const broker = await freshBroker(plant.id, "int-defaults broker");
    await db.execute(sql`
      insert into integrations (plant_id, connection_id, kind)
      values (${plant.id}, ${broker.id}, 'ha-export')`);
    const [only] = await store.readIntegrations(db, plant.id);
    expect(only?.params).toEqual({
      topicPrefix: "sunreye",
      haDiscoveryEnabled: false,
      haDiscoveryPrefix: "homeassistant",
    });
  });

  test("TWO EVCC ingests may share one broker; a second HA export may not", async () => {
    const plant = await freshPlant("int-instances");
    const broker = await freshBroker(plant.id, "int-instances broker");
    const evcc = (topicRoot: string) =>
      store.createIntegration(db, plant.id, {
        connectionId: broker.id,
        kind: "evcc-ingest",
        params: { topicRoot },
      });
    await evcc("house");
    await evcc("garage");
    expect(await store.readIntegrations(db, plant.id)).toHaveLength(2);

    const exportRow = () =>
      store.createIntegration(db, plant.id, {
        connectionId: broker.id,
        kind: "ha-export",
        params: { topicPrefix: "sunreye", haDiscoveryEnabled: false, haDiscoveryPrefix: "ha" },
      });
    await exportRow();
    expect(await failure(exportRow())).toContain("integrations_ha_export_connection_idx");
  });

  test("an HA export on a DIFFERENT broker is fine — the index is per connection", async () => {
    const plant = await freshPlant("int-two-brokers");
    const first = await freshBroker(plant.id, "int-two-brokers a");
    const second = await freshBroker(plant.id, "int-two-brokers b");
    const exportOn = (connectionId: number) =>
      store.createIntegration(db, plant.id, {
        connectionId,
        kind: "ha-export",
        params: { topicPrefix: "sunreye", haDiscoveryEnabled: false, haDiscoveryPrefix: "ha" },
      });
    await exportOn(first.id);
    await exportOn(second.id);
    expect(await store.readIntegrations(db, plant.id)).toHaveLength(2);
  });

  test("an integration PINS its connection — the delete is refused, not cascaded", async () => {
    const plant = await freshPlant("int-restrict");
    const broker = await freshBroker(plant.id, "int-restrict broker");
    const row = await store.createIntegration(db, plant.id, {
      connectionId: broker.id,
      kind: "evcc-ingest",
      params: { topicRoot: "evcc" },
    });
    expect(await failure(repo.deleteConnection(db, broker.id))).toContain("integrations");
    // And the integration is still there: nothing was quietly detached.
    expect((await store.readIntegrations(db, plant.id)).map((r) => r.id)).toEqual([row.id]);

    // Un-configure it and the endpoint becomes deletable — the pin is the only
    // thing holding it.
    expect(await store.deleteIntegration(db, row.id)).toBe(true);
    expect(await repo.deleteConnection(db, broker.id)).toBe(true);
  });

  test("updateIntegration toggles `enabled` and moves `updated_at`", async () => {
    const plant = await freshPlant("int-toggle");
    const broker = await freshBroker(plant.id, "int-toggle broker");
    const row = await store.createIntegration(db, plant.id, {
      connectionId: broker.id,
      kind: "evcc-ingest",
      params: { topicRoot: "evcc" },
    });
    const stampedAt = async () => {
      const { rows } = await db.execute(
        sql`select updated_at from integrations where id = ${row.id}`,
      );
      return String((rows[0] as { updated_at: unknown }).updated_at);
    };
    const before = await stampedAt();
    // The column's whole purpose is "when did the export stop publishing", and
    // `now()` is transaction time, so the write needs its own instant to differ.
    await db.execute(sql`select pg_sleep(0.01)`);
    const updated = await store.updateIntegration(db, row.id, { enabled: false });
    expect(updated.enabled).toBe(false);
    expect(await stampedAt()).not.toBe(before);
  });

  test("`params` REPLACES the document — a removed key is gone, not merged over", async () => {
    const plant = await freshPlant("int-replace");
    const broker = await freshBroker(plant.id, "int-replace broker");
    const row = await store.createIntegration(db, plant.id, {
      connectionId: broker.id,
      kind: "ha-export",
      params: { topicPrefix: "sunreye", haDiscoveryEnabled: true, haDiscoveryPrefix: "custom" },
    });
    const updated = await store.updateIntegration(db, row.id, {
      params: { topicPrefix: "solar", haDiscoveryEnabled: false, haDiscoveryPrefix: "ha" },
    });
    expect(updated.params).toEqual({
      topicPrefix: "solar",
      haDiscoveryEnabled: false,
      haDiscoveryPrefix: "ha",
    });
  });

  test("an EMPTY patch runs no UPDATE at all — the row and its stamp stand still", async () => {
    const plant = await freshPlant("int-empty-patch");
    const broker = await freshBroker(plant.id, "int-empty-patch broker");
    const row = await store.createIntegration(db, plant.id, {
      connectionId: broker.id,
      kind: "evcc-ingest",
      params: { topicRoot: "evcc" },
    });
    const { rows: before } = await db.execute(
      sql`select updated_at from integrations where id = ${row.id}`,
    );
    await db.execute(sql`select pg_sleep(0.01)`);
    const read = await store.updateIntegration(db, row.id, {});
    expect(read).toEqual(row);
    const { rows: after } = await db.execute(
      sql`select updated_at from integrations where id = ${row.id}`,
    );
    expect(String((after[0] as { updated_at: unknown }).updated_at)).toBe(
      String((before[0] as { updated_at: unknown }).updated_at),
    );
  });

  test("updateIntegration on an id that names no row throws", async () => {
    expect(await failure(store.updateIntegration(db, 32_000, { enabled: true }))).toContain(
      "32000",
    );
  });

  test("deleteIntegration reports whether a row went", async () => {
    const plant = await freshPlant("int-delete");
    const broker = await freshBroker(plant.id, "int-delete broker");
    const row = await store.createIntegration(db, plant.id, {
      connectionId: broker.id,
      kind: "evcc-ingest",
      params: { topicRoot: "evcc" },
    });
    expect(await store.deleteIntegration(db, row.id)).toBe(true);
    expect(await store.deleteIntegration(db, row.id)).toBe(false);
    expect(await store.readIntegrations(db, plant.id)).toEqual([]);
  });

  test("a kind no arm covers is loud on READ, not silently defaulted", async () => {
    // The CHECK is what normally stops this; the row is written past it here to
    // reach the case that actually matters — a database migrated ahead of the
    // binary — and prove the reader THROWS rather than yielding an integration
    // nothing starts.
    const plant = await freshPlant("int-future-kind");
    await db.execute(sql`alter table integrations drop constraint integrations_kind_check`);
    try {
      await db.execute(
        sql`insert into integrations (plant_id, kind) values (${plant.id}, 'weather')`,
      );
      expect(await failure(store.readIntegrations(db, plant.id))).not.toBe("");
    } finally {
      await db.execute(sql`delete from integrations where plant_id = ${plant.id}`);
      await db.execute(sql`
        alter table integrations add constraint integrations_kind_check
        check (kind in ('evcc-ingest', 'ha-export'))`);
    }
  });
});
