import { describe, expect, test } from "bun:test";
import type { CostBreakdown, CostSeriesPoint, PeriodEnergy } from "@SunReye/contracts/energy";
import type { SpotStats } from "@SunReye/contracts/prices";
import type { ComparisonResponse } from "@SunReye/contracts/statistics";
import type { ChartSpec, CostRange } from "$lib/cost/ranges";
import {
  statisticsQuery,
  type StatisticsQuery,
  type ApiResponse,
  type StatisticsApi,
  type StatisticsRead,
} from "./statistics-query";

// A deferred answer per call, so a test decides when (and whether) each request
// lands — which is the whole of cancellation and in-flight sharing.
type Call = {
  endpoint: keyof StatisticsApi;
  query: unknown;
  settle: (r: ApiResponse) => void;
  fail: () => void;
};

function harness(opts: { maxEntries?: number } = {}) {
  const calls: Call[] = [];
  const endpoint =
    (name: keyof StatisticsApi) =>
    (query?: unknown): Promise<ApiResponse> =>
      new Promise((resolve, reject) => {
        calls.push({
          endpoint: name,
          query,
          settle: resolve,
          fail: () => reject(new Error("net")),
        });
      });
  const api: StatisticsApi = {
    comparison: endpoint("comparison"),
    costSeries: endpoint("costSeries"),
    energySeries: endpoint("energySeries"),
    records: endpoint("records"),
    amortisation: endpoint("amortisation"),
    heatmap: endpoint("heatmap"),
    spotStats: endpoint("spotStats"),
    dayAheadPrices: endpoint("dayAheadPrices"),
    batteryHealth: endpoint("batteryHealth"),
  };
  // Plain objects standing in for the runes stores: the module only ever READS
  // them, synchronously, which is what lets an $effect track the same reads.
  const live = { revision: 0, priceRevision: 0 };
  const scope = { query: { source: "plant" } };
  const query = statisticsQuery({
    api,
    live,
    source: scope,
    now: () => new Date("2026-08-15T12:00:00Z"),
    ...opts,
  });
  return { calls, live, scope, query };
}

/** Subscribe and collect every value delivered. */
function collect<T>(read: StatisticsRead<T>) {
  const seen: T[] = [];
  const dispose = read.subscribe((v) => seen.push(v));
  return { seen, dispose };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

const spec = (day: string, bucket: ChartSpec["bucket"] = "day"): ChartSpec => ({
  from: new Date(`${day}T00:00:00Z`),
  to: new Date(`${day}T23:00:00Z`),
  bucket,
  caption: "",
});

const point = (bucket: string, net: number): CostSeriesPoint => ({
  bucket,
  importCost: net,
  exportEarnings: 0,
  zeroValueExportKwh: 0,
  zeroValueExportEur: 0,
  standingCharge: 0,
  net,
});

describe("fetching", () => {
  test("a series read carries the spec and the selected source, and pairs the points with the bucket they were fetched at", async () => {
    const { calls, query } = harness();
    const got = collect(query.costSeries(spec("2026-08-01", "hour")));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.query).toEqual({
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-08-01T23:00:00.000Z",
      bucket: "hour",
      source: "plant",
    });
    calls[0]!.settle({ data: [point("2026-08-01T10", 3)] });
    await flush();
    expect(got.seen).toEqual([{ points: [point("2026-08-01T10", 3)], bucket: "hour" }]);
  });

  test("an absent body reads as an empty series, not a crash", async () => {
    const { calls, query } = harness();
    const got = collect(query.energySeries(spec("2026-08-01")));
    calls[0]!.settle({ data: null });
    await flush();
    expect(got.seen).toEqual([{ periods: [], bucket: "day" }]);
  });

  test('Elysia\'s empty-body null (the string "") is no payload', async () => {
    const { calls, query } = harness();
    const got = collect(query.amortisation());
    calls[0]!.settle({ data: "" });
    await flush();
    expect(got.seen).toEqual([null]);
  });

  test("nothing is requested until someone subscribes", () => {
    const { calls, query } = harness();
    query.records();
    expect(calls).toHaveLength(0);
  });

  test("the comparison asks for the PRICED window, and drops a reference that predates recorded history", async () => {
    const { calls, query } = harness();
    // A month the clock (Aug 15) is standing in: the priced window ends now.
    const range = {
      from: new Date("2026-08-01T00:00:00Z"),
      to: new Date("2026-09-01T00:00:00Z"),
    } as CostRange;
    const got = collect(query.comparison(range, "previous"));
    expect(calls[0]!.query).toEqual({
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-08-15T12:00:00.000Z",
      mode: "previous",
      source: "plant",
    });
    const current = { net: 1 } as CostBreakdown;
    const previous = { net: 2 } as CostBreakdown;
    const payload = {
      current,
      previous,
      coverage: { dataFrom: "2026-08-01T00:00:00.000Z" },
    } as unknown as ComparisonResponse;
    calls[0]!.settle({ data: payload });
    await flush();
    expect(got.seen).toEqual([{ current, previous: null }]);
  });

  test("the year-over-year read fetches both monthly series and folds each to one value per month", async () => {
    const { calls, query } = harness();
    const window = { from: "2024-09-01T00:00:00.000Z", to: "2026-08-15T12:00:00.000Z" };
    const got = collect(query.yoy(window));
    expect(calls.map((c) => c.endpoint)).toEqual(["costSeries", "energySeries"]);
    expect(calls[0]!.query).toEqual({ ...window, bucket: "month", source: "plant" });
    calls[0]!.settle({ data: [point("2026-07", 12)] });
    calls[1]!.settle({ data: [{ bucket: "2026-07", productionKwh: 400 } as PeriodEnergy] });
    await flush();
    expect(got.seen).toEqual([
      {
        net: [{ bucket: "2026-07", value: 12 }],
        production: [{ bucket: "2026-07", value: 400 }],
      },
    ]);
  });
});

describe("cancellation", () => {
  test("a disposed subscriber never hears the answer it asked for", async () => {
    const { calls, query } = harness();
    const got = collect(
      query.heatmap(new Date("2026-08-01T00:00:00Z"), new Date("2026-08-08T00:00:00Z")),
    );
    got.dispose();
    calls[0]!.settle({ data: [] });
    await flush();
    expect(got.seen).toEqual([]);
  });

  test("an earlier request landing after a later one cannot clobber it", async () => {
    const { calls, query } = harness();
    const first = collect(query.costSeries(spec("2026-08-01")));
    first.dispose(); // the spec moved on
    const second = collect(query.costSeries(spec("2026-08-02")));
    calls[1]!.settle({ data: [point("2026-08-02", 2)] });
    calls[0]!.settle({ data: [point("2026-08-01", 1)] });
    await flush();
    expect(first.seen).toEqual([]);
    expect(second.seen.map((s) => s.points[0]!.bucket)).toEqual(["2026-08-02"]);
  });
});

describe("cache by spec", () => {
  test("a settled answer is handed back synchronously, with no second request", async () => {
    const { calls, query } = harness();
    collect(query.costSeries(spec("2026-08-01")));
    calls[0]!.settle({ data: [point("2026-08-01", 1)] });
    await flush();
    const again = collect(query.costSeries(spec("2026-08-01")));
    expect(calls).toHaveLength(1);
    expect(again.seen).toHaveLength(1);
  });

  test("two readers of one spec in flight share one request", async () => {
    const { calls, query } = harness();
    const a = collect(
      query.spotStats(new Date("2026-08-01T00:00:00Z"), new Date("2026-09-01T00:00:00Z")),
    );
    const b = collect(
      query.spotStats(new Date("2026-08-01T00:00:00Z"), new Date("2026-09-01T00:00:00Z")),
    );
    expect(calls).toHaveLength(1);
    const stats = { currency: "EUR" } as SpotStats;
    calls[0]!.settle({ data: stats });
    await flush();
    expect(a.seen).toEqual([stats]);
    expect(b.seen).toEqual([stats]);
  });

  test("a different source is a different spec", () => {
    const { calls, query, scope } = harness();
    collect(query.records());
    scope.query = { source: "inverter-2" };
    collect(query.records());
    expect(calls.map((c) => c.query)).toEqual([{ source: "plant" }, { source: "inverter-2" }]);
  });

  test("a failed answer is delivered but not kept, so the next read retries", async () => {
    const { calls, query } = harness();
    const got = collect(query.costSeries(spec("2026-08-01")));
    calls[0]!.settle({ data: null, error: { status: 500 } });
    await flush();
    expect(got.seen).toEqual([{ points: [], bucket: "day" }]);
    collect(query.costSeries(spec("2026-08-01")));
    expect(calls).toHaveLength(2);
  });

  test("a rejected request delivers nothing and is not kept", async () => {
    const { calls, query } = harness();
    const got = collect(query.records());
    calls[0]!.fail();
    await flush();
    expect(got.seen).toEqual([]);
    collect(query.records());
    expect(calls).toHaveLength(2);
  });

  test("the cache is bounded: the oldest spec is dropped past the cap", async () => {
    const { calls, query } = harness({ maxEntries: 2 });
    for (const day of ["2026-08-01", "2026-08-02", "2026-08-03"]) {
      collect(query.costSeries(spec(day)));
      calls.at(-1)!.settle({ data: [] });
    }
    await flush();
    collect(query.costSeries(spec("2026-08-03")));
    expect(calls).toHaveLength(3);
    collect(query.costSeries(spec("2026-08-01")));
    expect(calls).toHaveLength(4);
  });
});

describe("live invalidation", () => {
  /** Requests issued by one read, and by a second read after `bump`. */
  async function requestsAround(
    read: (q: StatisticsQuery) => StatisticsRead<unknown>,
    bump: (live: { revision: number; priceRevision: number }) => void,
  ): Promise<{ first: number; again: number }> {
    const { calls, query, live } = harness();
    collect(read(query));
    const first = calls.length;
    for (const call of calls) call.settle({ data: [] });
    await flush();
    bump(live);
    collect(read(query));
    return { first, again: calls.length - first };
  }
  const revision = (live: { revision: number }) => (live.revision += 1);
  const priceSync = (live: { priceRevision: number }) => (live.priceRevision += 1);

  const costSeries = (q: StatisticsQuery) => q.costSeries(spec("2026-08-01"));
  const energySeries = (q: StatisticsQuery) => q.energySeries(spec("2026-08-01"));
  const amortisation = (q: StatisticsQuery) => q.amortisation();
  const comparison = (q: StatisticsQuery) =>
    q.comparison(
      { from: new Date("2026-07-01"), to: new Date("2026-08-01") } as CostRange,
      "previous",
    );
  const records = (q: StatisticsQuery) => q.records();
  const heatmap = (q: StatisticsQuery) => q.heatmap(new Date("2026-08-01"), new Date("2026-08-08"));
  const yoy = (q: StatisticsQuery) => q.yoy({ from: "2024-09-01", to: "2026-08-01" });
  const spotStats = (q: StatisticsQuery) =>
    q.spotStats(new Date("2026-08-01"), new Date("2026-08-08"));
  const dayAhead = (q: StatisticsQuery) => q.dayAheadPrices();
  const health = (q: StatisticsQuery) => q.batteryHealth();

  // Every read the window's energy feeds — records, the heatmap, the monthly
  // year-over-year and the spot what-if included, since each is priced or
  // folded from the same counters.
  test.each([
    ["cost series", costSeries],
    ["energy series", energySeries],
    ["amortisation", amortisation],
    ["comparison", comparison],
    ["records", records],
    ["heatmap", heatmap],
    ["year-over-year", yoy],
    ["spot statistics", spotStats],
  ])("a live push makes the %s stale", async (_, read) => {
    const { first, again } = await requestsAround(read, revision);
    expect(again).toBe(first);
  });

  // Neither is derived from the household's energy: the day-ahead curve is the
  // market's, and pack health is a property of the battery.
  test.each([
    ["day-ahead prices", dayAhead],
    ["battery health", health],
  ])("a live push leaves the %s cached", async (_, read) => {
    const { again } = await requestsAround(read, revision);
    expect(again).toBe(0);
  });

  test.each([
    ["spot statistics", spotStats],
    ["day-ahead prices", dayAhead],
  ])("a spot-price sync makes the %s stale", async (_, read) => {
    const { first, again } = await requestsAround(read, priceSync);
    expect(again).toBe(first);
  });

  test("a spot-price sync leaves the energy reads cached", async () => {
    const { again } = await requestsAround(costSeries, priceSync);
    expect(again).toBe(0);
  });
});
