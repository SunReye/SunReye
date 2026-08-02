import { describe, expect, test } from "bun:test";
import { type EnergyTotals, applyTodayOverride, derivePeriodEnergy } from "./energy-calc";

const totals = (t: Partial<EnergyTotals>): EnergyTotals => ({
  importKwh: 0,
  exportKwh: 0,
  loadKwh: 0,
  productionKwh: 0,
  batteryDischargeKwh: 0,
  batteryChargeKwh: 0,
  ...t,
});

describe("derivePeriodEnergy", () => {
  test("splits consumption into grid vs solar and production into self vs export", () => {
    const m = derivePeriodEnergy(
      "2024-06",
      totals({ importKwh: 1, exportKwh: 4, loadKwh: 5, productionKwh: 10 }),
    );
    expect(m.bucket).toBe("2024-06");
    expect(m.gridToLoadKwh).toBe(1); // min(import, load)
    expect(m.solarToLoadKwh).toBe(4); // load - import
    expect(m.selfConsumedKwh).toBe(6); // production - export
    expect(m.exportedKwh).toBe(4);
    expect(m.selfSufficiency).toBeCloseTo((5 - 1) / 5, 6);
    expect(m.selfConsumption).toBeCloseTo((10 - 4) / 10, 6);
  });

  test("clamps when import exceeds load or export exceeds production", () => {
    const m = derivePeriodEnergy(
      "2024-06-01T14",
      totals({ importKwh: 8, exportKwh: 12, loadKwh: 5, productionKwh: 10 }),
    );
    expect(m.gridToLoadKwh).toBe(5); // capped at load
    expect(m.solarToLoadKwh).toBe(0); // never negative
    expect(m.selfConsumedKwh).toBe(0); // never negative
    expect(m.selfSufficiency).toBe(0);
    expect(m.selfConsumption).toBe(0);
  });

  test("3-way split: battery covers part of the on-site consumption", () => {
    // load 10, import 4 → on-site 6; battery discharged 2 → 2 from battery, 4 direct solar.
    const m = derivePeriodEnergy(
      "2024-06-01T14",
      totals({ importKwh: 4, loadKwh: 10, batteryDischargeKwh: 2 }),
    );
    expect(m.gridToLoadKwh).toBe(4);
    expect(m.solarToLoadKwh).toBe(6); // combined on-site figure kept
    expect(m.batteryToLoadKwh).toBe(2);
    expect(m.solarDirectToLoadKwh).toBe(4);
    // battery + solarDirect subdivide the on-site figure exactly.
    expect(m.batteryToLoadKwh + m.solarDirectToLoadKwh).toBe(m.solarToLoadKwh);
    // 3-way split reconstructs load.
    expect(m.gridToLoadKwh + m.batteryToLoadKwh + m.solarDirectToLoadKwh).toBe(m.loadKwh);
  });

  test("3-way split: battery discharge exceeding on-site is clamped (solarDirect=0)", () => {
    // load 10, import 4 → on-site 6; battery discharged 9 (charge/export losses) → clamp to 6.
    const m = derivePeriodEnergy(
      "2024-06-01T15",
      totals({ importKwh: 4, loadKwh: 10, batteryDischargeKwh: 9 }),
    );
    expect(m.solarToLoadKwh).toBe(6);
    expect(m.batteryToLoadKwh).toBe(6); // clamped to on-site figure
    expect(m.solarDirectToLoadKwh).toBe(0);
    expect(m.gridToLoadKwh + m.batteryToLoadKwh + m.solarDirectToLoadKwh).toBe(m.loadKwh);
  });

  test("3-way split: zero battery discharge → solarDirect is the full on-site figure", () => {
    const m = derivePeriodEnergy(
      "2024-06-01T16",
      totals({ importKwh: 4, loadKwh: 10, batteryDischargeKwh: 0 }),
    );
    expect(m.solarToLoadKwh).toBe(6);
    expect(m.batteryToLoadKwh).toBe(0);
    expect(m.solarDirectToLoadKwh).toBe(6); // graceful: no battery slice
    expect(m.gridToLoadKwh + m.batteryToLoadKwh + m.solarDirectToLoadKwh).toBe(m.loadKwh);
  });

  test("3-way split: negative battery discharge is guarded to 0", () => {
    const m = derivePeriodEnergy(
      "2024-06-01T17",
      totals({ importKwh: 4, loadKwh: 10, batteryDischargeKwh: -3 }),
    );
    expect(m.batteryToLoadKwh).toBe(0);
    expect(m.solarDirectToLoadKwh).toBe(6);
  });

  test("null ratios when the period has no load or no production", () => {
    const m = derivePeriodEnergy("2024-06-01", totals({ importKwh: 2 }));
    expect(m.selfSufficiency).toBeNull();
    expect(m.selfConsumption).toBeNull();
  });

  test("all-zero totals yield a zeroed period with null ratios", () => {
    expect(derivePeriodEnergy("2024-01", totals({}))).toMatchObject({
      bucket: "2024-01",
      loadKwh: 0,
      productionKwh: 0,
      gridToLoadKwh: 0,
      solarToLoadKwh: 0,
      selfConsumedKwh: 0,
      exportedKwh: 0,
      selfSufficiency: null,
      selfConsumption: null,
    });
  });
});

describe("applyTodayOverride", () => {
  const base = totals({ importKwh: 1, exportKwh: 2, loadKwh: 3, productionKwh: 4 });

  test("overrides only the fields present in `today`", () => {
    expect(applyTodayOverride(base, { loadKwh: 8.6, importKwh: 5 })).toEqual({
      importKwh: 5, // overridden
      exportKwh: 2, // kept (absent from today)
      loadKwh: 8.6, // overridden
      productionKwh: 4, // kept (absent from today)
      batteryDischargeKwh: 0, // kept (absent from today)
      batteryChargeKwh: 0, // kept (absent from today)
    });
  });

  test("overrides the battery discharge field from `today`", () => {
    expect(applyTodayOverride(base, { batteryDischargeKwh: 7 })).toMatchObject({
      batteryDischargeKwh: 7, // overridden
      loadKwh: 3, // kept
    });
  });

  test("an explicit zero in `today` still overrides (only undefined is skipped)", () => {
    expect(applyTodayOverride(base, { exportKwh: 0 })).toMatchObject({
      exportKwh: 0,
      importKwh: 1,
    });
  });

  test("empty `today` is the identity (all delta values kept)", () => {
    expect(applyTodayOverride(base, {})).toEqual({ ...base });
  });

  test("does not mutate either input", () => {
    const snapshot = { ...base };
    const today = { loadKwh: 9 };
    const out = applyTodayOverride(base, today);
    expect(base).toEqual(snapshot); // input untouched
    expect(today).toEqual({ loadKwh: 9 }); // override untouched
    expect(out).not.toBe(base); // fresh object
  });
});
