import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import createClient from "openapi-fetch";
import type { paths as CorePaths } from "$lib/core-api.gen";

// mock-hygiene-ignore-next-line -- SvelteKit virtual modules: no real module exists under bun test. The server-side values keep `$lib/api` loadable.
mock.module("$app/environment", () => ({ browser: false }));
// mock-hygiene-ignore-next-line -- SvelteKit virtual module, see above.
mock.module("$app/navigation", () => ({ goto: async () => {} }));
// mock-hygiene-ignore-next-line -- SvelteKit virtual module, see above.
mock.module("$env/dynamic/public", () => ({ env: {} }));
// mock-hygiene-ignore-next-line -- a rune module: it cannot be compiled, so cannot be imported, under bun test.
mock.module("$lib/source.svelte", () => ({ source: { query: { source: "plant" } } }));

const realCore = await import("$lib/core-api");
const realCoreExports = { ...realCore };

type Query = Record<string, string>;
type Point = { time: string; avg: number; min: number; max: number };
const queries: Query[] = [];
const paths: string[] = [];
let answer: (query: Query) => Response | Promise<Response> = () => json([]);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

mock.module("$lib/core-api", () => ({
  ...realCore,
  core: createClient<CorePaths>({
    baseUrl: "http://core.test",
    fetch: async (request) => {
      const url = new URL(request.url);
      paths.push(url.pathname);
      const query = Object.fromEntries(url.searchParams);
      queries.push(query);
      return answer(query);
    },
  }),
}));

afterAll(() => {
  mock.module("$lib/core-api", () => ({ ...realCoreExports }));
});

const { fetchSeriesSet } = await import("./device-series");

const WINDOW = { from: new Date("2026-09-01T00:00:00Z"), to: new Date("2026-09-01T01:00:00Z") };
const point = (time: string, avg: number, min = avg, max = avg): Point => ({ time, avg, min, max });

beforeEach(() => {
  queries.length = 0;
  answer = () => json([]);
  paths.length = 0;
});

describe("fetchSeriesSet", () => {
  test("each alias is its metric's buckets keyed by epoch ms", async () => {
    answer = () => json([point("2026-09-01T00:00:00Z", 100), point("2026-09-01T00:01:00Z", 150)]);
    const { pv } = await fetchSeriesSet({ pv: { metric: "pv.power" } }, WINDOW);
    expect([...pv]).toEqual([
      [Date.parse("2026-09-01T00:00:00Z"), 100],
      [Date.parse("2026-09-01T00:01:00Z"), 150],
    ]);
  });

  test("the read is the core's rollup route", async () => {
    await fetchSeriesSet({ pv: { metric: "pv.power" } }, WINDOW);
    expect(paths).toEqual(["/api/history/rollup"]);
  });

  test("the request carries the window, the minute tier and the row cap", async () => {
    await fetchSeriesSet({ pv: { metric: "pv.power" } }, WINDOW);
    expect(queries).toEqual([
      {
        metric: "pv.power",
        source: "plant",
        bucket: "minute",
        from: "2026-09-01T00:00:00.000Z",
        to: "2026-09-01T01:00:00.000Z",
        limit: "1441",
      },
    ]);
  });

  test("a stated bucket is honoured", async () => {
    await fetchSeriesSet({ pv: { metric: "pv.power" } }, { ...WINDOW, bucket: "hour" });
    expect(queries[0]?.bucket).toBe("hour");
  });

  test("a ref naming a device reads that slug, not the selected source", async () => {
    await fetchSeriesSet({ t: { metric: "optimizer.state", inverterId: "optimizer" } }, WINDOW);
    expect(queries[0]).toMatchObject({ inverterId: "optimizer" });
    expect(queries[0]).not.toHaveProperty("source");
  });

  test("two aliases over one metric and device share ONE request and differ by aggregate", async () => {
    answer = () => json([point("2026-09-01T00:00:00Z", 1.5, 1, 2)]);
    const out = await fetchSeriesSet(
      {
        lo: { metric: "optimizer.state", inverterId: "optimizer", agg: "min" },
        hi: { metric: "optimizer.state", inverterId: "optimizer", agg: "max" },
        mean: { metric: "optimizer.state", inverterId: "optimizer" },
      },
      WINDOW,
    );
    expect(queries).toHaveLength(1);
    const t = Date.parse("2026-09-01T00:00:00Z");
    expect(out.lo.get(t)).toBe(1);
    expect(out.hi.get(t)).toBe(2);
    expect(out.mean.get(t)).toBe(1.5);
  });

  test("the same metric on two devices is two requests", async () => {
    await fetchSeriesSet(
      { a: { metric: "pv.power", inverterId: "a" }, b: { metric: "pv.power", inverterId: "b" } },
      WINDOW,
    );
    expect(queries.map((q) => q.inverterId)).toEqual(["a", "b"]);
  });

  test("a null ref is an empty series and costs no request", async () => {
    const out = await fetchSeriesSet({ pv: { metric: "pv.power" }, load: null }, WINDOW);
    expect(queries).toHaveLength(1);
    expect(out.load.size).toBe(0);
  });

  test("an empty body, a non-array body, a refusal and an unreachable core are an empty series, not a throw", async () => {
    const answers: (() => Response | Promise<Response>)[] = [
      () => json([]),
      () => new Response(null, { status: 200 }),
      () => json(null),
      () => json({ error: "metric is required" }, 400),
      () => json({ error: "unauthorized" }, 401),
      () => Promise.reject(new TypeError("fetch failed")),
    ];
    for (const next of answers) {
      answer = next;
      const { pv } = await fetchSeriesSet({ pv: { metric: "pv.power" } }, WINDOW);
      expect(pv.size).toBe(0);
    }
  });

  test("a zero reading is a reading", async () => {
    answer = () => json([point("2026-09-01T00:00:00Z", 0)]);
    const { pv } = await fetchSeriesSet({ pv: { metric: "pv.power" } }, WINDOW);
    expect(pv.get(Date.parse("2026-09-01T00:00:00Z"))).toBe(0);
  });

  test("no refs, no requests", async () => {
    expect(await fetchSeriesSet({}, WINDOW)).toEqual({});
    expect(queries).toEqual([]);
  });
});
