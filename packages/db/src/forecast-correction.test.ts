import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { drizzle } from "drizzle-orm/pg-proxy";

// forecast-correction.ts is pure database access: every export shapes one SQL
// statement and hands the rows back. Rather than stubbing the queries away
// (which would assert nothing), the DB singleton is swapped for drizzle's
// pg-proxy driver — a real drizzle instance that builds the real SQL string +
// params and hands them to a callback instead of a socket. So the assertions
// below are on the SQL this module actually emits, and on the mapping of the
// rows postgres would answer with.
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

const { getCorrectionCells, getCorrectionState, upsertCorrectionCells, upsertCorrectionState } =
  await import("./forecast-correction");

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

/** A `forecast_correction_cells` row in the driver's column order. */
const cellRow = (
  deviceId: string,
  month: number,
  hour: number,
  ratio: unknown,
  weight: unknown,
) => [deviceId, month, hour, ratio, weight, "2026-06-01 12:00:00+00"];

describe("reading the learned grid", () => {
  test("the grid is read for one device — a second plant's cells never leak in", async () => {
    await getCorrectionCells(3);
    const call = onlyCall();
    expect(flat(call.sql)).toContain('from "forecast_correction_cells"');
    expect(flat(call.sql)).toContain('"device_id" = $1');
    expect(call.params).toEqual([3]);
  });

  test("the inverter id is a bound parameter, not interpolated text", async () => {
    await getCorrectionCells("inv'; drop table forecast_correction_cells; --");
    const call = onlyCall();
    expect(call.sql).not.toContain("drop table");
    expect(call.params[0]).toBe("inv'; drop table forecast_correction_cells; --");
  });

  test("an inverter that has never learned reads back an empty grid, not null", async () => {
    expect(await getCorrectionCells(9)).toEqual([]);
  });

  test("a fully-shaded hour keeps its 0.0 ratio — 0 is a learned value, not 'no cell'", async () => {
    // A cell over a chimney legitimately learns "this hour produces nothing".
    // Dropping it would silently restore the uncorrected forecast for that hour.
    queue.push([cellRow(3, 12, 9, 0, 4.5)]);
    const [cell] = await getCorrectionCells(3);
    expect(cell?.ratio).toBe(0);
    expect(cell?.weight).toBe(4.5);
  });

  test("midnight and December land as hour 0 and month 12, not as absent cells", async () => {
    queue.push([cellRow(3, 12, 0, 1.05, 2), cellRow(3, 1, 23, 0.9, 1)]);
    const cells = await getCorrectionCells(3);
    expect(cells.map((c) => [c.month, c.hour])).toEqual([
      [12, 0],
      [1, 23],
    ]);
  });

  test("double precision arriving as a string is coerced — the grid is multiplied, not concatenated", async () => {
    queue.push([cellRow(3, 6, 13, "0.87", "12.5")]);
    const [cell] = await getCorrectionCells(3);
    expect(cell?.ratio).toBe(0.87);
    expect(cell?.weight).toBe(12.5);
  });
});

describe("writing the learned grid", () => {
  test("an empty batch issues no statement at all", async () => {
    // `insert ... values ()` is a syntax error, so the guard is the behaviour:
    // a learn run that produced no cells must be a no-op, not a failed write.
    await upsertCorrectionCells([]);
    expect(calls).toEqual([]);
  });

  test("a whole batch goes in one statement, in the order it was handed over", async () => {
    await upsertCorrectionCells([
      { deviceId: 3, month: 6, hour: 12, ratio: 1.1, weight: 3 },
      { deviceId: 3, month: 6, hour: 13, ratio: 0.95, weight: 2 },
    ]);
    expect(calls).toHaveLength(1);
    const call = onlyCall();
    expect(flat(call.sql)).toContain('insert into "forecast_correction_cells"');
    expect(call.params).toEqual([3, 6, 12, 1.1, 3, 3, 6, 13, 0.95, 2]);
  });

  test("re-learning a cell overwrites its ratio and weight instead of duplicating the key", async () => {
    // The grid is keyed (inverter, month, hour); a second learn run for the same
    // hour must land on the same row or the grid grows without bound and the
    // reader picks an arbitrary one of the duplicates.
    await upsertCorrectionCells([{ deviceId: 3, month: 6, hour: 12, ratio: 1.1, weight: 3 }]);
    const sqlText = flat(onlyCall().sql);
    expect(sqlText).toContain('on conflict ("device_id","month","hour") do update set');
    expect(sqlText).toContain('"ratio" = excluded.ratio');
    expect(sqlText).toContain('"weight" = excluded.weight');
  });

  test("the overwrite restamps updated_at from the database clock", async () => {
    // Staleness of the grid is judged from this column; carrying the old value
    // over on conflict would make a freshly-relearned cell look abandoned.
    await upsertCorrectionCells([{ deviceId: 3, month: 6, hour: 12, ratio: 1.1, weight: 3 }]);
    expect(flat(onlyCall().sql)).toContain('"updated_at" = now()');
  });

  test("a cell that has decayed to nothing is written as 0, not left out of the batch", async () => {
    await upsertCorrectionCells([{ deviceId: 3, month: 1, hour: 0, ratio: 0, weight: 0 }]);
    expect(onlyCall().params).toEqual([3, 1, 0, 0, 0]);
  });
});

describe("reading the learn cursor", () => {
  const stateRow = (
    deviceId: string,
    learnedThrough: string | null,
    maeRaw: unknown,
    maeCorrected: unknown,
    samples: unknown,
  ) => [deviceId, learnedThrough, maeRaw, maeCorrected, samples, "2026-06-01 12:00:00+00"];

  test("the cursor is read for one device", async () => {
    await getCorrectionState(3);
    const call = onlyCall();
    expect(flat(call.sql)).toContain('from "forecast_correction_state"');
    expect(flat(call.sql)).toContain('"device_id" = $1');
    expect(call.params).toEqual([3]);
  });

  test("before the first learn run there is no state — null, so the caller starts from scratch", async () => {
    expect(await getCorrectionState(3)).toBeNull();
  });

  test("a state row created before the first fold reports a null cursor, not an epoch date", async () => {
    // A row can exist with `learned_through` still null; inventing a date here
    // would make the job resume from the wrong day.
    queue.push([stateRow(3, null, 0, 0, 0)]);
    const state = await getCorrectionState(3);
    expect(state?.learnedThrough).toBeNull();
    expect(state?.samples).toBe(0);
  });

  test("a perfect day is 0 W of error, not a missing statistic", async () => {
    queue.push([stateRow(3, "2026-06-01", 0, 0, 12)]);
    const state = await getCorrectionState(3);
    expect(state?.maeRaw).toBe(0);
    expect(state?.maeCorrected).toBe(0);
    expect(state?.samples).toBe(12);
  });

  test("skill stats arriving as strings are coerced — the UI subtracts them", async () => {
    queue.push([stateRow(3, "2026-06-01", "420.5", "310.25", "88")]);
    const state = await getCorrectionState(3);
    expect(state?.maeRaw).toBe(420.5);
    expect(state?.maeCorrected).toBe(310.25);
    expect(state?.samples).toBe(88);
  });
});

describe("advancing the learn cursor", () => {
  const state = {
    deviceId: 3,
    learnedThrough: "2026-06-01",
    maeRaw: 420.5,
    maeCorrected: 310.25,
    samples: 88,
  };

  test("the first run inserts the row", async () => {
    await upsertCorrectionState(state);
    const call = onlyCall();
    expect(flat(call.sql)).toContain('insert into "forecast_correction_state"');
    expect(call.params.slice(0, 5)).toEqual([3, "2026-06-01", 420.5, 310.25, 88]);
  });

  test("a later run advances the same row rather than inserting a second cursor", async () => {
    await upsertCorrectionState(state);
    const sqlText = flat(onlyCall().sql);
    expect(sqlText).toContain('on conflict ("device_id") do update set');
    expect(sqlText).toContain('"learned_through" = $6');
    expect(sqlText).toContain('"updated_at" = now()');
  });

  test("the advanced values are bound, not carried over from the attempted insert", async () => {
    // The conflict branch re-binds every column, so the update parameters must
    // repeat the new cursor — otherwise a second run would leave the old day.
    await upsertCorrectionState({ ...state, learnedThrough: "2026-06-02", samples: 89 });
    expect(onlyCall().params).toEqual([
      3,
      "2026-06-02",
      420.5,
      310.25,
      89,
      "2026-06-02",
      420.5,
      310.25,
      89,
    ]);
  });

  test("a first fold with zero skill stats writes 0s, not defaults", async () => {
    await upsertCorrectionState({
      deviceId: 3,
      learnedThrough: "2026-06-01",
      maeRaw: 0,
      maeCorrected: 0,
      samples: 0,
    });
    expect(onlyCall().params).toEqual([3, "2026-06-01", 0, 0, 0, "2026-06-01", 0, 0, 0]);
  });
});
