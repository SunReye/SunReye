import type { EnergyTotals } from "@SunReye/contracts/energy";
import { describe, expect, test } from "bun:test";
import { type AmortisationInputs, amortisation } from "./amortisation-calc";

const DAY_MS = 86_400_000;

const lifetime = (over: Partial<EnergyTotals> = {}): EnergyTotals => ({
  importKwh: 2_000,
  exportKwh: 6_000,
  loadKwh: 7_000,
  productionKwh: 12_000,
  batteryDischargeKwh: 0,
  batteryChargeKwh: 0,
  ...over,
});

/** Two years to the day after commissioning, at a flat 0.30 / 0.08. */
const now = new Date("2026-05-17T12:00:00Z");
const base: AmortisationInputs = {
  currency: "EUR",
  investment: { totalCost: 10_000, commissionedOn: "2024-05-17" },
  lifetime: lifetime(),
  metersLoad: true,
  rates: { importPrice: 0.3, exportPrice: 0.08 },
  recordedSince: new Date("2025-01-01T00:00:00Z"),
  solarYears: null,
  seasonalGaps: ["arrays"],
  now,
};

describe("amortisation", () => {
  test("prices the lifetime counters at the flat rates", () => {
    const r = amortisation(base);
    // Self-consumed = load − import = 5 000 kWh at 0.30; 6 000 kWh exported at 0.08.
    expect(r.lifetime.selfConsumedKwh).toBe(5_000);
    expect(r.importSavings).toBeCloseTo(1_500, 10);
    expect(r.exportEarnings).toBeCloseTo(480, 10);
    expect(r.savings).toBeCloseTo(1_980, 10);
    expect(r.currency).toBe("EUR");
    expect(r.rates).toEqual({ importPrice: 0.3, exportPrice: 0.08 });
  });

  test("an unmetered house counts production − export as self-consumed", () => {
    const r = amortisation({ ...base, metersLoad: false, lifetime: lifetime({ loadKwh: 0 }) });
    expect(r.lifetime.selfConsumedKwh).toBe(6_000);
  });

  test("registers that lead each other never yield negative self-consumption", () => {
    const r = amortisation({ ...base, lifetime: lifetime({ loadKwh: 1_000, importKwh: 2_000 }) });
    expect(r.lifetime.selfConsumedKwh).toBe(0);
    expect(r.importSavings).toBe(0);
  });

  test("progress, remaining and the projected payback follow the daily rate", () => {
    const r = amortisation(base);
    expect(r.configured).toBe(true);
    expect(r.since).toBe("2024-05-17");
    // 2024-05-17 → 2026-05-17 is 730 days (2024 is a leap year, Feb 29 is before May).
    expect(r.elapsedDays).toBe(730);
    expect(r.weighting).toBe("calendar");
    expect(r.seasonalGaps).toEqual(["arrays"]);
    expect(r.elapsedYears).toBeCloseTo(730 / 365.25, 10);
    expect(r.progress).toBeCloseTo(0.198, 10);
    expect(r.remaining).toBeCloseTo(8_020, 10);
    expect(r.annualRate).toBeCloseTo(1_980 / (730 / 365.25), 10);
    expect(r.paidOff).toBe(false);
    // 8 020 / (1 980 / 730) ≈ 2 956.77 days from now.
    const days = 8_020 / (1_980 / 730);
    expect(new Date(r.paybackDate ?? "").getTime()).toBeCloseTo(now.getTime() + days * DAY_MS, -4);
    expect(r.paybackYears).toBeCloseTo((730 + days) / 365.25, 6);
  });

  test("a plant that has paid for itself reports full progress and no payback date", () => {
    const r = amortisation({
      ...base,
      investment: { totalCost: 1_000, commissionedOn: "2024-05-17" },
    });
    expect(r.paidOff).toBe(true);
    expect(r.progress).toBe(1);
    expect(r.remaining).toBe(0);
    expect(r.paybackDate).toBeNull();
    // It paid off at 1 000 / (1 980 / 730) days after commissioning.
    expect(r.paybackYears).toBeCloseTo(1_000 / (1_980 / 730) / 365.25, 6);
  });

  test("without a total cost the plant is unconfigured but the savings still show", () => {
    const r = amortisation({ ...base, investment: { totalCost: 0, commissionedOn: null } });
    expect(r.configured).toBe(false);
    expect(r.savings).toBeCloseTo(1_980, 10);
    expect(r.progress).toBeNull();
    expect(r.remaining).toBeNull();
    expect(r.paybackDate).toBeNull();
    expect(r.paybackYears).toBeNull();
    expect(r.paidOff).toBe(false);
  });

  test("without a commissioning day the rate runs from the first recorded day", () => {
    const r = amortisation({ ...base, investment: { totalCost: 10_000, commissionedOn: null } });
    expect(r.since).toBe("2025-01-01T00:00:00.000Z");
    expect(r.elapsedDays).toBe(501);
    expect(r.annualRate).toBeCloseTo(1_980 / (501 / 365.25), 10);
  });

  test("with neither date the rate and payback are unknowable", () => {
    const r = amortisation({
      ...base,
      investment: { totalCost: 10_000, commissionedOn: null },
      recordedSince: null,
    });
    expect(r.since).toBeNull();
    expect(r.elapsedDays).toBe(0);
    expect(r.elapsedYears).toBe(0);
    expect(r.annualRate).toBeNull();
    expect(r.paybackDate).toBeNull();
    expect(r.paybackYears).toBeNull();
    // Progress does not need a date.
    expect(r.progress).toBeCloseTo(0.198, 10);
  });

  test("a plant commissioned today has no daily rate yet", () => {
    const r = amortisation({
      ...base,
      investment: { totalCost: 10_000, commissionedOn: "2026-05-17" },
    });
    expect(r.elapsedDays).toBe(0);
    expect(r.annualRate).toBeNull();
    expect(r.paybackDate).toBeNull();
  });

  test("solar years replace the calendar for every annualised figure", () => {
    // 200 summer days that were worth 0.7 of a solar year: the rate is spread
    // over 0.7 years, not 0.55, and the payback date moves accordingly.
    const r = amortisation({
      ...base,
      investment: { totalCost: 10_000, commissionedOn: "2025-10-29" },
      solarYears: 0.7,
    });
    expect(r.elapsedDays).toBe(200);
    expect(r.weighting).toBe("solar");
    expect(r.seasonalGaps).toEqual([]);
    expect(r.elapsedYears).toBe(0.7);
    expect(r.annualRate).toBeCloseTo(1_980 / 0.7, 10);
    const totalYears = 10_000 / (1_980 / 0.7);
    expect(r.paybackYears).toBeCloseTo(totalYears, 10);
    expect(new Date(r.paybackDate ?? "").getTime()).toBeCloseTo(
      now.getTime() + (totalYears - 0.7) * 365.25 * DAY_MS,
      -4,
    );
  });

  test("solar years on a plant commissioned today still annualise nothing", () => {
    const r = amortisation({
      ...base,
      investment: { totalCost: 10_000, commissionedOn: "2026-05-17" },
      solarYears: 0.003,
    });
    expect(r.elapsedYears).toBe(0);
    expect(r.annualRate).toBeNull();
  });

  test("zero savings means no payback date, not a date at infinity", () => {
    const r = amortisation({ ...base, lifetime: lifetime({ importKwh: 7_000, exportKwh: 0 }) });
    expect(r.savings).toBe(0);
    expect(r.annualRate).toBe(0);
    expect(r.paybackDate).toBeNull();
    expect(r.paybackYears).toBeNull();
  });

  test("a negative rate (rebate tariff) never projects a payback", () => {
    const r = amortisation({ ...base, rates: { importPrice: -0.1, exportPrice: 0 } });
    expect(r.savings).toBeLessThan(0);
    expect(r.progress).toBe(0);
    expect(r.remaining).toBe(10_000);
    expect(r.paybackDate).toBeNull();
  });
});
