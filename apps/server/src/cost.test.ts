import { type TariffConfig, tariffConfigSchema } from "@SunReye/db/tariff";
import type { CanonicalRole, InverterProfile, InverterSample } from "@SunReye/inverter-core";
import { describe, expect, mock, test } from "bun:test";

// cost.ts imports the DB singleton (which eagerly validates server env). Mock it
// so the guard logic can be imported and exercised without a database or a
// populated .env — mirroring inverter.test.ts's approach.
//
// `fetchBucketEnergy` runs two queries — the pre-window baseline, then the
// in-window buckets — so the stub answers from a queue in that order.
let queryResults: Array<Array<Record<string, unknown>>> = [];
const execute = mock(async () => ({ rows: queryResults.shift() ?? [] }));
mock.module("@SunReye/db", () => ({ db: { execute } }));

// Flat 0.30/kWh so the money in a computeCost result is readable by eye.
const flatTariff: TariffConfig = tariffConfigSchema.parse({
  currency: "EUR",
  standingChargeMonthly: 0,
  import: { defaultPricePerKwh: 0.3 },
  export: { feedInPerKwh: 0.08 },
});
mock.module("./settings", () => ({ getTariff: async () => flatTariff }));

// computeCost reads the poll cache directly (its `sample` argument is only
// injectable one level down), so the cache itself is the stand-in.
const liveState: { latest: InverterSample | null } = { latest: null };
mock.module("./state", () => ({ liveState }));

const { computeCost, fetchBucketEnergy, liveTodayTotals } = await import("./cost");

/** The live overlay for `inverterId` at `now`, given the poll cache's `sample`. */
const overlayFor = (
  profile: InverterProfile,
  sample: InverterSample | null,
  inverterId: string,
  now: Date,
) => liveTodayTotals(profile, inverterId, now, sample);

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
    );
    return buckets.map((b) => b.import);
  };

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

describe("computeCost and the live today registers", () => {
  // Both the lifetime counter and its today twin, so the live overlay applies.
  const profile = profileWith({
    "grid.energy.imported.total": "imp",
    "grid.energy.imported.today": "impToday",
  });

  // Windows are built from the real clock: computeCost reads `new Date()` for
  // "today" and takes no injectable now.
  const clock = new Date();
  const midnight = new Date(clock);
  midnight.setHours(0, 0, 0, 0);
  const at = (offsetHours: number) => new Date(midnight.getTime() + offsetHours * 3_600_000);

  // Yesterday 21:00 → 100 kWh on the clock. Then 2 kWh through the evening and
  // 1 kWh recorded since midnight: 3 kWh in the month, 1 kWh of it today.
  const baseline = [{ metric: "imp", bucket: at(-3).toISOString(), last_max: 100 }];
  const buckets = [
    { bucket: at(-2).toISOString(), metric: "imp", min_value: 100, max_value: 102 },
    { bucket: at(0).toISOString(), metric: "imp", min_value: 102, max_value: 103 },
  ];

  /** The window's breakdown, over the pre-window baseline and in-window rows the
   *  reader will see. */
  const costOver = async (
    from: Date,
    seed: Array<Record<string, unknown>>,
    rows: Array<Record<string, unknown>>,
  ) => {
    queryResults = [seed, rows];
    return computeCost(profile, { from, to: new Date(), inverterId: "inv-1" });
  };
  /** Month-to-date: yesterday's buckets and today's, seeded before them. */
  const monthToDate = () =>
    costOver(new Date(midnight.getFullYear(), midnight.getMonth(), 1), baseline, buckets);
  /** Today: only the buckets since midnight, seeded from last evening's high. */
  const todaySeed = [{ metric: "imp", bucket: at(-2).toISOString(), last_max: 102 }];
  const today = () => costOver(midnight, todaySeed, buckets.slice(1));

  /** A poll-cache sample reading `kwh` on the today twin. */
  const liveImport = (kwh: number): InverterSample => ({
    time: clock.toISOString(),
    inverterId: "inv-1",
    metrics: { impToday: kwh },
  });

  test("without a live sample both windows stay on the counter deltas", async () => {
    liveState.latest = null;
    expect((await monthToDate()).importKwh).toBe(3);
    expect((await today()).importKwh).toBe(1);
  });

  test("the today window reports the live register", async () => {
    liveState.latest = liveImport(5);
    expect((await today()).importKwh).toBe(5);
  });

  test("a month-to-date window swaps today's slice, keeping the earlier days", async () => {
    // 3 kWh counted − 1 kWh of it today + the 5 kWh the register actually read.
    liveState.latest = liveImport(5);
    expect((await monthToDate()).importKwh).toBe(7);
  });

  test("a month can never report less energy than the day inside it", async () => {
    // The register leads the rollups, so today's 5 kWh must not be left out of
    // the wider window — which used to report 3 against the day's 5.
    liveState.latest = liveImport(5);
    const [month, day] = [await monthToDate(), await today()];
    expect(month.importKwh).toBeGreaterThanOrEqual(day.importKwh);
  });

  test("the money stays priced from the counter deltas, not the register", async () => {
    liveState.latest = liveImport(5);
    // 3 kWh at 0.30 — a whole-day register can't be split into tariff bands.
    expect((await monthToDate()).importCost).toBeCloseTo(0.9, 10);
  });

  test("a window that starts after midnight takes no override", async () => {
    // The register counts from midnight, so it cannot be apportioned to a
    // window that skips part of the day.
    liveState.latest = liveImport(5);
    const partial = await costOver(
      new Date(midnight.getTime() + 1000),
      todaySeed,
      buckets.slice(1),
    );
    expect(partial.importKwh).toBe(1);
  });

  test("a stale register (yesterday's sample) leaves the window alone", async () => {
    liveState.latest = {
      time: new Date(midnight.getTime() - 3_600_000).toISOString(),
      inverterId: "inv-1",
      metrics: { impToday: 5 },
    };
    expect((await monthToDate()).importKwh).toBe(3);
  });
});
