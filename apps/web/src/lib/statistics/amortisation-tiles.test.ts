import { describe, expect, test } from "bun:test";
import type { AmortisationResponse } from "@SunReye/contracts/statistics";
import { costFormatters } from "../cost/format";
import { AMORTISATION_TILES, deriveTiles } from "./tiles";

const f = costFormatters("EUR");

/** Two years in, a fifth of the way to paying off a 10 000 € plant. */
const response = (over: Partial<AmortisationResponse> = {}): AmortisationResponse => ({
  currency: "EUR",
  configured: true,
  investment: { totalCost: 10_000, commissionedOn: "2024-05-17" },
  since: "2024-05-17",
  elapsedDays: 730,
  lifetime: {
    importKwh: 2_000,
    exportKwh: 6_000,
    productionKwh: 12_000,
    loadKwh: 7_000,
    selfConsumedKwh: 5_000,
  },
  rates: { importPrice: 0.3, exportPrice: 0.08 },
  importSavings: 1_500,
  exportEarnings: 480,
  savings: 1_980,
  progress: 0.198,
  remaining: 8_020,
  elapsedYears: 730 / 365.25,
  weighting: "calendar",
  seasonalGaps: ["arrays"],
  annualRate: 1_980 / (730 / 365.25),
  paidOff: false,
  paybackDate: "2034-06-20T00:00:00.000Z",
  paybackYears: 10.1,
  ...over,
});

const find = (r: AmortisationResponse, id: string) =>
  deriveTiles(AMORTISATION_TILES, r, f).find((t) => t.id === id);
/** The resolved tile, or a failure naming the one that is missing. */
const byId = (r: AmortisationResponse, id: string) => {
  const tile = find(r, id);
  if (!tile) throw new Error(`tile ${id} missing`);
  return tile;
};

describe("AMORTISATION_TILES registry", () => {
  test("declares the eight tiles in render order", () => {
    expect(deriveTiles(AMORTISATION_TILES, response(), f).map((t) => t.id)).toEqual([
      "amortisation.invested",
      "amortisation.savings",
      "amortisation.progress",
      "amortisation.payback",
      "amortisation.yearlyRate",
      "amortisation.monthlyRate",
      "amortisation.yearlyExport",
      "amortisation.selfConsumed",
    ]);
  });

  test("the per-year tiles spread the lifetime figures over the elapsed days", () => {
    const r = response();
    // 1 980 over 730 / 365.25 years ≈ 990.7 a year.
    expect(byId(r, "amortisation.yearlyRate").value).toBe(f.money(1_980 / (730 / 365.25)));
    // 480 € of feed-in over the same years, and 6 000 kWh with it.
    expect(byId(r, "amortisation.yearlyExport").value).toBe(f.money(480 / (730 / 365.25)));
    expect(byId(r, "amortisation.yearlyExport").sub).toContain(f.kwh(6_000 / (730 / 365.25)));
  });

  test("solar weighting spreads the same figures over solar years and says so", () => {
    const r = response({
      weighting: "solar",
      seasonalGaps: [],
      elapsedYears: 1.8,
      annualRate: 1_980 / 1.8,
    });
    expect(byId(r, "amortisation.yearlyRate").value).toBe(f.money(1_980 / 1.8));
    expect(byId(r, "amortisation.yearlyExport").value).toBe(f.money(480 / 1.8));
    expect(byId(r, "amortisation.yearlyRate").sub).not.toBe(
      byId(response(), "amortisation.yearlyRate").sub,
    );
  });

  test("the headline figures are money, percent, a date and kWh", () => {
    const r = response();
    expect(byId(r, "amortisation.invested").value).toBe(f.money(10_000));
    expect(byId(r, "amortisation.savings").value).toBe(f.money(1_980));
    expect(byId(r, "amortisation.savings").sub).toContain(f.money(1_500));
    expect(byId(r, "amortisation.savings").sub).toContain(f.money(480));
    expect(byId(r, "amortisation.progress").value).toBe("20%");
    expect(byId(r, "amortisation.progress").sub).toContain(f.money(8_020));
    expect(byId(r, "amortisation.payback").value).toContain("2034");
    expect(byId(r, "amortisation.payback").sub).toContain("10.1");
    // A twelfth of the annual rate.
    expect(byId(r, "amortisation.monthlyRate").value).toBe(f.money(1_980 / (730 / 365.25) / 12));
    // Self-consumption per year, against the house's consumption per year.
    expect(byId(r, "amortisation.selfConsumed").value).toBe(f.kwh(5_000 / (730 / 365.25)));
    expect(byId(r, "amortisation.selfConsumed").sub).toContain(f.kwh(7_000 / (730 / 365.25)));
  });

  test("savings turn green when positive", () => {
    expect(byId(response(), "amortisation.savings").accent).toBe("text-sign-good");
    expect(byId(response({ savings: -1 }), "amortisation.savings").accent).toBe("");
  });

  test("an unconfigured plant keeps the savings and drops the investment tiles", () => {
    const r = response({
      configured: false,
      investment: { totalCost: 0, commissionedOn: null },
      progress: null,
      remaining: null,
      paybackDate: null,
      paybackYears: null,
    });
    expect(deriveTiles(AMORTISATION_TILES, r, f).map((t) => t.id)).toEqual([
      "amortisation.savings",
      "amortisation.yearlyRate",
      "amortisation.monthlyRate",
      "amortisation.yearlyExport",
      "amortisation.selfConsumed",
    ]);
  });

  test("a paid-off plant says so instead of projecting a date", () => {
    const r = response({
      paidOff: true,
      progress: 1,
      remaining: 0,
      paybackDate: null,
      paybackYears: 4.2,
    });
    expect(byId(r, "amortisation.payback").value).not.toContain("20");
    expect(byId(r, "amortisation.payback").sub).toContain("4.2");
    expect(byId(r, "amortisation.progress").value).toBe("100%");
  });

  test("without a daily rate the payback and per-period tiles are absent", () => {
    const r = response({
      annualRate: null,
      elapsedYears: 0,
      paybackDate: null,
      paybackYears: null,
      since: null,
      elapsedDays: 0,
    });
    expect(find(r, "amortisation.payback")).toBeUndefined();
    expect(find(r, "amortisation.monthlyRate")).toBeUndefined();
    expect(find(r, "amortisation.yearlyRate")).toBeUndefined();
    expect(find(r, "amortisation.yearlyExport")).toBeUndefined();
    // The self-consumption tile stays, as lifetime totals.
    expect(byId(r, "amortisation.selfConsumed").value).toBe(f.kwh(5_000));
    expect(byId(r, "amortisation.selfConsumed").sub).toContain(f.kwh(6_000));
  });

  test("consumption is annualised by the calendar even under solar weighting", () => {
    // 205 summer days worth 0.72 solar years: the solar figure is spread over
    // 0.72 years, the house's consumption over 205 / 365.25 calendar years.
    const r = response({
      weighting: "solar",
      seasonalGaps: [],
      elapsedDays: 205,
      elapsedYears: 0.72,
      annualRate: 1_980 / 0.72,
      lifetime: { ...response().lifetime, selfConsumedKwh: 5_190, loadKwh: 5_660 },
    });
    expect(byId(r, "amortisation.selfConsumed").value).toBe(f.kwh(5_190 / 0.72));
    expect(byId(r, "amortisation.selfConsumed").sub).toContain(f.kwh((5_660 / 205) * 365.25));
  });

  test("an unmetered house shows the export per year beside its self-consumption", () => {
    const r = response({ lifetime: { ...response().lifetime, loadKwh: 0 } });
    expect(byId(r, "amortisation.selfConsumed").sub).toContain(f.kwh(6_000 / (730 / 365.25)));
  });

  test("under a full year the annualised tiles say they are projected and go grey", () => {
    const r = response({
      elapsedDays: 120,
      elapsedYears: 120 / 365.25,
      annualRate: 1_980 / (120 / 365.25),
    });
    for (const id of [
      "amortisation.yearlyRate",
      "amortisation.monthlyRate",
      "amortisation.yearlyExport",
      "amortisation.payback",
      "amortisation.selfConsumed",
    ]) {
      expect(byId(r, id).sub).toContain("120");
      expect(byId(r, id).accent).toBe("text-muted-foreground");
    }
    // The lifetime figures are facts, not projections.
    expect(byId(r, "amortisation.savings").accent).toBe("text-sign-good");
    expect(byId(r, "amortisation.savings").sub).not.toContain("120");
  });

  test("after a full year the projection note is gone and the accents return", () => {
    const r = response(); // 730 days
    expect(byId(r, "amortisation.yearlyRate").sub).not.toContain("730");
    expect(byId(r, "amortisation.yearlyRate").accent).toBe("");
    const paid = response({
      paidOff: true,
      progress: 1,
      remaining: 0,
      paybackDate: null,
      paybackYears: 4.2,
    });
    expect(byId(paid, "amortisation.payback").accent).toBe("text-sign-good");
  });

  test("the delta chip never fires: these figures have no reference window", () => {
    for (const def of AMORTISATION_TILES) expect(def.raw(response())).toBeNull();
  });
});
