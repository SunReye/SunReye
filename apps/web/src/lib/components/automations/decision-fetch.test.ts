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

type Query = { metric: string; inverterId?: string; source?: string; bucket: string };
const queries: Query[] = [];
let answer: (
  query: Query,
) => Array<{ time: string; avg: number; min: number; max: number }> = () => [];
mock.module("$lib/api", () => ({
  ...realApi,
  api: {
    api: {
      history: {
        rollup: {
          get: async ({ query }: { query: Query }) => {
            queries.push(query);
            return { data: answer(query) };
          },
        },
      },
    },
  },
}));

afterAll(() => {
  mock.module("$lib/api", () => ({ ...realApiExports }));
});

const { fetchDecisionSeries } = await import("./decision-fetch");

const FROM = new Date("2026-09-01T00:00:00Z");
const TO = new Date("2026-09-01T06:00:00Z");
const T = Date.parse("2026-09-01T00:05:00Z");

beforeEach(() => {
  queries.length = 0;
  roles = {};
  answer = () => [];
});

describe("fetchDecisionSeries", () => {
  test("the optimizer's outputs are read by slug, the state as one request for both extremes", async () => {
    await fetchDecisionSeries(FROM, TO);
    const optimizer = queries.filter((q) => q.inverterId === "optimizer").map((q) => q.metric);
    expect(optimizer.sort()).toEqual([
      "optimizer.applied.current",
      "optimizer.local.sink.power",
      "optimizer.state",
      "optimizer.target.current",
      "optimizer.threshold.power",
    ]);
  });

  test("every request is minute-tier", async () => {
    roles = { "pv.total.power": "pv.total" };
    await fetchDecisionSeries(FROM, TO);
    expect(new Set(queries.map((q) => q.bucket))).toEqual(new Set(["minute"]));
  });

  test("the plant's series follow the selected source and only for mapped roles", async () => {
    roles = { "pv.total.power": "pv.total", "grid.power": "grid.power" };
    await fetchDecisionSeries(FROM, TO);
    const plant = queries.filter((q) => q.inverterId === undefined);
    expect(plant.map((q) => q.metric).sort()).toEqual(["grid.power", "pv.total"]);
    for (const q of plant) expect(q.source).toBe("plant");
  });

  test("an unmapped role is an empty series, not a column of zeros", async () => {
    const series = await fetchDecisionSeries(FROM, TO);
    expect(series.pvW.size).toBe(0);
    expect(series.batteryV.size).toBe(0);
  });

  test("the state is read as the bucket's lowest and highest ordinal, never its mean", async () => {
    answer = (q) =>
      q.metric === "optimizer.state"
        ? [{ time: "2026-09-01T00:05:00Z", avg: 1.4, min: 1, max: 2 }]
        : [];
    const series = await fetchDecisionSeries(FROM, TO);
    expect(series.stateMin.get(T)).toBe(1);
    expect(series.stateMax.get(T)).toBe(2);
  });

  test("a mapped role's readings reach its alias", async () => {
    roles = { "battery.power": "battery.power" };
    answer = (q) =>
      q.metric === "battery.power"
        ? [{ time: "2026-09-01T00:05:00Z", avg: -800, min: -900, max: -700 }]
        : [];
    expect((await fetchDecisionSeries(FROM, TO)).batteryW.get(T)).toBe(-800);
  });
});
