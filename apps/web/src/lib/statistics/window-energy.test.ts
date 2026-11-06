import { describe, expect, test } from "bun:test";
import type { PeriodEnergy } from "@SunReye/contracts/energy";
import { energyBreakdown } from "./window-energy";

const period = (bucket: string, over: Partial<PeriodEnergy> = {}): PeriodEnergy => ({
  bucket,
  importKwh: 0,
  exportKwh: 0,
  loadKwh: 0,
  productionKwh: 0,
  batteryDischargeKwh: 0,
  batteryChargeKwh: 0,
  gridToLoadKwh: 0,
  solarToLoadKwh: 0,
  batteryToLoadKwh: 0,
  solarDirectToLoadKwh: 0,
  selfConsumedKwh: 0,
  exportedKwh: 0,
  selfSufficiency: null,
  selfConsumption: null,
  ...over,
});

const window = { from: new Date("2026-05-01T00:00:00Z"), to: new Date("2026-05-03T00:00:00Z") };

describe("energyBreakdown", () => {
  test("sums every flow over the window's periods and takes the ratios of the sums", () => {
    const got = energyBreakdown(
      [
        period("2026-05-01", {
          importKwh: 3,
          exportKwh: 1,
          loadKwh: 10,
          productionKwh: 8,
          batteryDischargeKwh: 2,
          batteryChargeKwh: 1,
          solarToLoadKwh: 7,
          selfConsumedKwh: 7,
        }),
        period("2026-05-02", {
          importKwh: 5,
          exportKwh: 0,
          loadKwh: 10,
          productionKwh: 2,
          solarToLoadKwh: 5,
          selfConsumedKwh: 2,
        }),
      ],
      window,
    );
    expect(got).toMatchObject({
      importKwh: 8,
      exportKwh: 1,
      loadKwh: 20,
      productionKwh: 10,
      batteryDischargeKwh: 2,
      batteryChargeKwh: 1,
      solarToLoadKwh: 12,
      // 12 of 20 kWh of load came from the plant, 9 of 10 kWh produced stayed in the house.
      selfSufficiency: 0.6,
      selfConsumption: 0.9,
      from: "2026-05-01T00:00:00.000Z",
      to: "2026-05-03T00:00:00.000Z",
    });
  });

  test("a window with no energy has zeroes and no ratios, not a division by zero", () => {
    const got = energyBreakdown([period("2026-05-01")], window);
    expect(got.loadKwh).toBe(0);
    expect([got.selfSufficiency, got.selfConsumption]).toEqual([null, null]);
    expect(energyBreakdown([], window).productionKwh).toBe(0);
  });

  test("a ratio never leaves 0..1, however the periods round", () => {
    const got = energyBreakdown(
      [
        period("k", {
          loadKwh: 1,
          solarToLoadKwh: 1.0000001,
          productionKwh: 1,
          selfConsumedKwh: 1.5,
        }),
      ],
      window,
    );
    expect([got.selfSufficiency, got.selfConsumption]).toEqual([1, 1]);
  });

  test("it prices nothing: no tariff, no money", () => {
    const got = energyBreakdown([period("k", { importKwh: 5, loadKwh: 5 })], window);
    expect([
      got.importCost,
      got.exportEarnings,
      got.net,
      got.savings,
      got.byDay,
      got.byBand,
    ]).toEqual([0, 0, 0, 0, [], []]);
  });
});
