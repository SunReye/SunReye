import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type TariffConfig, tariffConfigSchema } from "@SunReye/db/tariff";
import type { HourEnergy } from "../energy/cost-calc";
import {
  type SpotDailyRow,
  type SpotPriceSlot,
  groupNegativeWindows,
  hourlyAveragePrices,
  paidVsMarket,
  spotDailyStats,
  spotWhatIf,
} from "./spot-stats-calc";

// The what-if reads local hour/weekday for band matching; pin the zone so the
// band assertions don't depend on the machine. Bun applies TZ at runtime.
const ORIGINAL_TZ = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "Europe/Berlin";
});
afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

const MINUTE_MS = 60_000;

/** A quarter-hour slot chain starting at `startMs`, one entry per price. */
function slots(startMs: number, minutes: number, prices: number[]): SpotPriceSlot[] {
  return prices.map((eurPerMwh, i) => ({
    startMs: startMs + i * minutes * MINUTE_MS,
    minutes,
    eurPerMwh,
  }));
}

const dailyRow = (over: Partial<SpotDailyRow> & { date: string }): SpotDailyRow => ({
  minEurPerMwh: 0,
  maxEurPerMwh: 0,
  slots: 0,
  negativeSlots: 0,
  priceMinutes: 0,
  minutes: 0,
  negativeMinutes: 0,
  ...over,
});

const hour = (time: Date, importKwh: number): HourEnergy => ({
  time,
  import: importKwh,
  export: 0,
  load: 0,
  production: 0,
  batteryDischarge: 0,
  batteryCharge: 0,
});

describe("spotDailyStats", () => {
  test("averages each day by slot width, not slot count", () => {
    // 60 minutes at 100 plus 60 minutes at 0 → 50, even though the second day
    // half is four quarter-hours against one hour.
    const { daily } = spotDailyStats([
      dailyRow({
        date: "2025-06-01",
        minEurPerMwh: 0,
        maxEurPerMwh: 100,
        slots: 5,
        priceMinutes: 100 * 60,
        minutes: 120,
      }),
    ]);
    expect(daily[0]?.avgEurPerMwh).toBe(50);
  });

  test("summary rolls the days up and reports negative HOURS from the widths", () => {
    const { summary } = spotDailyStats([
      dailyRow({
        date: "2025-06-01",
        minEurPerMwh: -20,
        maxEurPerMwh: 80,
        slots: 96,
        negativeSlots: 8,
        priceMinutes: 40 * 1440,
        minutes: 1440,
        negativeMinutes: 120,
      }),
      dailyRow({
        date: "2025-06-02",
        minEurPerMwh: 10,
        maxEurPerMwh: 200,
        slots: 96,
        priceMinutes: 60 * 1440,
        minutes: 1440,
      }),
    ]);
    expect(summary).toEqual({
      avgEurPerMwh: 50,
      minEurPerMwh: -20,
      maxEurPerMwh: 200,
      slots: 192,
      negativeSlots: 8,
      negativeHours: 2,
    });
  });

  test("no stored slot in the window → no summary", () => {
    expect(spotDailyStats([])).toEqual({ daily: [], summary: null });
  });
});

describe("groupNegativeWindows", () => {
  const start = Date.UTC(2025, 5, 1, 10, 0, 0);

  test("merges consecutive negative slots into one window", () => {
    const windows = groupNegativeWindows(slots(start, 15, [5, -3, -8, -1, 4]));
    expect(windows).toEqual([
      {
        start: new Date(start + 15 * MINUTE_MS).toISOString(),
        end: new Date(start + 60 * MINUTE_MS).toISOString(),
        minEurPerMwh: -8,
        slots: 3,
      },
    ]);
  });

  test("zero is not negative — §51 triggers strictly below zero", () => {
    expect(groupNegativeWindows(slots(start, 15, [0, 0]))).toEqual([]);
  });

  test("a gap splits a run: the missing slot is unknown, not negative", () => {
    const windows = groupNegativeWindows([
      { startMs: start, minutes: 15, eurPerMwh: -1 },
      // 15 minutes skipped
      { startMs: start + 30 * MINUTE_MS, minutes: 15, eurPerMwh: -2 },
    ]);
    expect(windows).toHaveLength(2);
    expect(windows[1]?.minEurPerMwh).toBe(-2);
  });

  test("a run open at the end of the slice is still emitted", () => {
    expect(groupNegativeWindows(slots(start, 60, [-4]))).toEqual([
      {
        start: new Date(start).toISOString(),
        end: new Date(start + 60 * MINUTE_MS).toISOString(),
        minEurPerMwh: -4,
        slots: 1,
      },
    ]);
  });
});

describe("hourlyAveragePrices", () => {
  test("collapses quarter-hours onto their epoch hour, weighted by width", () => {
    const start = Date.UTC(2025, 5, 1, 10, 0, 0);
    const byHour = hourlyAveragePrices(slots(start, 15, [0, 40, 60, 100, 20]));
    expect(byHour.get(start)).toBe(50);
    expect(byHour.get(start + 3_600_000)).toBe(20);
  });
});

describe("paidVsMarket", () => {
  const start = Date.UTC(2025, 5, 1, 10, 0, 0);
  const priceByHour = new Map([
    [start, 100],
    [start + 3_600_000, 0],
  ]);

  test("weights import by the hour's market price", () => {
    const result = paidVsMarket(
      [hour(new Date(start), 1), hour(new Date(start + 3_600_000), 3)],
      priceByHour,
    );
    expect(result).toEqual({
      importKwh: 4,
      importWeightedAvgEurPerMwh: 25,
      coverage: 1,
    });
  });

  test("coverage reports the share of import that had a price", () => {
    const unpriced = new Date(start + 10 * 3_600_000);
    const result = paidVsMarket([hour(new Date(start), 1), hour(unpriced, 3)], priceByHour);
    expect(result?.importKwh).toBe(4);
    expect(result?.coverage).toBe(0.25);
  });

  test("null without prices, and null when nothing was imported in a priced hour", () => {
    expect(paidVsMarket([hour(new Date(start), 1)], new Map())).toBeNull();
    expect(paidVsMarket([hour(new Date(start), 0)], priceByHour)).toBeNull();
  });
});

describe("spotWhatIf", () => {
  const start = Date.UTC(2025, 5, 1, 10, 0, 0);
  const tariff: TariffConfig = tariffConfigSchema.parse({
    import: {
      defaultPricePerKwh: 0.3,
      spot: { supplierMarkupPerKwh: 0.02, gridFeesPerKwh: 0.08, vatPercent: 19 },
    },
  });

  test("prices the same import under both models", () => {
    const result = spotWhatIf([hour(new Date(start), 2)], tariff, new Map([[start, 100]]));
    // Landed: (100/1000 + 0.02 + 0.08) × 1.19 = 0.238 per kWh.
    expect(result?.staticCost).toBeCloseTo(0.6, 10);
    expect(result?.spotCost).toBeCloseTo(0.476, 10);
    expect(result?.delta).toBeCloseTo(-0.124, 10);
    expect(result?.spotComponentsConfigured).toBe(true);
    expect(result?.coverage).toBe(1);
  });

  test("an unpriced hour falls back to the band on both sides, so it cancels", () => {
    const unpriced = new Date(start + 5 * 3_600_000);
    const result = spotWhatIf(
      [hour(new Date(start), 2), hour(unpriced, 10)],
      tariff,
      new Map([[start, 100]]),
    );
    // The 10 kWh hour adds 3.00 to BOTH totals; the delta is unchanged.
    expect(result?.delta).toBeCloseTo(-0.124, 10);
    expect(result?.coverage).toBeCloseTo(2 / 12, 10);
  });

  test("bare wholesale is flagged so the UI can caption it", () => {
    const bare = tariffConfigSchema.parse({ import: { defaultPricePerKwh: 0.3 } });
    const result = spotWhatIf([hour(new Date(start), 1)], bare, new Map([[start, 100]]));
    expect(result?.spotComponentsConfigured).toBe(false);
    expect(result?.spotCost).toBeCloseTo(0.1, 10);
  });

  test("null without prices, and null when nothing was imported", () => {
    expect(spotWhatIf([hour(new Date(start), 5)], tariff, new Map())).toBeNull();
    expect(spotWhatIf([hour(new Date(start), 0)], tariff, new Map([[start, 100]]))).toBeNull();
  });
});
