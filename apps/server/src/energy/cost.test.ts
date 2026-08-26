import type { EnergyField } from "@SunReye/contracts/energy";
import { spotPrices } from "@SunReye/db/schema/spot-price";
import { type TariffConfig, tariffConfigSchema } from "@SunReye/db/tariff";
import type { CanonicalRole, InverterProfile, InverterSample } from "@SunReye/inverter-core";
import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

/** How an energy figure is derived from stored data — see `ENERGY_ROLE_DERIVATION`. */
type EnergyDerivation = "counter" | "integral";

// cost.ts imports the DB singleton (which eagerly validates server env). Mock it
// so the guard logic can be imported and exercised without a database or a
// populated .env — mirroring inverter.test.ts's approach.
//
// `fetchBucketEnergy` runs two queries — the pre-window baseline, then the
// in-window buckets — so the stub answers from a queue in that order.
//
// The spreads below are load-bearing: `mock.module` is process-global and
// permanent, so a mock returning only the exports THIS suite needs deletes the
// rest for every test file that runs after it. Override what is stubbed, keep
// everything else real.
const realDb = await import("@SunReye/db");
const realSettings = await import("../settings/settings");
const realState = await import("../shared/state");

// ...and the spread alone is not enough: the stubbed exports stay installed for
// every file that loads after this one, so the suites that unit-test these very
// modules would assert against the doubles below. `afterAll` hands them back.
// A module namespace is live — once a mock is installed `realDb.db` IS the stub
// — so the real exports have to be snapshotted BY VALUE here, at load time,
// before any `mock.module` call runs.
const realDbExports = { ...realDb };
const realSettingsExports = { ...realSettings };
const realStateExports = { ...realState };

afterAll(() => {
  mock.module("@SunReye/db", () => ({ ...realDbExports }));
  mock.module("../settings/settings", () => ({ ...realSettingsExports }));
  mock.module("../shared/state", () => ({ ...realStateExports }));
});

let queryResults: Array<Array<Record<string, unknown>>> = [];
const execute = mock(async () => ({ rows: queryResults.shift() ?? [] }));

/**
 * Stored day-ahead slots for the §51 EEG export rule, already narrowed to the
 * window under test — the stub below answers `from(spot_prices)` with them
 * verbatim rather than re-implementing the SQL predicate. Real rows carry more
 * columns; the cost engine reads only these two.
 */
let spotSlots: Array<{ slotStart: Date; eurPerMwh: number }> = [];
/** Tables read through the singleton, so "did it look at prices at all?" is assertable. */
let tablesRead: unknown[] = [];

/**
 * The row-level reads behind the §51 path: the price feed reaches for
 * `spot_prices`, and the bidding zone comes from `app_settings` through the
 * settings accessor (no row → the stored default zone). Kept on this suite's
 * own DB stand-in rather than mocking `@SunReye/db/spot-price`, which the db
 * package's own suite exercises for real.
 */
const select = () => {
  let rows: unknown[] = [];
  const chain = {
    from(table: unknown) {
      tablesRead.push(table);
      rows = table === spotPrices ? spotSlots : [];
      return chain;
    },
    where: () => chain,
    orderBy: async () => rows,
    limit: async () => rows,
  };
  return chain;
};
mock.module("@SunReye/db", () => ({ ...realDb, db: { execute, select } }));

// Flat 0.30/kWh so the money in a computeCost result is readable by eye. The
// standing charge is 0 unless a test swaps `tariff` for one that has it.
const flatTariff: TariffConfig = tariffConfigSchema.parse({
  currency: "EUR",
  standingChargeMonthly: 0,
  import: { defaultPricePerKwh: 0.3 },
  export: { feedInPerKwh: 0.08 },
});
let tariff: TariffConfig = flatTariff;
mock.module("../settings/settings", () => ({ ...realSettings, getTariff: async () => tariff }));

// computeCost reads the poll cache directly (its `sample` argument is only
// injectable one level down), so the cache itself is the stand-in.
const liveState: { latest: InverterSample | null } = { latest: null };
mock.module("../shared/state", () => ({ ...realState, liveState }));

const {
  ENERGY_FIELDS,
  ENERGY_ROLE_DERIVATION,
  computeCost,
  computeCostSeries,
  currentPeriodKey,
  fetchBucketEnergy,
  liveTodayTotals,
} = await import("./cost");

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

describe("computeCost — the live registers keep the tiles coherent", () => {
  // Every counter and its today twin, so the whole overlay applies at once.
  const profile = profileWith({
    "grid.energy.imported.total": "imp",
    "grid.energy.exported.total": "exp",
    "load.energy.total": "load",
    "production.total": "prod",
    "grid.energy.imported.today": "impToday",
    "grid.energy.exported.today": "expToday",
    "load.energy.today": "loadToday",
    "production.today": "prodToday",
  });

  const clock = new Date();
  const midnight = new Date(clock);
  midnight.setHours(0, 0, 0, 0);

  /** One rollup bucket at midnight per metric, counting from zero. */
  const buckets = Object.entries({ imp: 1, exp: 2, load: 4, prod: 5 }).map(([metric, kwh]) => ({
    bucket: midnight.toISOString(),
    metric,
    min_value: 0,
    max_value: kwh,
  }));

  /** Today's breakdown with the given live `*.today` registers on the poll cache. */
  const todayWith = async (metrics: Record<string, number>) => {
    liveState.latest = { time: clock.toISOString(), inverterId: "inv-1", metrics };
    queryResults = [[], buckets];
    return computeCost(profile, { from: midnight, to: new Date(), inverterId: "inv-1" });
  };

  test("the ratios are recomputed from the reported energy, not left on the deltas", async () => {
    const totals = await todayWith({ impToday: 2, expToday: 3, loadToday: 10, prodToday: 12 });
    expect(totals.importKwh).toBe(2);
    expect(totals.loadKwh).toBe(10);
    // (10 − 2) / 10 and (12 − 3) / 12 — the deltas would have said 0.75 / 0.6.
    expect(totals.solarToLoadKwh).toBe(8);
    expect(totals.selfSufficiency).toBeCloseTo(0.8, 10);
    expect(totals.selfConsumption).toBeCloseTo(0.75, 10);
    // Money stays banded from the counter deltas: 1 kWh at 0.30, 2 kWh at 0.08.
    expect(totals.importCost).toBeCloseTo(0.3, 10);
    expect(totals.exportEarnings).toBeCloseTo(0.16, 10);
  });

  test("registers that lead each other never push a ratio below zero", async () => {
    // The import register can be ahead of the load register mid-poll; a raw
    // (load − import) / load would then report negative self-sufficiency.
    const totals = await todayWith({ impToday: 12, expToday: 13, loadToday: 10, prodToday: 12 });
    expect(totals.solarToLoadKwh).toBe(0);
    expect(totals.selfSufficiency).toBe(0);
    expect(totals.selfConsumption).toBe(0);
  });

  test("a negative register reads as zero, not as free energy", async () => {
    // A signed grid register can go below zero; letting it through would report
    // more than 100 % self-sufficiency.
    const totals = await todayWith({ impToday: -1, expToday: 0, loadToday: 10, prodToday: 12 });
    expect(totals.importKwh).toBe(0);
    expect(totals.selfSufficiency).toBe(1);
    expect(totals.selfConsumption).toBe(1);
  });

  test("the first minutes after midnight report no ratio at all", async () => {
    // Nothing consumed and nothing produced yet: the ratios are undefined, and
    // must be null rather than NaN or a confident zero.
    const totals = await todayWith({ impToday: 0, expToday: 0, loadToday: 0, prodToday: 0 });
    expect(totals.loadKwh).toBe(0);
    expect(totals.selfSufficiency).toBeNull();
    expect(totals.selfConsumption).toBeNull();
  });
});

describe("§51 EEG — export that earned nothing", () => {
  const exportProfile = profileWith({ "grid.energy.exported.total": "exp" });

  /** A §51 plant: spot-mode export under the eegFeedIn marketing model. */
  const eegTariff: TariffConfig = tariffConfigSchema.parse({
    currency: "EUR",
    standingChargeMonthly: 0,
    import: { defaultPricePerKwh: 0.3 },
    export: { mode: "spot", feedInPerKwh: 0.08, spot: { marketingModel: "eegFeedIn" } },
  });

  const day = (h: number) => new Date(2024, 5, 15, h);
  /** `kwh` exported in the local hour `h`, as the rollups deliver it: a rise of
   *  the lifetime counter, which stood at `counterAt` entering the hour. */
  const exportedAt = (h: number, kwh: number, counterAt = 0) => ({
    bucket: day(h).toISOString(),
    metric: "exp",
    min_value: counterAt,
    max_value: counterAt + kwh,
  });
  /** Quarter-hourly day-ahead prices for one local hour, in €/MWh. */
  const slotsAt = (h: number, prices: number[], date = day(h)) =>
    prices.map((eurPerMwh, i) => ({
      slotStart: new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, i * 15),
      eurPerMwh,
    }));

  /** The day's breakdown over the given in-window buckets. */
  const costOverDay = (rows: Array<Record<string, unknown>>) => {
    queryResults = [[], rows];
    return computeCost(exportProfile, { from: day(0), to: day(23), inverterId: "inv-1" });
  };

  beforeEach(() => {
    spotSlots = [];
    tablesRead = [];
  });

  afterEach(() => {
    tariff = flatTariff;
  });

  test("a plant that never opted in pays for no price lookup", async () => {
    const totals = await costOverDay([exportedAt(13, 4)]);
    expect(tablesRead).not.toContain(spotPrices);
    expect(totals.exportEarnings).toBeCloseTo(0.32, 10);
    expect(totals.zeroValueExportKwh).toBe(0);
    expect(totals.zeroValueExportEur).toBe(0);
  });

  test("spot export under another marketing model is not §51 either", async () => {
    tariff = tariffConfigSchema.parse({
      currency: "EUR",
      export: { mode: "spot", feedInPerKwh: 0.08, spot: { marketingModel: "direktvermarktung" } },
    });
    const totals = await costOverDay([exportedAt(13, 4)]);
    expect(tablesRead).not.toContain(spotPrices);
    expect(totals.zeroValueExportKwh).toBe(0);
  });

  test("with no prices stored for the window, export is paid as usual", async () => {
    tariff = eegTariff;
    const totals = await costOverDay([exportedAt(13, 4)]);
    // It looked at the price feed — and found nothing recorded for the window.
    expect(tablesRead).toContain(spotPrices);
    expect(totals.exportEarnings).toBeCloseTo(0.32, 10);
    expect(totals.zeroValueExportKwh).toBe(0);
  });

  test("an hour that cleared negative throughout earns nothing", async () => {
    tariff = eegTariff;
    spotSlots = slotsAt(13, [-5, -3, -10, -1]);
    const totals = await costOverDay([exportedAt(13, 4)]);
    expect(totals.exportEarnings).toBe(0);
    expect(totals.zeroValueExportKwh).toBeCloseTo(4, 10);
    // What the rule cost this plant, in money: 4 kWh × 0.08.
    expect(totals.zeroValueExportEur).toBeCloseTo(0.32, 10);
    expect(totals.net).toBeCloseTo(0, 10);
  });

  test("a partly negative hour loses exactly the negative share", async () => {
    tariff = eegTariff;
    spotSlots = slotsAt(13, [-5, 20, 30, 40]); // one quarter-hour of four
    const totals = await costOverDay([exportedAt(13, 4)]);
    expect(totals.zeroValueExportKwh).toBeCloseTo(1, 10);
    expect(totals.exportEarnings).toBeCloseTo(0.24, 10);
  });

  test("a slot that cleared at exactly 0.00 still pays", async () => {
    // §51 triggers strictly below zero; free is not negative.
    tariff = eegTariff;
    spotSlots = slotsAt(13, [0, -5, 0, 0]);
    const totals = await costOverDay([exportedAt(13, 4)]);
    expect(totals.zeroValueExportKwh).toBeCloseTo(1, 10);
    expect(totals.exportEarnings).toBeCloseTo(0.24, 10);
  });

  test("an hourly feed's single slot decides its whole hour", async () => {
    // The share is taken over the slots actually stored, not over a fixed four:
    // an hourly source (aWATTar) publishes one slot per hour, and a negative one
    // means the whole hour earned nothing — not a quarter of it.
    tariff = eegTariff;
    spotSlots = [{ slotStart: day(13), eurPerMwh: -5 }];
    const totals = await costOverDay([exportedAt(13, 4)]);
    expect(totals.zeroValueExportKwh).toBeCloseTo(4, 10);
    expect(totals.exportEarnings).toBe(0);
  });

  test("an hour with no stored price is unknown, not negative", async () => {
    // Hour 12 is priced and negative; hour 13 was never fetched. Treating the
    // gap as negative would silently zero out a day of feed-in revenue.
    tariff = eegTariff;
    spotSlots = slotsAt(12, [-5, -5, -5, -5]);
    const totals = await costOverDay([exportedAt(12, 4), exportedAt(13, 4, 4)]);
    expect(totals.exportKwh).toBeCloseTo(8, 10);
    expect(totals.zeroValueExportKwh).toBeCloseTo(4, 10);
    expect(totals.exportEarnings).toBeCloseTo(0.32, 10);
  });

  test("a month of §51 exports is priced per day and rolled back up to one bar", async () => {
    // A month bucket alone cannot say which 13:00 a row belongs to, so the
    // series drops to day granularity and rolls the priced days up.
    tariff = eegTariff;
    spotSlots = slotsAt(13, [-5, -5, -5, -5], new Date(2024, 5, 15));
    queryResults = [
      [
        { period: "2024-06-15", hod: 13, dow: 6, metric: "exp", kwh: 4 },
        { period: "2024-06-16", hod: 13, dow: 7, metric: "exp", kwh: 4 },
      ],
    ];
    const points = await computeCostSeries(exportProfile, {
      from: new Date(2024, 5, 1),
      to: new Date(2024, 6, 1),
      bucket: "month",
      inverterId: "inv-1",
    });
    expect(points.map((p) => p.bucket)).toEqual(["2024-06"]);
    // The 15th's export earned nothing; the 16th's — unpriced — was paid.
    expect(points[0]?.zeroValueExportKwh).toBeCloseTo(4, 10);
    expect(points[0]?.zeroValueExportEur).toBeCloseTo(0.32, 10);
    expect(points[0]?.exportEarnings).toBeCloseTo(0.32, 10);
  });

  test("without §51 a month request stays grouped by month", async () => {
    queryResults = [[{ period: "2024-06", hod: 13, dow: 6, metric: "exp", kwh: 4 }]];
    const points = await computeCostSeries(exportProfile, {
      from: new Date(2024, 5, 1),
      to: new Date(2024, 6, 1),
      bucket: "month",
      inverterId: "inv-1",
    });
    expect(points.map((p) => p.bucket)).toEqual(["2024-06"]);
    expect(points[0]?.exportEarnings).toBeCloseTo(0.32, 10);
    expect(points[0]?.zeroValueExportKwh).toBe(0);
  });
});

describe("currentPeriodKey", () => {
  test("names the period a moment falls in, at each granularity", () => {
    const at = new Date(2024, 5, 15, 9, 45);
    expect(currentPeriodKey("hour", at)).toBe("2024-06-15T09");
    expect(currentPeriodKey("day", at)).toBe("2024-06-15");
    expect(currentPeriodKey("month", at)).toBe("2024-06");
  });

  test("pads single-digit months, days and hours", () => {
    const at = new Date(2024, 0, 5, 3, 0);
    expect(currentPeriodKey("hour", at)).toBe("2024-01-05T03");
    expect(currentPeriodKey("day", at)).toBe("2024-01-05");
    expect(currentPeriodKey("month", at)).toBe("2024-01");
  });

  test("midnight belongs to the day that starts, not the one that ended", () => {
    expect(currentPeriodKey("hour", new Date(2024, 5, 15, 0, 0, 0))).toBe("2024-06-15T00");
    expect(currentPeriodKey("day", new Date(2024, 5, 15, 23, 59, 59))).toBe("2024-06-15");
  });

  test("an explicit plant zone decides the key, independent of the host zone", () => {
    // 23:30Z on the 15th is 01:30 on the 16th in Berlin — the exact clock
    // disagreement that misfiled a full day onto tomorrow's bar (issues #46/#52).
    // The key reads its zone only from the `tz` argument, so this holds whatever
    // the host zone is (no process.env.TZ mutation — bun caches the zone and a
    // flip would leak into later test files).
    const instant = new Date("2026-08-15T23:30:00Z");
    expect(currentPeriodKey("hour", instant, "Europe/Berlin")).toBe("2026-08-16T01");
    expect(currentPeriodKey("day", instant, "Europe/Berlin")).toBe("2026-08-16");
    expect(currentPeriodKey("month", instant, "Europe/Berlin")).toBe("2026-08");
    // A different plant zone lands on the previous day for the very same instant.
    expect(currentPeriodKey("day", instant, "UTC")).toBe("2026-08-15");
  });

  test("matches the key the series produced for the same period", async () => {
    // The live-register override lands on this key, so it has to be the exact
    // one the delta matrix zero-filled — not merely one that looks like it.
    const now = new Date(2026, 7, 2, 14, 30);
    queryResults = [[]];
    const points = await computeCostSeries(profileWith({ "grid.energy.imported.total": "imp" }), {
      from: new Date(2026, 7, 1),
      to: new Date(2026, 8, 1),
      bucket: "day",
      inverterId: "inv-1",
    });
    expect(points.map((p) => p.bucket)).toContain(currentPeriodKey("day", now));
  });
});

describe("computeCostSeries — which periods get a bar", () => {
  const profile = profileWith({ "grid.energy.imported.total": "imp" });

  /** Period keys for a window, with no counter rows behind them. */
  const bucketsFor = async (from: Date, to: Date, bucket: "hour" | "day" | "month") => {
    queryResults = [[]]; // one query: the delta matrix
    const points = await computeCostSeries(profile, { from, to, bucket, inverterId: "inv-1" });
    return points.map((p) => p.bucket);
  };

  test("a calendar month is every day of it, including days still to come", async () => {
    const days = await bucketsFor(new Date(2026, 7, 1), new Date(2026, 8, 1), "day");
    expect(days).toHaveLength(31);
    expect(days.at(0)).toBe("2026-08-01");
    expect(days.at(-1)).toBe("2026-08-31");
  });

  test("a period the window only clips gets no bar", async () => {
    // What a Europe/Berlin browser sends a UTC server for "this month": 22:00
    // on the previous day. Two hours of July are not a July bar on a chart
    // captioned "this month".
    const from = new Date(Date.UTC(2026, 6, 31, 22));
    const days = await bucketsFor(from, new Date(Date.UTC(2026, 7, 31, 22)), "day");
    expect(days).not.toContain("2026-07-31");
    expect(days.at(0)).toBe("2026-08-01");
  });

  test("but a period the window mostly covers keeps its bar", async () => {
    // The same skew clips the far end by two hours; that day is still the day.
    const days = await bucketsFor(
      new Date(Date.UTC(2026, 6, 31, 22)),
      new Date(Date.UTC(2026, 7, 31, 22)),
      "day",
    );
    expect(days.at(-1)).toBe("2026-08-31");
  });

  test("a window shorter than one period is still that one period", async () => {
    // Today-by-day at 02:00 covers two hours of a day and is the only bar there
    // is — the majority rule must not empty the chart.
    const days = await bucketsFor(new Date(2026, 7, 2), new Date(2026, 7, 2, 2), "day");
    expect(days).toEqual(["2026-08-02"]);
  });

  test("no standing charge is prorated into days that haven't happened", async () => {
    // Exactly 1.00/day. The chart now runs to the end of the month, so the days
    // still to come must carry nothing — otherwise the bars would sum to more
    // standing charge than the tiles report for the month so far.
    tariff = tariffConfigSchema.parse({ currency: "EUR", standingChargeMonthly: 30.4375 });
    try {
      const now = new Date();
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      const to = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      queryResults = [[]];
      const points = await computeCostSeries(profile, {
        from,
        to,
        bucket: "day",
        inverterId: "inv-1",
      });
      const elapsedDays = (now.getTime() - from.getTime()) / 86_400_000;
      const total = points.reduce((sum, p) => sum + p.standingCharge, 0);

      expect(total).toBeCloseTo(elapsedDays, 6);
      // The month's last day is in the future for every day but the last one.
      if (now.getDate() < points.length) expect(points.at(-1)?.standingCharge).toBe(0);
    } finally {
      tariff = flatTariff;
    }
  });
});

/**
 * Issue #115: is a role's energy read from a device counter, or integrated from
 * power samples? The answer is declared by `ENERGY_ROLE_DERIVATION` in `cost.ts`
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
