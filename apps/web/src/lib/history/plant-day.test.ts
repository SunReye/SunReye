import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

// mock-hygiene-ignore-next-line -- SvelteKit virtual modules: no real module exists under bun test. The server-side values keep `$lib/api` loadable.
mock.module("$app/environment", () => ({ browser: false }));
// mock-hygiene-ignore-next-line -- SvelteKit virtual module, see above.
mock.module("$app/navigation", () => ({ goto: async () => {} }));
// mock-hygiene-ignore-next-line -- SvelteKit virtual module, see above.
mock.module("$env/dynamic/public", () => ({ env: {} }));
// mock-hygiene-ignore-next-line -- a rune module: it cannot be compiled, so cannot be imported, under bun test.
mock.module("$lib/source.svelte", () => ({ source: { query: { source: "plant" } } }));
let roles: Record<string, string> = {};
// mock-hygiene-ignore-next-line -- a rune module: it cannot be compiled, so cannot be imported, under bun test.
mock.module("$lib/inverter/store.svelte", () => ({
  inverter: { byRole: (role: string) => (roles[role] ? { key: roles[role] } : undefined) },
}));

const realApi = await import("$lib/api");
const realApiExports = { ...realApi };

type Query = { metric: string; from: string; to: string; bucket: string };
const queries: Query[] = [];
let points: Record<string, Array<{ time: string; avg: number }>> = {};
mock.module("$lib/api", () => ({
  ...realApi,
  api: {
    api: {
      history: {
        rollup: {
          get: async ({ query }: { query: Query }) => {
            queries.push(query);
            return { data: points[query.metric] ?? [] };
          },
        },
      },
    },
  },
}));

afterAll(() => {
  mock.module("$lib/api", () => ({ ...realApiExports }));
});

const { fetchMeasuredDay } = await import("./plant-day");

const T0 = "2026-09-01T10:00:00Z";
const T0_MS = Date.parse(T0);

beforeEach(() => {
  queries.length = 0;
  roles = {};
  points = {};
});

describe("fetchMeasuredDay", () => {
  test("a profile with no total PV metric has no day, and nothing is fetched", async () => {
    roles = { "battery.power": "battery.power", "grid.power": "grid.power" };
    expect(await fetchMeasuredDay()).toBeNull();
    expect(queries).toEqual([]);
  });

  test("reads only the roles the profile maps, over local midnight to now at the minute tier", async () => {
    roles = { "pv.total.power": "pv.total", "battery.soc": "battery.soc" };
    await fetchMeasuredDay();
    expect(queries.map((q) => q.metric).sort()).toEqual(["battery.soc", "pv.total"]);
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    for (const q of queries) {
      expect(q.bucket).toBe("minute");
      expect(q.from).toBe(midnight.toISOString());
      expect(Date.parse(q.to)).toBeGreaterThanOrEqual(midnight.getTime());
    }
  });

  test("decomposes the measured day: PV splits into charge, export and the house remainder", async () => {
    roles = {
      "pv.total.power": "pv",
      "battery.power": "batt",
      "grid.power": "grid",
      "battery.soc": "soc",
    };
    points = {
      pv: [{ time: T0, avg: 5000 }],
      // Negative battery and grid power are charge and export.
      batt: [{ time: T0, avg: -1000 }],
      grid: [{ time: T0, avg: -2000 }],
      soc: [{ time: T0, avg: 60 }],
    };
    const day = await fetchMeasuredDay();
    expect(day?.power).toEqual([
      {
        t: new Date(T0_MS),
        pvKw: 5,
        chargeKw: 1,
        exportKw: 2,
        loadKw: 2,
        curtailedKw: 0,
        thresholdKw: 0,
        socPct: 60,
      },
    ]);
    expect(day?.soc).toEqual([{ t: T0_MS, socPct: 60 }]);
  });

  test("an unmetered battery and grid leave the whole PV to the house", async () => {
    roles = { "pv.total.power": "pv" };
    points = { pv: [{ time: T0, avg: 3000 }] };
    const day = await fetchMeasuredDay();
    expect(day?.power[0]).toMatchObject({ pvKw: 3, loadKw: 3, chargeKw: 0, exportKw: 0 });
    expect(day?.soc).toEqual([]);
  });
});
