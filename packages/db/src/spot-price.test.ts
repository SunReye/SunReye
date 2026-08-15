import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { drizzle } from "drizzle-orm/pg-proxy";

// spot-price.ts is pure database access: every export shapes one SQL statement
// and hands the rows back. Rather than stubbing the queries away (which would
// assert nothing), the DB singleton is swapped for drizzle's pg-proxy driver — a
// real drizzle instance that builds the real SQL string + params and hands them
// to a callback instead of a socket. So the assertions below are on the SQL this
// module actually emits, and on the mapping of the rows postgres would answer
// with.
//
// The spread is load-bearing: `mock.module` is process-global and permanent, so
// a mock returning only `db` would delete every other `@SunReye/db` export for
// each test file that runs after this one.
const realDb = await import("./index");
// Snapshotted BY VALUE, before the mock below is installed: a module namespace is
// live, so afterwards `realDb.db` IS the proxy and handing `realDb` back would
// restore the stub.
const realDbExports = { ...realDb };

interface Call {
  sql: string;
  params: unknown[];
  method: string;
}

type Handler = (sql: string, params: unknown[], method: string) => { rows: unknown[] };

// Both db-layer suites mock the same singleton, and module mocks are global and
// permanent, so the installed stub routes to whichever suite is currently
// running instead of to a proxy captured at load time.
const slot = globalThis as { __sunreyeDbProxyHandler?: Handler };

const proxy = drizzle(async (sqlText: string, params: unknown[], method: string) => {
  const handler = slot.__sunreyeDbProxyHandler;
  if (!handler) throw new Error("no db proxy handler registered");
  return handler(sqlText, params, method);
});

mock.module("./index", () => ({ ...realDb, db: proxy }));

// The mock is permanent and keyed by the resolved path, so the pg-proxy handle
// above would stand in for the real `db` barrel export in every test file that
// loads after this one — including the db-layer suites that install their own.
afterAll(() => {
  mock.module("./index", () => ({ ...realDbExports }));
});

const { countSpotPrices, getSpotPrices, upsertSpotPrices } = await import("./spot-price");

const calls: Call[] = [];
/** Rows the next query resolves with, in call order — driver order, one array per row. */
const queue: unknown[][][] = [];

beforeEach(() => {
  calls.length = 0;
  queue.length = 0;
  slot.__sunreyeDbProxyHandler = (sqlText, params, method) => {
    calls.push({ sql: sqlText, params, method });
    return { rows: queue.shift() ?? [] };
  };
});

/** Collapse whitespace so multi-line SQL can be matched by substring. */
const flat = (s: string) => s.replace(/\s+/g, " ").trim();

const onlyCall = (): Call => {
  const call = calls[0];
  if (!call) throw new Error("no query was issued");
  return call;
};

/** A `spot_prices` row in the driver's column order. */
const priceRow = (
  slotStart: string,
  eurPerMwh: unknown,
  slotMinutes = 15,
  provider = "aWATTar",
) => ["DE-LU", slotStart, slotMinutes, eurPerMwh, provider, "2026-06-01 12:00:00+00"];

const DAY_START = new Date("2026-06-01T00:00:00.000Z");
const DAY_END = new Date("2026-06-02T00:00:00.000Z");

describe("reading a delivery window", () => {
  test("one zone only — a neighbouring market's prices never enter the window", async () => {
    await getSpotPrices("DE-LU", DAY_START, DAY_END);
    const call = onlyCall();
    expect(flat(call.sql)).toContain('from "spot_prices"');
    expect(flat(call.sql)).toContain('"zone" = $1');
    expect(call.params[0]).toBe("DE-LU");
  });

  test("the window is half-open: the slot starting exactly at `from` is in, the one at `to` is not", async () => {
    // A quarter-hour is named by its start, so a slot starting at midnight
    // belongs to the new day. Making `to` inclusive would price the first slot
    // of the next day twice.
    await getSpotPrices("DE-LU", DAY_START, DAY_END);
    const sqlText = flat(onlyCall().sql);
    expect(sqlText).toContain('"slot_start" >= $2');
    expect(sqlText).toContain('"slot_start" < $3');
    expect(sqlText).not.toContain('"slot_start" <= ');
  });

  test("the bounds are sent as the instants asked for", async () => {
    await getSpotPrices("DE-LU", DAY_START, DAY_END);
    const call = onlyCall();
    expect(call.params[1]).toBe("2026-06-01T00:00:00.000Z");
    expect(call.params[2]).toBe("2026-06-02T00:00:00.000Z");
  });

  test("a window that starts mid-day reads only from that instant on", async () => {
    // The job refetches from "now" on a restart; an off-by-one here would re-read
    // the whole day or skip the slot in flight.
    const midday = new Date("2026-06-01T13:45:00.000Z");
    await getSpotPrices("DE-LU", midday, DAY_END);
    expect(onlyCall().params[1]).toBe("2026-06-01T13:45:00.000Z");
  });

  test("an inverted window is passed through as-is and simply matches nothing", async () => {
    // `from > to` cannot match a row, so it must read empty rather than being
    // silently swapped into a real window.
    const rows = await getSpotPrices("DE-LU", DAY_END, DAY_START);
    expect(rows).toEqual([]);
    expect(onlyCall().params.slice(1)).toEqual([
      "2026-06-02T00:00:00.000Z",
      "2026-06-01T00:00:00.000Z",
    ]);
  });

  test("slots come back oldest first — the caller walks the day in order", async () => {
    await getSpotPrices("DE-LU", DAY_START, DAY_END);
    expect(flat(onlyCall().sql)).toContain('order by "spot_prices"."slot_start" asc');
  });

  test("a day whose auction has not published yet reads back empty, not null", async () => {
    expect(await getSpotPrices("DE-LU", DAY_START, DAY_END)).toEqual([]);
  });

  test("a negative price survives the read as a negative number — the whole point of the table", async () => {
    queue.push([priceRow("2026-06-01T12:00:00.000Z", -85.4)]);
    const [row] = await getSpotPrices("DE-LU", DAY_START, DAY_END);
    expect(row?.eurPerMwh).toBe(-85.4);
  });

  test("a 0.00 EUR/MWh slot is a price, not a missing one", async () => {
    queue.push([priceRow("2026-06-01T12:00:00.000Z", 0)]);
    const [row] = await getSpotPrices("DE-LU", DAY_START, DAY_END);
    expect(row?.eurPerMwh).toBe(0);
  });

  test("a price arriving as a string is coerced — §51 compares it against zero", async () => {
    // `"-0.01" < 0` is false in JavaScript's string comparison; a negative slot
    // read as text would be paid the full EEG tariff.
    queue.push([priceRow("2026-06-01T12:00:00.000Z", "-0.01")]);
    const [row] = await getSpotPrices("DE-LU", DAY_START, DAY_END);
    expect(row?.eurPerMwh).toBe(-0.01);
    expect(row?.eurPerMwh).toBeLessThan(0);
  });

  test("slot_start comes back as an absolute instant, not the raw postgres text", async () => {
    queue.push([priceRow("2026-06-01 12:15:00+00", 42)]);
    const [row] = await getSpotPrices("DE-LU", DAY_START, DAY_END);
    expect(row?.slotStart).toBeInstanceOf(Date);
    expect(row?.slotStart.toISOString()).toBe("2026-06-01T12:15:00.000Z");
  });

  test("a row fanned out from an hourly source still reports its 60-minute origin", async () => {
    // `slot_minutes` is provenance: it says a negative quarter-hour inside a
    // positive hour was not resolvable from this source.
    queue.push([
      priceRow("2026-06-01T12:00:00.000Z", 30, 60, "aWATTar"),
      priceRow("2026-06-01T12:15:00.000Z", 30, 60, "aWATTar"),
    ]);
    const rows = await getSpotPrices("DE-LU", DAY_START, DAY_END);
    expect(rows.map((r) => r.slotMinutes)).toEqual([60, 60]);
    expect(rows.map((r) => r.provider)).toEqual(["aWATTar", "aWATTar"]);
  });

  test("the zone is a bound parameter, not interpolated text", async () => {
    await getSpotPrices("DE-LU'; drop table spot_prices; --", DAY_START, DAY_END);
    const call = onlyCall();
    expect(call.sql).not.toContain("drop table");
    expect(call.params[0]).toBe("DE-LU'; drop table spot_prices; --");
  });
});

describe("storing a publication", () => {
  const slotRow = (
    startIso: string,
    eurPerMwh: number,
    slotMinutes = 15,
    provider = "aWATTar",
  ) => ({
    zone: "DE-LU",
    slotStart: new Date(startIso),
    slotMinutes,
    eurPerMwh,
    provider,
  });

  test("an empty publication issues no statement at all", async () => {
    // `insert ... values ()` is a syntax error, so a provider answering with
    // nothing must be a no-op rather than a failed write.
    await upsertSpotPrices([]);
    expect(calls).toEqual([]);
  });

  test("a whole delivery day goes in one statement", async () => {
    const day = Array.from({ length: 96 }, (_, i) =>
      slotRow(new Date(DAY_START.getTime() + i * 15 * 60_000).toISOString(), i),
    );
    await upsertSpotPrices(day);
    expect(calls).toHaveLength(1);
    expect(onlyCall().params).toHaveLength(96 * 5);
  });

  test("a re-publication lands on the same (zone, slot_start) row instead of beside it", async () => {
    await upsertSpotPrices([slotRow("2026-06-01T12:00:00.000Z", 42)]);
    expect(flat(onlyCall().sql)).toContain('on conflict ("zone","slot_start") do update set');
  });

  test("a finer re-publication overwrites the coarse row's width, price and provider", async () => {
    // A 60-minute row later republished as quarter-hours must not keep claiming
    // to be an hour — that flag is what tells the pricing engine a negative
    // quarter-hour was unresolvable.
    await upsertSpotPrices([slotRow("2026-06-01T12:00:00.000Z", -12.5, 15, "energy-charts")]);
    const sqlText = flat(onlyCall().sql);
    expect(sqlText).toContain('"slot_minutes" = excluded.slot_minutes');
    expect(sqlText).toContain('"eur_per_mwh" = excluded.eur_per_mwh');
    expect(sqlText).toContain('"provider" = excluded.provider');
    expect(sqlText).toContain('"updated_at" = now()');
  });

  test("the slot start is bound as its instant and the price keeps its sign", async () => {
    await upsertSpotPrices([slotRow("2026-06-01T12:00:00.000Z", -85.4, 15, "energy-charts")]);
    expect(onlyCall().params).toEqual([
      "DE-LU",
      "2026-06-01T12:00:00.000Z",
      15,
      -85.4,
      "energy-charts",
    ]);
  });

  test("a 0.00 EUR/MWh slot is written as 0, not skipped as falsy", async () => {
    await upsertSpotPrices([slotRow("2026-06-01T12:00:00.000Z", 0)]);
    expect(onlyCall().params[3]).toBe(0);
  });

  test("slots from two zones ride in the same batch without merging", async () => {
    await upsertSpotPrices([
      slotRow("2026-06-01T12:00:00.000Z", 30),
      { ...slotRow("2026-06-01T12:00:00.000Z", 31), zone: "AT" },
    ]);
    expect(calls).toHaveLength(1);
    expect(onlyCall().params.slice(0, 2)).toEqual(["DE-LU", "2026-06-01T12:00:00.000Z"]);
    expect(onlyCall().params.slice(5, 7)).toEqual(["AT", "2026-06-01T12:00:00.000Z"]);
  });
});

describe("counting what is stored", () => {
  test("the count is scoped to the same zone and half-open window as the read", async () => {
    await countSpotPrices("DE-LU", DAY_START, DAY_END);
    const call = onlyCall();
    expect(flat(call.sql)).toContain("select count(*)");
    expect(flat(call.sql)).toContain('"zone" = $1');
    expect(flat(call.sql)).toContain('"slot_start" >= $2');
    expect(flat(call.sql)).toContain('"slot_start" < $3');
    expect(call.params).toEqual(["DE-LU", "2026-06-01T00:00:00.000Z", "2026-06-02T00:00:00.000Z"]);
  });

  test("a day nothing was stored for counts 0 — the job's cue to fetch it", async () => {
    queue.push([["0"]]);
    expect(await countSpotPrices("DE-LU", DAY_START, DAY_END)).toBe(0);
  });

  test("a count answered with no row at all is still 0, never undefined", async () => {
    // The completeness check compares this against the expected slot count;
    // `undefined >= 96` is false but `undefined` propagated into arithmetic is
    // NaN, so the fallback has to be a number.
    expect(await countSpotPrices("DE-LU", DAY_START, DAY_END)).toBe(0);
  });

  test("a full quarter-hourly day counts 96, as a number and not as bigint text", async () => {
    // postgres returns count() as bigint, which some drivers hand back as a
    // string: `"96" >= 96` is true by coercion but `"100" < "96"` is not, so a
    // long DST day would read as incomplete forever.
    queue.push([["96"]]);
    const n = await countSpotPrices("DE-LU", DAY_START, DAY_END);
    expect(n).toBe(96);
    expect(typeof n).toBe("number");
  });

  test("the long autumn day counts 100 slots, the short spring day 92", async () => {
    // Slots are UTC-anchored instants, so DST is just a different row count —
    // no special case, but the count has to be allowed to differ from 96.
    queue.push([["100"]]);
    expect(await countSpotPrices("DE-LU", DAY_START, DAY_END)).toBe(100);
    queue.push([["92"]]);
    expect(await countSpotPrices("DE-LU", DAY_START, DAY_END)).toBe(92);
  });
});
