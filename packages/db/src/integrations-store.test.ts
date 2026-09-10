import { describe, expect, test } from "bun:test";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import {
  createIntegration,
  deleteIntegration,
  readIntegrations,
  updateIntegration,
} from "./integrations-store";

/**
 * The TRANSLATION either side of an `integrations` statement — the row shapes
 * that come back, the numeric coercion (`smallint` arrives as a string through
 * this driver, and a lookup keyed by "3" instead of 3 fails silently at the
 * call site), the JSONB cast, and the case where the right SQL is NO SQL.
 *
 * NOT proof that the statements run: a SQL-text assertion cannot be that
 * (`AGENTS.md`), so `apps/server/db-tests/integrations-store.test.ts` executes
 * every one of them against a real Postgres.
 */
const dialect = new PgDialect();
const rendered = (query: SQL | undefined): string =>
  query === undefined ? "" : dialect.sqlToQuery(query).sql;

function fakeClient(queue: Array<Array<Record<string, unknown>>> = []) {
  const executed: SQL[] = [];
  const client = {
    async execute(query: SQL) {
      executed.push(query);
      return { rows: queue.shift() ?? [] };
    },
  };
  return { client, executed };
}

/** A row exactly as node-postgres hands it over: smallints as strings. */
const row = (over: Record<string, unknown> = {}) => ({
  id: "4",
  connectionId: "5",
  kind: "evcc-ingest",
  enabled: true,
  params: { topicRoot: "evcc" },
  ...over,
});

describe("readIntegrations", () => {
  test("it returns the plant's rows, lowest id first, with numbers as numbers", async () => {
    const { client, executed } = fakeClient([
      [row(), row({ id: "9", kind: "ha-export", params: {} })],
    ]);
    const rows = await readIntegrations(client, 7);
    expect(rows[0]).toEqual({
      id: 4,
      connectionId: 5,
      enabled: true,
      kind: "evcc-ingest",
      params: { topicRoot: "evcc" },
    });
    expect(typeof rows[0]?.id).toBe("number");
    expect(typeof rows[0]?.connectionId).toBe("number");
    expect(rendered(executed[0])).toContain("order by id asc");
    expect(rendered(executed[0])).toContain("plant_id");
  });

  test("an empty params document parses to the arm's DEFAULTS, not to {}", async () => {
    // A row's presence means "configured"; a caller reading `params.topicPrefix`
    // must never find it absent because the operator saved the defaults.
    const { client } = fakeClient([[row({ kind: "ha-export", params: {} })]]);
    const [only] = await readIntegrations(client, 7);
    expect(only?.params).toEqual({
      topicPrefix: "sunreye",
      haDiscoveryEnabled: false,
      haDiscoveryPrefix: "homeassistant",
    });
  });

  test("a connection-less row keeps its null rather than becoming 0", async () => {
    const { client } = fakeClient([[row({ connectionId: null })]]);
    expect((await readIntegrations(client, 7))[0]?.connectionId).toBeNull();
  });

  test("a plant with no integrations reads as an empty list", async () => {
    const { client } = fakeClient([[]]);
    expect(await readIntegrations(client, 7)).toEqual([]);
  });

  test("a kind this build has no arm for THROWS rather than defaulting silently", async () => {
    // The whole reason this is a row and not an `app_settings` document: a
    // database migrated ahead of the binary is loud here.
    const { client } = fakeClient([[row({ kind: "weather" })]]);
    expect(readIntegrations(client, 7)).rejects.toThrow();
  });
});

describe("createIntegration", () => {
  test("it inserts the plant, connection, kind and a CAST params document", async () => {
    const { client, executed } = fakeClient([[row()]]);
    const created = await createIntegration(client, 7, {
      connectionId: 5,
      kind: "evcc-ingest",
      params: { topicRoot: "evcc" },
    });
    expect(created.id).toBe(4);
    const sqlText = rendered(executed[0]);
    expect(sqlText).toContain("insert into integrations");
    expect(sqlText).toContain("::jsonb");
    expect(sqlText).toContain("returning");
  });

  test("a connection-less insert carries a null rather than omitting the column", async () => {
    const { client, executed } = fakeClient([
      [row({ connectionId: null, kind: "ha-export", params: {} })],
    ]);
    const created = await createIntegration(client, 7, {
      connectionId: null,
      kind: "ha-export",
      params: {},
    });
    expect(created.connectionId).toBeNull();
    expect(rendered(executed[0])).toContain("connection_id");
  });

  test("an insert that returns nothing throws rather than handing back a half row", async () => {
    const { client } = fakeClient([[]]);
    expect(
      createIntegration(client, 7, { connectionId: 5, kind: "evcc-ingest", params: {} }),
    ).rejects.toThrow(/could not be created/);
  });
});

describe("updateIntegration", () => {
  test("`enabled` alone renders one assignment and no params write", async () => {
    const { client, executed } = fakeClient([[], [row({ enabled: false })]]);
    const updated = await updateIntegration(client, 4, { enabled: false });
    expect(updated.enabled).toBe(false);
    expect(rendered(executed[0])).toContain("enabled");
    expect(rendered(executed[0])).not.toContain("params");
  });

  test("`params` REPLACES, cast to jsonb", async () => {
    const { client, executed } = fakeClient([[], [row({ params: { topicRoot: "garage" } })]]);
    const updated = await updateIntegration(client, 4, { params: { topicRoot: "garage" } });
    expect(updated.params).toEqual({ topicRoot: "garage" });
    expect(rendered(executed[0])).toContain("::jsonb");
  });

  test("an EMPTY patch runs no UPDATE at all — `set` with no assignments is a syntax error", async () => {
    const { client, executed } = fakeClient([[row()]]);
    await updateIntegration(client, 4, {});
    expect(executed).toHaveLength(1);
    expect(rendered(executed[0])).toContain("select");
  });

  test("an id that names no row throws", async () => {
    const { client } = fakeClient([[], []]);
    expect(updateIntegration(client, 404, { enabled: true })).rejects.toThrow(/404/);
  });
});

describe("deleteIntegration", () => {
  test("it reports whether a row went", async () => {
    const gone = fakeClient([[{ id: "4" }]]);
    expect(await deleteIntegration(gone.client, 4)).toBe(true);
    expect(rendered(gone.executed[0])).toContain("delete from integrations");

    const none = fakeClient([[]]);
    expect(await deleteIntegration(none.client, 4)).toBe(false);
  });
});
