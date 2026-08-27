import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { SpotPriceInsert } from "@SunReye/db/schema/spot-price";
import { type SpotPriceConfig, spotPriceConfigSchema } from "@SunReye/db/spot-price-config";
import { type TariffConfig, tariffConfigSchema } from "@SunReye/db/tariff";

// The job is the impure half of the price feed: it counts what is stored, asks a
// provider for what is missing and writes the answer back. Both of those seams
// are stubbed here rather than the job's own logic:
//
//   * `@SunReye/db/spot-price` becomes an in-memory table keyed exactly like the
//     real one — `(zone, slot_start)` — so an overlapping refetch really does
//     overwrite instead of duplicating, and the read path (`spot-price-store`)
//     stays the real module reading the same rows.
//   * the transport is stubbed at `globalThis.fetch`, so the registered
//     providers parse a real payload and map a real status code.
//
// The spreads are load-bearing: `mock.module` is process-global and permanent, so
// a factory returning only the exports this suite needs would delete the rest for
// every file that runs afterwards.
const realSpotPriceDb = await import("@SunReye/db/spot-price");
const realSettings = await import("../settings/settings");

// A module namespace is live: once the stub below is installed, reading
// `realSpotPriceDb.getSpotPrices` yields the stub, so the namespace cannot be
// used to undo the mock. Snapshot the real exports by value first.
const realSpotPriceExports = { ...realSpotPriceDb };
const realSettingsExports = { ...realSettings };

interface StoredRow {
  zone: string;
  slotStart: Date;
  slotMinutes: number;
  eurPerMwh: number;
  provider: string;
}

/** Stand-in for `spot_prices`, keyed by the real primary key. */
const table = new Map<string, StoredRow>();
const rowKey = (zone: string, startMs: number) => `${zone}|${startMs}`;

/** Every batch handed to the upsert, in order — one entry per write. */
const upsertBatches: StoredRow[][] = [];
/** Windows the job asked the count for, so "which days" is assertable. */
const countedWindows: { zone: string; fromMs: number; toMs: number }[] = [];
let upsertError: Error | null = null;

const inWindow = (zone: string, from: Date, to: Date) =>
  [...table.values()]
    .filter((r) => r.zone === zone && r.slotStart >= from && r.slotStart < to)
    .sort((a, b) => a.slotStart.getTime() - b.slotStart.getTime());

mock.module("@SunReye/db/spot-price", () => ({
  ...realSpotPriceDb,
  getSpotPrices: async (zone: string, from: Date, to: Date) => inWindow(zone, from, to),
  countSpotPrices: async (zone: string, from: Date, to: Date) => {
    countedWindows.push({ zone, fromMs: from.getTime(), toMs: to.getTime() });
    return inWindow(zone, from, to).length;
  },
  upsertSpotPrices: async (rows: SpotPriceInsert[]) => {
    if (upsertError) throw upsertError;
    const batch = rows.map((r) => ({ ...r, slotStart: r.slotStart as Date }) as StoredRow);
    upsertBatches.push(batch);
    for (const row of batch) table.set(rowKey(row.zone, row.slotStart.getTime()), row);
  },
}));

let tariff: TariffConfig = tariffConfigSchema.parse({});
mock.module("../settings/settings", () => ({ ...realSettings, getTariff: async () => tariff }));

const { getSpotPriceView, runSpotPriceSync, spotProviderCatalog } =
  await import("./spot-price-job");
const { invalidateSpotSlice } = await import("./spot-price-store");

const QUARTER_MS = 900_000;
const HOUR_MS = 3_600_000;

/** Requested URLs, newest last — the window the job asked for is visible here. */
const requests: string[] = [];
let handler: (url: string) => Response = () => new Response("", { status: 500 });
const realFetch = globalThis.fetch;

/** Serve one body (or a bare status) to every provider request. */
function serve(body: unknown, status = 200): void {
  handler = () => new Response(status === 200 ? JSON.stringify(body) : "", { status });
}

/** An energy-charts payload of `count` slots `stepMs` apart from `fromMs`. */
const chartsBody = (
  fromMs: number,
  count: number,
  stepMs = QUARTER_MS,
  priceAt: (i: number) => number = () => 50,
) => ({
  unix_seconds: Array.from({ length: count }, (_, i) => (fromMs + i * stepMs) / 1000),
  price: Array.from({ length: count }, (_, i) => priceAt(i)),
  unit: "EUR / MWh",
});

/** An aWATTar payload — hourly by construction, which is the point of it. */
const awattarBody = (fromMs: number, count: number) => ({
  data: Array.from({ length: count }, (_, i) => ({
    start_timestamp: fromMs + i * HOUR_MS,
    end_timestamp: fromMs + (i + 1) * HOUR_MS,
    marketprice: 50,
    unit: "Eur/MWh",
  })),
});

/** Put `n` quarter-hour slots into the table as if an earlier run had stored them. */
function prestore(
  zone: string,
  fromMs: number,
  n: number,
  over: { eurPerMwh?: (i: number) => number; slotMinutes?: number; provider?: string } = {},
): void {
  for (let i = 0; i < n; i++) {
    const startMs = fromMs + i * QUARTER_MS;
    table.set(rowKey(zone, startMs), {
      zone,
      slotStart: new Date(startMs),
      slotMinutes: over.slotMinutes ?? 15,
      eurPerMwh: over.eurPerMwh?.(i) ?? 50,
      provider: over.provider ?? "energy-charts",
    });
  }
}

const cfg = (over: Partial<SpotPriceConfig> = {}): SpotPriceConfig =>
  spotPriceConfigSchema.parse({ enabled: true, ...over });

// A summer Wednesday: Berlin is CEST, so the market day runs 22:00Z → 22:00Z.
const NOW = Date.parse("2026-06-10T09:00:00Z");
const TODAY = Date.parse("2026-06-09T22:00:00Z");
const TOMORROW = Date.parse("2026-06-10T22:00:00Z");
const END = Date.parse("2026-06-11T22:00:00Z");

beforeEach(() => {
  table.clear();
  upsertBatches.length = 0;
  countedWindows.length = 0;
  requests.length = 0;
  upsertError = null;
  tariff = tariffConfigSchema.parse({});
  invalidateSpotSlice();
  serve(null, 500);
  globalThis.fetch = ((input: string | URL | Request) => {
    requests.push(String(input));
    return Promise.resolve(handler(String(input)));
  }) as typeof globalThis.fetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
  // `mock.module` is permanent and keyed by the resolved path, so the in-memory
  // table above stays installed as `@SunReye/db/spot-price` for the rest of the
  // process — including for `packages/db/src/spot-price.test.ts`, the suite that
  // tests that very module and would otherwise assert against this stub and see
  // no SQL at all. Hand the real exports back once this suite is done.
  mock.module("@SunReye/db/spot-price", () => ({ ...realSpotPriceExports }));
  // Same for the settings accessor: `getTariff` above answers from this file's
  // `tariff` variable, which would otherwise decide the tariff for every later
  // suite — including the one that tests the settings module itself.
  mock.module("../settings/settings", () => ({ ...realSettingsExports }));
});

describe("provider catalog", () => {
  test("advertises every registered source with its zones and credit line", () => {
    const catalog = spotProviderCatalog();
    const ids = catalog.map((p) => p.id);
    expect(ids).toContain("energy-charts");
    expect(ids).toContain("awattar");

    const awattar = catalog.find((p) => p.id === "awattar");
    expect(awattar?.zones).toEqual(["DE-LU", "AT"]);
    // The credit is a licence condition for the default source, so it must be
    // carried all the way to the settings form rather than left to the UI.
    expect(catalog.every((p) => p.attribution.length > 0)).toBe(true);
  });
});

describe("day-ahead sync", () => {
  test("stays off until the feed is enabled and pointed at a market", async () => {
    expect(await runSpotPriceSync(cfg({ enabled: false }), NOW)).toEqual({
      outcome: "disabled",
      stored: 0,
    });
    expect(await runSpotPriceSync(cfg({ zone: "   " }), NOW)).toEqual({
      outcome: "disabled",
      stored: 0,
    });
    // Off means off: no count, no network.
    expect(countedWindows).toEqual([]);
    expect(requests).toEqual([]);
  });

  test("a source this build does not know degrades to no prices, never a throw", async () => {
    const result = await runSpotPriceSync(cfg({ provider: "entso-e" }), NOW);
    expect(result).toEqual({ outcome: "unknown-provider", stored: 0 });
    expect(requests).toEqual([]);
    expect(table.size).toBe(0);
  });

  test("asks about today and tomorrow as two market-local delivery days", async () => {
    serve(chartsBody(TODAY, 192));
    await runSpotPriceSync(cfg(), NOW);

    expect(countedWindows).toEqual([
      { zone: "DE-LU", fromMs: TODAY, toMs: TOMORROW },
      { zone: "DE-LU", fromMs: TOMORROW, toMs: END },
    ]);
    // The upstream's `end` is inclusive of the delivery day, so the window's
    // exclusive end must not leak a third day into the request.
    expect(requests[0]).toContain("start=2026-06-10");
    expect(requests[0]).toContain("end=2026-06-11");
    expect(requests[0]).toContain("bzn=DE-LU");
  });

  test("with both days complete it costs one count and no network at all", async () => {
    prestore("DE-LU", TODAY, 192);
    const result = await runSpotPriceSync(cfg(), NOW);
    expect(result).toEqual({ outcome: "complete", stored: 0 });
    expect(requests).toEqual([]);
    expect(upsertBatches).toEqual([]);
  });

  test("a quarter-hourly source is stored slot for slot", async () => {
    serve(chartsBody(TODAY, 192));
    const result = await runSpotPriceSync(cfg(), NOW);

    expect(result).toEqual({ outcome: "stored", stored: 192 });
    expect(table.size).toBe(192);
    expect([...table.values()].every((r) => r.slotMinutes === 15)).toBe(true);
    expect([...table.values()].every((r) => r.provider === "energy-charts")).toBe(true);
  });

  test("an hourly source is fanned onto the quarter-hour grid but still admits its width", async () => {
    serve(chartsBody(TODAY, 48, HOUR_MS));
    const result = await runSpotPriceSync(cfg(), NOW);

    // 48 hourly prices become 192 stored quarter-hours...
    expect(result.stored).toBe(192);
    expect(table.size).toBe(192);
    // ...every one of which says the source was hourly, so nobody reads a
    // negative quarter-hour into an hourly average later.
    expect([...table.values()].every((r) => r.slotMinutes === 60)).toBe(true);
  });

  test("routes the configured market to the provider that serves it", async () => {
    serve(awattarBody(Date.parse("2026-06-09T22:00:00Z"), 48));
    const result = await runSpotPriceSync(cfg({ provider: "awattar", zone: "AT" }), NOW);

    expect(requests[0]).toContain("api.awattar.at");
    expect(result.outcome).toBe("stored");
    expect([...table.values()].every((r) => r.zone === "AT")).toBe(true);
    // Vienna keeps Berlin's offsets, so the delivery day is the same window.
    expect(countedWindows[0]).toEqual({ zone: "AT", fromMs: TODAY, toMs: TOMORROW });
  });

  test("a half-stored day is refetched rather than left partial", async () => {
    prestore("DE-LU", TODAY, 96); // today complete
    prestore("DE-LU", TOMORROW, 40); // tomorrow interrupted mid-day
    serve(chartsBody(TODAY, 192));

    const result = await runSpotPriceSync(cfg(), NOW);
    expect(result.outcome).toBe("stored");
    expect(table.size).toBe(192);
  });

  test("a day that starts mid-way through is missing its head, not complete", async () => {
    // 96 slots stored, but they start at noon and run into tomorrow: today is
    // short and tomorrow is short, and counting the zone as a whole would hide it.
    prestore("DE-LU", TODAY + 48 * QUARTER_MS, 96);
    serve(chartsBody(TODAY, 192));

    const result = await runSpotPriceSync(cfg(), NOW);
    expect(result.outcome).toBe("stored");
  });

  test("an overlapping refetch overwrites the same slots instead of duplicating them", async () => {
    // First tick: the auction for tomorrow has not cleared, so the upstream
    // truncates at the end of today.
    serve(chartsBody(TODAY, 96));
    const first = await runSpotPriceSync(cfg(), NOW);
    expect(first).toEqual({ outcome: "stored", stored: 96 });

    // Second tick: the same window is asked for again and now answers in full.
    serve(chartsBody(TODAY, 192, QUARTER_MS, () => 70));
    const second = await runSpotPriceSync(cfg(), NOW);

    expect(second).toEqual({ outcome: "stored", stored: 192 });
    expect(upsertBatches).toHaveLength(2);
    // Today's slots were written twice and are still one row each...
    expect(table.size).toBe(192);
    // ...carrying the latest publication's price.
    expect(table.get(rowKey("DE-LU", TODAY))?.eurPerMwh).toBe(70);
  });

  test("once both days are stored the next tick is a no-op", async () => {
    serve(chartsBody(TODAY, 192));
    await runSpotPriceSync(cfg(), NOW);
    requests.length = 0;

    expect(await runSpotPriceSync(cfg(), NOW)).toEqual({ outcome: "complete", stored: 0 });
    expect(requests).toEqual([]);
  });

  test("tomorrow not published yet is an expected state, not a failure", async () => {
    prestore("DE-LU", TODAY, 96);
    serve(null, 404);

    const result = await runSpotPriceSync(cfg(), NOW);
    expect(result).toEqual({ outcome: "unpublished", stored: 0 });
    // Today's stored series survives — a pending auction must never drop rows.
    expect(table.size).toBe(96);
    expect(upsertBatches).toEqual([]);
  });

  test("a range the upstream refuses outright also reads as unpublished", async () => {
    serve(null, 400);
    expect(await runSpotPriceSync(cfg(), NOW)).toEqual({ outcome: "unpublished", stored: 0 });
  });

  test("an empty 200 is unpublished, never an empty day written as prices", async () => {
    serve({ unix_seconds: [], price: [], unit: "EUR / MWh" });
    expect(await runSpotPriceSync(cfg(), NOW)).toEqual({ outcome: "unpublished", stored: 0 });
    expect(table.size).toBe(0);
  });

  test("a transport failure writes nothing, and the next tick retries the same window", async () => {
    serve(null, 503);
    expect(await runSpotPriceSync(cfg(), NOW)).toEqual({ outcome: "failed", stored: 0 });
    expect(table.size).toBe(0);

    // No cursor was advanced by the failure, so the retry asks for exactly the
    // same two delivery days and succeeds.
    countedWindows.length = 0;
    serve(chartsBody(TODAY, 192));
    expect(await runSpotPriceSync(cfg(), NOW)).toEqual({ outcome: "stored", stored: 192 });
    expect(countedWindows).toEqual([
      { zone: "DE-LU", fromMs: TODAY, toMs: TOMORROW },
      { zone: "DE-LU", fromMs: TOMORROW, toMs: END },
    ]);
  });

  test("a malformed payload fails the run rather than storing a mispriced day", async () => {
    // ct/kWh where EUR/MWh was promised would be a factor-ten error on every slot.
    serve({ ...chartsBody(TODAY, 4), unit: "MWh" });
    expect(await runSpotPriceSync(cfg(), NOW)).toEqual({ outcome: "failed", stored: 0 });
    expect(table.size).toBe(0);
  });

  test("a database that rejects the write fails the run, it does not report stored", async () => {
    serve(chartsBody(TODAY, 192));
    upsertError = new Error("connection terminated");

    expect(await runSpotPriceSync(cfg(), NOW)).toEqual({ outcome: "failed", stored: 0 });
    expect(table.size).toBe(0);
  });

  test("a published gap is dropped, never stored as a zero price", async () => {
    const body = chartsBody(TODAY, 4);
    body.price[1] = null as unknown as number;
    serve(body);

    const result = await runSpotPriceSync(cfg(), NOW);
    expect(result.stored).toBe(3);
    expect(table.has(rowKey("DE-LU", TODAY + QUARTER_MS))).toBe(false);
  });

  test("negative slots are stored signed — they are the reason this job exists", async () => {
    serve(chartsBody(TODAY, 4, QUARTER_MS, (i) => (i === 2 ? -18.5 : 40)));
    await runSpotPriceSync(cfg(), NOW);
    expect(table.get(rowKey("DE-LU", TODAY + 2 * QUARTER_MS))?.eurPerMwh).toBe(-18.5);
  });
});

describe("day-ahead sync across a DST seam", () => {
  test("the 23-hour spring day is complete at 92 slots", async () => {
    const now = Date.parse("2026-03-29T10:00:00Z");
    const springStart = Date.parse("2026-03-28T23:00:00Z");
    const springEnd = Date.parse("2026-03-29T22:00:00Z");
    prestore("DE-LU", springStart, 92);
    prestore("DE-LU", springEnd, 96);

    expect(await runSpotPriceSync(cfg(), now)).toEqual({ outcome: "complete", stored: 0 });
    expect(countedWindows[0]).toEqual({
      zone: "DE-LU",
      fromMs: springStart,
      toMs: springEnd,
    });
  });

  test("one slot short of the spring day still refetches", async () => {
    const now = Date.parse("2026-03-29T10:00:00Z");
    prestore("DE-LU", Date.parse("2026-03-28T23:00:00Z"), 91);
    prestore("DE-LU", Date.parse("2026-03-29T22:00:00Z"), 96);
    serve(chartsBody(Date.parse("2026-03-28T23:00:00Z"), 188));

    expect((await runSpotPriceSync(cfg(), now)).outcome).toBe("stored");
  });

  test("the 25-hour autumn day is not complete at 96 slots", async () => {
    const now = Date.parse("2026-10-25T09:00:00Z");
    const autumnStart = Date.parse("2026-10-24T22:00:00Z");
    const autumnEnd = Date.parse("2026-10-25T23:00:00Z");
    // A full ordinary day's worth of rows — and still four short, because the
    // hour repeats. Treating it as complete would leave a silent hole at 02:00.
    prestore("DE-LU", autumnStart, 96);
    prestore("DE-LU", autumnEnd, 96);
    serve(chartsBody(autumnStart, 196));

    expect((await runSpotPriceSync(cfg(), now)).outcome).toBe("stored");
    expect(countedWindows[0]).toEqual({ zone: "DE-LU", fromMs: autumnStart, toMs: autumnEnd });
  });

  test("100 slots completes the autumn day", async () => {
    const now = Date.parse("2026-10-25T09:00:00Z");
    prestore("DE-LU", Date.parse("2026-10-24T22:00:00Z"), 100);
    prestore("DE-LU", Date.parse("2026-10-25T23:00:00Z"), 96);
    expect(await runSpotPriceSync(cfg(), now)).toEqual({ outcome: "complete", stored: 0 });
  });

  // The cases above all sit *on* the seam, where the short/long day is today and
  // tomorrow is an ordinary 24 hours. That leaves the window's far end — which is
  // a second local-midnight derivation, not `tomorrow + 24h` — resting on nothing:
  // on the eve of a seam it is tomorrow that is 23 or 25 hours long, and a naive
  // day of arithmetic there would miscount the delivery day the auction is about
  // to publish.
  test("on the eve of the spring seam tomorrow is the 23-hour day, not a flat 24", async () => {
    const now = Date.parse("2026-03-28T09:00:00Z");
    const today = Date.parse("2026-03-27T23:00:00Z");
    const tomorrow = Date.parse("2026-03-28T23:00:00Z");
    const end = Date.parse("2026-03-29T22:00:00Z");
    prestore("DE-LU", today, 96);
    prestore("DE-LU", tomorrow, 92);

    // 92 slots complete the short day; against a flat 24 hours it would read as
    // partial and refetch a day that is already whole.
    expect(await runSpotPriceSync(cfg(), now)).toEqual({ outcome: "complete", stored: 0 });
    expect(countedWindows[1]).toEqual({ zone: "DE-LU", fromMs: tomorrow, toMs: end });
  });

  test("on the eve of the autumn seam tomorrow is the 25-hour day, not a flat 24", async () => {
    const now = Date.parse("2026-10-24T09:00:00Z");
    const today = Date.parse("2026-10-23T22:00:00Z");
    const tomorrow = Date.parse("2026-10-24T22:00:00Z");
    const end = Date.parse("2026-10-25T23:00:00Z");
    prestore("DE-LU", today, 96);
    prestore("DE-LU", tomorrow, 96);
    serve(chartsBody(today, 196));

    // A full ordinary day of rows is still four short of the long day: against a
    // flat 24 hours this would report complete and leave a hole at 02:00.
    expect((await runSpotPriceSync(cfg(), now)).outcome).toBe("stored");
    expect(countedWindows[1]).toEqual({ zone: "DE-LU", fromMs: tomorrow, toMs: end });
  });
});

describe("priced view", () => {
  test("is null while the feed is off or unconfigured", async () => {
    // Both shapes get a full stored day first. Without it the empty table would
    // return null on its own and this would pass with the readiness guard
    // deleted — it has to be the config that suppresses the view, not the
    // absence of data.
    prestore("DE-LU", TODAY, 96);
    prestore("   ", TODAY, 96);

    expect(await getSpotPriceView(cfg({ enabled: false }), NOW)).toBeNull();
    expect(await getSpotPriceView(cfg({ zone: "   " }), NOW)).toBeNull();
    // ...and the same rows do produce a view once the config is ready, so the
    // null above is not just an unreadable table.
    expect((await getSpotPriceView(cfg(), NOW))?.series).toHaveLength(96);
  });

  test("is null when nothing is stored — an empty series is not a price of zero", async () => {
    expect(await getSpotPriceView(cfg(), NOW)).toBeNull();
  });

  test("reports the slice, its credit line and the cheapest and priciest slot", async () => {
    prestore("DE-LU", TODAY, 96, { eurPerMwh: (i) => (i === 5 ? -30 : 40 + i) });
    prestore("DE-LU", TOMORROW, 96);

    const view = await getSpotPriceView(cfg(), NOW);
    expect(view?.provider).toBe("energy-charts");
    expect(view?.zone).toBe("DE-LU");
    expect(view?.attribution).toContain("CC BY 4.0");
    expect(view?.coverage).toEqual({ today: "complete", tomorrow: "complete" });
    expect(view?.availability).toBe("ok");
    expect(view?.utcOffsetSeconds).toBe(7200);
    expect(view?.series).toHaveLength(192);
    expect(view?.extremes).toEqual({ minEurPerMwh: -30, maxEurPerMwh: 135 });
  });

  test("a source this build does not know still serves the stored prices, without a credit line", async () => {
    prestore("DE-LU", TODAY, 4);
    const view = await getSpotPriceView(cfg({ provider: "entso-e" }), NOW);
    expect(view?.attribution).toBeNull();
    expect(view?.series).toHaveLength(4);
  });

  test("admits the coarsest resolution in the slice", async () => {
    // Half the day re-published at quarter-hour precision, half still hourly:
    // the view must report the hour, since a negative quarter-hour inside a
    // positive hour is unresolvable in that half.
    prestore("DE-LU", TODAY, 48, { slotMinutes: 15 });
    prestore("DE-LU", TODAY + 48 * QUARTER_MS, 48, { slotMinutes: 60 });

    const view = await getSpotPriceView(cfg(), NOW);
    expect(view?.resolutionMinutes).toBe(60);
  });

  test("counts negative slots per delivery day, split at market-local midnight", async () => {
    // 23:45 local today, 00:00 and 00:15 local tomorrow.
    prestore("DE-LU", TOMORROW - QUARTER_MS, 1, { eurPerMwh: () => -5 });
    prestore("DE-LU", TOMORROW, 2, { eurPerMwh: () => -7 });

    const view = await getSpotPriceView(cfg(), NOW);
    expect(view?.negativeSlots).toEqual({ today: 1, tomorrow: 2 });
    // Coverage is what says a 0 means "none" rather than "unknown".
    expect(view?.coverage.today).toBe("partial");
  });

  test("a slot clearing at exactly zero is not negative", async () => {
    prestore("DE-LU", TODAY, 2, { eurPerMwh: (i) => (i === 0 ? 0 : -0.01) });
    const view = await getSpotPriceView(cfg(), NOW);
    expect(view?.series.map((p) => p.negative)).toEqual([false, true]);
    expect(view?.negativeSlots).toEqual({ today: 1, tomorrow: 0 });
  });

  test("a spot import tariff lands the wholesale price with fees, levies and VAT", async () => {
    tariff = tariffConfigSchema.parse({
      import: {
        mode: "spot",
        defaultPricePerKwh: 0.3,
        spot: {
          supplierMarkupPerKwh: 0.05,
          gridFeesPerKwh: 0.1,
          leviesPerKwh: 0.03,
          vatPercent: 19,
        },
      },
    });
    prestore("DE-LU", TODAY, 2, { eurPerMwh: (i) => (i === 0 ? 100 : -200) });

    const view = await getSpotPriceView(cfg(), NOW);
    // 0.10 + 0.18 = 0.28 net, +19% VAT.
    expect(view?.series[0]?.importPerKwh).toBeCloseTo(0.3332, 6);
    // A deeply negative slot pays the household to consume — VAT applies to the
    // whole landed sum, so the result stays below zero rather than clamping.
    expect(view?.series[1]?.importPerKwh).toBeCloseTo(-0.0238, 6);
  });

  test("under §51 a negative slot earns nothing, a zero slot still earns the tariff", async () => {
    tariff = tariffConfigSchema.parse({
      export: { mode: "spot", feedInPerKwh: 0.08, spot: { marketingModel: "eegFeedIn" } },
    });
    prestore("DE-LU", TODAY, 3, { eurPerMwh: (i) => [-1, 0, 60][i] ?? 0 });

    const view = await getSpotPriceView(cfg(), NOW);
    expect(view?.series.map((p) => p.exportPerKwh)).toEqual([0, 0.08, 0.08]);
  });

  test("a time-of-use band is matched on the market-local day, not the UTC one", async () => {
    // Berlin is CEST, so a slot at 22:15Z is 00:15 the *next* local day — the
    // weekday a Monday-only night band has to be matched against.
    tariff = tariffConfigSchema.parse({
      import: {
        defaultPricePerKwh: 0.3,
        bands: [{ name: "Monday night", pricePerKwh: 0.18, startHour: 0, endHour: 6, days: [1] }],
      },
    });
    const monday0015 = Date.parse("2026-06-14T22:15:00Z"); // Sunday in UTC
    const tuesday0015 = Date.parse("2026-06-15T22:15:00Z"); // Monday in UTC
    prestore("DE-LU", monday0015, 1);
    prestore("DE-LU", tuesday0015, 1);

    const view = await getSpotPriceView(cfg(), Date.parse("2026-06-15T09:00:00Z"));
    expect(view?.series.map((p) => p.time)).toEqual(["2026-06-15T00:15", "2026-06-16T00:15"]);
    expect(view?.series.map((p) => p.importPerKwh)).toEqual([0.18, 0.3]);
  });

  test("slots stored while the run was incomplete are visible to the very next read", async () => {
    // The read path caches for a minute, so a sync that did not invalidate it
    // would leave the UI reporting "no prices" long after they landed.
    expect(await getSpotPriceView(cfg(), NOW)).toBeNull();

    serve(chartsBody(TODAY, 192));
    expect((await runSpotPriceSync(cfg(), NOW)).outcome).toBe("stored");

    const view = await getSpotPriceView(cfg(), NOW);
    expect(view?.series).toHaveLength(192);
    expect(view?.availability).toBe("ok");
  });
});
