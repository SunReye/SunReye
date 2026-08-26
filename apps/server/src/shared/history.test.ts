import { afterAll, describe, expect, mock, test } from "bun:test";
import { drizzle } from "drizzle-orm/pg-proxy";

// history.ts is pure database access: every export shapes one SQL statement and
// maps the rows back. Rather than stubbing the queries away (which would assert
// nothing), the DB singleton is swapped for drizzle's pg-proxy driver — a real
// drizzle instance that builds the real SQL string + params and hands them to a
// callback instead of a socket. So the assertions below are on the SQL this
// module actually emits, not on a mock's arguments.
//
// The spread is load-bearing: `mock.module` is process-global and permanent, so
// a mock returning only `db` would delete every other `@SunReye/db` export for
// each test file that runs after this one.
const realDb = await import("@SunReye/db");

// …and the spread alone is not enough: the stub below is permanent too, so the
// fake `db` would stay installed for every later file — including the suites
// that exercise real queries through the singleton. A module namespace is live
// (after the mock, `realDb.db` IS `dbStub`), so the real exports have to be
// snapshotted by value here, before anything is installed.
const realDbExports = { ...realDb };

interface Call {
  sql: string;
  params: unknown[];
  method: string;
}

const calls: Call[] = [];
/** Rows the next query resolves with, in call order. */
const queue: unknown[][] = [];

const proxy = drizzle(async (sqlText: string, params: unknown[], method: string) => {
  calls.push({ sql: sqlText, params, method });
  return { rows: queue.shift() ?? [] };
});

// `db.execute` on the node-postgres driver resolves to a pg result object
// (`{ rows }`); the proxy driver resolves to the rows themselves. Re-wrap so the
// module under test sees the shape production gives it.
const dbStub = {
  execute: async (q: never) => ({ rows: await proxy.execute(q) }),
  select: (...args: never[]) => (proxy.select as unknown as (...a: never[]) => unknown)(...args),
};
mock.module("@SunReye/db", () => ({ ...realDb, db: dbStub }));

// Hand the singleton back once this file is done, so no later suite runs its
// queries against this recorder. `afterAll`, not `afterEach`: every test below
// still needs the proxy.
afterAll(() => {
  mock.module("@SunReye/db", () => ({ ...realDbExports }));
});

const {
  queryHourlyAvgRange,
  queryMedianHourlyAvg,
  queryRawHistory,
  queryRecentBuckets,
  queryRollup,
} = await import("./history");

/** Reset the recorder, queue `rows` for the next query, return the call made. */
async function capture<T>(rows: unknown[], run: () => Promise<T>): Promise<[Call, T]> {
  calls.length = 0;
  queue.length = 0;
  queue.push(rows);
  const result = await run();
  const call = calls[0];
  if (!call) throw new Error("no query was issued");
  return [call, result];
}

/** Collapse whitespace so multi-line SQL can be matched by substring. */
const flat = (s: string) => s.replace(/\s+/g, " ").trim();

const ROLLUP = {
  metric: "pv.power",
  inverterId: "inv-1",
  limit: 5000,
  bucket: "hour",
} as const;

describe("queryRollup — window and view selection", () => {
  test("each bucket size reads its own continuous aggregate view", async () => {
    for (const [bucket, view] of [
      ["minute", "minute_rollups"],
      ["hour", "hourly_rollups"],
      ["day", "daily_rollups"],
    ] as const) {
      const [call] = await capture([], () =>
        queryRollup({ ...ROLLUP, bucket, since: new Date("2026-01-01T00:00:00Z") }),
      );
      expect(flat(call.sql)).toContain(`from ${view}`);
    }
  });

  test("an explicit [from, to) window is half-open — a bucket landing exactly on `to` is the next window's", async () => {
    const from = new Date("2026-03-01T00:00:00Z");
    const to = new Date("2026-03-02T00:00:00Z");
    const [call] = await capture([], () => queryRollup({ ...ROLLUP, from, to }));
    expect(flat(call.sql)).toContain("bucket >= $3 and bucket < $4");
    expect(call.params[2]).toEqual(from);
    expect(call.params[3]).toEqual(to);
  });

  test("an explicit window wins over `since` when both are passed", async () => {
    const from = new Date("2026-03-01T00:00:00Z");
    const to = new Date("2026-03-02T00:00:00Z");
    const since = new Date("2020-01-01T00:00:00Z");
    const [call] = await capture([], () => queryRollup({ ...ROLLUP, since, from, to }));
    expect(call.params).not.toContain(since);
    expect(call.params.slice(2, 4)).toEqual([from, to]);
  });

  // Hazard: the date-range picker sending only one bound must not silently
  // become an unbounded read of the whole history. Today it does — both bounds
  // are required for the range branch — so this pins the fallback that results.
  test("a half-specified range (only `from`, no `to`) falls back to the open-ended `since` branch", async () => {
    const from = new Date("2026-03-01T00:00:00Z");
    const since = new Date("2026-02-01T00:00:00Z");
    const [call] = await capture([], () => queryRollup({ ...ROLLUP, from, since }));
    expect(flat(call.sql)).toContain("bucket >= $3");
    expect(flat(call.sql)).not.toContain("bucket <");
    expect(call.params[2]).toEqual(since);
  });

  test("only `to` given, no `since`: the read starts at the epoch, not at `to`", async () => {
    const to = new Date("2026-03-02T00:00:00Z");
    const [call] = await capture([], () => queryRollup({ ...ROLLUP, to }));
    expect(call.params[2]).toEqual(new Date(0));
  });

  test("no window at all reads from the epoch — every retained bucket, capped by `limit`", async () => {
    const [call] = await capture([], () => queryRollup({ ...ROLLUP }));
    expect(call.params[2]).toEqual(new Date(0));
  });

  test("metric and inverter are bound parameters, not interpolated text", async () => {
    const [call] = await capture([], () =>
      queryRollup({
        ...ROLLUP,
        metric: "battery.soc'; drop table metrics_raw; --",
        inverterId: "inv-2",
        since: new Date(0),
      }),
    );
    expect(call.sql).not.toContain("drop table");
    expect(call.params[0]).toBe("battery.soc'; drop table metrics_raw; --");
    expect(call.params[1]).toBe("inv-2");
  });

  test("rows come back ascending — charts plot left to right without re-sorting", async () => {
    const [call] = await capture([], () => queryRollup({ ...ROLLUP, since: new Date(0) }));
    expect(flat(call.sql)).toContain("order by bucket asc");
  });

  // The 1600-point cap belongs to the caller (route/UI); this layer passes the
  // number straight through. A day of minute buckets is 1440 — over the cap the
  // caller must widen the bucket, because here the read is simply truncated.
  test("`limit` is passed through verbatim — no clamping happens in this layer", async () => {
    for (const limit of [1, 1600, 50_000]) {
      const [call] = await capture([], () => queryRollup({ ...ROLLUP, limit, since: new Date(0) }));
      // $7: the predicates are bound once per union arm (metric, inverter,
      // window × 2), so the limit is the seventh parameter, not the fourth.
      expect(flat(call.sql)).toContain("limit $7");
      expect(call.params[6]).toBe(limit);
    }
  });

  test("a limit of 0 is sent as 0 — an empty read, not 'unlimited'", async () => {
    const [call] = await capture([], () =>
      queryRollup({ ...ROLLUP, limit: 0, since: new Date(0) }),
    );
    expect(call.params[6]).toBe(0);
  });
});

describe("queryRollup — row mapping", () => {
  test("no buckets in the window yields an empty series, not null", async () => {
    const [, rows] = await capture([], () => queryRollup({ ...ROLLUP, since: new Date(0) }));
    expect(rows).toEqual([]);
  });

  test("a zero average is a reading — 0 kW of PV at night must survive the mapping", async () => {
    const [, rows] = await capture(
      [{ bucket: "2026-01-01T00:00:00.000Z", avg_value: 0, max_value: 0, min_value: 0 }],
      () => queryRollup({ ...ROLLUP, since: new Date(0) }),
    );
    expect(rows).toEqual([{ time: "2026-01-01T00:00:00.000Z", avg: 0, max: 0, min: 0 }]);
  });

  test("negative values survive — house battery discharge and sub-zero temperatures are real", async () => {
    const [, rows] = await capture(
      [{ bucket: "2026-01-01T00:00:00.000Z", avg_value: -7.5, max_value: -0.1, min_value: -12.25 }],
      () => queryRollup({ ...ROLLUP, since: new Date(0) }),
    );
    expect(rows[0]).toEqual({
      time: "2026-01-01T00:00:00.000Z",
      avg: -7.5,
      max: -0.1,
      min: -12.25,
    });
  });

  // postgres returns `numeric`/`double precision` as strings through some
  // drivers; the caller does arithmetic on these, so they must land as numbers.
  test("numeric columns arriving as strings are coerced to numbers, not concatenated later", async () => {
    const [, rows] = await capture(
      [{ bucket: "2026-01-01T00:00:00.000Z", avg_value: "1.5", max_value: "2", min_value: "-0.5" }],
      () => queryRollup({ ...ROLLUP, since: new Date(0) }),
    );
    expect(rows[0]?.avg).toBe(1.5);
    expect(rows[0]?.max).toBe(2);
    expect(rows[0]?.min).toBe(-0.5);
  });

  test("a bucket handed back as a Date is normalised to the same ISO instant as its string form", async () => {
    const instant = "2026-06-01T13:00:00.000Z";
    const [, asDate] = await capture(
      [{ bucket: new Date(instant), avg_value: 1, max_value: 1, min_value: 1 }],
      () => queryRollup({ ...ROLLUP, since: new Date(0) }),
    );
    const [, asString] = await capture(
      [{ bucket: instant, avg_value: 1, max_value: 1, min_value: 1 }],
      () => queryRollup({ ...ROLLUP, since: new Date(0) }),
    );
    expect(asDate[0]?.time).toBe(instant);
    expect(asString[0]?.time).toBe(instant);
  });

  // Timescale hands back `timestamptz` without a `T`; the mapping must still
  // produce the UTC instant, or a chart silently shifts by the local offset.
  test("a postgres-style timestamp string keeps its UTC offset through the mapping", async () => {
    const [, rows] = await capture(
      [{ bucket: "2026-06-01 13:00:00+00", avg_value: 1, max_value: 1, min_value: 1 }],
      () => queryRollup({ ...ROLLUP, since: new Date(0) }),
    );
    expect(rows[0]?.time).toBe("2026-06-01T13:00:00.000Z");
  });

  test("bucket order is preserved exactly as the database returned it, including across midnight", async () => {
    const [, rows] = await capture(
      [
        { bucket: "2026-01-01T23:00:00.000Z", avg_value: 1, max_value: 1, min_value: 1 },
        { bucket: "2026-01-02T00:00:00.000Z", avg_value: 2, max_value: 2, min_value: 2 },
      ],
      () => queryRollup({ ...ROLLUP, since: new Date(0) }),
    );
    expect(rows.map((r) => r.time)).toEqual([
      "2026-01-01T23:00:00.000Z",
      "2026-01-02T00:00:00.000Z",
    ]);
  });
});

describe("queryMedianHourlyAvg", () => {
  test("the window is `days` back from now, so a 7-day median never reaches an eighth day", async () => {
    const before = Date.now();
    const [call] = await capture([{ median: 1 }], () => queryMedianHourlyAvg("load.power", "i", 7));
    const after = Date.now();
    const since = call.params[2] as Date;
    expect(since.getTime()).toBeGreaterThanOrEqual(before - 7 * 24 * 3600 * 1000);
    expect(since.getTime()).toBeLessThanOrEqual(after - 7 * 24 * 3600 * 1000);
  });

  test("0 days asks for the current instant onwards — an empty window, not 'everything'", async () => {
    const before = Date.now();
    const [call] = await capture([{ median: null }], () =>
      queryMedianHourlyAvg("load.power", "i", 0),
    );
    expect((call.params[2] as Date).getTime()).toBeGreaterThanOrEqual(before);
  });

  test("metric and inverter are bound parameters", async () => {
    const [call] = await capture([{ median: 1 }], () =>
      queryMedianHourlyAvg("load.power", "inv-9", 3),
    );
    expect(call.params[0]).toBe("load.power");
    expect(call.params[1]).toBe("inv-9");
    expect(flat(call.sql)).toContain("from hourly_rollups");
  });

  test("no rows at all means 'no data' — null, so the forecast model can fall back", async () => {
    const [, median] = await capture([], () => queryMedianHourlyAvg("load.power", "i", 30));
    expect(median).toBeNull();
  });

  test("a NULL median (window matched no buckets) is null, not 0", async () => {
    const [, median] = await capture([{ median: null }], () =>
      queryMedianHourlyAvg("load.power", "i", 30),
    );
    expect(median).toBeNull();
  });

  test("an undefined median column is null rather than NaN", async () => {
    const [, median] = await capture([{}], () => queryMedianHourlyAvg("load.power", "i", 30));
    expect(median).toBeNull();
  });

  // The falsy-check hazard: a genuinely zero median house load (an all-day
  // outage, a metric that is flat zero) must stay 0 and not degrade to "no data".
  test("a median of exactly 0 is a measurement, not missing data", async () => {
    const [, median] = await capture([{ median: 0 }], () => queryMedianHourlyAvg("l", "i", 30));
    expect(median).toBe(0);
  });

  test("a median arriving as a numeric string is coerced to a number", async () => {
    const [, median] = await capture([{ median: "0.75" }], () =>
      queryMedianHourlyAvg("l", "i", 30),
    );
    expect(median).toBe(0.75);
  });

  test("a negative median survives — export power is signed", async () => {
    const [, median] = await capture([{ median: -120.5 }], () => queryMedianHourlyAvg("l", "i", 1));
    expect(median).toBe(-120.5);
  });

  test("only the first row is read — a stray second row cannot change the answer", async () => {
    const [, median] = await capture([{ median: 5 }, { median: 99 }], () =>
      queryMedianHourlyAvg("l", "i", 1),
    );
    expect(median).toBe(5);
  });
});

describe("queryHourlyAvgRange", () => {
  const from = new Date("2026-05-01T00:00:00Z");
  const to = new Date("2026-05-02T00:00:00Z");

  test("the window is half-open [from, to) so consecutive days never double-count an hour", async () => {
    const [call] = await capture([], () => queryHourlyAvgRange("pv.power", "inv-1", from, to));
    const sqlText = flat(call.sql);
    expect(sqlText).toContain("bucket >= $3");
    expect(sqlText).toContain("bucket < $4");
    // Once per union arm: the weighted aggregate and the legacy one are filtered
    // by the same window, so an arm can never contribute a bucket outside it.
    expect(call.params).toEqual(["pv.power", "inv-1", from, to, "pv.power", "inv-1", from, to]);
  });

  test("reads the hourly aggregate ascending, unlimited — the caller matches it hour by hour", async () => {
    const [call] = await capture([], () => queryHourlyAvgRange("pv.power", "inv-1", from, to));
    const sqlText = flat(call.sql);
    expect(sqlText).toContain("from hourly_rollups");
    expect(sqlText).toContain("order by bucket asc");
    expect(sqlText).not.toContain("limit");
  });

  test("an inverted window (from after to) is still sent — the caller owns that validation", async () => {
    const [call] = await capture([], () => queryHourlyAvgRange("pv.power", "inv-1", to, from));
    expect(call.params.slice(2, 4)).toEqual([to, from]);
    expect(call.params.slice(6)).toEqual([to, from]);
  });

  test("a gap in the series yields fewer rows, not zero-filled ones", async () => {
    const [, rows] = await capture(
      [
        { bucket: "2026-05-01T00:00:00.000Z", avg_value: 1 },
        { bucket: "2026-05-01T02:00:00.000Z", avg_value: 3 },
      ],
      () => queryHourlyAvgRange("pv.power", "inv-1", from, to),
    );
    expect(rows).toEqual([
      { bucketMs: Date.parse("2026-05-01T00:00:00Z"), avg: 1 },
      { bucketMs: Date.parse("2026-05-01T02:00:00Z"), avg: 3 },
    ]);
  });

  test("bucketMs is the UTC instant, so it matches a reanalysis series regardless of local offset", async () => {
    const [, rows] = await capture([{ bucket: "2026-05-01 13:00:00+00", avg_value: 2 }], () =>
      queryHourlyAvgRange("pv.power", "inv-1", from, to),
    );
    expect(rows[0]?.bucketMs).toBe(Date.parse("2026-05-01T13:00:00Z"));
  });

  test("a zero hourly average is kept — an overcast hour produced 0, it is not a gap", async () => {
    const [, rows] = await capture([{ bucket: "2026-05-01T00:00:00.000Z", avg_value: 0 }], () =>
      queryHourlyAvgRange("pv.power", "inv-1", from, to),
    );
    expect(rows[0]?.avg).toBe(0);
  });

  test("a numeric-string average is coerced, so the correction factor stays arithmetic", async () => {
    const [, rows] = await capture(
      [{ bucket: "2026-05-01T00:00:00.000Z", avg_value: "12.5" }],
      () => queryHourlyAvgRange("pv.power", "inv-1", from, to),
    );
    expect(rows[0]?.avg).toBe(12.5);
  });

  test("an empty window is an empty array — the learning step has nothing to correct with", async () => {
    const [, rows] = await capture([], () => queryHourlyAvgRange("pv.power", "inv-1", from, to));
    expect(rows).toEqual([]);
  });
});

describe("queryRawHistory", () => {
  const since = new Date("2026-04-01T00:00:00Z");
  const q = { metric: "pv.power", inverterId: "inv-1", since, limit: 10 };

  /** Driver row for metrics_raw, in the table's column order. */
  const row = (time: string, value: number, metric = "pv.power", inverterId = "inv-1") => [
    time,
    inverterId,
    metric,
    value,
  ];

  test("filters on time, metric and inverter together — never a neighbour inverter's samples", async () => {
    const [call] = await capture([], () => queryRawHistory(q));
    const sqlText = flat(call.sql).toLowerCase();
    expect(sqlText).toContain('from "metrics_raw"');
    expect(sqlText).toContain('"time" >=');
    expect(sqlText).toContain('"metric" =');
    expect(sqlText).toContain('"inverter_id" =');
    // The timestamp is encoded by drizzle's column type before it reaches the
    // driver, so compare the instant it denotes rather than the literal shape.
    expect(Date.parse(String(call.params[0]))).toBe(since.getTime());
    expect(call.params.slice(1)).toEqual(["pv.power", "inv-1", 10]);
  });

  test("the lower bound is inclusive — a sample exactly at `since` belongs to the window", async () => {
    const [call] = await capture([], () => queryRawHistory(q));
    expect(flat(call.sql)).toContain('"time" >= $1');
    expect(flat(call.sql)).not.toContain('"time" > $1');
  });

  test("most-recent-first, so a capped read keeps the newest samples rather than the oldest", async () => {
    const [call] = await capture([], () => queryRawHistory(q));
    expect(flat(call.sql).toLowerCase()).toContain("order by");
    expect(flat(call.sql).toLowerCase()).toContain("desc");
    expect(flat(call.sql).toLowerCase()).toContain("limit");
  });

  test("`limit` reaches the query unchanged, including a limit of 1", async () => {
    const [call] = await capture([], () => queryRawHistory({ ...q, limit: 1 }));
    expect(call.params.at(-1)).toBe(1);
  });

  test("no samples in the window is an empty array, not an error", async () => {
    const [, rows] = await capture([], () => queryRawHistory(q));
    expect(rows).toEqual([]);
  });

  test("rows keep the database's descending order — the client is not silently re-sorted", async () => {
    const [, rows] = await capture(
      [row("2026-04-02T00:00:00.000Z", 2), row("2026-04-01T23:59:59.000Z", 1)],
      () => queryRawHistory(q),
    );
    expect(rows.map((r) => r.time)).toEqual([
      "2026-04-02T00:00:00.000Z",
      "2026-04-01T23:59:59.000Z",
    ]);
  });

  test("a 0 W sample is returned as 0 — an idle inverter reported a value", async () => {
    const [, rows] = await capture([row("2026-04-01T12:00:00.000Z", 0)], () => queryRawHistory(q));
    expect(rows).toEqual([{ time: "2026-04-01T12:00:00.000Z", value: 0 }]);
  });

  test("a negative sample is returned as-is — import/export and temperature are signed", async () => {
    const [, rows] = await capture([row("2026-04-01T12:00:00.000Z", -1234.5)], () =>
      queryRawHistory(q),
    );
    expect(rows[0]?.value).toBe(-1234.5);
  });

  test("times are serialised as UTC ISO strings whatever the server's local zone", async () => {
    const [, rows] = await capture([row("2026-04-01 22:30:00+00", 5)], () => queryRawHistory(q));
    expect(rows[0]?.time).toBe("2026-04-01T22:30:00.000Z");
  });
});

describe("queryRecentBuckets — the SQL", () => {
  const q = { inverterId: "inv-1", seconds: 300, stepSeconds: 1 };

  test("buckets server-side with time_bucket + last(value, time), grouped per metric", async () => {
    const [call] = await capture([], () => queryRecentBuckets(q));
    const sqlText = flat(call.sql);
    expect(sqlText).toContain("time_bucket(");
    expect(sqlText).toContain("last(value, time)");
    expect(sqlText).toContain("group by metric, bucket");
    expect(sqlText).toContain("order by metric, bucket asc");
    expect(sqlText).toContain("from metrics_raw");
  });

  test("inverter and window are bound parameters, never interpolated text", async () => {
    const before = Date.now();
    const [call] = await capture([], () =>
      queryRecentBuckets({ ...q, inverterId: "inv'; drop table metrics_raw; --" }),
    );
    const after = Date.now();
    expect(call.sql).not.toContain("drop table");
    expect(call.params[0]).toBe("inv'; drop table metrics_raw; --");
    const since = call.params[1] as Date;
    expect(since.getTime()).toBeGreaterThanOrEqual(before - 300_000);
    expect(since.getTime()).toBeLessThanOrEqual(after - 300_000);
  });

  // The bug the old `limit: 200000` was papering over: a GLOBAL `desc + limit`
  // caps rows before any per-metric grouping, so a wide feed loses its oldest
  // samples across EVERY metric. The bound is now structural (window ÷ step),
  // and the client cannot influence it at all.
  test("carries no client-supplied limit — any cap is derived from window ÷ step", async () => {
    const [call] = await capture([], () => queryRecentBuckets(q));
    const sqlText = flat(call.sql);
    // No limit is a bound parameter, and no number the caller passed is one:
    // every parameter is either the inverter id or the window start.
    const since = call.params[1];
    expect(call.params.every((p) => p === "inv-1" || p === since)).toBe(true);
    const cap = /limit (\d+)/.exec(sqlText)?.[1];
    if (cap !== undefined) {
      // Derived: grows with the bucket count, and comfortably above the
      // structural row count of any realistic feed.
      const wide = await capture([], () => queryRecentBuckets({ ...q, seconds: 600 }));
      const wideCap = /limit (\d+)/.exec(flat(wide[0].sql))?.[1];
      expect(Number(wideCap)).toBeGreaterThan(Number(cap));
      expect(Number(cap)).toBeGreaterThanOrEqual(300 * 64);
    }
    expect(sqlText).not.toContain("order by time desc");
  });

  // `time_bucket` is EPOCH-aligned, not `since`-aligned, so an N-second window
  // whose start falls mid-bucket spans N/step + 1 buckets. A cap of exactly
  // ceil(seconds/step) × guard is therefore one bucket-row-per-metric short —
  // and because the order is `metric, bucket`, truncation does not shave the
  // edges evenly: it drops the alphabetically LAST metrics ENTIRELY. On a
  // full-width request `seedBackfill` reads an absent metric as dead and clears
  // its buffer, so an off-by-one here blanks the tail of the dashboard.
  test("the derived cap allows for the extra epoch-aligned bucket an unaligned window spans", async () => {
    for (const [seconds, stepSeconds, buckets] of [
      [1, 1, 2],
      [300, 1, 301],
      [300, 5, 61],
      [3600, 60, 61],
    ] as const) {
      const [call] = await capture([], () => queryRecentBuckets({ ...q, seconds, stepSeconds }));
      const cap = Number(/limit (\d+)/.exec(flat(call.sql))?.[1] ?? Number.POSITIVE_INFINITY);
      expect(cap).toBeGreaterThanOrEqual(buckets * 512);
    }
  });

  test("two metrics × 300 buckets: every metric still keeps its OLDEST bucket", async () => {
    const rows: unknown[] = [];
    for (const metric of ["a_pv", "z_load"]) {
      for (let i = 0; i < 300; i++) rows.push({ metric, bucket: 1_755_345_600 + i, value: i });
    }
    const [, out] = await capture(rows, () => queryRecentBuckets(q));
    expect(out.metrics.a_pv?.o[0]).toBe(0);
    expect(out.metrics.z_load?.o[0]).toBe(0);
    expect(out.metrics.a_pv?.o.length).toBe(300);
    expect(out.metrics.z_load?.o.length).toBe(300);
  });

  test("stepSeconds reaches the bucket width and the offsets that are derived from it", async () => {
    const [call, out] = await capture(
      [
        { metric: "pv", bucket: 1_755_345_600, value: 1 },
        { metric: "pv", bucket: 1_755_345_605, value: 2 },
      ],
      () => queryRecentBuckets({ ...q, stepSeconds: 5 }),
    );
    expect(flat(call.sql)).toContain("secs => 5");
    expect(out.step).toBe(5);
    expect(out.metrics.pv).toEqual({ o: [0, 1], v: [1, 2] });
  });
});

describe("queryRecentBuckets — carrying the held value into the window", () => {
  const q = { inverterId: "inv-1", seconds: 300, stepSeconds: 1 };

  test("seeds each metric with the value in force at the window start", async () => {
    // Under change-only storage a metric that did not change inside the window
    // has NO row in it. Without a seed the payload omits the metric entirely,
    // and a full-width backfill reads an omitted metric as dead and clears its
    // buffer — a steady voltage would blank its own sparkline.
    const [call] = await capture([], () => queryRecentBuckets(q));
    expect(flat(call.sql)).toContain("order by metric, time desc");
    expect(flat(call.sql)).toContain("union all");
  });

  test("the lookback for the seed is bounded, not an open-ended scan", async () => {
    // An unbounded `time < since` walks the whole hypertable. The encoder closes
    // every interval at its bucket boundary, so a live metric always has a row
    // within a minute; a 5-minute bound is generous and still cheap.
    const [call] = await capture([], () => queryRecentBuckets(q));
    expect(flat(call.sql)).toContain("make_interval(secs => 300)");
  });

  test("a real sample in the first bucket wins over the seed", async () => {
    // Both arms can land in the same bucket. Emitting two points at one instant
    // would make the client draw a vertical step out of nothing, so the measured
    // sample is preferred.
    const [call] = await capture([], () => queryRecentBuckets(q));
    expect(flat(call.sql)).toContain("distinct on (metric, bucket)");
  });

  test("a metric with no row in the lookback is not seeded", async () => {
    // The boundary that matters: "unchanged" and "the device was not answering"
    // must not become the same thing. A metric the seed cannot find stays absent,
    // which is how a dead metric still reads as dead.
    const [, out] = await capture([{ metric: "pv.power", bucket: 1_700_000_000, value: 42 }], () =>
      queryRecentBuckets(q),
    );
    expect(Object.keys(out.metrics)).toEqual(["pv.power"]);
  });

  test("the seeded value is shaped like any other point", async () => {
    const [, out] = await capture(
      [
        { metric: "pv.power", bucket: 1_700_000_000, value: 230 },
        { metric: "pv.power", bucket: 1_700_000_060, value: 231 },
      ],
      () => queryRecentBuckets({ ...q, stepSeconds: 60 }),
    );
    expect(out.metrics["pv.power"]).toEqual({ o: [0, 1], v: [230, 231] });
  });
});

describe("queryRecentBuckets — row shaping", () => {
  const q = { inverterId: "inv-1", seconds: 300, stepSeconds: 1 };

  test("offsets are small integers relative to t0, values in the same order", async () => {
    const [, out] = await capture(
      [
        { metric: "pv", bucket: 1_755_345_600, value: 10 },
        { metric: "pv", bucket: 1_755_345_601, value: 11 },
      ],
      () => queryRecentBuckets(q),
    );
    expect(out).toEqual({
      t0: 1_755_345_600_000,
      step: 1,
      metrics: { pv: { o: [0, 1], v: [10, 11] } },
    });
  });

  test("no rows in the window is an empty metric map with a numeric t0, never NaN", async () => {
    const [, out] = await capture([], () => queryRecentBuckets(q));
    expect(out.metrics).toEqual({});
    expect(Number.isFinite(out.t0)).toBe(true);
    expect(out.step).toBe(1);
  });

  test("exactly one row lands at offset 0", async () => {
    const [, out] = await capture([{ metric: "pv", bucket: 1_755_345_600, value: 7 }], () =>
      queryRecentBuckets(q),
    );
    expect(out.metrics.pv).toEqual({ o: [0], v: [7] });
  });

  test("0 W and −350 W survive shaping — they are readings, not absences", async () => {
    const [, out] = await capture(
      [
        { metric: "grid", bucket: 1_755_345_600, value: 0 },
        { metric: "grid", bucket: 1_755_345_601, value: -350 },
      ],
      () => queryRecentBuckets(q),
    );
    expect(out.metrics.grid?.v).toEqual([0, -350]);
  });

  test("two metrics with DISJOINT bucket sets share one t0 — the oldest bucket seen anywhere", async () => {
    const [, out] = await capture(
      [
        { metric: "load", bucket: 1_755_345_610, value: 1 },
        { metric: "pv", bucket: 1_755_345_600, value: 2 },
      ],
      () => queryRecentBuckets(q),
    );
    expect(out.t0).toBe(1_755_345_600_000);
    expect(out.metrics.pv).toEqual({ o: [0], v: [2] });
    expect(out.metrics.load).toEqual({ o: [10], v: [1] });
  });

  test("a gap inside one metric's buckets is a jump in `o`, never a fabricated point", async () => {
    const [, out] = await capture(
      [
        { metric: "pv", bucket: 1_755_345_600, value: 1 },
        { metric: "pv", bucket: 1_755_345_607, value: 2 },
      ],
      () => queryRecentBuckets(q),
    );
    expect(out.metrics.pv).toEqual({ o: [0, 7], v: [1, 2] });
  });

  test("bigint buckets and numeric values arriving as strings are coerced, not concatenated", async () => {
    const [, out] = await capture(
      [
        { metric: "pv", bucket: "1755345600", value: "1.5" },
        { metric: "pv", bucket: "1755345601", value: "0" },
      ],
      () => queryRecentBuckets(q),
    );
    expect(out.t0).toBe(1_755_345_600_000);
    expect(out.metrics.pv).toEqual({ o: [0, 1], v: [1.5, 0] });
  });
});

/**
 * The read cutover (#116). `rollup-sql.test.ts` proves the composition; these
 * prove what this module does with the rows that come back — in particular the
 * one row shape a weighted aggregate can produce that the legacy one never
 * could.
 */
describe("queryRollup — weighted/legacy cutover", () => {
  test("each tier reads BOTH its weighted aggregate and its legacy one", async () => {
    for (const [bucket, weighted, legacy] of [
      ["minute", "weighted_minute_rollups", "minute_rollups"],
      ["hour", "weighted_hourly_rollups", "hourly_rollups"],
      ["day", "weighted_daily_rollups", "daily_rollups"],
    ] as const) {
      const [call] = await capture([], () =>
        queryRollup({ ...ROLLUP, bucket, since: new Date(0) }),
      );
      expect(flat(call.sql)).toContain(`from ${weighted}`);
      expect(flat(call.sql)).toContain(`from ${legacy}`);
    }
  });

  test("a degenerate zero-weight bucket is dropped, never reported as 0 kW", async () => {
    // `nullif(weight, 0)` makes the quotient NULL rather than an error or a
    // fabricated number. `Number(null)` is 0, which would draw a flat line
    // through a gap and read as a real measurement — so the row is dropped.
    const [, rows] = await capture(
      [
        { bucket: "2026-01-01T00:00:00.000Z", avg_value: null, max_value: 5, min_value: 5 },
        { bucket: "2026-01-01T01:00:00.000Z", avg_value: 2, max_value: 3, min_value: 1 },
      ],
      () => queryRollup({ ...ROLLUP, since: new Date(0) }),
    );
    expect(rows).toEqual([{ time: "2026-01-01T01:00:00.000Z", avg: 2, max: 3, min: 1 }]);
  });

  test("a zero average is still a reading — the drop is for NULL only", async () => {
    const [, rows] = await capture(
      [{ bucket: "2026-01-01T00:00:00.000Z", avg_value: 0, max_value: 0, min_value: 0 }],
      () => queryRollup({ ...ROLLUP, since: new Date(0) }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.avg).toBe(0);
  });

  test("the predicates are bound once per arm, so neither side scans unfiltered", async () => {
    const [call] = await capture([], () =>
      queryRollup({ ...ROLLUP, metric: "battery.power", inverterId: "inv-7", since: new Date(0) }),
    );
    expect(call.params.filter((p) => p === "battery.power")).toHaveLength(2);
    expect(call.params.filter((p) => p === "inv-7")).toHaveLength(2);
  });

  test("the row shape callers already depend on is unchanged", async () => {
    const [, rows] = await capture(
      [{ bucket: "2026-01-01T00:00:00.000Z", avg_value: 1.5, max_value: 3, min_value: 0 }],
      () => queryRollup({ ...ROLLUP, since: new Date(0) }),
    );
    expect(Object.keys(rows[0] ?? {})).toEqual(["time", "avg", "max", "min"]);
  });
});

describe("queryHourlyAvgRange — weighted/legacy cutover", () => {
  test("reads both hourly aggregates", async () => {
    const [call] = await capture([], () =>
      queryHourlyAvgRange("pv.power", "inv-1", new Date(0), new Date(1)),
    );
    expect(flat(call.sql)).toContain("from weighted_hourly_rollups");
    expect(flat(call.sql)).toContain("from hourly_rollups");
  });

  test("a NULL average is dropped rather than learned from as a zero actual", async () => {
    // This series is the measured-actual side of the forecast correction's
    // learning. A fabricated 0 here teaches the model that the sun did not shine.
    const [, rows] = await capture(
      [
        { bucket: "2026-01-01T00:00:00.000Z", avg_value: null },
        { bucket: "2026-01-01T01:00:00.000Z", avg_value: 4 },
      ],
      () => queryHourlyAvgRange("pv.power", "inv-1", new Date(0), new Date(1)),
    );
    expect(rows).toEqual([{ bucketMs: Date.parse("2026-01-01T01:00:00.000Z"), avg: 4 }]);
  });
});

describe("queryMedianHourlyAvg — weighted/legacy cutover", () => {
  test("takes the median over the cutover union, not over one aggregate", async () => {
    const [call] = await capture([{ median: 1 }], () => queryMedianHourlyAvg("load.power", "i", 7));
    expect(flat(call.sql)).toContain("from weighted_hourly_rollups");
    expect(flat(call.sql)).toContain("from hourly_rollups");
    expect(flat(call.sql)).toContain("percentile_cont(0.5) within group (order by avg_value)");
  });
});
