import type { HourEnergy } from "@SunReye/contracts/energy";
import { type TariffConfig, tariffConfigSchema } from "@SunReye/db/tariff";
import type { CanonicalRole, InverterProfile, InverterSample } from "@SunReye/inverter-core";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { type CostDeps, computeCost, computeCostSeries } from "./cost";
import { withImpliedHourLoad } from "./energy-calc";
import { currentPeriodKey, periodKeysInRange } from "./period-keys";
import { type CounterDeltaRow, type RollupReader, metersLoadEnergy } from "./rollup-reader";

// Pricing is tested against an in-memory reader: the hours and matrix rows are
// what the rollup reader WOULD return, so these tests say nothing about SQL or
// counter chaining — `rollup-reader.test.ts` and `db-tests/` own that. No
// database, no settings, no poll cache: every source arrives through `CostDeps`.

/** The zone these host-local fixtures were written in. */
const HOST_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Minimal profile mapping the given canonical roles → metric keys. */
const profileWith = (roleKeys: Partial<Record<CanonicalRole, string>>): InverterProfile =>
  ({
    id: "inv-1",
    metrics: Object.entries(roleKeys).map(([role, key]) => ({ role, key })),
  }) as unknown as InverterProfile;

/** An hour of energy, zero-filled. */
const hourOf = (time: Date, kwh: Partial<Omit<HourEnergy, "time">>): HourEnergy => ({
  time,
  import: 0,
  export: 0,
  load: 0,
  production: 0,
  batteryDischarge: 0,
  batteryCharge: 0,
  ...kwh,
});

// Flat 0.30/kWh so the money in a computeCost result is readable by eye. The
// standing charge is 0 unless a test swaps `tariff` for one that has it.
const flatTariff: TariffConfig = tariffConfigSchema.parse({
  currency: "EUR",
  standingChargeMonthly: 0,
  import: { defaultPricePerKwh: 0.3 },
  export: { feedInPerKwh: 0.08 },
});
let tariff: TariffConfig = flatTariff;

/** What the reader hands back: per-hour energy, and the delta matrix's rows. */
let hours: HourEnergy[] = [];
let matrixRows: CounterDeltaRow[] = [];
/** The poll cache's sample. */
let liveSample: InverterSample | null = null;
/** Stored day-ahead slots for the §51 rule, already narrowed to the window. */
let spotSlots: Array<{ slotStart: Date; eurPerMwh: number }> = [];
const spotLookup = mock(async () => spotSlots);

/** The matrix's metric → field map, for the two counters these fixtures map. */
const FIELD_BY_ROLE: Record<string, "import" | "export"> = {
  "grid.energy.imported.total": "import",
  "grid.energy.exported.total": "export",
};

/**
 * The reader stand-in. Load is implied for an unmetered profile exactly as the
 * real reader does it, so the hours read like its output.
 */
const reader: RollupReader = {
  bucketEnergy: async (profile) => (metersLoadEnergy(profile) ? hours : withImpliedHourLoad(hours)),
  counterDeltaMatrix: async (profile, opts) => ({
    rows: matrixRows,
    fieldByKey: new Map(
      profile.metrics.flatMap((m) => {
        const field = FIELD_BY_ROLE[m.role as string];
        return field ? [[m.key, field] as const] : [];
      }),
    ),
    periods: periodKeysInRange(opts.from, opts.to, opts.bucket, opts.tz),
  }),
};

/** The deps every call gets: this suite's reader, prices, cache and tariff. */
const deps = (): CostDeps => ({
  context: { tz: HOST_TZ, tariff, target: "inv-1" },
  reader,
  spotSlots: spotLookup,
  liveSample: () => liveSample,
});

beforeEach(() => {
  hours = [];
  matrixRows = [];
  liveSample = null;
  spotSlots = [];
  spotLookup.mockClear();
});

describe("computeCost and the live today registers", () => {
  // Both the lifetime counter and its today twin, so the live overlay applies.
  const profile = profileWith({
    "grid.energy.imported.total": "imp",
    "grid.energy.imported.today": "impToday",
  });

  // Windows are built from the real clock, as computeCost's default `now` is.
  const clock = new Date();
  const midnight = new Date(clock);
  midnight.setHours(0, 0, 0, 0);
  const at = (offsetHours: number) => new Date(midnight.getTime() + offsetHours * 3_600_000);

  // 2 kWh through yesterday evening and 1 kWh since midnight — 3 kWh in the
  // month, 1 kWh of it today.
  const monthHours = [hourOf(at(-2), { import: 2 }), hourOf(at(0), { import: 1 })];

  /** The window's breakdown over the hours the reader will return. */
  const costOver = async (from: Date, read: HourEnergy[]) => {
    hours = read;
    return computeCost(profile, { from, to: new Date(), inverterId: "inv-1" }, deps());
  };
  /** Month-to-date: yesterday's hours and today's. */
  const monthToDate = () =>
    costOver(new Date(midnight.getFullYear(), midnight.getMonth(), 1), monthHours);
  /** Today: only the hours since midnight. */
  const today = () => costOver(midnight, monthHours.slice(1));

  /** A poll-cache sample reading `kwh` on the today twin. */
  const liveImport = (kwh: number): InverterSample => ({
    time: clock.toISOString(),
    inverterId: "inv-1",
    metrics: { impToday: kwh },
  });

  test("without a live sample both windows stay on the counter deltas", async () => {
    expect((await monthToDate()).importKwh).toBe(3);
    expect((await today()).importKwh).toBe(1);
  });

  test("the today window reports the live register", async () => {
    liveSample = liveImport(5);
    expect((await today()).importKwh).toBe(5);
  });

  test("a month-to-date window swaps today's slice, keeping the earlier days", async () => {
    // 3 kWh counted − 1 kWh of it today + the 5 kWh the register actually read.
    liveSample = liveImport(5);
    expect((await monthToDate()).importKwh).toBe(7);
  });

  test("a month can never report less energy than the day inside it", async () => {
    // The register leads the rollups, so today's 5 kWh must not be left out of
    // the wider window — which used to report 3 against the day's 5.
    liveSample = liveImport(5);
    const [month, day] = [await monthToDate(), await today()];
    expect(month.importKwh).toBeGreaterThanOrEqual(day.importKwh);
  });

  test("today's money follows the register at the slice's effective rate", async () => {
    liveSample = liveImport(5);
    // Yesterday's 2 kWh stay at 0.30; today's 1 kWh delta (0.30) becomes the
    // register's 5 kWh at the same effective rate — 0.60 + 1.50.
    expect((await monthToDate()).importCost).toBeCloseTo(2.1, 10);
    expect((await today()).importCost).toBeCloseTo(1.5, 10);
  });

  test("a register the deltas have not seen yet is priced at the current band", async () => {
    // No hours since midnight: the only price available is the tariff's own.
    liveSample = liveImport(2);
    const early = await costOver(midnight, []);
    expect(early.importKwh).toBe(2);
    expect(early.importCost).toBeCloseTo(0.6, 10);
  });

  test("a window that starts after midnight takes no override", async () => {
    // The register counts from midnight, so it cannot be apportioned to a
    // window that skips part of the day.
    liveSample = liveImport(5);
    const partial = await costOver(new Date(midnight.getTime() + 1000), monthHours.slice(1));
    expect(partial.importKwh).toBe(1);
  });

  test("a stale register (yesterday's sample) leaves the window alone", async () => {
    liveSample = {
      time: new Date(midnight.getTime() - 3_600_000).toISOString(),
      inverterId: "inv-1",
      metrics: { impToday: 5 },
    };
    expect((await monthToDate()).importKwh).toBe(3);
  });

  test("the plant zone and the target come from the context, read through the reader", async () => {
    const bucketEnergy = mock(reader.bucketEnergy);
    const plant = { plant: [{ id: 1, slug: "inv-1", weight: 1 }] };
    await computeCost(
      profile,
      { from: midnight, to: new Date() },
      {
        ...deps(),
        context: { tz: "Asia/Kolkata", tariff, target: plant },
        reader: { ...reader, bucketEnergy },
      },
    );
    const [, target, , , view, tz] = bucketEnergy.mock.calls[0] ?? [];
    expect(target).toBe(plant);
    expect(view).toBe("hourly_rollups");
    expect(tz).toBe("Asia/Kolkata");
  });
});

describe("computeCost — an unmetered house load", () => {
  // Grid-tied: production and grid flow metered with their today twins, nothing
  // counting the house.
  const gridTied = profileWith({
    "grid.energy.imported.total": "imp",
    "grid.energy.exported.total": "exp",
    "production.total": "prod",
    "grid.energy.imported.today": "impToday",
    "grid.energy.exported.today": "expToday",
    "production.today": "prodToday",
  });

  const clock = new Date();
  const midnight = new Date(clock);
  midnight.setHours(0, 0, 0, 0);

  const todayWith = async (metrics: Record<string, number>) => {
    liveSample = { time: clock.toISOString(), inverterId: "inv-1", metrics };
    hours = [hourOf(midnight, { import: 1, export: 2, production: 5 })];
    return computeCost(gridTied, { from: midnight, to: new Date(), inverterId: "inv-1" }, deps());
  };

  test("the reported consumption follows the live registers it was implied from", async () => {
    // The live swap moves import/export/production; a load implied from the
    // pre-swap deltas would then contradict the numbers next to it on the tile.
    const totals = await todayWith({ impToday: 2, expToday: 3, prodToday: 12 });
    expect(totals.loadKwh).toBeCloseTo(11, 10);
    expect(totals.selfSufficiency).toBeCloseTo(9 / 11, 10);
  });

  test("savings are priced against the implied consumption, not against zero", async () => {
    // gridOnlyCost is what the house would have cost bought entirely from the
    // grid — 0 for an unmetered plant before this, so its whole savings tile
    // read 0.
    const totals = await todayWith({ impToday: 2, expToday: 3, prodToday: 12 });
    expect(totals.gridOnlyCost).toBeGreaterThan(0);
    expect(totals.savings).toBeGreaterThan(0);
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

  /** Today's breakdown with the given live `*.today` registers on the poll cache. */
  const todayWith = async (metrics: Record<string, number>) => {
    liveSample = { time: clock.toISOString(), inverterId: "inv-1", metrics };
    hours = [hourOf(midnight, { import: 1, export: 2, load: 4, production: 5 })];
    return computeCost(profile, { from: midnight, to: new Date(), inverterId: "inv-1" }, deps());
  };

  test("the ratios are recomputed from the reported energy, not left on the deltas", async () => {
    const totals = await todayWith({ impToday: 2, expToday: 3, loadToday: 10, prodToday: 12 });
    expect(totals.importKwh).toBe(2);
    expect(totals.loadKwh).toBe(10);
    // (10 − 2) / 10 and (12 − 3) / 12 — the deltas would have said 0.75 / 0.6.
    expect(totals.solarToLoadKwh).toBe(8);
    expect(totals.selfSufficiency).toBeCloseTo(0.8, 10);
    expect(totals.selfConsumption).toBeCloseTo(0.75, 10);
    // Money follows the registers at the deltas' effective rate: 2 kWh at 0.30,
    // 3 kWh at 0.08, and the house's 10 kWh at 0.30 had it all been bought.
    expect(totals.importCost).toBeCloseTo(0.6, 10);
    expect(totals.exportEarnings).toBeCloseTo(0.24, 10);
    expect(totals.gridOnlyCost).toBeCloseTo(3.0, 10);
    expect(totals.solarSavings).toBeCloseTo(2.4, 10);
    expect(totals.savings).toBeCloseTo(2.64, 10);
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
  /** `kwh` exported in the local hour `h`. */
  const exportedAt = (h: number, kwh: number) => hourOf(day(h), { export: kwh });
  /** Quarter-hourly day-ahead prices for one local hour, in €/MWh. */
  const slotsAt = (h: number, prices: number[], date = day(h)) =>
    prices.map((eurPerMwh, i) => ({
      slotStart: new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, i * 15),
      eurPerMwh,
    }));

  /** The day's breakdown over the given hours. */
  const costOverDay = (read: HourEnergy[]) => {
    hours = read;
    return computeCost(exportProfile, { from: day(0), to: day(23), inverterId: "inv-1" }, deps());
  };

  afterEach(() => {
    tariff = flatTariff;
  });

  test("a plant that never opted in pays for no price lookup", async () => {
    const totals = await costOverDay([exportedAt(13, 4)]);
    expect(spotLookup).not.toHaveBeenCalled();
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
    expect(spotLookup).not.toHaveBeenCalled();
    expect(totals.zeroValueExportKwh).toBe(0);
  });

  test("with no prices stored for the window, export is paid as usual", async () => {
    tariff = eegTariff;
    const totals = await costOverDay([exportedAt(13, 4)]);
    // It looked at the price feed — and found nothing recorded for the window.
    expect(spotLookup).toHaveBeenCalledWith(day(0), day(23));
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
    const totals = await costOverDay([exportedAt(12, 4), exportedAt(13, 4)]);
    expect(totals.exportKwh).toBeCloseTo(8, 10);
    expect(totals.zeroValueExportKwh).toBeCloseTo(4, 10);
    expect(totals.exportEarnings).toBeCloseTo(0.32, 10);
  });

  test("a month of §51 exports is priced per day and rolled back up to one bar", async () => {
    // A month bucket alone cannot say which 13:00 a row belongs to, so the
    // series drops to day granularity and rolls the priced days up.
    tariff = eegTariff;
    spotSlots = slotsAt(13, [-5, -5, -5, -5], new Date(2024, 5, 15));
    matrixRows = [
      { period: "2024-06-15", hod: 13, dow: 6, metric: "exp", kwh: 4 },
      { period: "2024-06-16", hod: 13, dow: 7, metric: "exp", kwh: 4 },
    ];
    const points = await computeCostSeries(
      exportProfile,
      {
        from: new Date(2024, 5, 1),
        to: new Date(2024, 6, 1),
        bucket: "month",
        inverterId: "inv-1",
      },
      deps(),
    );
    expect(points.map((p) => p.bucket)).toEqual(["2024-06"]);
    // The 15th's export earned nothing; the 16th's — unpriced — was paid.
    expect(points[0]?.zeroValueExportKwh).toBeCloseTo(4, 10);
    expect(points[0]?.zeroValueExportEur).toBeCloseTo(0.32, 10);
    expect(points[0]?.exportEarnings).toBeCloseTo(0.32, 10);
  });

  test("without §51 a month request stays grouped by month", async () => {
    matrixRows = [{ period: "2024-06", hod: 13, dow: 6, metric: "exp", kwh: 4 }];
    const points = await computeCostSeries(
      exportProfile,
      {
        from: new Date(2024, 5, 1),
        to: new Date(2024, 6, 1),
        bucket: "month",
        inverterId: "inv-1",
      },
      deps(),
    );
    expect(points.map((p) => p.bucket)).toEqual(["2024-06"]);
    expect(points[0]?.exportEarnings).toBeCloseTo(0.32, 10);
    expect(points[0]?.zeroValueExportKwh).toBe(0);
  });
});

describe("computeCostSeries — which periods get a bar", () => {
  const profile = profileWith({ "grid.energy.imported.total": "imp" });

  /** Period keys for a window, with no counter rows behind them. */
  const bucketsFor = async (from: Date, to: Date, bucket: "hour" | "day" | "month") => {
    const points = await computeCostSeries(
      profile,
      { from, to, bucket, inverterId: "inv-1" },
      deps(),
    );
    return points.map((p) => p.bucket);
  };

  test("matches the key currentPeriodKey gives the same period", async () => {
    // The live-register override lands on this key, so it has to be the exact
    // one the delta matrix zero-filled — not merely one that looks like it.
    const days = await bucketsFor(new Date(2026, 7, 1), new Date(2026, 8, 1), "day");
    expect(days).toContain(currentPeriodKey("day", new Date(2026, 7, 2, 14, 30), HOST_TZ));
  });

  test("the matrix is read at the context's zone and target, from the hourly rollups", async () => {
    const counterDeltaMatrix = mock(reader.counterDeltaMatrix);
    await computeCostSeries(
      profile,
      { from: new Date(2026, 7, 1), to: new Date(2026, 8, 1), bucket: "day" },
      {
        ...deps(),
        context: { tz: "America/New_York", tariff, target: "inv-2" },
        reader: { ...reader, counterDeltaMatrix },
      },
    );
    const opts = counterDeltaMatrix.mock.calls[0]?.[1];
    expect(opts?.tz).toBe("America/New_York");
    expect(opts?.inverterId).toBe("inv-2");
    expect(opts?.view).toBe("hourly_rollups");
  });

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
      const points = await computeCostSeries(
        profile,
        { from, to, bucket: "day", inverterId: "inv-1" },
        deps(),
      );
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
