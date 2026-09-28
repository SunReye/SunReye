import type { EnergyField } from "@SunReye/contracts/energy";
import type { CanonicalRole, InverterProfile, InverterSample } from "@SunReye/inverter-core";
import { afterAll, describe, expect, mock, test } from "bun:test";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

/** The zone these host-local fixtures were written in. */
const HOST_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** How an energy figure is derived from stored data — see `ENERGY_ROLE_DERIVATION`. */
type EnergyDerivation = "counter" | "integral";

// The reader issues its SQL through the DB singleton. The stand-in answers from
// a queue: `fetchBucketEnergy` runs two queries — the pre-window baseline, then
// the in-window buckets — so tests queue them in that order. That the statements
// RUN is `db-tests/day-register.test.ts` and `db-tests/counter-levels.test.ts`.
//
// Spread, and handed back BY VALUE in `afterAll`: `mock.module` is process-global
// and permanent, and a module namespace is live.
const realDb = await import("@SunReye/db");
const realDbExports = { ...realDb };
afterAll(() => {
  mock.module("@SunReye/db", () => ({ ...realDbExports }));
});

let queryResults: Array<Array<Record<string, unknown>>> = [];
const execute = mock(async () => ({ rows: queryResults.shift() ?? [] }));
mock.module("@SunReye/db", () => ({ ...realDb, db: { execute } }));

const {
  ENERGY_FIELDS,
  ENERGY_ROLE_DERIVATION,
  fetchBucketEnergy,
  fetchCounterDeltaMatrix,
  fetchLatestCounterLevels,
  liveCounterLevels,
  liveTodayTotals,
  metersLoadEnergy,
} = await import("./rollup-reader");

/** The live overlay for `inverterId` at `now`, given the poll cache's `sample`. */
const overlayFor = (
  profile: InverterProfile,
  sample: InverterSample | null,
  inverterId: string,
  now: Date,
) => liveTodayTotals(profile, inverterId, HOST_TZ, now, sample);

/** Minimal profile mapping the given canonical roles → metric keys. */
const profileWith = (roleKeys: Partial<Record<CanonicalRole, string>>): InverterProfile =>
  ({
    id: "inv-1",
    metrics: Object.entries(roleKeys).map(([role, key]) => ({ role, key })),
  }) as unknown as InverterProfile;

/** All four today-twin roles mapped to distinct metric keys. */
const fullProfile = profileWith({
  "grid.energy.imported.today": "imp",
  "grid.energy.exported.today": "exp",
  "load.energy.today": "load",
  "production.today": "prod",
});

/** A live sample on the given local day, for `inv-1` unless overridden. */
const sample = (
  localDay: Date,
  metrics: Record<string, number>,
  inverterId = "inv-1",
): InverterSample => ({
  time: localDay.toISOString(),
  inverterId,
  metrics,
});

// A fixed "now" and a same-local-day sample time, both built from local fields
// so the same-day comparison holds regardless of the runner's timezone.
const now = new Date(2024, 5, 15, 13, 0, 0);
const today = new Date(2024, 5, 15, 12, 30, 0);
const yesterday = new Date(2024, 5, 14, 23, 59, 0);

const liveMetrics = { imp: 1.1, exp: 2.2, load: 8.6, prod: 5.5 };

describe("fetchBucketEnergy — a plant target", () => {
  test("reads the members' counters SUMMED per bucket, by id", async () => {
    const profile = profileWith({ "grid.energy.imported.today": "impToday" });
    queryResults = [[], []];
    execute.mockClear();
    await fetchBucketEnergy(
      profile,
      {
        plant: [
          { id: 1, slug: "inv-1", weight: 1 },
          { id: 2, slug: "inv-2", weight: 1 },
        ],
      },
      new Date(Date.UTC(2024, 5, 15)),
      new Date(Date.UTC(2024, 5, 16)),
      "hourly_rollups",
      HOST_TZ,
    );
    const first = (execute.mock.calls as unknown as Array<[SQL]>)[0]?.[0];
    if (!first) throw new Error("no query was issued");
    const { sql: text, params } = new PgDialect().sqlToQuery(first);
    const flatText = text.replace(/\s+/g, " ");
    expect(flatText).toContain("r.device_id in ($");
    expect(flatText).toContain("sum(r.max_value) as max_value");
    expect(flatText).toContain("group by r.bucket, mk.key");
    expect(params).toContain(1);
    expect(params).toContain(2);
    expect(params).not.toContain("inv-1");
  });
});

describe("liveCounterLevels — the lifetime registers", () => {
  const counters = profileWith({
    "grid.energy.imported.total": "impT",
    "grid.energy.exported.total": "expT",
    "production.total": "prodT",
  });
  const levels = { impT: 4_321.5, expT: 9_876, prodT: 15_000 };

  test("reads every mapped *.total role the sample carries, zero-filling the rest", () => {
    expect(liveCounterLevels(counters, "inv-1", sample(today, levels))).toEqual({
      importKwh: 4_321.5,
      exportKwh: 9_876,
      loadKwh: 0,
      productionKwh: 15_000,
      batteryDischargeKwh: 0,
      batteryChargeKwh: 0,
    });
  });

  test("a lifetime counter is not a day figure: yesterday's sample still counts", () => {
    expect(liveCounterLevels(counters, "inv-1", sample(yesterday, levels))?.importKwh).toBe(
      4_321.5,
    );
  });

  test("no sample, or a sample that does not speak for the target → null", () => {
    expect(liveCounterLevels(counters, "inv-1", null)).toBeNull();
    expect(liveCounterLevels(counters, "inv-1", sample(today, levels, "other"))).toBeNull();
    const two = {
      plant: [
        { id: 1, slug: "inv-1", weight: 1 },
        { id: 2, slug: "inv-2", weight: 1 },
      ],
    };
    expect(liveCounterLevels(counters, two, sample(today, levels))).toBeNull();
  });

  test("a register the sample lacks is not zero-filled into a level of 0 — the whole read is partial", () => {
    // Only production came through: the caller must not price 0 kWh imported
    // as "the plant never bought anything".
    expect(liveCounterLevels(counters, "inv-1", sample(today, { prodT: 15_000 }))).toBeNull();
  });
});

describe("fetchLatestCounterLevels — the lifetime registers from the rollups", () => {
  const counters = profileWith({
    "grid.energy.imported.total": "impT",
    "grid.energy.exported.total": "expT",
  });

  test("takes each counter's latest daily high, zero-filling unmapped fields", async () => {
    queryResults = [
      [
        { metric: "impT", max_value: "4321.5" },
        { metric: "expT", max_value: 9876 },
      ],
    ];
    execute.mockClear();
    const levels = await fetchLatestCounterLevels(counters, "inv-1");
    expect(levels).toEqual({
      importKwh: 4_321.5,
      exportKwh: 9_876,
      loadKwh: 0,
      productionKwh: 0,
      batteryDischargeKwh: 0,
      batteryChargeKwh: 0,
    });
    const first = (execute.mock.calls as unknown as Array<[SQL]>)[0]?.[0];
    if (!first) throw new Error("no query was issued");
    const text = new PgDialect().sqlToQuery(first).sql.replace(/\s+/g, " ");
    // The forever-retained tier, newest bucket per metric.
    expect(text).toContain("daily_rollups");
    expect(text).toContain("distinct on (metric)");
    expect(text).toContain("order by metric, bucket desc");
  });

  test("a plant target sums the members' levels per bucket, like every other read", async () => {
    queryResults = [[]];
    execute.mockClear();
    await fetchLatestCounterLevels(counters, {
      plant: [
        { id: 1, slug: "inv-1", weight: 1 },
        { id: 2, slug: "inv-2", weight: 1 },
      ],
    });
    const first = (execute.mock.calls as unknown as Array<[SQL]>)[0]?.[0];
    if (!first) throw new Error("no query was issued");
    const text = new PgDialect().sqlToQuery(first).sql.replace(/\s+/g, " ");
    expect(text).toContain("sum(r.max_value) as max_value");
  });

  test("no rows at all → null, so an empty database is not a plant that saved nothing", async () => {
    queryResults = [[]];
    expect(await fetchLatestCounterLevels(counters, "inv-1")).toBeNull();
  });

  test("a profile mapping no counters issues no query", async () => {
    execute.mockClear();
    expect(await fetchLatestCounterLevels(profileWith({}), "inv-1")).toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("liveTodayTotals", () => {
  test("null live sample → empty (no override)", () => {
    expect(overlayFor(fullProfile, null, "inv-1", now)).toEqual({});
  });

  test("inverterId mismatch → empty (no override)", () => {
    const s = sample(today, liveMetrics, "other-inverter");
    expect(overlayFor(fullProfile, s, "inv-1", now)).toEqual({});
  });

  test("stale sample from a previous local day → empty (no override across midnight)", () => {
    const s = sample(yesterday, liveMetrics);
    expect(overlayFor(fullProfile, s, "inv-1", now)).toEqual({});
  });

  test("the day boundary is the PLANT's, not the host's", () => {
    // 21:30Z and 22:30Z share a UTC day, but straddle Berlin's midnight (23:30 → 00:30).
    const s: InverterSample = {
      time: "2026-08-15T21:30:00Z",
      inverterId: "inv-1",
      metrics: liveMetrics,
    };
    const at = new Date("2026-08-15T22:30:00Z");
    expect(liveTodayTotals(fullProfile, "inv-1", "Europe/Berlin", at, s)).toEqual({});
    expect(liveTodayTotals(fullProfile, "inv-1", "UTC", at, s).importKwh).toBe(1.1);
  });

  test("a plant of ONE member is spoken for by that member's sample", () => {
    const s = sample(today, liveMetrics, "inv-1");
    const plant = { plant: [{ id: 1, slug: "inv-1", weight: 1 }] };
    expect(liveTodayTotals(fullProfile, plant, HOST_TZ, now, s)).toEqual({
      importKwh: 1.1,
      exportKwh: 2.2,
      loadKwh: 8.6,
      productionKwh: 5.5,
    });
  });

  test("a plant of TWO members takes no live override — one device's register is not the plant's", () => {
    const s = sample(today, liveMetrics, "inv-1");
    const plant = {
      plant: [
        { id: 1, slug: "inv-1", weight: 1 },
        { id: 2, slug: "inv-2", weight: 1 },
      ],
    };
    expect(liveTodayTotals(fullProfile, plant, HOST_TZ, now, s)).toEqual({});
  });

  test("all guards pass → every mapped, finite field is returned", () => {
    const s = sample(today, liveMetrics);
    expect(overlayFor(fullProfile, s, "inv-1", now)).toEqual({
      importKwh: 1.1,
      exportKwh: 2.2,
      loadKwh: 8.6,
      productionKwh: 5.5,
    });
  });

  test("unmapped today-twin role → that field is left out (kept on the delta value)", () => {
    // Only load + production twins mapped; import/export absent from the profile.
    const partial = profileWith({
      "load.energy.today": "load",
      "production.today": "prod",
    });
    const s = sample(today, liveMetrics);
    expect(overlayFor(partial, s, "inv-1", now)).toEqual({
      loadKwh: 8.6,
      productionKwh: 5.5,
    });
  });

  test("mapped role missing / non-finite in the sample → that field is skipped", () => {
    // `imp` absent, `exp` NaN, `prod` Infinity → only the finite `load` survives.
    const s = sample(today, { load: 8.6, exp: Number.NaN, prod: Number.POSITIVE_INFINITY });
    expect(overlayFor(fullProfile, s, "inv-1", now)).toEqual({ loadKwh: 8.6 });
  });

  test("an explicit zero is a valid override (finite, not skipped)", () => {
    const s = sample(today, { imp: 0, exp: 0, load: 0, prod: 0 });
    expect(overlayFor(fullProfile, s, "inv-1", now)).toEqual({
      importKwh: 0,
      exportKwh: 0,
      loadKwh: 0,
      productionKwh: 0,
    });
  });
});

describe("metersLoadEnergy", () => {
  test("the cumulative counter counts", () => {
    expect(metersLoadEnergy(profileWith({ "load.energy.total": "load" }))).toBe(true);
  });

  test("so does the current-day twin on its own", () => {
    // A profile may map only the today register; deriving over it would
    // overwrite a measured figure with an implied one.
    expect(metersLoadEnergy(profileWith({ "load.energy.today": "loadToday" }))).toBe(true);
  });

  test("a plant with production and grid flow but no house counter does not", () => {
    expect(
      metersLoadEnergy(
        profileWith({ "production.total": "prod", "grid.energy.imported.total": "imp" }),
      ),
    ).toBe(false);
  });

  test("an instantaneous load reading is not an energy counter", () => {
    // `load.power` says nothing about kWh over a period.
    expect(metersLoadEnergy(profileWith({ "load.power": "loadW" }))).toBe(false);
  });
});

describe("fetchBucketEnergy", () => {
  // One counter only: the import total, so the deltas below are unambiguous.
  const importProfile = profileWith({ "grid.energy.imported.total": "imp" });
  const hour = (h: number) => new Date(Date.UTC(2024, 5, 15, h));
  /** A rollup row as the views return it. */
  const bucketRow = (at: Date, min: number, max: number) => ({
    bucket: at.toISOString(),
    metric: "imp",
    min_value: min,
    max_value: max,
  });

  /** Import kWh per bucket, given the baseline row(s) and the in-window rows. */
  const importsFor = async (
    baseline: Array<Record<string, unknown>>,
    rows: Array<Record<string, unknown>>,
  ) => {
    queryResults = [baseline, rows];
    const buckets = await fetchBucketEnergy(
      importProfile,
      "inv-1",
      hour(0),
      hour(23),
      "hourly_rollups",
      HOST_TZ,
    );
    return buckets.map((b) => b.import);
  };

  test("a plant with no load counter gets its consumption implied per hour", async () => {
    // The grid-tied shape: production + grid flow metered, house consumption
    // not. Without this the whole savings/self-sufficiency side of the Costs
    // page reads zero on a plant that consumes plenty.
    const gridTied = profileWith({
      "grid.energy.imported.total": "imp",
      "grid.energy.exported.total": "exp",
      "production.total": "prod",
    });
    queryResults = [
      [],
      [
        { bucket: hour(12).toISOString(), metric: "prod", min_value: 0, max_value: 4 },
        { bucket: hour(12).toISOString(), metric: "exp", min_value: 0, max_value: 3 },
        { bucket: hour(20).toISOString(), metric: "imp", min_value: 0, max_value: 1.5 },
      ],
    ];
    const buckets = await fetchBucketEnergy(
      gridTied,
      "inv-1",
      hour(0),
      hour(23),
      "hourly_rollups",
      HOST_TZ,
    );
    expect(buckets.map((b) => b.load)).toEqual([1, 1.5]);
  });

  test("a plant that meters its load keeps the measured figure", async () => {
    const metered = profileWith({
      "grid.energy.imported.total": "imp",
      "load.energy.total": "load",
    });
    queryResults = [
      [],
      [
        { bucket: hour(20).toISOString(), metric: "imp", min_value: 0, max_value: 5 },
        { bucket: hour(20).toISOString(), metric: "load", min_value: 0, max_value: 2 },
      ],
    ];
    const buckets = await fetchBucketEnergy(
      metered,
      "inv-1",
      hour(0),
      hour(23),
      "hourly_rollups",
      HOST_TZ,
    );
    // 2, not the 5 the surrounding flows would imply — a measured counter wins.
    expect(buckets.map((b) => b.load)).toEqual([2]);
  });

  test("an adjacent baseline prices the first bucket as a rise from prior state", async () => {
    const imports = await importsFor(
      [{ metric: "imp", bucket: hour(-1).toISOString(), last_max: 100 }],
      [bucketRow(hour(0), 100.5, 101)],
    );
    expect(imports).toEqual([1]);
  });

  test("a baseline on the far side of a recording gap is not bridged", async () => {
    // Recorder was down for three days; the counter rose 5 kWh in that hole.
    // Billing it to the first hour back would put three days of energy in this
    // window — the bucket may only claim the 0.5 it watched happen.
    const imports = await importsFor(
      [{ metric: "imp", bucket: new Date(Date.UTC(2024, 5, 12, 8)).toISOString(), last_max: 100 }],
      [bucketRow(hour(0), 105, 105.5)],
    );
    expect(imports).toEqual([0.5]);
  });

  test("a gap inside the window breaks the chain at the bucket after it", async () => {
    const imports = await importsFor(
      [{ metric: "imp", bucket: hour(-1).toISOString(), last_max: 100 }],
      [
        bucketRow(hour(0), 100, 101),
        // Nothing recorded for hours 1–9; hour 10 comes back 8 kWh higher.
        bucketRow(hour(10), 109, 109.5),
        bucketRow(hour(11), 109.5, 110),
      ],
    );
    expect(imports).toEqual([1, 0.5, 0.5]);
  });

  test("a short hole is still bridged — a restart must not drop the energy", async () => {
    const imports = await importsFor(
      [{ metric: "imp", bucket: hour(-1).toISOString(), last_max: 100 }],
      [bucketRow(hour(0), 100, 101), bucketRow(hour(2), 101.4, 101.5)],
    );
    expect(imports).toEqual([1, 0.5]);
  });
});

/**
 * Issue #115: is a role's energy read from a device counter, or integrated from
 * power samples? The answer is declared by `ENERGY_ROLE_DERIVATION` in `rollup-reader.ts`
 * and MEASURED here, so the table cannot rot — it is compared against what the
 * code actually does with one recording described two ways.
 *
 * The discriminating perturbation is exactly what milestone 8's change-only
 * storage does to the raw series. A monotonic counter's change points are
 * precisely the samples change-only storage keeps, so a bucket's `max_value`
 * and `min_value` survive thinning untouched while its unweighted `avg_value`
 * and sample count move a long way. A counter-derived figure is therefore
 * invariant across the two; an integral over the averaged samples is not.
 */
describe("energy derivation per role (issue #115)", () => {
  const hour = (h: number) => new Date(Date.UTC(2024, 5, 15, h));
  const HOURS = 6;

  /** A rollup row as the continuous aggregates materialize one. */
  interface RollupRow extends Record<string, unknown> {
    bucket: string;
    metric: string;
    min_value: number;
    max_value: number;
    avg_value: number;
    samples: number;
  }

  /**
   * One morning of a counter climbing 1 kWh/hour, as the hourly rollups would
   * hold it. `dense` picks the recording style: a sample every poll (the counter
   * sits at the hour's opening level almost the whole hour, so the mean hugs the
   * minimum) versus change-only (only the change points survive, so the mean
   * sits mid-bucket). Same physical counter, same max/min — different mean.
   */
  const counterDay = (metric: string, dense: boolean): RollupRow[] =>
    Array.from({ length: HOURS }, (_, h) => {
      const min = 100 + h;
      const max = 101 + h;
      return {
        bucket: hour(h).toISOString(),
        metric,
        min_value: min,
        max_value: max,
        avg_value: dense ? min + 0.02 : (min + max) / 2,
        samples: dense ? 3600 : 2,
      };
    });

  /** Total kWh the engine reports for `field` from these rollup rows. */
  const energyFrom = async (field: EnergyField, rows: RollupRow[]): Promise<number> => {
    const profile = profileWith({ [ENERGY_FIELDS[field]]: "m" });
    // No baseline row: both variants then price their first bucket from its own
    // min, so the two runs differ ONLY in mean and sample count.
    queryResults = [[], rows];
    const buckets = await fetchBucketEnergy(
      profile,
      "inv-1",
      hour(0),
      hour(HOURS),
      "hourly_rollups",
      HOST_TZ,
    );
    return buckets.reduce((sum, b) => sum + b[field], 0);
  };

  /** What the code actually does, measured rather than restated from the table. */
  const measureDerivation = async (field: EnergyField): Promise<EnergyDerivation> => {
    const dense = await energyFrom(field, counterDay("m", true));
    const thinned = await energyFrom(field, counterDay("m", false));
    // A figure that is zero either way would be trivially "invariant" — the
    // fixture has to actually produce energy for the verdict to mean anything.
    expect(dense).toBeGreaterThan(0);
    return Math.abs(dense - thinned) < 1e-9 ? "counter" : "integral";
  };

  test("the fixture's thinning really does move an integral (the test has teeth)", () => {
    // Σ avg·1h over the same two row sets — the naive integral #116 is about.
    const integral = (rows: RollupRow[]) => rows.reduce((sum, r) => sum + r.avg_value, 0);
    expect(integral(counterDay("m", true))).not.toBeCloseTo(integral(counterDay("m", false)), 6);
  });

  for (const [field, declared] of Object.entries(ENERGY_ROLE_DERIVATION) as Array<
    [EnergyField, EnergyDerivation]
  >) {
    test(`${field} is ${declared}-derived`, async () => {
      expect(await measureDerivation(field)).toBe(declared);
    });
  }

  test("the table covers every energy role the engine prices", () => {
    expect(Object.keys(ENERGY_ROLE_DERIVATION).sort()).toEqual(Object.keys(ENERGY_FIELDS).sort());
  });
});

/**
 * A counter that restarts — firmware update, device swap, a register that rolls
 * over — must cost at most the bucket it happened in. An integral would simply
 * carry on; a counter difference can go wrong in both directions, so both are
 * pinned: never a negative kWh, and never the whole lifetime total.
 */
describe("counter restart across the bucket boundary", () => {
  const importProfile = profileWith({ "grid.energy.imported.total": "imp" });
  const hour = (h: number) => new Date(Date.UTC(2024, 5, 15, h));
  const staleBaseline = [
    { metric: "imp", bucket: new Date(Date.UTC(2024, 5, 12, 8)).toISOString(), last_max: 11_000 },
  ];
  const bucketRow = (at: Date, min: number, max: number) => ({
    bucket: at.toISOString(),
    metric: "imp",
    min_value: min,
    max_value: max,
  });
  const importsFor = async (
    baseline: Array<Record<string, unknown>>,
    rows: Array<Record<string, unknown>>,
  ) => {
    queryResults = [baseline, rows];
    const buckets = await fetchBucketEnergy(
      importProfile,
      "inv-1",
      hour(0),
      hour(23),
      "hourly_rollups",
      HOST_TZ,
    );
    return buckets.map((b) => b.import);
  };

  test("a restart to zero costs one bucket — never a negative kWh", async () => {
    const imports = await importsFor(
      [{ metric: "imp", bucket: hour(-1).toISOString(), last_max: 11_000 }],
      [
        // The counter is replaced and restarts near zero, then climbs normally.
        bucketRow(hour(0), 0, 0.5),
        bucketRow(hour(1), 0.5, 1.5),
      ],
    );
    expect(imports).toEqual([0, 1]);
  });

  test("a restart in the first bucket back after an outage is not billed as a lifetime total", async () => {
    // The recorder was down for three days, came back on the OLD counter
    // (11 000 kWh), and the device restarted inside that same hour. The bucket's
    // own max − min then spans the restart: 11 000 kWh in one hour, a bill
    // nobody can pay. It may only claim the rise it watched happen since the
    // last known level.
    const imports = await importsFor(staleBaseline, [bucketRow(hour(0), 0, 11_000.4)]);
    expect(imports[0]).toBeCloseTo(0.4, 6);
  });

  test("a restart entirely before the outage ended still prices its own rise", async () => {
    // Every sample in the bucket is post-restart (max is BELOW the stale
    // baseline), so the intra-bucket rise is the honest figure.
    const imports = await importsFor(staleBaseline, [bucketRow(hour(0), 0.2, 0.7)]);
    expect(imports[0]).toBeCloseTo(0.5, 6);
  });
});

/**
 * A `*.today` register — the device's own day counter, reset to 0 at its local
 * midnight — is what the hourly series differences where the profile maps one.
 *
 * The defect this describes: on a freshly booted appliance the first hourly
 * bucket had no predecessor to difference against, so it fell back to its own
 * `max − min`. The first poll of that hour answers 0 for a register that has
 * not been read yet, and the next answers the lifetime odometer — so the whole
 * odometer (3 755.7 kWh imported, on the appliance this was found on) was
 * booked into one hour, poisoning the chart, the energy split, self-sufficiency
 * and the bill. `(min, max)` alone cannot tell that apart from a counter that
 * genuinely starts at zero, which is why the fix is the register, not the rule:
 * a counter that resets every day bounds the worst case at one day, and on a
 * first boot has no odometer in it to book.
 */
describe("fetchBucketEnergy — the daily-resetting *.today register", () => {
  // Both registers mapped: the hourly series must read the day twin, and the
  // daily rollups — which a daily reset cannot drive — the lifetime odometer.
  const dayProfile = profileWith({
    "grid.energy.imported.total": "impT",
    "grid.energy.imported.today": "impD",
  });
  const hour = (h: number) => new Date(Date.UTC(2024, 5, 15, h));
  const row = (at: Date, metric: string, min: number, max: number) => ({
    bucket: at.toISOString(),
    metric,
    min_value: min,
    max_value: max,
  });
  /** The metric keys a read actually asked the database for. */
  const keysQueried = (): unknown[] => {
    const first = (execute.mock.calls as unknown as Array<[SQL]>)[0]?.[0];
    if (!first) throw new Error("no query was issued");
    return new PgDialect().sqlToQuery(first).params;
  };

  /** Import kWh per bucket. The plant zone is pinned to UTC so the day boundary
   *  sits where the fixture's `hour()` puts it, on any runner. */
  const importsFor = async (
    baseline: Array<Record<string, unknown>>,
    rows: Array<Record<string, unknown>>,
    to = hour(24),
  ) => {
    queryResults = [baseline, rows];
    const buckets = await fetchBucketEnergy(
      dayProfile,
      "inv-1",
      hour(0),
      to,
      "hourly_rollups",
      "UTC",
    );
    return buckets.map((b) => b.import);
  };

  test("the hourly series reads the day twin, not the lifetime counter", async () => {
    queryResults = [[], []];
    execute.mockClear();
    await fetchBucketEnergy(dayProfile, "inv-1", hour(0), hour(24), "hourly_rollups", "UTC");
    expect(keysQueried()).toContain("impD");
    expect(keysQueried()).not.toContain("impT");
  });

  test("a daily rollup cannot difference a register that resets daily", async () => {
    // A day counter says nothing about a day-or-longer bucket's rise, so the
    // coarser views stay on the lifetime odometer.
    queryResults = [[], []];
    execute.mockClear();
    await fetchBucketEnergy(dayProfile, "inv-1", hour(0), hour(24), "daily_rollups", "UTC");
    expect(keysQueried()).toContain("impT");
    expect(keysQueried()).not.toContain("impD");
  });

  test("a first boot books the day, never the lifetime odometer", async () => {
    // 05:00 on day one, no predecessor at all: the hour's first poll answered 0
    // for both registers, the next the real reading. Differencing the lifetime
    // counter bills 3 755.7 kWh to that hour.
    const imports = await importsFor(
      [],
      [row(hour(5), "impD", 0, 2.4), row(hour(5), "impT", 0, 3_755.7)],
    );
    expect(imports).toEqual([2.4]);
  });

  test("an hour is the day register's rise since the hour before it", async () => {
    const imports = await importsFor(
      [{ metric: "impD", bucket: hour(4).toISOString(), last_max: 2.4 }],
      [row(hour(5), "impD", 2.4, 3), row(hour(6), "impD", 3, 3.1)],
    );
    expect(imports[0]).toBeCloseTo(0.6, 6);
    expect(imports[1]).toBeCloseTo(0.1, 6);
  });

  test("the midnight reset is not a lost hour — the day's first bucket counts its own rise", async () => {
    // The register closes the day at 18 kWh and drops to 0 at the plant's
    // midnight. Chaining across that boundary would make the new day's first
    // hour a negative delta, clamped to zero: an hour missing every single day.
    const imports = await importsFor(
      [{ metric: "impD", bucket: hour(22).toISOString(), last_max: 17 }],
      [row(hour(23), "impD", 17, 18), row(hour(24), "impD", 0, 0.4)],
      hour(25),
    );
    expect(imports[0]).toBeCloseTo(1, 6);
    expect(imports[1]).toBeCloseTo(0.4, 6);
  });

  test("nor is it a whole day billed to one hour when the reset lands mid-bucket", async () => {
    // The device's day rolls over inside the bucket rather than on its edge — a
    // plant zone offset from the device's clock, or a device a few minutes late.
    // The bucket then holds both yesterday's closing 18 kWh and today's opening
    // 0.2, so its own max − min is a whole day in one hour: the lifetime defect
    // in miniature. Only the rise above the last known level was observed.
    const imports = await importsFor(
      [{ metric: "impD", bucket: hour(23).toISOString(), last_max: 17.6 }],
      [row(hour(24), "impD", 0.2, 18)],
      hour(25),
    );
    expect(imports[0]).toBeCloseTo(0.4, 6);
  });

  test("a field with no day twin keeps the lifetime path, beside one that has", async () => {
    // Both derivations coexist in the same read: a profile maps the twins it
    // maps, and the rest are differenced from the odometer as before.
    const mixed = profileWith({
      "grid.energy.imported.total": "impT",
      "grid.energy.imported.today": "impD",
      "grid.energy.exported.total": "expT",
    });
    queryResults = [[], [row(hour(5), "impD", 0, 2.4), row(hour(5), "expT", 900, 901.5)]];
    const buckets = await fetchBucketEnergy(
      mixed,
      "inv-1",
      hour(0),
      hour(24),
      "hourly_rollups",
      "UTC",
    );
    expect(buckets[0]?.import).toBeCloseTo(2.4, 6);
    expect(buckets[0]?.export).toBeCloseTo(1.5, 6);
  });
});

/**
 * The same rule, in the SQL that mirrors it. `fetchCounterDeltaMatrix` derives
 * the cost series, the energy split and the heatmap from the same rollups, so a
 * day register that stopped at `fetchBucketEnergy` would leave those three
 * reading the lifetime odometer they were poisoned by.
 *
 * Text assertions only: that this statement RUNS is `db-tests/day-register.test.ts`.
 */
describe("fetchCounterDeltaMatrix — the day register in SQL", () => {
  const dayProfile = profileWith({
    "grid.energy.imported.total": "impT",
    "grid.energy.imported.today": "impD",
  });
  const from = new Date(Date.UTC(2024, 5, 15));
  const to = new Date(Date.UTC(2024, 5, 16));

  /** The matrix statement behind the hourly cost series, flattened, plus its
   *  parameters. */
  const statementFor = async () => {
    queryResults = [[]];
    execute.mockClear();
    await fetchCounterDeltaMatrix(dayProfile, {
      from,
      to,
      bucket: "hour",
      inverterId: "inv-1",
      view: "hourly_rollups",
      tz: HOST_TZ,
    });
    const first = (execute.mock.calls as unknown as Array<[SQL]>)[0]?.[0];
    if (!first) throw new Error("no query was issued");
    const q = new PgDialect().sqlToQuery(first);
    return { text: q.sql.replace(/\s+/g, " "), params: q.params };
  };

  test("the cost series reads the day twin and refuses to chain across the plant's midnight", async () => {
    const { text, params } = await statementFor();
    expect(params).toContain("impD");
    expect(params).not.toContain("impT");
    // The guard: a predecessor in a different plant-local day is no baseline.
    expect(text).toContain("date_trunc('day'");
  });
});
