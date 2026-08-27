import { describe, expect, test } from "bun:test";
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
  assertFixtureTarget,
  assignShapes,
  buildPlan,
  compareEnergy,
  compareGroundTruth,
  compareRestarts,
  parseArgs,
  planRowCount,
  sqlValueExpr,
  statements,
  valueAt,
  withDatabase,
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

/**
 * The two comparators the replay rehearsal calls DIRECTLY.
 *
 * They are reached through `compareGroundTruth` above as well, but the rehearsal
 * has no 1.2.0 tier summaries to put beside a 2.0.0 database and so calls these
 * two on their own. A public entry point that only one caller exercises is a
 * public entry point nothing pins.
 */
describe("compareEnergy and compareRestarts, called on their own", () => {
  const rows = (energy: number) => [
    { metric: "total_energy", day: "2026-07-28", energy, naive: 64_280.97, resets: 1 },
  ];

  test("identical rows compare clean", () => {
    expect(compareEnergy(rows(41.97), rows(41.97))).toEqual([]);
  });

  test("a drifted total is reported with both numbers", () => {
    const problems = compareEnergy(rows(41.97), rows(64_280.97));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/total_energy 2026-07-28: 41\.97 before, 64280\.97 after/);
  });

  test("floating-point noise below the epsilon is not a finding", () => {
    expect(compareEnergy(rows(41.97), rows(41.97 + 1e-9))).toEqual([]);
  });

  test("a metric-day that vanished, and one that appeared, are different findings", () => {
    expect(compareEnergy(rows(41.97), []).join(" ")).toMatch(/missing after/);
    expect(compareEnergy([], rows(41.97)).join(" ")).toMatch(/appeared after/);
  });

  test("two empty sides compare clean — an empty span is not a loss", () => {
    expect(compareEnergy([], [])).toEqual([]);
  });

  test("compareRestarts counts them, and says why the count matters", () => {
    const restart = {
      metric: "total_energy",
      at: "2026-07-28T12:00:00.000Z",
      valueBefore: 1,
      valueAfter: 0,
    };
    expect(compareRestarts([restart], [restart])).toEqual([]);
    expect(compareRestarts([restart], []).join(" ")).toMatch(/1 before, 0 after/);
  });
});
