import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { drizzle } from "drizzle-orm/pg-proxy";

// `health.ts` is the database-bound half of battery health: the measuring rules
// are pure and already pinned in `./capacity-estimate.test.ts`. What is left
// here — and what these tests are about — is the moving of rows: the statement
// each export emits, the way driver rows are binned back into three series, and
// the arithmetic applied on the way in and out of storage.
//
// So the DB singleton is swapped for drizzle's pg-proxy driver rather than
// stubbed away: a real drizzle instance that builds the real SQL text and
// parameters and hands them to a callback instead of a socket. Every assertion
// below is therefore on the statement this module actually emits, or on the
// values it actually derives, never on a mock's arguments.
//
// The spread is load-bearing: `mock.module` is process-global and permanent, so
// a mock returning only `db` would delete every other `@SunReye/db` export for
// every test file that runs after this one.
const realDb = await import("@SunReye/db");

// …and the spread alone is not enough: the stub is permanent too, so this fake
// `db` would stay installed for every later file, including the suites that run
// real queries through the singleton. A module namespace is live (after the
// mock, `realDb.db` IS `dbStub`), so the real exports are snapshotted BY VALUE
// here, before anything is installed.
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

const dbStub = {
  select: (...args: never[]) => (proxy.select as unknown as (...a: never[]) => unknown)(...args),
  insert: (...args: never[]) => (proxy.insert as unknown as (...a: never[]) => unknown)(...args),
};
mock.module("@SunReye/db", () => ({ ...realDb, db: dbStub }));

// Hand the singleton back once this file is done, so no later suite runs its
// queries against this recorder.
afterAll(() => {
  mock.module("@SunReye/db", () => ({ ...realDbExports }));
});

const { batteryHealthSummary, measureSegments, recordSegments } = await import("./health");
const { MIN_SEGMENTS } = await import("./capacity-estimate");

beforeEach(() => {
  calls.length = 0;
  queue.length = 0;
});

/** Collapse whitespace so multi-line SQL can be matched by substring. */
const flat = (s: string) => s.replace(/\s+/g, " ").trim();

const KEYS = { soc: "battery.soc", power: "battery.power", temperature: "battery.temperature" };
const INV = "inv-1";
const FROM = new Date("2026-03-01T00:00:00Z");
const TO = new Date("2026-03-02T00:00:00Z");

/**
 * A driver row for the series read, in the projection's field order
 * (`metric, time, value, dur_ms`). `durMs` is nullable on purpose: rows written
 * before the storage rewrite carry no duration.
 */
const seriesRow = (metric: string, tMs: number, value: number, durMs: number | null) => [
  metric,
  new Date(tMs).toISOString(),
  value,
  durMs,
];

const MINUTE = 60_000;

/**
 * A 30-minute discharge from 90 % to 60 %: four SOC samples ten minutes apart
 * (inside the BMS-trusted band, and no gap wide enough to break the run), and
 * three power intervals covering the whole span at a steady `w`.
 *
 * At `w = 2000` the integral is 2000 W x 1 800 000 ms = 1.0 kWh exactly, so
 * every energy assertion below is a round number rather than a fixture.
 */
function dischargeRows(w: number, opts: { tempC?: number } = {}): unknown[][] {
  const rows: unknown[][] = [];
  for (const [i, soc] of [90, 80, 70, 60].entries()) {
    rows.push(seriesRow(KEYS.soc, i * 10 * MINUTE, soc, 10 * MINUTE));
  }
  for (let i = 0; i < 3; i++) {
    rows.push(seriesRow(KEYS.power, i * 10 * MINUTE, w, 10 * MINUTE));
  }
  if (opts.tempC !== undefined) {
    for (let i = 0; i < 3; i++) {
      rows.push(seriesRow(KEYS.temperature, i * 10 * MINUTE, opts.tempC, 10 * MINUTE));
    }
  }
  return rows;
}

describe("measureSegments — the series read", () => {
  test("reads the raw table joined to the metric names, scoped to the device, over a half-open window, oldest first", async () => {
    queue.push([]);
    await measureSegments(INV, FROM, TO, KEYS);
    const call = calls[0] as Call;
    const sql = flat(call.sql);
    // Raw rows, not a rollup: a stored row carries its own `dur_ms`, so the
    // energy integral is exact — a minute bucket would have averaged away the
    // very thing being integrated.
    expect(sql).toContain('from "metrics_raw"');
    expect(sql).not.toContain("rollups");
    // The metric key is JOINED rather than resolved to an id in process,
    // because the row loop dispatches on the NAME.
    expect(sql).toContain('inner join "metric_keys"');
    // Identity stops at the database's edge: a slug in, an int2 sub-select out.
    expect(sql).toContain('"metrics_raw"."device_id" = coalesce');
    // Half-open: a row landing exactly on `to` belongs to the next window.
    expect(sql).toContain('"metrics_raw"."time" >= ');
    expect(sql).toContain('"metrics_raw"."time" < ');
    expect(sql).toContain('order by "metrics_raw"."time"');
    // The bounds arrive as bound parameters (this driver renders them as ISO
    // text), and the source id is bound TWICE — `deviceIdOf` tries the slug,
    // then the transitional profile-id arm.
    expect(call.params).toContain(FROM.toISOString());
    expect(call.params).toContain(TO.toISOString());
    expect(call.params.filter((p) => p === INV)).toHaveLength(2);
  });

  test("asks only for the keys the profile maps — no temperature role, no temperature key", async () => {
    queue.push([]);
    await measureSegments(INV, FROM, TO, { soc: KEYS.soc, power: KEYS.power });
    expect(calls[0]?.params).not.toContain(KEYS.temperature);
    expect(calls[0]?.params).toContain(KEYS.soc);
    expect(calls[0]?.params).toContain(KEYS.power);
  });

  test("the source id is a bound parameter, not interpolated text", async () => {
    queue.push([]);
    const hostile = "inv'; drop table metrics_raw; --";
    await measureSegments(hostile, FROM, TO, KEYS);
    expect(calls[0]?.sql).not.toContain("drop table");
    expect(calls[0]?.params).toContain(hostile);
  });

  test("an empty window measures nothing — no rows is not a zero-capacity pack", async () => {
    queue.push([]);
    expect(await measureSegments(INV, FROM, TO, KEYS)).toEqual([]);
  });
});

describe("measureSegments — binning driver rows back into three series", () => {
  test("a full discharge is measured: SOC rows drive the segment, power rows its energy", async () => {
    queue.push(dischargeRows(2000));
    const [segment, ...rest] = await measureSegments(INV, FROM, TO, KEYS);
    expect(rest).toEqual([]);
    expect(segment?.socStart).toBe(90);
    expect(segment?.socEnd).toBe(60);
    expect(segment?.deltaSoc).toBe(30);
    expect(segment?.energyKwh).toBeCloseTo(1.0, 9);
    // No temperature key was returned, so the segment carries no temperature
    // rather than a zero.
    expect(segment?.meanTempC).toBeUndefined();
  });

  test("rows for a third metric are read as temperature and reach the estimator", async () => {
    queue.push(dischargeRows(2000, { tempC: 25 }));
    const [segment] = await measureSegments(INV, FROM, TO, KEYS);
    expect(segment?.meanTempC).toBeCloseTo(25, 9);
    // Temperature is passed only when some arrived — the previous test pins the
    // other side of that branch.
    expect(segment?.energyKwh).toBeCloseTo(1.0, 9);
  });

  test("a pre-rewrite row with no `dur_ms` is integrated as one shipped poll interval, not skipped and not zero", async () => {
    // One power interval of 3600 W. Held for the fallback 1000 ms it is
    // 3600 x 1000 / 3.6e9 = 0.001 kWh; skipped it would be 0, and treated as
    // the ten-minute SOC spacing it would be 0.6.
    const withNull = [
      ...[90, 80, 70, 60].map((soc, i) => seriesRow(KEYS.soc, i * 10 * MINUTE, soc, null)),
      seriesRow(KEYS.power, 0, 3600, null),
    ];
    queue.push(withNull);
    const [segment] = await measureSegments(INV, FROM, TO, KEYS);
    expect(segment?.energyKwh).toBeCloseTo(0.001, 12);

    // …and it is exactly equivalent to the same row carrying 1000 explicitly.
    queue.push([
      ...[90, 80, 70, 60].map((soc, i) => seriesRow(KEYS.soc, i * 10 * MINUTE, soc, 1000)),
      seriesRow(KEYS.power, 0, 3600, 1000),
    ]);
    const [explicit] = await measureSegments(INV, FROM, TO, KEYS);
    expect(explicit).toEqual(segment);
  });
});

describe("measureSegments — which way `battery.power` points", () => {
  test("a profile that reports positive-means-discharge is measured as it stands", async () => {
    queue.push(dischargeRows(2000));
    const [segment] = await measureSegments(INV, FROM, TO, KEYS);
    expect(segment?.energyKwh).toBeCloseTo(1.0, 9);
  });

  test("a profile that reports positive-means-CHARGE is normalised, not measured backwards", async () => {
    // The same physical discharge, with the sign convention flipped. Getting
    // this wrong would not fail — it would silently measure the charge side.
    queue.push(dischargeRows(-2000));
    const [segment] = await measureSegments(INV, FROM, TO, KEYS);
    expect(segment?.socStart).toBe(90);
    expect(segment?.energyKwh).toBeCloseTo(1.0, 9);
  });

  test("when the window cannot say which way the sign points, nothing is measured — never a guess", async () => {
    // SOC never moves, so no step can vote. The power series is perfectly
    // readable; it is the PAIRING that is unavailable.
    queue.push([
      ...[90, 90, 90, 90].map((soc, i) => seriesRow(KEYS.soc, i * 10 * MINUTE, soc, 10 * MINUTE)),
      ...[0, 1, 2].map((i) => seriesRow(KEYS.power, i * 10 * MINUTE, 2000, 10 * MINUTE)),
    ]);
    expect(await measureSegments(INV, FROM, TO, KEYS)).toEqual([]);
    // The read still happened — the refusal is a measurement decision, not a
    // short-circuited query.
    expect(calls).toHaveLength(1);
  });
});

describe("recordSegments", () => {
  const segment = {
    startMs: Date.parse("2026-03-01T20:00:00Z"),
    endMs: Date.parse("2026-03-02T04:00:00Z"),
    socStart: 90,
    socEnd: 60,
    deltaSoc: 30,
    energyKwh: 3,
  };

  test("nothing to store issues no statement at all", async () => {
    expect(await recordSegments(INV, [])).toBe(0);
    expect(calls).toEqual([]);
  });

  test("each segment's own capacity estimate is derived on the way in: energy over the fraction of charge it cost", async () => {
    queue.push([[segment.endMs]]);
    await recordSegments(INV, [segment]);
    const call = calls[0] as Call;
    // 3 kWh for 30 SOC points is a 10 kWh pack.
    expect(call.params).toContain(10);
    expect(call.params).toContain(3);
    expect(call.params).toContain(90);
    expect(call.params).toContain(60);
  });

  test("the segment's END instant is the key, so a re-score inserts nothing rather than duplicating", async () => {
    queue.push([[segment.endMs]]);
    await recordSegments(INV, [segment]);
    const sql = flat(calls[0]?.sql ?? "");
    expect(sql).toContain("on conflict do nothing");
    expect(sql).toContain('insert into "battery_capacity_estimates"');
    expect(sql).toContain('returning "measured_at"');
  });

  test("the count is rows actually INSERTED, not rows offered — a re-score over a scored window reports 0", async () => {
    // Two segments handed over, the driver returns no returned rows: every one
    // conflicted. A caller told "stored 2" here could not tell a working
    // backfill from one that found nothing new.
    queue.push([]);
    expect(await recordSegments(INV, [segment, { ...segment, endMs: segment.endMs + 1 }])).toBe(0);

    // And a partially-new window reports only the new row.
    queue.push([[segment.endMs]]);
    expect(await recordSegments(INV, [segment, { ...segment, endMs: segment.endMs + 1 }])).toBe(1);
  });

  test("a segment measured without temperature stores NULL, never a zero degrees", async () => {
    queue.push([[segment.endMs]]);
    await recordSegments(INV, [segment]);
    expect(calls[0]?.params).toContain(null);
    expect(calls[0]?.params).not.toContain(0);
  });

  test("a measured temperature is stored as it was measured", async () => {
    queue.push([[segment.endMs]]);
    await recordSegments(INV, [{ ...segment, meanTempC: 18.5 }]);
    expect(calls[0]?.params).toContain(18.5);
  });

  test("all segments go in one statement, and the device is resolved in SQL rather than awaited", async () => {
    queue.push([[segment.endMs]]);
    await recordSegments(INV, [segment, { ...segment, endMs: segment.endMs + 1 }]);
    expect(calls).toHaveLength(1);
    expect(flat(calls[0]?.sql ?? "")).toContain("coalesce");
  });
});

describe("batteryHealthSummary", () => {
  const DAY = 86_400_000;
  const NOW = new Date("2026-09-01T00:00:00Z");

  /**
   * A stored estimate row in the table's column order. `energyKwh` and the SOC
   * pair are what the summary re-derives from; `capacityKwh` is carried for the
   * trend only.
   */
  const estRow = (
    measuredAtMs: number,
    energyKwh: number,
    opts: { capacityKwh?: number; tempC?: number | null } = {},
  ) => [
    1,
    new Date(measuredAtMs).toISOString(),
    new Date(measuredAtMs - 4 * 3_600_000).toISOString(),
    90,
    60,
    energyKwh,
    opts.capacityKwh ?? energyKwh / 0.3,
    opts.tempC ?? null,
  ];

  /** `n` estimates ending `daysAgo` before {@link NOW}, one per day. */
  const run = (n: number, daysAgo: number, energyKwh: number) =>
    Array.from({ length: n }, (_, i) => estRow(NOW.getTime() - (daysAgo + i) * DAY, energyKwh));

  test("reads only this device's estimates, oldest first", async () => {
    queue.push([]);
    await batteryHealthSummary(INV, { now: NOW });
    const sql = flat(calls[0]?.sql ?? "");
    expect(sql).toContain('from "battery_capacity_estimates"');
    expect(sql).toContain("coalesce");
    expect(sql).toContain('order by "battery_capacity_estimates"."measured_at"');
  });

  test("no history reports nothing measured, not a healthy pack", async () => {
    queue.push([]);
    const health = await batteryHealthSummary(INV, { now: NOW });
    expect(health.capacity).toBeNull();
    expect(health.baseline).toBeNull();
    expect(health.health).toBeNull();
    expect(health.trend).toEqual([]);
  });

  test("a single stored estimate is an anecdote, not a capacity", async () => {
    queue.push([estRow(NOW.getTime() - DAY, 3)]);
    const health = await batteryHealthSummary(INV, { now: NOW });
    expect(health.capacity).toBeNull();
    expect(health.health).toBeNull();
    // …but it is still reported in the degradation series.
    expect(health.trend).toHaveLength(1);
  });

  test("one short of the minimum still reports no capacity", async () => {
    queue.push(run(MIN_SEGMENTS - 1, 1, 3));
    expect((await batteryHealthSummary(INV, { now: NOW })).capacity).toBeNull();
  });

  test("the current capacity is measured over the recent window and the baseline over the earliest estimates, so degradation shows", async () => {
    // Five estimates from over a year ago at 10 kWh, then five recent at 8.
    queue.push([...run(MIN_SEGMENTS, 400, 3), ...run(MIN_SEGMENTS, 10, 2.4)]);
    const health = await batteryHealthSummary(INV, { nameplateKwh: null, now: NOW });
    expect(health.capacity?.kwh).toBeCloseTo(8, 9);
    expect(health.capacity?.segments).toBe(MIN_SEGMENTS);
    // The old estimates are outside the recent window and still anchor the
    // baseline — that is exactly what the baseline is for.
    expect(health.baseline?.kwh).toBeCloseTo(10, 9);
    // With no nameplate the pack is measured against its own first solid
    // reading: 8 of the 10 it started at.
    expect(health.health).toEqual({ ratio: 0.8, reference: "baseline", referenceKwh: 10 });
  });

  test("a configured nameplate wins over the install's own baseline", async () => {
    queue.push([...run(MIN_SEGMENTS, 400, 3), ...run(MIN_SEGMENTS, 10, 2.4)]);
    const health = await batteryHealthSummary(INV, { nameplateKwh: 16, now: NOW });
    expect(health.health).toEqual({ ratio: 0.5, reference: "nameplate", referenceKwh: 16 });
  });

  test("the recent window reaches back 180 days, and its far edge is included", async () => {
    // Exactly on the boundary: still recent.
    queue.push(Array.from({ length: MIN_SEGMENTS }, () => estRow(NOW.getTime() - 180 * DAY, 3)));
    expect((await batteryHealthSummary(INV, { now: NOW })).capacity?.kwh).toBeCloseTo(10, 9);

    // One millisecond older: outside, so there is no current capacity left —
    // though the baseline, which ignores the window, still stands.
    queue.push(
      Array.from({ length: MIN_SEGMENTS }, () => estRow(NOW.getTime() - 180 * DAY - 1, 3)),
    );
    const stale = await batteryHealthSummary(INV, { now: NOW });
    expect(stale.capacity).toBeNull();
    expect(stale.baseline?.kwh).toBeCloseTo(10, 9);
    // No current capacity means no SOH — an unmeasurable ratio must not read as
    // a healthy one.
    expect(stale.health).toBeNull();
  });

  test("the stored `capacity_kwh` column is carried to the trend but never trusted for the summary", async () => {
    // Every row claims 99 kWh while its own energy and SOC say 10. The summary
    // re-derives; only the trend echoes the column.
    queue.push(
      Array.from({ length: MIN_SEGMENTS }, (_, i) =>
        estRow(NOW.getTime() - (i + 1) * DAY, 3, { capacityKwh: 99 }),
      ),
    );
    const health = await batteryHealthSummary(INV, { now: NOW });
    expect(health.capacity?.kwh).toBeCloseTo(10, 9);
    expect(health.trend.map((p) => p.capacityKwh)).toEqual(Array(MIN_SEGMENTS).fill(99));
  });

  test("the trend is the stored series verbatim: ISO instants, the stored capacity, and the temperature or null", async () => {
    queue.push([
      estRow(Date.parse("2026-01-01T00:00:00Z"), 3, { capacityKwh: 10, tempC: 21.5 }),
      estRow(Date.parse("2026-02-01T00:00:00Z"), 3, { capacityKwh: 9.5, tempC: null }),
    ]);
    const health = await batteryHealthSummary(INV, { now: NOW });
    expect(health.trend).toEqual([
      { measuredAt: "2026-01-01T00:00:00.000Z", capacityKwh: 10, tempC: 21.5 },
      { measuredAt: "2026-02-01T00:00:00.000Z", capacityKwh: 9.5, tempC: null },
    ]);
  });

  test("with no options at all the window is measured against the wall clock", async () => {
    // Estimates from an hour ago: recent under any reading of "now".
    queue.push(
      Array.from({ length: MIN_SEGMENTS }, (_, i) => estRow(Date.now() - (i + 1) * 3_600_000, 3)),
    );
    const health = await batteryHealthSummary(INV);
    expect(health.capacity?.kwh).toBeCloseTo(10, 9);
    expect(health.health).toEqual({ ratio: 1, reference: "baseline", referenceKwh: 10 });
  });
});
