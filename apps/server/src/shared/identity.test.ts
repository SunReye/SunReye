import { describe, expect, test } from "bun:test";
import { type MetricKeySpec } from "@SunReye/db/metric-keys";

import { createIdentityResolver } from "./identity";

/**
 * The write-path resolver, driven against in-memory doubles.
 *
 * It exists because the read path's SQL sub-selects (`./identity-sql.ts`) are the
 * wrong shape for a `VALUES` list of thousands of rows: one sub-select per row,
 * on the hottest path in the app. So this side resolves in process and CACHES —
 * which makes the caching rules the thing worth testing, not the SQL.
 */

/** A `MetricKeyWriter`-shaped double that answers a device lookup from a map. */
function fakeDb(devices: Record<string, number>) {
  const queries: string[] = [];
  return {
    queries,
    execute: async (query: { queryChunks?: unknown[] }) => {
      queries.push(JSON.stringify(query.queryChunks ?? []));
      // The device lookup binds the source id; find it among the chunk params.
      const text = JSON.stringify(query);
      const hit = Object.keys(devices).find((slug) => text.includes(`"${slug}"`));
      return { rows: hit === undefined ? [] : [{ id: devices[hit] }] };
    },
  };
}

const specs = [
  { key: "pv.power", isCounter: false },
  { key: "pv.energy.total", isCounter: true },
];

describe("device resolution", () => {
  test("resolves a source id to its device id", async () => {
    const r = createIdentityResolver({ db: fakeDb({ "deye-1": 7 }) });
    expect(await r.deviceId("deye-1")).toBe(7);
  });

  test("an unknown device is null, never a throw — an unknown device is 'no data'", async () => {
    const r = createIdentityResolver({ db: fakeDb({}) });
    expect(await r.deviceId("ghost")).toBeNull();
  });

  test("a resolved id is cached: the second call issues no query", async () => {
    const db = fakeDb({ "deye-1": 7 });
    const r = createIdentityResolver({ db });
    await r.deviceId("deye-1");
    const after = db.queries.length;
    await r.deviceId("deye-1");
    expect(db.queries.length).toBe(after);
  });

  test("a MISS is never cached — onboarding creates the device while the process runs", async () => {
    // Negative caching here would mean a server that booted before the device
    // row existed writes nothing until it is restarted.
    const db = fakeDb({});
    const r = createIdentityResolver({ db });
    await r.deviceId("later");
    const after = db.queries.length;
    await r.deviceId("later");
    expect(db.queries.length).toBeGreaterThan(after);
  });

  test("concurrent lookups of the same id share one query", async () => {
    const db = fakeDb({ "deye-1": 7 });
    const r = createIdentityResolver({ db });
    const [a, b] = await Promise.all([r.deviceId("deye-1"), r.deviceId("deye-1")]);
    expect([a, b]).toEqual([7, 7]);
    expect(db.queries).toHaveLength(1);
  });

  test("id 0 is a resolved id, not a miss", async () => {
    // `smallint GENERATED ALWAYS AS IDENTITY` starts at 1, so this cannot happen
    // today — but a falsy-check would make it a silent data-loss bug if it ever
    // did, and the check costs nothing.
    const r = createIdentityResolver({ db: fakeDb({ zero: 0 }) });
    expect(await r.deviceId("zero")).toBe(0);
  });
});

describe("metric key registration", () => {
  test("registers a profile's metrics eagerly and returns key -> id", async () => {
    const seen: Array<readonly { key: string; isCounter: boolean }[]> = [];
    const r = createIdentityResolver({
      db: fakeDb({}),
      ensure: async (_db, s) => {
        seen.push([...s]);
        return new Map(s.map((x, i) => [x.key, i + 1]));
      },
    });
    await r.registerMetrics(specs);
    expect(seen).toEqual([specs]);
    expect(await r.metricId("pv.energy.total")).toBe(2);
  });

  test("the counter class reaches the registration — the aggregates need it", async () => {
    let got: readonly { key: string; isCounter: boolean }[] = [];
    const r = createIdentityResolver({
      db: fakeDb({}),
      ensure: async (_db, s) => {
        got = [...s];
        return new Map(s.map((x) => [x.key, 1]));
      },
    });
    await r.registerMetrics(specs);
    expect(got.find((s) => s.key === "pv.energy.total")?.isCounter).toBe(true);
  });

  test("an already-registered key costs no round trip", async () => {
    let calls = 0;
    const r = createIdentityResolver({
      db: fakeDb({}),
      ensure: async (_db, s) => {
        calls += 1;
        return new Map(s.map((x, i) => [x.key, i + 1]));
      },
    });
    await r.registerMetrics(specs);
    expect(calls).toBe(1);
    await r.metricIds(["pv.power"]);
    expect(calls).toBe(1);
  });

  test("an UNSEEN key is registered lazily — a profile can be installed with no restart", async () => {
    // `installProfile` registers a profile from a user-supplied URL without a
    // restart, and `schema.ts` validates a metric key as `z.string().min(1)`, so
    // the set of keys is open at runtime by design.
    const registered: string[] = [];
    const r = createIdentityResolver({
      db: fakeDb({}),
      ensure: async (_db, s) => {
        registered.push(...s.map((x) => x.key));
        return new Map(s.map((x) => [x.key, 42]));
      },
    });
    await r.registerMetrics(specs);
    const ids = await r.metricIds(["pv.power", "surprise.metric"]);
    // Only the unseen key is sent — not the whole batch again.
    expect(registered).toEqual([...specs.map((s) => s.key), "surprise.metric"]);
    expect(ids.get("surprise.metric")).toBe(42);
  });

  test("a lazily registered key defaults to NOT a counter — the answer that cannot corrupt a delta", async () => {
    let got: readonly { key: string; isCounter: boolean }[] = [];
    const r = createIdentityResolver({
      db: fakeDb({}),
      ensure: async (_db, s) => {
        got = [...s];
        return new Map(s.map((x) => [x.key, 5]));
      },
    });
    await r.metricIds(["unknown.key"]);
    expect(got).toEqual([{ key: "unknown.key", isCounter: false }]);
  });

  test("an EMPTY batch issues nothing — a VALUES list with no rows is a syntax error", async () => {
    let calls = 0;
    const r = createIdentityResolver({
      db: fakeDb({}),
      ensure: async () => {
        calls += 1;
        return new Map();
      },
    });
    expect((await r.metricIds([])).size).toBe(0);
    await r.registerMetrics([]);
    expect(calls).toBe(0);
  });

  test("re-registering the same profile does not re-send keys it already holds", async () => {
    // int2 caps the dimension at 32767 against ~108 metrics per profile. That is
    // ample only while a reinstall REUSES rows, and the cheapest way not to churn
    // them is not to ask.
    let batches = 0;
    const r = createIdentityResolver({
      db: fakeDb({}),
      ensure: async (_db, s) => {
        batches += 1;
        return new Map(s.map((x, i) => [x.key, i + 1]));
      },
    });
    await r.registerMetrics(specs);
    await r.registerMetrics(specs);
    expect(batches).toBe(1);
  });

  test("a corrected counter class is re-sent, because the id must stay put while the class changes", async () => {
    const sent: Array<readonly MetricKeySpec[]> = [];
    const r = createIdentityResolver({
      db: fakeDb({}),
      ensure: async (_db, s) => {
        sent.push([...s]);
        return new Map(s.map((x) => [x.key, 3]));
      },
    });
    await r.registerMetrics([{ key: "e.total", isCounter: false }]);
    await r.registerMetrics([{ key: "e.total", isCounter: true }]);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual([{ key: "e.total", isCounter: true }]);
  });

  test("the stated unit reaches the registration — it is unrecoverable once the profile goes", async () => {
    const sent: Array<readonly MetricKeySpec[]> = [];
    const r = createIdentityResolver({
      db: fakeDb({}),
      ensure: async (_db, s) => {
        sent.push([...s]);
        return new Map(s.map((x) => [x.key, 4]));
      },
    });
    await r.registerMetrics([{ key: "pv.power", isCounter: false, unit: "W" }]);
    expect(sent[0]).toEqual([{ key: "pv.power", isCounter: false, unit: "W" }]);
  });

  test("a corrected unit is re-sent even though the key and class are unchanged", async () => {
    // Without the unit in the staleness check the cache would answer from the
    // first registration and the correction would never reach the row.
    const sent: Array<readonly MetricKeySpec[]> = [];
    const r = createIdentityResolver({
      db: fakeDb({}),
      ensure: async (_db, s) => {
        sent.push([...s]);
        return new Map(s.map((x) => [x.key, 5]));
      },
    });
    await r.registerMetrics([{ key: "pv.power", isCounter: false, unit: "kW" }]);
    await r.registerMetrics([{ key: "pv.power", isCounter: false, unit: "W" }]);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual([{ key: "pv.power", isCounter: false, unit: "W" }]);
  });

  test("re-registering the identical unit sends nothing", async () => {
    const sent: Array<readonly MetricKeySpec[]> = [];
    const r = createIdentityResolver({
      db: fakeDb({}),
      ensure: async (_db, s) => {
        sent.push([...s]);
        return new Map(s.map((x) => [x.key, 6]));
      },
    });
    await r.registerMetrics([{ key: "pv.power", isCounter: false, unit: "W" }]);
    await r.registerMetrics([{ key: "pv.power", isCounter: false, unit: "W" }]);
    expect(sent).toHaveLength(1);
  });

  test("a profile that drops a unit does not re-send, so absence never erases", async () => {
    // The upsert already refuses to write a null over a stated unit; not
    // re-sending is the cheaper half of the same guarantee.
    const sent: Array<readonly MetricKeySpec[]> = [];
    const r = createIdentityResolver({
      db: fakeDb({}),
      ensure: async (_db, s) => {
        sent.push([...s]);
        return new Map(s.map((x) => [x.key, 7]));
      },
    });
    await r.registerMetrics([{ key: "pv.power", isCounter: false, unit: "W" }]);
    await r.registerMetrics([{ key: "pv.power", isCounter: false }]);
    expect(sent).toHaveLength(1);
  });

  test("the lazy path never invents a unit for a key it has not seen", async () => {
    const sent: Array<readonly MetricKeySpec[]> = [];
    const r = createIdentityResolver({
      db: fakeDb({}),
      ensure: async (_db, s) => {
        sent.push([...s]);
        return new Map(s.map((x) => [x.key, 8]));
      },
    });
    await r.metricId("surprise.metric");
    expect(sent[0]).toEqual([{ key: "surprise.metric", isCounter: false }]);
  });

  test("the lazy path re-states the unit the eager path registered", async () => {
    const sent: Array<readonly MetricKeySpec[]> = [];
    const r = createIdentityResolver({
      db: fakeDb({}),
      ensure: async (_db, s) => {
        sent.push([...s]);
        return new Map(s.map((x) => [x.key, 9]));
      },
    });
    await r.registerMetrics([{ key: "pv.power", isCounter: false, unit: "W" }]);
    // A second batch mentioning the same key must not downgrade it to "unknown
    // unit" — the row would keep its unit thanks to the upsert, but a needless
    // re-send on every batch is a round trip on the hottest path.
    await r.metricIds(["pv.power"]);
    expect(sent).toHaveLength(1);
  });
});

describe("reset", () => {
  test("drops every cached id, so a database swap cannot be written under stale ids", async () => {
    const db = fakeDb({ "deye-1": 7 });
    const r = createIdentityResolver({ db });
    await r.deviceId("deye-1");
    r.reset();
    const before = db.queries.length;
    await r.deviceId("deye-1");
    expect(db.queries.length).toBeGreaterThan(before);
  });
});
