import { describe, expect, test } from "bun:test";
import type { PeriodEnergy } from "@SunReye/contracts/energy";
import { windowRatios } from "./energy-split-ratios";

/** A period carrying only the four flows the ratios are made of. */
const period = (loadKwh: number, importKwh: number, productionKwh = 0, exportKwh = 0) =>
  ({ loadKwh, importKwh, productionKwh, exportKwh }) as PeriodEnergy;

describe("the energy split's window ratios", () => {
  // They sit beside the charts to tie back to the headline tiles, which carry
  // the server's WINDOW figure: (Σload − Σimport) / Σload. A mean of per-period
  // ratios weighs a 1 kWh night like a 20 kWh day and lands somewhere else.
  test("self-sufficiency is the window's, not the mean of each period's", () => {
    // Per period: 90 % and 10 %, mean 50 %. The window: (12 − 2.8) / 12 ≈ 76.7 %.
    const { selfSufficiency } = windowRatios([period(10, 1), period(2, 1.8)]);
    expect(selfSufficiency).toBeCloseTo(9.2 / 12, 10);

    // Weighted: a big day and a small night. Mean of ratios would be 0.5.
    expect(windowRatios([period(19, 0), period(1, 1)]).selfSufficiency).toBeCloseTo(0.95, 10);
  });

  test("self-consumption is the window's, not the mean of each period's", () => {
    // Per period: 80 % and 0 %, mean 40 %. The window: (10 − 2 + 0) / 12 = 66.7 %.
    const { selfConsumption } = windowRatios([period(0, 0, 10, 2), period(0, 0, 2, 2)]);
    expect(selfConsumption).toBeCloseTo(8 / 12, 10);
  });

  test("a period with no flow neither counts as zero nor divides by it", () => {
    const ratios = windowRatios([period(10, 5, 4, 1), period(0, 0, 0, 0)]);
    expect(ratios.selfSufficiency).toBeCloseTo(0.5, 10);
    expect(ratios.selfConsumption).toBeCloseTo(0.75, 10);
  });

  test("a window with no load or no production has no ratio, not 0 %", () => {
    expect(windowRatios([period(0, 0, 5, 1)]).selfSufficiency).toBeNull();
    expect(windowRatios([period(5, 1, 0, 0)]).selfConsumption).toBeNull();
    expect(windowRatios([])).toEqual({ selfSufficiency: null, selfConsumption: null });
  });

  test("stays inside 0..1 when a period imported more than it used", () => {
    // Grid charging the battery: import past load. The server clamps; so does this.
    expect(windowRatios([period(2, 5)]).selfSufficiency).toBe(0);
    expect(windowRatios([period(2, 0, 3, 4)]).selfConsumption).toBe(0);
  });
});
