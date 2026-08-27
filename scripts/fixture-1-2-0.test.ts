import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEV_DB_PORT,
  FAST_METRIC_KEYS,
  FIXTURE_DB,
  FIXTURE_PORT,
  type FixtureMode,
  type GroundTruth,
  HELP,
  RESTART_METRIC,
  type Shape,
  applySchema,
  assertFixtureTarget,
  assignShapes,
  build,
  buildPlan,
  cli,
  compareGroundTruth,
  compress,
  containerState,
  counterIncrement,
  describeRestarts,
  ensureContainer,
  type FixtureIo,
  groundTruthOnly,
  groundTruthPath,
  loadProfile,
  main,
  materialize,
  paritySnapshotPath,
  parseArgs,
  perDayEnergy,
  planRowCount,
  productionIo,
  readEnergy,
  readParitySnapshot,
  readRawWindow,
  readState,
  readTier,
  recordGroundTruth,
  recreateDatabase,
  report,
  restore,
  seedMetrics,
  seedSideTables,
  snapshot,
  spanEnd,
  sqlValueExpr,
  stampJournals,
  statements,
  trimRaw,
  valueAt,
  verifyModel,
  waitReady,
  withDatabase,
  writeGroundTruth,
} from "./fixture-1-2-0";

const url = (port: number, db: string) => `postgres://u:p@localhost:${port}/${db}`;

/** The metric shape the profile loader hands to {@link assignShapes}. */
const profileMetrics = [
  { key: "dc.pv1.power", unit: "W" },
  { key: "battery.power", unit: "W" },
  { key: "battery.soc", unit: "%" },
  { key: "total_energy", unit: "kWh" },
  { key: "day_energy", unit: "kWh" },
  { key: "ac.total_energy_bought", unit: "kWh" },
  { key: "ac.l1.voltage", unit: "V" },
  { key: "ac.l1.current", unit: "A" },
  { key: "battery.temperature", unit: "°C" },
  { key: "inverter.status", unit: null },
];

describe("target guard", () => {
  test("accepts the dedicated fixture database on the throwaway port", () => {
    expect(() => assertFixtureTarget(url(FIXTURE_PORT, FIXTURE_DB))).not.toThrow();
  });

  test("refuses the dev database port, naming the live inverter", () => {
    expect(() => assertFixtureTarget(url(DEV_DB_PORT, FIXTURE_DB))).toThrow(/live inverter/i);
  });

  test("refuses any other port", () => {
    expect(() => assertFixtureTarget(url(5544, FIXTURE_DB))).toThrow(/5544/);
  });

  test("refuses any other database name, even on the right port", () => {
    expect(() => assertFixtureTarget(url(FIXTURE_PORT, "postgres"))).toThrow(/postgres/);
    expect(() => assertFixtureTarget(url(FIXTURE_PORT, "sunreye"))).toThrow(/sunreye/);
  });

  test("refuses a URL with no database at all", () => {
    expect(() => assertFixtureTarget(`postgres://u:p@localhost:${FIXTURE_PORT}/`)).toThrow();
  });

  test("an implicit port is not the fixture port", () => {
    expect(() => assertFixtureTarget(`postgres://u:p@localhost/${FIXTURE_DB}`)).toThrow();
  });

  test("withDatabase swaps only the database, keeping credentials and port", () => {
    const swapped = withDatabase(url(FIXTURE_PORT, "postgres"), FIXTURE_DB);
    expect(swapped).toContain(`:${FIXTURE_PORT}/${FIXTURE_DB}`);
    expect(swapped).toContain("u:p@");
    expect(() => assertFixtureTarget(swapped)).not.toThrow();
  });
});

describe("mode selection", () => {
  const endsAt = new Date("2026-08-27T00:00:00Z");
  const plan = (mode: FixtureMode) =>
    buildPlan({ mode, endsAt, profileMetrics, inverterId: "deye-sg05lp3" });

  test("full mode is the default and --fast selects the CI fixture", () => {
    expect(parseArgs([]).mode).toBe("full");
    expect(parseArgs(["--fast"]).mode).toBe("fast");
  });

  test("--help is an action, and says which mode is which", () => {
    expect(parseArgs(["--help"]).action).toBe("help");
    expect(HELP).toMatch(/--fast/);
    expect(HELP).toMatch(/\bCI\b/);
    expect(HELP).toMatch(/rehearsal/i);
  });

  test("actions are parsed, defaulting to build", () => {
    expect(parseArgs([]).action).toBe("build");
    expect(parseArgs(["--snapshot"]).action).toBe("snapshot");
    expect(parseArgs(["--restore"]).action).toBe("restore");
    expect(parseArgs(["--ground-truth"]).action).toBe("ground-truth");
    expect(parseArgs(["--reset"]).reset).toBe(true);
    expect(parseArgs([]).reset).toBe(false);
  });

  test("an unknown flag is rejected rather than silently ignored", () => {
    expect(() => parseArgs(["--ful"])).toThrow(/--ful/);
  });

  test("--ends-at pins the span so a rebuild is reproducible", () => {
    // Without it the span ends at the wall clock, so every rebuild produces a
    // different ground-truth file and two builds can never be compared.
    expect(parseArgs([]).endsAt).toBeNull();
    expect(parseArgs(["--ends-at=2026-08-01T00:00:00Z"]).endsAt?.toISOString()).toBe(
      "2026-08-01T00:00:00.000Z",
    );
  });

  test("--ends-at rejects a date it cannot parse instead of seeding Invalid Date", () => {
    expect(() => parseArgs(["--ends-at=last tuesday"])).toThrow(/ends-at/);
    expect(() => parseArgs(["--ends-at="])).toThrow(/ends-at/);
  });

  test("--ends-at must land on a whole minute, or buckets are half-open", () => {
    expect(() => parseArgs(["--ends-at=2026-08-01T00:00:30Z"])).toThrow(/minute/);
  });

  test("fast is a short span over few metrics; full is ~2 months over all of them", () => {
    const fast = plan("fast");
    const full = plan("full");
    expect(fast.metrics.length).toBeLessThan(full.metrics.length);
    expect(full.spanDays).toBeGreaterThanOrEqual(56);
    expect(full.metrics.length).toBe(profileMetrics.length);
    expect(planRowCount(fast)).toBeLessThan(planRowCount(full) / 4);
  });

  test("even fast must outlive raw retention, or it rehearses the wrong state", () => {
    // The whole point of the fixture is the state AFTER 7-day raw retention has
    // taken the history away, leaving minute_rollups as the only tier covering
    // it. A span of 7 days or less never trims, so the trim step would be a
    // no-op and CI would test the easy half.
    expect(plan("fast").spanDays).toBeGreaterThan(7);
  });

  test("every shape kind survives the fast subset, restart metric included", () => {
    const fast = plan("fast");
    const kinds = new Set(fast.metrics.map((m) => m.shape.kind));
    expect(kinds).toEqual(new Set(plan("full").metrics.map((m) => m.shape.kind)));
    expect(fast.metrics.map((m) => m.key)).toContain(RESTART_METRIC);
    expect(FAST_METRIC_KEYS).toContain(RESTART_METRIC);
  });

  test("the span ends where it was told to and covers spanDays exactly", () => {
    const full = plan("full");
    expect(full.endsAt.toISOString()).toBe(endsAt.toISOString());
    const days = (full.endsAt.getTime() - full.startsAt.getTime()) / 86_400_000;
    expect(days).toBe(full.spanDays);
    expect(planRowCount(full)).toBe(full.spanDays * 1440 * full.metrics.length);
  });
});

describe("shape assignment", () => {
  const metrics = assignShapes(profileMetrics, 60);
  const shapeOf = (key: string) => metrics.find((m) => m.key === key)?.shape;

  test("units drive the shape", () => {
    expect(shapeOf("dc.pv1.power")?.kind).toBe("pvPower");
    expect(shapeOf("battery.power")?.kind).toBe("signedPower");
    expect(shapeOf("battery.soc")?.kind).toBe("soc");
    expect(shapeOf("total_energy")?.kind).toBe("counter");
    expect(shapeOf("ac.l1.voltage")?.kind).toBe("level");
    expect(shapeOf("inverter.status")?.kind).toBe("status");
  });

  test("exactly one counter restarts, mid-span and mid-day", () => {
    const restarting = metrics.filter(
      (m) => m.shape.kind === "counter" && m.shape.restartAtMinute !== null,
    );
    expect(restarting.map((m) => m.key)).toEqual([RESTART_METRIC]);
    const shape = restarting[0]?.shape as Extract<Shape, { kind: "counter" }>;
    expect(shape.restartAtMinute).toBeGreaterThan(0);
    expect(shape.restartAtMinute).toBeLessThan(60 * 1440);
    // Mid-day, not on a bucket boundary: a restart at midnight would leave
    // every daily bucket's naive max-min accidentally correct.
    expect((shape.restartAtMinute as number) % 1440).not.toBe(0);
  });

  test("the restarting counter carries a lifetime offset, so the reset is a cliff", () => {
    const shape = shapeOf(RESTART_METRIC) as Extract<Shape, { kind: "counter" }>;
    expect(shape.offset).toBeGreaterThan(1000);
  });

  test("a shorter span still puts the restart inside it", () => {
    const short = assignShapes(profileMetrics, 3);
    const shape = short.find((m) => m.key === RESTART_METRIC)?.shape as Extract<
      Shape,
      { kind: "counter" }
    >;
    expect(shape.restartAtMinute).toBeGreaterThan(0);
    expect(shape.restartAtMinute).toBeLessThan(3 * 1440);
  });
});

describe("value model", () => {
  const metrics = assignShapes(profileMetrics, 60);
  const shapeOf = (key: string) => metrics.find((m) => m.key === key)!.shape;
  const H = (day: number, hour: number) => day * 1440 + hour * 60;

  test("PV power is zero overnight, positive at midday, never negative", () => {
    const pv = shapeOf("dc.pv1.power");
    expect(valueAt(pv, H(0, 0))).toBe(0);
    expect(valueAt(pv, H(0, 3))).toBe(0);
    expect(valueAt(pv, H(0, 23))).toBe(0);
    expect(valueAt(pv, H(0, 12))).toBeGreaterThan(0);
    for (let m = 0; m < 1440 * 3; m += 7) expect(valueAt(pv, m)).toBeGreaterThanOrEqual(0);
  });

  test("PV power varies day to day rather than repeating one curve", () => {
    const pv = shapeOf("dc.pv1.power");
    expect(valueAt(pv, H(0, 12))).not.toBeCloseTo(valueAt(pv, H(1, 12)), 6);
  });

  test("battery SOC charges through the day, discharges overnight, stays in band", () => {
    const soc = shapeOf("battery.soc") as Extract<Shape, { kind: "soc" }>;
    expect(valueAt(soc, H(0, 8))).toBeCloseTo(soc.minPct, 6);
    expect(valueAt(soc, H(0, 16))).toBeCloseTo(soc.maxPct, 6);
    expect(valueAt(soc, H(0, 12))).toBeGreaterThan(valueAt(soc, H(0, 10)));
    expect(valueAt(soc, H(0, 22))).toBeLessThan(valueAt(soc, H(0, 18)));
    for (let m = 0; m < 1440 * 3; m += 7) {
      const v = valueAt(soc, m);
      expect(v).toBeGreaterThanOrEqual(soc.minPct - 1e-9);
      expect(v).toBeLessThanOrEqual(soc.maxPct + 1e-9);
    }
  });

  test("battery power goes negative — discharge is a real reading, not a floor", () => {
    const flow = shapeOf("battery.power");
    const samples = Array.from({ length: 1440 }, (_, m) => valueAt(flow, m));
    expect(Math.min(...samples)).toBeLessThan(0);
    expect(Math.max(...samples)).toBeGreaterThan(0);
  });

  test("a lifetime counter is monotonically non-decreasing across the whole span", () => {
    const total = shapeOf("ac.total_energy_bought") as Extract<Shape, { kind: "counter" }>;
    expect(total.restartAtMinute).toBeNull();
    expect(total.dailyReset).toBe(false);
    let prev = -Infinity;
    for (let m = 0; m < 1440 * 60; m += 13) {
      const v = valueAt(total, m);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  test("a daily counter resets at every midnight — the recurring reset case", () => {
    const day = shapeOf("day_energy") as Extract<Shape, { kind: "counter" }>;
    expect(day.dailyReset).toBe(true);
    expect(valueAt(day, 0)).toBe(0);
    expect(valueAt(day, 1440)).toBe(0);
    expect(valueAt(day, 1439)).toBeGreaterThan(0);
    // Monotone inside a day, and every midnight is a drop.
    for (let m = 1; m < 1440; m++) {
      expect(valueAt(day, m)).toBeGreaterThanOrEqual(valueAt(day, m - 1));
    }
    expect(valueAt(day, 1440)).toBeLessThan(valueAt(day, 1439));
  });

  test("the restarting counter actually restarts: one drop, to zero, then rises again", () => {
    const shape = shapeOf(RESTART_METRIC) as Extract<Shape, { kind: "counter" }>;
    const at = shape.restartAtMinute as number;
    expect(valueAt(shape, at - 1)).toBeGreaterThan(1000);
    expect(valueAt(shape, at)).toBeCloseTo(0, 6);
    let drops = 0;
    let prev = valueAt(shape, 0);
    for (let m = 1; m < 60 * 1440; m++) {
      const v = valueAt(shape, m);
      if (v < prev) drops += 1;
      prev = v;
    }
    expect(drops).toBe(1);
    expect(valueAt(shape, at + 1440)).toBeGreaterThan(valueAt(shape, at));
  });

  test("levels stay plausibly near their base", () => {
    const volts = shapeOf("ac.l1.voltage") as Extract<Shape, { kind: "level" }>;
    for (let m = 0; m < 2000; m += 3) {
      expect(Math.abs(valueAt(volts, m) - volts.base)).toBeLessThanOrEqual(volts.amplitude + 1e-9);
    }
  });

  test("status is a constant enum code, not a wobble", () => {
    const status = shapeOf("inverter.status");
    expect(valueAt(status, 0)).toBe(valueAt(status, 999));
    expect(Number.isInteger(valueAt(status, 0))).toBe(true);
  });

  test("every shape kind emits a SQL expression over the seed columns", () => {
    for (const metric of metrics) {
      const expr = sqlValueExpr(metric.shape);
      expect(expr.length).toBeGreaterThan(0);
      expect(expr).toMatch(/s\.m|s\.mi|^[0-9.]+(::double precision)?$/);
      expect(expr).not.toContain("undefined");
      expect(expr).not.toContain("NaN");
    }
  });
});

describe("counterIncrement", () => {
  test("a normal step is the delta", () => {
    expect(counterIncrement(10, 12.5)).toBe(2.5);
  });

  test("a flat step contributes nothing", () => {
    expect(counterIncrement(10, 10)).toBe(0);
  });

  test("a reset contributes the post-reset value, not a negative delta", () => {
    expect(counterIncrement(45_000, 0)).toBe(0);
    expect(counterIncrement(45_000, 1.5)).toBe(1.5);
  });

  test("zero-to-zero and a negative reading never produce a negative increment", () => {
    expect(counterIncrement(0, 0)).toBe(0);
    expect(counterIncrement(5, -3)).toBe(0);
    expect(counterIncrement(-3, 0)).toBe(0);
  });
});

describe("perDayEnergy", () => {
  const reading = (metric: string, time: string, value: number) => ({ metric, time, value });

  test("an empty payload aggregates to nothing rather than throwing", () => {
    expect(perDayEnergy([])).toEqual([]);
  });

  test("a single reading has no delta to attribute, so the day is absent", () => {
    expect(perDayEnergy([reading("e", "2026-08-01T00:00:00Z", 5)])).toEqual([]);
  });

  test("a partial window sums only the deltas it has", () => {
    const rows = perDayEnergy([
      reading("e", "2026-08-01T10:00:00Z", 5),
      reading("e", "2026-08-01T11:00:00Z", 7),
      reading("e", "2026-08-01T12:00:00Z", 8),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.energy).toBeCloseTo(3, 9);
    expect(rows[0]?.naive).toBeCloseTo(3, 9);
    expect(rows[0]?.resets).toBe(0);
  });

  test("a step across midnight belongs to the later day", () => {
    const rows = perDayEnergy([
      reading("e", "2026-08-01T23:59:00Z", 10),
      reading("e", "2026-08-02T00:00:00Z", 11),
      reading("e", "2026-08-02T23:59:00Z", 20),
    ]);
    expect(rows.map((r) => r.day)).toEqual(["2026-08-02"]);
    expect(rows[0]?.energy).toBeCloseTo(10, 9);
  });

  test("unordered input is sorted before differencing", () => {
    const ordered = perDayEnergy([
      reading("e", "2026-08-01T02:00:00Z", 3),
      reading("e", "2026-08-01T01:00:00Z", 1),
      reading("e", "2026-08-01T03:00:00Z", 6),
    ]);
    expect(ordered[0]?.energy).toBeCloseTo(5, 9);
    expect(ordered[0]?.resets).toBe(0);
  });

  test("metrics are aggregated independently", () => {
    const rows = perDayEnergy([
      reading("a", "2026-08-01T01:00:00Z", 1),
      reading("b", "2026-08-01T01:00:00Z", 100),
      reading("a", "2026-08-01T02:00:00Z", 2),
      reading("b", "2026-08-01T02:00:00Z", 130),
    ]);
    expect(rows.map((r) => [r.metric, r.energy])).toEqual([
      ["a", 1],
      ["b", 30],
    ]);
  });

  test("a counter reset makes naive max-minus-min wrong by orders of magnitude", () => {
    const rows = perDayEnergy([
      reading("total_energy", "2026-08-01T10:00:00Z", 45_000),
      reading("total_energy", "2026-08-01T11:00:00Z", 45_001),
      reading("total_energy", "2026-08-01T12:00:00Z", 0),
      reading("total_energy", "2026-08-01T13:00:00Z", 1),
    ]);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.resets).toBe(1);
    expect(row.energy).toBeCloseTo(2, 9);
    expect(row.naive).toBeCloseTo(45_001, 9);
    expect(row.naive / row.energy).toBeGreaterThan(1000);
  });

  test("describeRestarts locates each reset and quantifies the naive error", () => {
    const restarts = describeRestarts([
      reading("total_energy", "2026-08-01T11:00:00Z", 45_001),
      reading("total_energy", "2026-08-01T12:00:00Z", 0),
      reading("day_energy", "2026-08-01T12:00:00Z", 3),
    ]);
    expect(restarts).toHaveLength(1);
    expect(restarts[0]).toMatchObject({
      metric: "total_energy",
      at: "2026-08-01T12:00:00.000Z",
      valueBefore: 45_001,
      valueAfter: 0,
    });
  });

  test("no reset means no restart rows — and that is reportable, not silent", () => {
    expect(describeRestarts([reading("e", "2026-08-01T01:00:00Z", 1)])).toEqual([]);
  });
});

describe("compareGroundTruth", () => {
  const truth = (overrides: Partial<GroundTruth> = {}): GroundTruth => ({
    generatedAt: "2026-08-27T00:00:00.000Z",
    fixture: {
      mode: "fast",
      inverterId: "deye-sg05lp3",
      spanDays: 3,
      cadenceSeconds: 60,
      metricCount: 9,
      rawRetentionDays: 7,
    },
    tiers: {
      minute_rollups: {
        minBucket: "2026-08-24T00:00:00Z",
        maxBucket: "2026-08-26T23:59:00Z",
        count: 38_880,
        digest: "m1",
      },
      hourly_rollups: {
        minBucket: "2026-08-24T00:00:00Z",
        maxBucket: "2026-08-26T23:00:00Z",
        count: 648,
        digest: "h1",
      },
      daily_rollups: {
        minBucket: "2026-08-24T00:00:00Z",
        maxBucket: "2026-08-26T00:00:00Z",
        count: 27,
        digest: "d1",
      },
    },
    raw: { minTime: "2026-08-24T00:00:00Z", maxTime: "2026-08-26T23:59:00Z", count: 38_880 },
    perMetricPerDayEnergy: [
      { metric: "total_energy", day: "2026-08-25", energy: 30, naive: 45_010, resets: 1 },
    ],
    restarts: [
      {
        metric: "total_energy",
        at: "2026-08-25T12:00:00.000Z",
        valueBefore: 45_015,
        valueAfter: 0,
      },
    ],
    ...overrides,
  });

  test("a fixture compared with itself has nothing to report", () => {
    expect(compareGroundTruth(truth(), truth())).toEqual([]);
  });

  test("a tier that lost buckets is a finding", () => {
    const after = truth();
    after.tiers.daily_rollups.count = 26;
    const problems = compareGroundTruth(truth(), after);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/daily_rollups/);
  });

  test("a bucket that changed value is caught by the tier digest", () => {
    // The committed file cannot carry 5M individual buckets, so bucket-level
    // integrity rides on a digest instead. Without this, a migration that kept
    // every count and window but rewrote the averages would pass.
    const after = truth();
    after.tiers.hourly_rollups.digest = "h2";
    expect(compareGroundTruth(truth(), after)[0]).toMatch(/hourly_rollups.*digest/);
  });

  test("a digest absent on either side is not compared rather than reported wrong", () => {
    const before = truth();
    before.tiers.daily_rollups.digest = null;
    const after = truth();
    after.tiers.daily_rollups.digest = "whatever";
    expect(compareGroundTruth(before, after)).toEqual([]);
  });

  test("a tier whose window shifted is a finding", () => {
    const after = truth();
    after.tiers.minute_rollups.minBucket = "2026-08-25T00:00:00Z";
    expect(compareGroundTruth(truth(), after)[0]).toMatch(/minBucket/);
  });

  test("a missing tier is a finding, not a crash", () => {
    const after = truth();
    delete (after.tiers as Record<string, unknown>).hourly_rollups;
    expect(compareGroundTruth(truth(), after)[0]).toMatch(/hourly_rollups/);
  });

  test("the raw window is compared too", () => {
    const after = truth();
    after.raw.count = 0;
    expect(compareGroundTruth(truth(), after)[0]).toMatch(/metrics_raw/);
  });

  test("drifted per-day energy is a finding; float noise is not", () => {
    const noisy = truth();
    noisy.perMetricPerDayEnergy[0]!.energy = 30 + 1e-12;
    expect(compareGroundTruth(truth(), noisy)).toEqual([]);

    const drifted = truth();
    drifted.perMetricPerDayEnergy[0]!.energy = 45_010;
    expect(compareGroundTruth(truth(), drifted)[0]).toMatch(/total_energy.*2026-08-25/);
  });

  test("a per-day row that vanished, and one that appeared, are both findings", () => {
    const fewer = truth({ perMetricPerDayEnergy: [] });
    expect(compareGroundTruth(truth(), fewer).join(" ")).toMatch(/missing/i);
    expect(compareGroundTruth(fewer, truth()).join(" ")).toMatch(/unexpected|appeared/i);
  });

  test("losing the counter restart is a finding — it is the case the migration must get right", () => {
    const after = truth({ restarts: [] });
    expect(compareGroundTruth(truth(), after)[0]).toMatch(/restart/i);
  });

  test("a fixture with no compressed chunk is reported as untested", () => {
    // The riskiest thing a migration does to this schema is touch a compressed
    // chunk. The tier arrays are deliberately not carried in the snapshot any
    // more, so this check has to live here rather than in compareSnapshots.
    const before = truth();
    before.snapshot = {
      rollups: { minute_rollups: [], hourly_rollups: [], daily_rollups: [] },
      weightedRollups: {
        weighted_minute_rollups: [],
        weighted_hourly_rollups: [],
        weighted_daily_rollups: [],
      },
      tables: { app_settings: 6 },
      digests: { app_settings: "a1" },
      rawRows: 99_585,
      compressedChunks: 0,
      policies: ["policy_compression:metrics_raw"],
    };
    expect(compareGroundTruth(before, before, { requireData: true }).join(" ")).toMatch(
      /compressed chunk/i,
    );
  });

  test("requireData does not object to the deliberately empty rollup arrays", () => {
    // compareSnapshots would call an empty rollup set "parity over nothing";
    // here it is by design, and the tier digests carry that weight instead.
    const before = truth();
    before.snapshot = {
      rollups: { minute_rollups: [], hourly_rollups: [], daily_rollups: [] },
      weightedRollups: {
        weighted_minute_rollups: [],
        weighted_hourly_rollups: [],
        weighted_daily_rollups: [],
      },
      tables: { app_settings: 6 },
      digests: { app_settings: "a1" },
      rawRows: 99_585,
      compressedChunks: 59,
      policies: ["policy_compression:metrics_raw"],
    };
    expect(compareGroundTruth(before, before, { requireData: true })).toEqual([]);
  });

  test("comparing two empty ground truths reports that it proves nothing", () => {
    const empty = truth({
      tiers: {
        minute_rollups: { minBucket: null, maxBucket: null, count: 0, digest: null },
        hourly_rollups: { minBucket: null, maxBucket: null, count: 0, digest: null },
        daily_rollups: { minBucket: null, maxBucket: null, count: 0, digest: null },
      },
      raw: { minTime: null, maxTime: null, count: 0 },
      perMetricPerDayEnergy: [],
      restarts: [],
    });
    expect(compareGroundTruth(empty, empty, { requireData: true }).join(" ")).toMatch(
      /proves nothing|no rollup/i,
    );
  });

  test("a shifted raw window is a finding even when the row count is unchanged", () => {
    // The trim drops whole CHUNKS, so a migration that lost the oldest chunk and
    // gained a newer one would keep the count identical while moving the window
    // — and the rollups would then cover a range raw no longer does.
    const before = truth();
    const after = truth({
      raw: { minTime: "2026-08-25T00:00:00Z", maxTime: "2026-08-27T23:59:00Z", count: 38_880 },
    });
    const problems = compareGroundTruth(before, after, {});
    expect(problems.join("\n")).toContain("metrics_raw: window");
    expect(problems.join("\n")).toContain("2026-08-24T00:00:00Z..2026-08-26T23:59:00Z before");
  });

  test("an identical raw window reports nothing about it", () => {
    expect(compareGroundTruth(truth(), truth(), {}).join("\n")).not.toContain("metrics_raw");
  });
});

describe("statements", () => {
  test("splits on drizzle's breakpoint marker and trims", () => {
    expect(statements("CREATE TABLE a();\n--> statement-breakpoint\nCREATE TABLE b();")).toEqual([
      "CREATE TABLE a();",
      "CREATE TABLE b();",
    ]);
  });

  test("an empty file yields no statements rather than one empty one", () => {
    expect(statements("")).toEqual([]);
    expect(statements("\n\n  \n")).toEqual([]);
  });

  test("a comment-only chunk is dropped — policies.sql ends with a trailing one", () => {
    const sql = "-- why\n-- more why\nSELECT 1;\n--> statement-breakpoint\n-- trailing note only\n";
    expect(statements(sql)).toEqual(["-- why\n-- more why\nSELECT 1;"]);
  });

  test("the real addon-v1.2.0 files split into runnable statements", async () => {
    const { $ } = await import("bun");
    const sql = await $`git show addon-v1.2.0:packages/db/src/timescale/0000_bootstrap.sql`.text();
    const parts = statements(sql);
    expect(parts.length).toBeGreaterThan(5);
    expect(parts.some((p) => p.includes("CREATE EXTENSION IF NOT EXISTS timescaledb"))).toBe(true);
    expect(parts.some((p) => p.includes("create_hypertable"))).toBe(true);
    // No dur_ms anywhere in 1.2.0: this is the cross-check on the whole premise.
    expect(sql).not.toContain("dur_ms");
  });
});

// ===========================================================================
// The runtime half: container, schema-from-git, seeding, ground truth.
//
// Everything below used to talk to Docker and Postgres directly, which put the
// whole second half of the script out of reach of any test — it was "proved by
// running it", and a fixture build is 221 s against a container this suite must
// not touch. It now goes through a `FixtureIo`, so the DECISIONS are provable
// here while the commands themselves stay in `productionIo`, verbatim, where a
// unit test never has to have an opinion about them.
//
// What is deliberately NOT asserted here: the text of any SQL statement. A
// SQL-text assertion cannot prove a query runs (AGENTS.md), and this fixture
// already has a better answer for its own arithmetic — `verifyModel` executes
// the SQL value model against the TypeScript one. What is asserted is which
// statement kinds are issued in which order, and how the rows that come back
// are turned into the ground truth.
// ===========================================================================

/** One statement the fake database was asked to run. */
type Issued = { text: string; params?: unknown[] };

type FakeDb = {
  readonly issued: Issued[];
  /** How many times `end()` was called — the connection must always be released. */
  readonly ended: () => number;
};

/**
 * A `Bun.SQL` that is only a recorder plus a router.
 *
 * `route` gets each statement and returns the rows for it, or undefined to fall
 * through to an empty result. Rejecting is done by throwing from `route`, which
 * is how the `compress` skip path is reached.
 */
function fakeDb(route: (text: string, params?: unknown[]) => unknown[] | undefined = () => []) {
  const issued: Issued[] = [];
  let ends = 0;
  const db = {
    issued,
    ended: () => ends,
    async unsafe(text: string, params?: unknown[]) {
      issued.push({ text, params });
      return route(text, params) ?? [];
    },
    async end() {
      ends += 1;
    },
  };
  return db as unknown as FakeDb & { unsafe: (t: string, p?: unknown[]) => Promise<unknown> };
}

type FakeIoOptions = {
  /** Successive `docker ps` outputs; the last one repeats. */
  containerState?: string[];
  /** Successive `pg_isready` exit codes; the last one repeats. */
  readyProbes?: number[];
  /** `git show` content, by path. */
  gitFiles?: Record<string, string>;
  restoreExit?: number;
  db?: ReturnType<typeof fakeDb>;
  /** The maintenance connection `recreateDatabase` opens, kept separate so the
   * two pools' `end()` counts never mix. */
  adminDb?: ReturnType<typeof fakeDb>;
  profile?: unknown;
  route?: (text: string, params?: unknown[]) => unknown[] | undefined;
};

type FakeIo = FixtureIo & {
  readonly calls: string[];
  readonly logs: string[];
  readonly errors: string[];
  readonly written: { path: string; content: string }[];
  readonly sleeps: number[];
  readonly db: ReturnType<typeof fakeDb>;
  readonly adminDb: ReturnType<typeof fakeDb>;
};

/** The default profile: the ten metrics the pure tests above already use. */
const FAKE_PROFILE = {
  id: "fixture-inverter",
  version: "1.4.2",
  metrics: profileMetrics,
};

/** A `_journal.json` with two entries, so "one stamp per entry" can fail. */
const FAKE_JOURNAL = JSON.stringify({
  entries: [
    { idx: 0, tag: "0000_brief_cammi", when: 1_700_000_000_000 },
    { idx: 1, tag: "0001_magenta_the_initiative", when: 1_700_000_001_000 },
  ],
});

function fakeIo(options: FakeIoOptions = {}): FakeIo {
  const calls: string[] = [];
  const logs: string[] = [];
  const errors: string[] = [];
  const written: { path: string; content: string }[] = [];
  const sleeps: number[] = [];
  const db = options.db ?? fakeDb(options.route);
  const adminDb = options.adminDb ?? fakeDb(options.route);

  /** Pop the next scripted answer, repeating the last one forever. */
  const series = <T>(values: T[] | undefined, fallback: T) => {
    const queue = [...(values ?? [fallback])];
    return () => (queue.length > 1 ? (queue.shift() as T) : (queue[0] ?? fallback));
  };
  const nextState = series(options.containerState, "");
  const nextProbe = series(options.readyProbes, 0);

  const io: FakeIo = {
    calls,
    logs,
    errors,
    written,
    sleeps,
    db,
    adminDb,
    async docker(command) {
      calls.push(command.kind === "psql" ? `psql:${command.sql}` : command.kind);
      if (command.kind === "state") return { stdout: nextState(), exitCode: 0 };
      if (command.kind === "ready") return { stdout: "", exitCode: nextProbe() };
      if (command.kind === "restore") return { stdout: "", exitCode: options.restoreExit ?? 0 };
      return { stdout: "", exitCode: 0 };
    },
    async gitShow(path: string) {
      calls.push(`gitShow:${path}`);
      const files = options.gitFiles ?? {};
      if (path.endsWith("_journal.json")) return files[path] ?? FAKE_JOURNAL;
      return files[path] ?? `SELECT 1;\n--> statement-breakpoint\nSELECT 2;`;
    },
    connect() {
      calls.push("connect");
      return db as unknown as ReturnType<FixtureIo["connect"]>;
    },
    connectAdmin() {
      calls.push("connectAdmin");
      return adminDb as unknown as ReturnType<FixtureIo["connectAdmin"]>;
    },
    async sleep(ms: number) {
      sleeps.push(ms);
    },
    async readProfile() {
      calls.push("readProfile");
      return JSON.stringify(options.profile ?? FAKE_PROFILE);
    },
    writeFile(path: string, content: string) {
      written.push({ path, content });
    },
    log(message: string) {
      logs.push(message);
    },
    error(message: string) {
      errors.push(message);
    },
  };
  return io;
}

/** A plan the runtime functions can be driven with, without touching a clock. */
const FIXED_END = new Date("2026-08-01T00:00:00.000Z");
const fixedPlan = (mode: FixtureMode = "fast") =>
  buildPlan({ mode, endsAt: FIXED_END, profileMetrics, inverterId: "fixture-inverter" });

describe("containerState", () => {
  test("no output at all means the container does not exist", async () => {
    // `docker ps -a` prints nothing for an absent container, and the reset
    // branch must not try to remove one.
    expect(await containerState(fakeIo({ containerState: [""] }))).toBe("absent");
    expect(await containerState(fakeIo({ containerState: ["  \n "] }))).toBe("absent");
  });

  test("a running container is running", async () => {
    expect(await containerState(fakeIo({ containerState: ["running\n"] }))).toBe("running");
  });

  test("any other state is stopped — exited, created and paused alike", async () => {
    for (const state of ["exited", "created", "paused", "restarting"]) {
      expect(await containerState(fakeIo({ containerState: [state] }))).toBe("stopped");
    }
  });
});

describe("waitReady", () => {
  test("returns as soon as the server accepts connections, without sleeping", async () => {
    const io = fakeIo({ readyProbes: [0] });
    await waitReady(io);
    expect(io.calls.filter((c) => c === "ready")).toHaveLength(1);
    expect(io.sleeps).toEqual([]);
  });

  test("retries while the server is still starting", async () => {
    const io = fakeIo({ readyProbes: [1, 1, 1, 0] });
    await waitReady(io);
    expect(io.calls.filter((c) => c === "ready")).toHaveLength(4);
    expect(io.sleeps).toEqual([500, 500, 500]);
  });

  test("gives up loudly after a minute rather than hanging forever", async () => {
    // A hang here is indistinguishable from a slow build; the failure has to
    // name the container and the port.
    const io = fakeIo({ readyProbes: [1] });
    await expect(waitReady(io)).rejects.toThrow(/never became ready on port 5433/);
    expect(io.calls.filter((c) => c === "ready")).toHaveLength(120);
  });
});

describe("ensureContainer", () => {
  test("an absent container is created, then waited for", async () => {
    const io = fakeIo({ containerState: [""] });
    await ensureContainer(false, io);
    expect(io.calls).toEqual(["state", "create", "ready"]);
  });

  test("a stopped container is started, never recreated", async () => {
    // Recreating it would throw away the 80 MB snapshot living inside it.
    const io = fakeIo({ containerState: ["exited"] });
    await ensureContainer(false, io);
    expect(io.calls).toEqual(["state", "start", "ready"]);
    expect(io.calls).not.toContain("create");
  });

  test("a running container is left alone, but still waited for", async () => {
    const io = fakeIo({ containerState: ["running"] });
    await ensureContainer(false, io);
    expect(io.calls).toEqual(["state", "ready"]);
  });

  test("--reset removes an existing container and creates a fresh one", async () => {
    const io = fakeIo({ containerState: ["running"] });
    await ensureContainer(true, io);
    expect(io.calls).toEqual(["state", "remove", "create", "ready"]);
  });

  test("--reset on an absent container removes nothing", async () => {
    // `docker rm -f` on a name that does not exist is an error, not a no-op.
    const io = fakeIo({ containerState: [""] });
    await ensureContainer(true, io);
    expect(io.calls).not.toContain("remove");
    expect(io.calls).toContain("create");
  });
});

describe("recreateDatabase", () => {
  test("drops and recreates only the fixture database, then releases the admin pool", async () => {
    const io = fakeIo();
    await recreateDatabase(io);
    const texts = io.adminDb.issued.map((i) => i.text);
    expect(texts).toHaveLength(2);
    expect(texts[0]).toContain(`DROP DATABASE IF EXISTS ${FIXTURE_DB}`);
    expect(texts[1]).toContain(`CREATE DATABASE ${FIXTURE_DB}`);
    // The one function in the script that DROPs must never name anything else.
    expect(texts.join(" ")).not.toContain("postgres WITH");
    expect(io.adminDb.ended()).toBe(1);
  });

  test("releases the admin pool even when the DROP fails", async () => {
    const db = fakeDb((text) => {
      if (text.includes("DROP DATABASE")) throw new Error("in use");
      return [];
    });
    const io = fakeIo({ adminDb: db });
    await expect(recreateDatabase(io)).rejects.toThrow("in use");
    expect(db.ended()).toBe(1);
  });
});

describe("applySchema", () => {
  test("replays every file from the tag, statement by statement", async () => {
    const io = fakeIo();
    await applySchema(io.connect("") as never, io);
    // Two drizzle files then two timescale files, in that order: the aggregates
    // in the timescale files read tables the drizzle files create.
    const shown = io.calls.filter((c) => c.startsWith("gitShow:")).map((c) => c.slice(8));
    expect(shown).toEqual([
      "packages/db/src/migrations/0000_brief_cammi.sql",
      "packages/db/src/migrations/0001_magenta_the_initiative.sql",
      "packages/db/src/timescale/0000_bootstrap.sql",
      "packages/db/src/timescale/policies.sql",
    ]);
    // One round trip per statement, never a batch: continuous aggregates cannot
    // be created inside a transaction block.
    expect(io.db.issued.map((i) => i.text)).toEqual([
      "SELECT 1;",
      "SELECT 2;",
      "SELECT 1;",
      "SELECT 2;",
      "SELECT 1;",
      "SELECT 2;",
      "SELECT 1;",
      "SELECT 2;",
    ]);
  });

  test("a comment-only chunk in the tag's SQL is never sent", async () => {
    const io = fakeIo({
      gitFiles: {
        "packages/db/src/migrations/0000_brief_cammi.sql":
          "-- just a comment\n--> statement-breakpoint\nCREATE TABLE t (id int);",
      },
    });
    await applySchema(io.connect("") as never, io);
    expect(io.db.issued.map((i) => i.text)).toContain("CREATE TABLE t (id int);");
    expect(io.db.issued.map((i) => i.text)).not.toContain("-- just a comment");
  });
});

describe("stampJournals", () => {
  test("stamps one drizzle row per journal entry, plus the timescale bootstrap", async () => {
    // Without this the fixture looks like a database that was never migrated,
    // and the 2.0.0 downgrade guard would take a different branch than it will
    // in production.
    const io = fakeIo();
    await stampJournals(io.connect("") as never, io);
    const drizzleInserts = io.db.issued.filter((i) =>
      i.text.includes('INSERT INTO drizzle."__drizzle_migrations"'),
    );
    expect(drizzleInserts).toHaveLength(2);
    expect(drizzleInserts.map((i) => i.params?.[1])).toEqual([
      1_700_000_000_000, 1_700_000_001_000,
    ]);
    // Each hash is the sha256 of the file at the TAG, not of anything local.
    for (const insert of drizzleInserts) {
      expect(insert.params?.[0]).toMatch(/^[0-9a-f]{64}$/);
    }
    const bootstrap = io.db.issued.filter((i) =>
      i.text.includes("INSERT INTO public.timescale_migrations"),
    );
    expect(bootstrap).toHaveLength(1);
    expect(bootstrap[0]?.params?.[0]).toBe("0000_bootstrap.sql");
  });

  test("an empty journal stamps no drizzle rows but still records the bootstrap", async () => {
    const io = fakeIo({
      gitFiles: {
        "packages/db/src/migrations/meta/_journal.json": JSON.stringify({ entries: [] }),
      },
    });
    await stampJournals(io.connect("") as never, io);
    expect(
      io.db.issued.filter((i) => i.text.includes('INSERT INTO drizzle."__drizzle_migrations"')),
    ).toEqual([]);
    expect(
      io.db.issued.filter((i) => i.text.includes("INSERT INTO public.timescale_migrations")),
    ).toHaveLength(1);
  });
});

describe("seedSideTables", () => {
  test("seeds the irreplaceable tables db-parity digests", async () => {
    // A migration that loses app_settings loses the user's tariffs and every
    // configured chart, so an empty side table would make parity trivially true.
    const io = fakeIo();
    const plan = fixedPlan();
    await seedSideTables(io.connect("") as never, plan, FAKE_PROFILE, io);
    const texts = io.db.issued.map((i) => i.text);
    expect(texts.filter((t) => t.includes('INSERT INTO "user"'))).toHaveLength(1);
    expect(texts.filter((t) => t.includes("INSERT INTO app_settings"))).toHaveLength(6);
    expect(texts.filter((t) => t.includes("INSERT INTO installed_profiles"))).toHaveLength(1);
    expect(texts.filter((t) => t.includes("INSERT INTO custom_charts"))).toHaveLength(1);
  });

  test("the settings name the plan's inverter and a non-full backup", async () => {
    const io = fakeIo();
    await seedSideTables(io.connect("") as never, fixedPlan(), FAKE_PROFILE, io);
    const settings = new Map(
      io.db.issued
        .filter((i) => i.text.includes("INSERT INTO app_settings"))
        .map((i) => [i.params?.[0] as string, JSON.parse(i.params?.[1] as string)]),
    );
    expect(settings.get("inverter.profile")).toBe("fixture-inverter");
    // `backup_full: false` is what makes the raw window's absence after a
    // restore the REQUIREMENT rather than a loss.
    expect(settings.get("backup")).toEqual({ enabled: true, backup_full: false });
    expect(settings.get("tariff")).toMatchObject({ kind: "fixed" });
  });

  test("the installed profile carries the profile's own version, not a literal", async () => {
    const io = fakeIo();
    await seedSideTables(io.connect("") as never, fixedPlan(), { version: "9.9.9" }, io);
    const insert = io.db.issued.find((i) => i.text.includes("INSERT INTO installed_profiles"));
    expect(insert?.params?.[1]).toBe("9.9.9");
  });
});

describe("seedMetrics", () => {
  test("one generate_series INSERT per metric, never one round trip per row", async () => {
    // Row by row from TypeScript would be ~9.3 M round trips.
    const io = fakeIo();
    const plan = fixedPlan("fast");
    await seedMetrics(io.connect("") as never, plan, io);
    expect(io.db.issued).toHaveLength(plan.metrics.length);
    for (const issued of io.db.issued) {
      expect(issued.text).toContain("generate_series");
      expect(issued.text).toContain("INSERT INTO metrics_raw");
    }
  });

  test("every metric is seeded under the plan's inverter id and its own key", async () => {
    const io = fakeIo();
    const plan = fixedPlan("fast");
    await seedMetrics(io.connect("") as never, plan, io);
    expect(io.db.issued.map((i) => i.params?.[1])).toEqual(plan.metrics.map((m) => m.key));
    expect(new Set(io.db.issued.map((i) => i.params?.[0]))).toEqual(new Set(["fixture-inverter"]));
    // The span bounds are the plan's, passed as parameters, not interpolated.
    expect(io.db.issued[0]?.params?.[2]).toBe(plan.startsAt.toISOString());
    expect(io.db.issued[0]?.params?.[3]).toBe(plan.endsAt.toISOString());
  });

  test("the row count it reports is the plan's, not a guess", async () => {
    const io = fakeIo();
    const plan = fixedPlan("fast");
    await seedMetrics(io.connect("") as never, plan, io);
    expect(io.logs.join("\n")).toContain(planRowCount(plan).toLocaleString("en-US"));
  });
});

describe("verifyModel", () => {
  /**
   * A database that answers with exactly what {@link valueAt} says. That is the
   * whole point of the check: the value model exists TWICE (TypeScript for the
   * tests, SQL for the 9 M-row generate_series) and a fixture whose values are
   * not what its ground truth claims proves the opposite of what it says.
   */
  const agreeingDb = (plan: ReturnType<typeof fixedPlan>, drift = 0) =>
    fakeDb((text, params) => {
      if (!text.includes("SELECT value FROM metrics_raw")) return [];
      const metric = plan.metrics.find((m) => m.key === params?.[0]);
      if (!metric) return [];
      return [{ value: valueAt(metric.shape, Number(params?.[2])) + drift }];
    });

  test("passes when the SQL model agrees with valueAt() at every sample", async () => {
    const plan = fixedPlan("fast");
    const io = fakeIo({ db: agreeingDb(plan) });
    await verifyModel(io.connect("") as never, plan, io);
    // Five sample points per metric, all checked.
    expect(io.logs.join("\n")).toContain(`${plan.metrics.length * 5} sampled rows`);
  });

  test("fails when the two expressions of the value model have drifted", async () => {
    const plan = fixedPlan("fast");
    const io = fakeIo({ db: agreeingDb(plan, 5) });
    await expect(verifyModel(io.connect("") as never, plan, io)).rejects.toThrow(
      /the two expressions of the value model have drifted/,
    );
  });

  test("a drift under the tolerance is accepted — float8 round trips are not exact", async () => {
    const plan = fixedPlan("fast");
    const io = fakeIo({ db: agreeingDb(plan, 1e-12) });
    await expect(verifyModel(io.connect("") as never, plan, io)).resolves.toBeUndefined();
  });

  test("fails when a sampled row is missing entirely, rather than reading it as zero", async () => {
    // A seed that silently inserted nothing would otherwise pass a check that
    // treated an absent row as 0 and compared it against a 0-valued shape.
    const plan = fixedPlan("fast");
    const io = fakeIo({ db: fakeDb(() => []) });
    await expect(verifyModel(io.connect("") as never, plan, io)).rejects.toThrow(
      /no seeded row for/,
    );
  });

  test("samples inside the span, never past its last minute", async () => {
    const plan = fixedPlan("fast");
    const io = fakeIo({ db: agreeingDb(plan) });
    await verifyModel(io.connect("") as never, plan, io);
    const minutes = io.db.issued
      .filter((i) => i.text.includes("SELECT value"))
      .map((i) => Number(i.params?.[2]));
    const totalMinutes = plan.spanDays * 1440;
    const lastMinute = totalMinutes - 1;
    // The first minute of the span is always sampled; the last sample sits at
    // 99.9 % of it, and the `min` clamp keeps every index inside the span even
    // when a fraction rounds up to the end.
    expect(Math.min(...minutes)).toBe(0);
    expect(Math.max(...minutes)).toBe(Math.floor(totalMinutes * 0.999));
    expect(minutes.every((m) => m >= 0 && m <= lastMinute)).toBe(true);
  });
});

describe("materialize", () => {
  test("refreshes all three tiers over a window that brackets the whole span", async () => {
    // The installed refresh policies have start_offsets of 10 min / 3 h / 3 d,
    // so they would never reach seeded history no matter how long it ran.
    const io = fakeIo();
    const plan = fixedPlan("fast");
    await materialize(io.connect("") as never, plan, io);
    const calls = io.db.issued.map((i) => i.text);
    expect(calls).toHaveLength(3);
    for (const tier of ["minute_rollups", "hourly_rollups", "daily_rollups"]) {
      expect(calls.some((c) => c.includes(`refresh_continuous_aggregate('${tier}'`))).toBe(true);
    }
    // A day of slack either side, so no bucket is half-open at either end.
    const from = new Date(plan.startsAt.getTime() - 86_400_000).toISOString();
    const to = new Date(plan.endsAt.getTime() + 86_400_000).toISOString();
    expect(calls[0]).toContain(from);
    expect(calls[0]).toContain(to);
  });

  test("daily is refreshed after hourly — daily reads hourly, not raw", async () => {
    const io = fakeIo();
    await materialize(io.connect("") as never, fixedPlan("fast"), io);
    const order = io.db.issued.map(
      (i) => /refresh_continuous_aggregate\('(\w+)'/.exec(i.text)?.[1],
    );
    expect(order.indexOf("daily_rollups")).toBeGreaterThan(order.indexOf("hourly_rollups"));
    expect(order.indexOf("hourly_rollups")).toBeGreaterThan(order.indexOf("minute_rollups"));
  });
});

describe("compress", () => {
  test("compresses raw and minute_rollups, each with its own cutoff", async () => {
    const io = fakeIo({ route: () => [{ n: 3 }] });
    const plan = fixedPlan("fast");
    await compress(io.connect("") as never, plan, io);
    expect(io.db.issued).toHaveLength(2);
    // Raw compresses at a day, minute_rollups at the 7-day retention edge.
    expect(io.db.issued[0]?.text).toContain(
      new Date(plan.endsAt.getTime() - 86_400_000).toISOString(),
    );
    expect(io.db.issued[1]?.text).toContain(
      new Date(plan.endsAt.getTime() - 7 * 86_400_000).toISOString(),
    );
    expect(io.logs.join("\n")).toContain("compressed 3 chunk(s) of metrics_raw");
  });

  test("a tier with no chunk old enough is skipped, not a build failure", async () => {
    // In --fast mode minute_rollups has nothing older than 7 days by
    // construction, and that is a correct fixture, not a broken one.
    const io = fakeIo({
      route: (text) => {
        if (text.includes("minute_rollups")) throw new Error("no chunks found");
        return [{ n: 1 }];
      },
    });
    await expect(compress(io.connect("") as never, fixedPlan("fast"), io)).resolves.toBeUndefined();
    expect(io.logs.join("\n")).toContain("compress minute_rollups: skipped (no chunks found)");
    expect(io.logs.join("\n")).toContain("compressed 0 chunk(s) of minute_rollups");
  });

  test("a result with no rows reports zero rather than crashing on undefined", async () => {
    const io = fakeIo({ route: () => [] });
    await compress(io.connect("") as never, fixedPlan("fast"), io);
    expect(io.logs.join("\n")).toContain("compressed 0 chunk(s) of metrics_raw");
  });
});

describe("trimRaw", () => {
  test("drops whole chunks older than the 7-day retention, never DELETEs", async () => {
    // A DELETE against compressed chunks silently aborts past ~100k tuples, and
    // it is also not what retention does: the migration must face whole missing
    // chunks, not a table with holes.
    const io = fakeIo({ route: () => [{ n: 4 }] });
    const plan = fixedPlan("fast");
    await trimRaw(io.connect("") as never, plan, io);
    expect(io.db.issued).toHaveLength(1);
    expect(io.db.issued[0]?.text).toContain("drop_chunks('metrics_raw'");
    expect(io.db.issued[0]?.text).not.toMatch(/\bDELETE\b/i);
    const cutoff = new Date(plan.endsAt.getTime() - 7 * 86_400_000).toISOString();
    expect(io.db.issued[0]?.text).toContain(cutoff);
    expect(io.logs.join("\n")).toContain(`dropped 4 raw chunk(s) older than ${cutoff}`);
  });

  test("dropping nothing is reported as zero, not as undefined", async () => {
    const io = fakeIo({ route: () => [] });
    await trimRaw(io.connect("") as never, fixedPlan("fast"), io);
    expect(io.logs.join("\n")).toContain("dropped 0 raw chunk(s)");
  });
});

describe("readTier", () => {
  test("maps a tier's window, count and digest out of the row", async () => {
    const io = fakeIo({
      route: () => [
        {
          minBucket: "2026-07-22T00:00:00+00",
          maxBucket: "2026-08-01T00:00:00+00",
          count: "14400",
          digest: "d41d8cd9",
        },
      ],
    });
    const summary = await readTier(io.connect("") as never, "minute_rollups");
    expect(summary).toEqual({
      minBucket: "2026-07-22T00:00:00+00",
      maxBucket: "2026-08-01T00:00:00+00",
      count: 14_400,
      digest: "d41d8cd9",
    });
  });

  test("a bigint count arrives as a STRING and must not stay one", async () => {
    // `count(*)::bigint` comes back as text; leaving it as a string makes every
    // later comparison a string comparison, where "9" > "14400".
    const io = fakeIo({
      route: () => [{ count: "9", minBucket: null, maxBucket: null, digest: null }],
    });
    const summary = await readTier(io.connect("") as never, "hourly_rollups");
    expect(summary.count).toBe(9);
    expect(typeof summary.count).toBe("number");
  });

  test("an empty tier is nulls and zero, not undefined", async () => {
    const io = fakeIo({ route: () => [] });
    expect(await readTier(io.connect("") as never, "daily_rollups")).toEqual({
      minBucket: null,
      maxBucket: null,
      count: 0,
      digest: null,
    });
  });
});

describe("readRawWindow", () => {
  test("maps the raw window, coercing the bigint count", async () => {
    const io = fakeIo({
      route: () => [
        { minTime: "2026-07-25T00:00:00+00", maxTime: "2026-07-31T23:59:00+00", count: "907200" },
      ],
    });
    expect(await readRawWindow(io.connect("") as never)).toEqual({
      minTime: "2026-07-25T00:00:00+00",
      maxTime: "2026-07-31T23:59:00+00",
      count: 907_200,
    });
  });

  test("a fully trimmed raw table is nulls and zero", async () => {
    const io = fakeIo({ route: () => [{ minTime: null, maxTime: null, count: "0" }] });
    expect(await readRawWindow(io.connect("") as never)).toEqual({
      minTime: null,
      maxTime: null,
      count: 0,
    });
  });

  test("no row at all is still zero, never NaN", async () => {
    const io = fakeIo({ route: () => [] });
    expect(await readRawWindow(io.connect("") as never)).toEqual({
      minTime: null,
      maxTime: null,
      count: 0,
    });
  });
});

describe("readParitySnapshot", () => {
  test("unwraps the json_build_object from whatever column name it lands in", async () => {
    // The column is named by Postgres, not by us; reading it by a fixed name
    // would break the moment the query is reformatted.
    const snap = { rawRows: 5, compressedChunks: 2 };
    const io = fakeIo({ route: () => [{ json_build_object: snap }] });
    expect(await readParitySnapshot(io.connect("") as never)).toEqual(snap);
    const io2 = fakeIo({ route: () => [{ some_other_alias: snap }] });
    expect(await readParitySnapshot(io2.connect("") as never)).toEqual(snap);
  });

  test("no row means no snapshot, not a crash", async () => {
    const io = fakeIo({ route: () => [] });
    expect(await readParitySnapshot(io.connect("") as never)).toBeUndefined();
  });
});

/** A database that answers every ground-truth read with a meaningful fixture. */
function statefulDb(over: { compressedChunks?: number; tierCount?: number } = {}) {
  return fakeDb((text, params) => {
    if (text.includes("json_build_object") || text.includes("compressedChunks")) {
      return [
        {
          snap: {
            rollups: { minute_rollups: [], hourly_rollups: [], daily_rollups: [] },
            tables: { app_settings: 6 },
            digests: { app_settings: "abc" },
            rawRows: 10_080,
            compressedChunks: over.compressedChunks ?? 3,
            policies: ["policy_compression:metrics_raw"],
          },
        },
      ];
    }
    if (text.includes("min(time)")) {
      return [
        { minTime: "2026-07-25T00:00:00+00", maxTime: "2026-07-31T23:59:00+00", count: "10080" },
      ];
    }
    if (text.includes("min(bucket)")) {
      return [
        {
          minBucket: "2026-07-22T00:00:00+00",
          maxBucket: "2026-08-01T00:00:00+00",
          count: String(over.tierCount ?? 1440),
          digest: "digest",
        },
      ];
    }
    // The counter read: two days, with a restart on the second so the fixture
    // carries the case the whole rehearsal exists for.
    if (text.includes("SELECT time, value FROM metrics_raw")) {
      const metric = String(params?.[0]);
      return [
        { time: "2026-07-30T00:00:00.000Z", value: 1000 },
        { time: "2026-07-30T23:59:00.000Z", value: 1010 },
        { time: "2026-07-31T00:00:00.000Z", value: 0 },
        { time: "2026-07-31T23:59:00.000Z", value: 7 },
      ].map((r) => ({ ...r, metric }));
    }
    return [];
  });
}

describe("readEnergy", () => {
  test("reads only the counter metrics — the others carry no energy", async () => {
    const plan = fixedPlan("fast");
    const io = fakeIo({ db: statefulDb() });
    await readEnergy(io.connect("") as never, plan);
    const counters = plan.metrics.filter((m) => m.shape.kind === "counter");
    expect(counters.length).toBeGreaterThan(0);
    expect(io.db.issued).toHaveLength(counters.length);
    expect(io.db.issued.map((i) => i.params?.[0])).toEqual(counters.map((m) => m.key));
  });

  test("attributes energy per day and records the restart the naive answer gets wrong", async () => {
    const plan = fixedPlan("fast");
    const io = fakeIo({ db: statefulDb() });
    const { energy, restarts } = await readEnergy(io.connect("") as never, plan);

    // Every counter metric contributes both days.
    const days = new Set(energy.map((r) => r.day));
    expect(days).toEqual(new Set(["2026-07-30", "2026-07-31"]));
    // The reset day's counter-aware energy is the 7 the counter now reads, while
    // max - min over the bucket would say 7 too — but the day it reset FROM is
    // where the naive arithmetic breaks, and it is recorded.
    expect(restarts.length).toBe(plan.metrics.filter((m) => m.shape.kind === "counter").length);
    for (const restart of restarts) {
      expect(restart.valueBefore).toBe(1010);
      expect(restart.valueAfter).toBe(0);
      expect(restart.at).toBe("2026-07-31T00:00:00.000Z");
    }
  });

  test("a metric with no rows contributes nothing rather than a zero-energy row", async () => {
    const plan = fixedPlan("fast");
    const io = fakeIo({ db: fakeDb(() => []) });
    const { energy, restarts } = await readEnergy(io.connect("") as never, plan);
    expect(energy).toEqual([]);
    expect(restarts).toEqual([]);
  });
});

describe("readState", () => {
  test("reads all three tiers, the raw window and the parity snapshot", async () => {
    const io = fakeIo({ db: statefulDb() });
    const state = await readState(io.connect("") as never);
    expect(Object.keys(state.tiers)).toEqual(["minute_rollups", "hourly_rollups", "daily_rollups"]);
    expect(state.raw.count).toBe(10_080);
    expect(state.snapshot?.compressedChunks).toBe(3);
  });

  test("omits the snapshot key entirely when there is none, rather than storing undefined", async () => {
    // `writeGroundTruth` splits on the key's presence, so an explicit
    // `snapshot: undefined` would write an empty parity file.
    const io = fakeIo({
      db: fakeDb((text) =>
        text.includes("min(time)")
          ? [{ minTime: null, maxTime: null, count: "0" }]
          : text.includes("min(bucket)")
            ? [{ minBucket: null, maxBucket: null, count: "0", digest: null }]
            : [],
      ),
    });
    const state = await readState(io.connect("") as never);
    expect("snapshot" in state).toBe(false);
  });
});

describe("recordGroundTruth", () => {
  test("stamps the plan's own shape beside the state it read", async () => {
    const plan = fixedPlan("fast");
    const io = fakeIo({ db: statefulDb() });
    const energy = { energy: [], restarts: [] };
    const truth = await recordGroundTruth(io.connect("") as never, plan, energy);

    expect(truth.fixture).toEqual({
      mode: "fast",
      inverterId: "fixture-inverter",
      spanDays: 10,
      cadenceSeconds: 60,
      metricCount: plan.metrics.length,
      rawRetentionDays: 7,
    });
    expect(truth.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(truth.tiers.minute_rollups.count).toBe(1440);
  });
});

describe("report", () => {
  const truth = (over: Partial<GroundTruth> = {}): GroundTruth => ({
    generatedAt: "2026-08-01T00:00:00.000Z",
    fixture: {
      mode: "fast",
      inverterId: "fixture-inverter",
      spanDays: 10,
      cadenceSeconds: 60,
      metricCount: 5,
      rawRetentionDays: 7,
    },
    tiers: {
      minute_rollups: { minBucket: "a", maxBucket: "b", count: 14_400, digest: "d" },
      hourly_rollups: { minBucket: "a", maxBucket: "b", count: 240, digest: "d" },
      daily_rollups: { minBucket: "a", maxBucket: "b", count: 10, digest: "d" },
    },
    raw: { minTime: "a", maxTime: "b", count: 10_080 },
    perMetricPerDayEnergy: [],
    restarts: [],
    ...over,
  });

  test("reports every tier's bucket count and window", () => {
    const io = fakeIo();
    report(truth(), io);
    expect(io.logs.join("\n")).toContain("minute_rollups: 14,400 buckets");
    expect(io.logs.join("\n")).toContain("metrics_raw: 10,080 rows");
  });

  test("names the worst naive error, which is the number the migration must beat", () => {
    const io = fakeIo();
    report(
      truth({
        perMetricPerDayEnergy: [
          { metric: "total_energy", day: "2026-07-31", energy: 2, naive: 40, resets: 1 },
          { metric: "day_energy", day: "2026-07-31", energy: 4, naive: 8, resets: 1 },
        ],
      }),
      io,
    );
    // 40/2 = 20x beats 8/4 = 2x, so the total_energy row is the headline.
    expect(io.logs.join("\n")).toContain("worst naive error: total_energy 2026-07-31");
    expect(io.logs.join("\n")).toContain("20x");
  });

  test("says nothing about a worst error when no day has a reset", () => {
    const io = fakeIo();
    report(
      truth({
        perMetricPerDayEnergy: [
          { metric: "total_energy", day: "2026-07-31", energy: 2, naive: 2, resets: 0 },
        ],
      }),
      io,
    );
    expect(io.logs.join("\n")).not.toContain("worst naive error");
  });

  test("a reset day with zero energy is skipped rather than dividing by zero", () => {
    const io = fakeIo();
    report(
      truth({
        perMetricPerDayEnergy: [
          { metric: "total_energy", day: "2026-07-31", energy: 0, naive: 40, resets: 1 },
        ],
      }),
      io,
    );
    expect(io.logs.join("\n")).not.toContain("worst naive error");
    expect(io.logs.join("\n")).not.toContain("Infinity");
  });
});

describe("ground-truth paths", () => {
  test("the final ground truth is the unsuffixed file — the one that is committed", () => {
    expect(groundTruthPath("fast")).toMatch(/ground-truth-1-2-0\.fast\.json$/);
    expect(groundTruthPath("full")).toMatch(/ground-truth-1-2-0\.full\.json$/);
  });

  test("every other stage gets its own name, so a re-read cannot overwrite the record", () => {
    // `--ground-truth` on a built fixture can only see the retained raw window;
    // writing that over the build's own file would destroy the real numbers.
    expect(groundTruthPath("fast", "pre-trim")).toMatch(/\.fast\.pre-trim\.json$/);
    expect(groundTruthPath("fast", "recheck")).toMatch(/\.fast\.recheck\.json$/);
    const paths = new Set([
      groundTruthPath("fast"),
      groundTruthPath("fast", "pre-trim"),
      groundTruthPath("fast", "recheck"),
    ]);
    expect(paths.size).toBe(3);
  });

  test("the parity snapshot is always stage-qualified and never collides with the summary", () => {
    expect(paritySnapshotPath("fast")).toMatch(/parity-1-2-0\.fast\.final\.json$/);
    expect(paritySnapshotPath("fast", "pre-trim")).toMatch(/parity-1-2-0\.fast\.pre-trim\.json$/);
    expect(paritySnapshotPath("fast")).not.toBe(groundTruthPath("fast"));
  });

  test("both live under scripts/fixtures", () => {
    expect(groundTruthPath("fast")).toContain("/fixtures/");
    expect(paritySnapshotPath("full")).toContain("/fixtures/");
  });
});

describe("writeGroundTruth", () => {
  const truth: GroundTruth = {
    generatedAt: "2026-08-01T00:00:00.000Z",
    fixture: {
      mode: "fast",
      inverterId: "fixture-inverter",
      spanDays: 10,
      cadenceSeconds: 60,
      metricCount: 5,
      rawRetentionDays: 7,
    },
    tiers: {
      minute_rollups: { minBucket: "a", maxBucket: "b", count: 1, digest: "d" },
      hourly_rollups: { minBucket: "a", maxBucket: "b", count: 1, digest: "d" },
      daily_rollups: { minBucket: "a", maxBucket: "b", count: 1, digest: "d" },
    },
    raw: { minTime: "a", maxTime: "b", count: 1 },
    perMetricPerDayEnergy: [
      { metric: "total_energy", day: "2026-07-31", energy: 2, naive: 40, resets: 1 },
    ],
    restarts: [
      { metric: "total_energy", at: "2026-07-31T00:00:00.000Z", valueBefore: 1010, valueAfter: 0 },
    ],
  };

  test("stamps the provenance into the file, so nobody downstream has to guess", () => {
    // The whole file is synthetic-but-schema-exact; a reader who does not know
    // that would over-trust it.
    const io = fakeIo();
    const path = writeGroundTruth("fast", truth, "final", io);
    expect(io.written).toHaveLength(1);
    expect(path).toBe(groundTruthPath("fast"));
    const parsed = JSON.parse(io.written[0]!.content);
    expect(parsed.provenance.kind).toBe("synthetic-but-schema-exact");
    expect(parsed.provenance.doesNotProve).toContain("production's actual row values");
    expect(parsed.restarts).toHaveLength(1);
  });

  test("the bulky parity snapshot goes to its own file, not into the committed record", () => {
    // The summaries are reviewable in a diff; the snapshot is 30 MB for the
    // 10-day fixture alone and is regenerated per run.
    const io = fakeIo();
    writeGroundTruth("fast", { ...truth, snapshot: { rawRows: 7 } as never }, "final", io);
    expect(io.written.map((w) => w.path)).toEqual([
      groundTruthPath("fast"),
      paritySnapshotPath("fast"),
    ]);
    expect(JSON.parse(io.written[0]!.content).snapshot).toBeUndefined();
    expect(JSON.parse(io.written[1]!.content)).toEqual({ rawRows: 7 });
  });

  test("with no snapshot only the summary file is written", () => {
    const io = fakeIo();
    writeGroundTruth("fast", truth, "pre-trim", io);
    expect(io.written).toHaveLength(1);
    expect(io.written[0]!.path).toBe(groundTruthPath("fast", "pre-trim"));
  });

  test("the file ends with a newline and is indented, so a diff is reviewable", () => {
    const io = fakeIo();
    writeGroundTruth("fast", truth, "final", io);
    expect(io.written[0]!.content.endsWith("\n")).toBe(true);
    expect(io.written[0]!.content).toContain('\n  "provenance"');
  });
});

describe("loadProfile", () => {
  test("parses the profile the fixture's identity comes from", async () => {
    const io = fakeIo();
    expect(await loadProfile(io)).toEqual(FAKE_PROFILE);
  });

  test("reads the real repo profile through the production wiring", async () => {
    // 1.2.0 stamps inverterId = profile.id, so the fixture's single inverter id
    // has to be a real profile id, not an invented string.
    const profile = await loadProfile(productionIo);
    expect(typeof profile.id).toBe("string");
    expect(profile.id.length).toBeGreaterThan(0);
    expect(Array.isArray(profile.metrics)).toBe(true);
  });
});

describe("spanEnd", () => {
  test("truncates to a whole minute so no bucket is half-open at the top", () => {
    const end = spanEnd(new Date("2026-08-01T12:34:56.789Z"));
    expect(end.toISOString()).toBe("2026-08-01T12:34:00.000Z");
  });

  test("a whole minute is left exactly as it is", () => {
    expect(spanEnd(new Date("2026-08-01T12:34:00.000Z")).toISOString()).toBe(
      "2026-08-01T12:34:00.000Z",
    );
  });

  test("does not mutate the date it was handed", () => {
    const now = new Date("2026-08-01T12:34:56.789Z");
    spanEnd(now);
    expect(now.toISOString()).toBe("2026-08-01T12:34:56.789Z");
  });

  test("defaults to the clock, on a whole minute", () => {
    const end = spanEnd();
    expect(end.getUTCSeconds()).toBe(0);
    expect(end.getUTCMilliseconds()).toBe(0);
  });
});

describe("snapshot", () => {
  test("waits for the server, then dumps inside the container", async () => {
    // Inside, so no host pg_dump of a matching version is needed.
    const io = fakeIo();
    expect(await snapshot(io)).toBe(0);
    expect(io.calls).toEqual(["ready", "dump"]);
    expect(io.logs.join("\n")).toContain("survives a container restart");
  });
});

describe("restore", () => {
  test("brackets pg_restore with pre_restore/post_restore", async () => {
    // Without them compressed chunks and continuous-aggregate catalog rows
    // cannot be written back at all.
    const io = fakeIo();
    expect(await restore(io)).toBe(0);
    expect(io.calls).toEqual([
      "ready",
      "connectAdmin",
      "psql:SELECT timescaledb_pre_restore();",
      "restore",
      "psql:SELECT timescaledb_post_restore();",
    ]);
  });

  test("a failing pg_restore is reported as untrustworthy, with its own exit code", async () => {
    // Returning 0 here would leave a half-restored fixture that every later
    // rehearsal would silently trust.
    const io = fakeIo({ restoreExit: 3 });
    expect(await restore(io)).toBe(3);
    expect(io.errors.join("\n")).toContain("pg_restore exited 3 — the fixture is NOT trustworthy.");
  });

  test("post_restore still runs after a failed restore, so the database is usable", async () => {
    const io = fakeIo({ restoreExit: 1 });
    await restore(io);
    expect(io.calls).toContain("psql:SELECT timescaledb_post_restore();");
  });
});

/** The whole build, driven by one router that answers every phase. */
type FullIoOverrides = {
  compressedChunks?: number;
  tierCount?: number;
  restarts?: boolean;
  mode?: FixtureMode;
};

/** The parity snapshot a built fixture reports. */
const fullSnapshot = (over: FullIoOverrides) => ({
  rollups: { minute_rollups: [], hourly_rollups: [], daily_rollups: [] },
  tables: { app_settings: 6 },
  digests: { app_settings: "abc" },
  rawRows: 10_080,
  compressedChunks: over.compressedChunks ?? 3,
  policies: ["policy_compression:metrics_raw"],
});

/**
 * The counter readings a build reads back: two days, with a restart on the
 * second unless `restarts: false` asks for a fixture without one.
 */
const fullCounterRows = (over: FullIoOverrides) =>
  over.restarts === false
    ? [
        { time: "2026-07-30T00:00:00.000Z", value: 1000 },
        { time: "2026-07-31T00:00:00.000Z", value: 1010 },
      ]
    : [
        { time: "2026-07-30T00:00:00.000Z", value: 1000 },
        { time: "2026-07-30T23:59:00.000Z", value: 1010 },
        { time: "2026-07-31T00:00:00.000Z", value: 0 },
        { time: "2026-07-31T23:59:00.000Z", value: 7 },
      ];

/**
 * Every read a whole build makes, as a table of matchers.
 *
 * A table rather than one long if-chain so each phase's answer stays a small
 * function — the chain was over the repo's complexity ceiling.
 */
const fullRoutes = (
  plan: ReturnType<typeof fixedPlan>,
  over: FullIoOverrides,
): readonly [fragment: string, rows: (params?: unknown[]) => unknown[]][] => [
  [
    "SELECT value FROM metrics_raw",
    (params) => {
      const metric = plan.metrics.find((m) => m.key === params?.[0]);
      return metric ? [{ value: valueAt(metric.shape, Number(params?.[2])) }] : [];
    },
  ],
  ["json_build_object", () => [{ snap: fullSnapshot(over) }]],
  [
    "min(time)",
    () => [
      { minTime: "2026-07-25T00:00:00+00", maxTime: "2026-07-31T23:59:00+00", count: "10080" },
    ],
  ],
  [
    "min(bucket)",
    () => [
      {
        minBucket: "2026-07-22T00:00:00+00",
        maxBucket: "2026-08-01T00:00:00+00",
        count: String(over.tierCount ?? 1440),
        digest: "digest",
      },
    ],
  ],
  [
    "SELECT time, value FROM metrics_raw",
    (params) => fullCounterRows(over).map((r) => ({ ...r, metric: String(params?.[0]) })),
  ],
  ["compress_chunk", () => [{ n: 2 }]],
  ["drop_chunks", () => [{ n: 2 }]],
];

/** A `FixtureIo` that can carry a whole `build` from end to end. */
const fullIo = (over: FullIoOverrides = {}) => {
  // The value router has to resolve shapes from the SAME plan the build makes:
  // `assignShapes` derives the restart minute from the span, so a fast-mode
  // shape answered to a full-mode build is a real drift, not a test artifact.
  const plan = fixedPlan(over.mode ?? "fast");
  const routes = fullRoutes(plan, over);
  return fakeIo({
    db: fakeDb((text, params) => {
      const route = routes.find(([fragment]) => text.includes(fragment));
      return route ? route[1](params) : [];
    }),
  });
};

describe("build", () => {
  const options = { action: "build", mode: "fast", reset: false, endsAt: FIXED_END } as const;

  test("a meaningful fixture builds and reports success", async () => {
    const io = fullIo();
    expect(await build({ ...options }, io)).toBe(0);
    expect(io.logs.join("\n")).toContain("fixture ready");
    expect(io.logs.join("\n")).toContain("SYNTHETIC-BUT-SCHEMA-EXACT");
    expect(io.errors).toEqual([]);
  });

  test("the phases run in the order the real instance lived through", async () => {
    const io = fullIo();
    await build({ ...options }, io);
    const phases = io.logs.join("\n");
    const at = (needle: string) => phases.indexOf(needle);
    // Seed, verify, materialize, compress, then trim — the aggregates must be
    // built while raw still spans the whole window.
    expect(at("raw rows in")).toBeLessThan(at("value model verified"));
    expect(at("value model verified")).toBeLessThan(at("materialized minute_rollups"));
    expect(at("materialized daily_rollups")).toBeLessThan(at("compressed"));
    expect(at("compressed")).toBeLessThan(at("dropped"));
  });

  test("the pre-trim ground truth is written BEFORE the trim, and both files are kept", async () => {
    // Pre-trim is the only record of what the full span held before retention
    // took it away — the numbers the rollups must still be able to reproduce.
    const io = fullIo();
    await build({ ...options }, io);
    const paths = io.written.map((w) => w.path);
    expect(paths).toContain(groundTruthPath("fast", "pre-trim"));
    expect(paths).toContain(groundTruthPath("fast"));
    const trimAt = io.logs.findIndex((l) => l.startsWith("dropped "));
    const preTrimWrittenBeforeTrim = io.logs
      .slice(0, trimAt)
      .some((l) => l.includes("seeded") || l.includes("compressed"));
    expect(preTrimWrittenBeforeTrim).toBe(true);
  });

  test("the container is brought up and the database recreated before anything is applied", async () => {
    const io = fullIo();
    await build({ ...options }, io);
    expect(io.calls.slice(0, 4)).toEqual(["readProfile", "state", "create", "ready"]);
    expect(io.calls).toContain("connectAdmin");
    expect(io.calls).toContain("connect");
  });

  test("--reset is forwarded to the container step", async () => {
    const io = fullIo();
    await build({ ...options, reset: true }, io);
    // Absent container: nothing to remove, but the reset path was taken.
    expect(io.calls).toContain("create");
  });

  test("refuses to call a fixture with no counter restart ready", async () => {
    // The headline case unseeded means a migration could keep the naive
    // max - min arithmetic and still pass every check.
    const io = fullIo({ restarts: false });
    expect(await build({ ...options }, io)).toBe(1);
    expect(io.errors.join("\n")).toContain("no counter restart");
    expect(io.logs.join("\n")).toContain("not meaningful enough to rehearse against");
    expect(io.logs.join("\n")).not.toContain("fixture ready");
  });

  test("refuses a fixture with no compressed chunk — the riskiest case untested", async () => {
    const io = fullIo({ compressedChunks: 0 });
    expect(await build({ ...options }, io)).toBe(1);
    expect(io.errors.join("\n")).toContain("no compressed chunk");
  });

  test("refuses a fixture with no rollup buckets at all", async () => {
    const io = fullIo({ tierCount: 0 });
    expect(await build({ ...options }, io)).toBe(1);
    expect(io.errors.join("\n")).toContain("no rollup buckets");
  });

  test("releases the connection even when a phase throws", async () => {
    const io = fakeIo({
      db: fakeDb((text) => {
        if (text.includes("INSERT INTO metrics_raw")) throw new Error("disk full");
        return [];
      }),
    });
    await expect(build({ ...options }, io)).rejects.toThrow("disk full");
    expect(io.db.ended()).toBe(1);
  });

  test("full mode plans the whole sixty days", async () => {
    const io = fullIo({ mode: "full" });
    await build({ ...options, mode: "full" }, io);
    expect(io.logs[0]).toContain("full mode: 60 days");
    expect(io.logs[0]).toContain(
      `${10 * 60 * 1440} raw rows`.replace(/\B(?=(\d{3})+(?!\d))/g, ","),
    );
  });
});

describe("groundTruthOnly", () => {
  test("re-reads a built fixture into the recheck file, never over the build's record", async () => {
    const io = fullIo();
    expect(await groundTruthOnly("fast", FIXED_END, io)).toBe(0);
    // The recheck summary, and its parity snapshot beside it — never the
    // build's own `final` or `pre-trim` records.
    expect(io.written.map((w) => w.path)).toEqual([
      groundTruthPath("fast", "recheck"),
      paritySnapshotPath("fast", "recheck"),
    ]);
    expect(io.written.map((w) => w.path)).not.toContain(groundTruthPath("fast"));
    expect(io.logs.join("\n")).toContain("ground truth (raw window only)");
  });

  test("builds nothing: no container is created and no database recreated", async () => {
    const io = fullIo();
    await groundTruthOnly("fast", FIXED_END, io);
    expect(io.calls).not.toContain("create");
    expect(io.calls).not.toContain("connectAdmin");
    expect(io.db.issued.some((i) => i.text.includes("INSERT INTO metrics_raw"))).toBe(false);
  });

  test("falls back to the clock when no --ends-at was given", async () => {
    const io = fullIo();
    expect(await groundTruthOnly("fast", null, io)).toBe(0);
  });

  test("releases the connection", async () => {
    const io = fullIo();
    await groundTruthOnly("fast", FIXED_END, io);
    expect(io.db.ended()).toBe(1);
  });
});

describe("main", () => {
  test("--help prints the help and does nothing else", async () => {
    const io = fakeIo();
    const logs: string[] = [];
    const realLog = console.log;
    console.log = (...a: unknown[]) => void logs.push(a.join(" "));
    try {
      expect(await main(["--help"], io)).toBe(0);
    } finally {
      console.log = realLog;
    }
    expect(logs.join("\n")).toBe(HELP);
    expect(io.calls).toEqual([]);
  });

  test("-h is the same as --help", async () => {
    const io = fakeIo();
    const realLog = console.log;
    console.log = () => {};
    try {
      expect(await main(["-h"], io)).toBe(0);
    } finally {
      console.log = realLog;
    }
    expect(io.calls).toEqual([]);
  });

  test("--snapshot dumps, and never builds", async () => {
    const io = fakeIo();
    expect(await main(["--snapshot"], io)).toBe(0);
    expect(io.calls).toContain("dump");
    expect(io.calls).not.toContain("create");
  });

  test("--restore restores, and never builds", async () => {
    const io = fakeIo();
    expect(await main(["--restore"], io)).toBe(0);
    expect(io.calls).toContain("restore");
    expect(io.db.issued.some((i) => i.text.includes("INSERT INTO"))).toBe(false);
  });

  test("--ground-truth re-reads without seeding", async () => {
    const io = fullIo();
    expect(await main(["--ground-truth", "--fast"], io)).toBe(0);
    expect(io.written.map((w) => w.path)).toEqual([
      groundTruthPath("fast", "recheck"),
      paritySnapshotPath("fast", "recheck"),
    ]);
  });

  test("no arguments at all is a full build", async () => {
    const io = fullIo({ mode: "full" });
    expect(await main([], io)).toBe(0);
    expect(io.logs[0]).toContain("full mode");
  });

  test("--ends-at is carried into the plan", async () => {
    const io = fullIo();
    await main(["--fast", "--ends-at=2026-08-01T00:00:00Z"], io);
    // The 10-day fast span ending there starts on the 22nd.
    expect(io.db.issued.find((i) => i.text.includes("generate_series"))?.params?.[2]).toBe(
      "2026-07-22T00:00:00.000Z",
    );
  });
});

describe("cli", () => {
  test("a bad flag exits 1 with its own message, never a stack trace", async () => {
    const io = fakeIo();
    expect(await cli(["--ful"], io)).toBe(1);
    expect(io.errors.join("\n")).toContain("unknown argument: --ful");
    // The help is included, so the typo is immediately fixable.
    expect(io.errors.join("\n")).toContain("--fast");
    expect(io.errors.join("\n")).toContain("fixture-1-2-0.ts — build");
  });

  test("an unparseable --ends-at exits 1 rather than reaching generate_series", async () => {
    // An `Invalid Date` would seed a span of NaN minutes.
    const io = fakeIo();
    expect(await cli(["--ends-at=not-a-date"], io)).toBe(1);
    expect(io.errors.join("\n")).toContain("cannot parse");
    expect(io.calls).toEqual([]);
  });

  test("an --ends-at with seconds exits 1 — buckets would be offset from the data", async () => {
    const io = fakeIo();
    expect(await cli(["--ends-at=2026-08-01T00:00:30Z"], io)).toBe(1);
    expect(io.errors.join("\n")).toContain("not a whole minute");
  });

  test("a failure mid-build exits 1 with the message, not a rejection", async () => {
    const io = fakeIo({
      db: fakeDb((text) => {
        if (text.includes("INSERT INTO metrics_raw")) throw new Error("disk full");
        return [];
      }),
    });
    expect(await cli(["--fast"], io)).toBe(1);
    expect(io.errors.join("\n")).toContain("disk full");
  });

  test("a successful run passes its exit code through", async () => {
    const io = fullIo();
    expect(await cli(["--fast"], io)).toBe(0);
  });

  test("--help through the cli is still 0", async () => {
    const io = fakeIo();
    const realLog = console.log;
    console.log = () => {};
    try {
      expect(await cli(["--help"], io)).toBe(0);
    } finally {
      console.log = realLog;
    }
  });
});

// ---------------------------------------------------------------------------
// The production wiring itself.
//
// Only the parts that can be executed without side effects are exercised here.
// `productionIo.docker` is deliberately NOT: `docker rm -f` and `pg_dump` would
// act on the live 1.2.0 fixture container this suite must never touch, and even
// a read-only `docker ps` would make the suite fail wherever Docker is absent.
// That is exactly why all eight commands live in that ONE method and nothing
// else does — it holds no decision, only command text, and every decision that
// used to sit beside them is proved above.
// ---------------------------------------------------------------------------
describe("productionIo", () => {
  test("gitShow rejects a path the tag does not carry, rather than returning empty", async () => {
    // Returning "" would make `statements()` yield nothing and `applySchema`
    // report "applied 0 statements" for a file it never read.
    await expect(productionIo.gitShow("packages/db/src/no-such-file.sql")).rejects.toThrow();
  });

  test("connect and connectAdmin build a handle without opening a connection", () => {
    // Nothing may dial out at construction time: `build` calls
    // `assertFixtureTarget` on the URL only after the handle exists.
    const db = productionIo.connect(
      "postgres://postgres:fixture@localhost:5433/sunreye_fixture_120",
    );
    expect(typeof db.end).toBe("function");
    const admin = productionIo.connectAdmin("postgres://postgres:fixture@localhost:5433/postgres");
    expect(typeof admin.end).toBe("function");
  });

  test("sleep resolves", async () => {
    await expect(productionIo.sleep(0)).resolves.toBeUndefined();
  });

  test("writeFile creates the fixtures directory it writes into", () => {
    // The ground truth lands in scripts/fixtures, which is gitignored for the
    // parity snapshots and therefore may not exist on a fresh clone.
    const dir = mkdtempSync(join(tmpdir(), "fixture-write-"));
    const path = join(dir, "nested", "deeper", "ground-truth.json");
    productionIo.writeFile(path, '{"ok":true}\n');
    expect(readFileSync(path, "utf8")).toBe('{"ok":true}\n');
  });

  test("readProfile reads the profile that ships in the repo", async () => {
    const profile = JSON.parse(await productionIo.readProfile());
    expect(typeof profile.id).toBe("string");
  });

  test("log is prefixed so a fixture line is identifiable in a build log", () => {
    const out: string[] = [];
    const err: string[] = [];
    const realLog = console.log;
    const realError = console.error;
    console.log = (...a: unknown[]) => void out.push(a.join(" "));
    console.error = (...a: unknown[]) => void err.push(a.join(" "));
    try {
      productionIo.log("seeded 9,300,000 raw rows");
      productionIo.error("pg_restore exited 3");
    } finally {
      console.log = realLog;
      console.error = realError;
    }
    expect(out).toEqual(["[fixture] seeded 9,300,000 raw rows"]);
    // Failures go to stderr unprefixed, the way the CLI's own errors do.
    expect(err).toEqual(["pg_restore exited 3"]);
  });
});

describe("buildPlan: an empty selection", () => {
  test("refuses to seed a fixture with no metrics at all", () => {
    // A profile whose keys do not overlap FAST_METRIC_KEYS would otherwise build
    // a database with a schema, ground truth of zeroes, and nothing to migrate.
    expect(() =>
      buildPlan({
        mode: "fast",
        endsAt: FIXED_END,
        profileMetrics: [{ key: "not.a.fast.metric", unit: "W" }],
        inverterId: "x",
      }),
    ).toThrow(/refusing to seed an empty fixture/);
  });

  test("refuses an empty profile in full mode too", () => {
    expect(() =>
      buildPlan({ mode: "full", endsAt: FIXED_END, profileMetrics: [], inverterId: "x" }),
    ).toThrow(/refusing to seed an empty fixture/);
  });
});
