import { describe, expect, it } from "bun:test";
import type { ForecastSlot } from "./forecast-chart.svelte";
import { kwLabel, kwhLabel, slotEndLabel, tooltipRows } from "./forecast-tooltip-rows";

const slot = (over: Partial<ForecastSlot>): ForecastSlot => ({
  label: "16:15",
  predictedW: 9040,
  predictedPeakW: 9220,
  predictedRawW: 9040,
  predictedRawPeakW: 9220,
  actualW: 5920,
  actualPeakW: 9650,
  ...over,
});

describe("tooltipRows", () => {
  it("headlines the slot AVERAGE, not the peak, for the measured row", () => {
    // The bar is drawn at the slot average (actualW). The eye lands on the
    // headline, so the headline must be the same quantity the bar draws.
    const actual = tooltipRows(slot({}))?.find((r) => r.key === "actual");
    expect(actual).toBeDefined();
    expect(kwLabel(actual!.avgW)).toBe("5.92 kW");
    // The peak is still available, demoted to secondary text.
    expect(kwLabel(actual!.peakW)).toBe("9.65 kW");
  });

  it("keeps the headline (avg) × slot hours equal to the rendered kWh", () => {
    const actual = tooltipRows(slot({}))!.find((r) => r.key === "actual")!;
    // 5920 W over 15 min = 1.48 kWh; over 60 min = 5.92 kWh.
    expect(kwhLabel(actual.avgW, 15)).toBe("1.48 kWh");
    expect(kwhLabel(actual.avgW, 60)).toBe("5.92 kWh");
    // headline kW × hours == kWh, exactly, for both step widths.
    for (const step of [15, 60]) {
      expect(actual.avgW * (step / 60)).toBeCloseTo((actual.avgW * step) / 60, 9);
    }
  });

  it("falls back to the average when the measured peak is missing", () => {
    const actual = tooltipRows(slot({ actualPeakW: null }))!.find((r) => r.key === "actual")!;
    expect(actual.peakW).toBe(5920);
    expect(actual.avgW).toBe(5920);
  });

  it("handles a zero measured slot", () => {
    const actual = tooltipRows(slot({ actualW: 0, actualPeakW: 0 }))!.find(
      (r) => r.key === "actual",
    )!;
    expect(actual.avgW).toBe(0);
    expect(kwLabel(actual.avgW)).toBe("0 kW");
  });

  it("omits the measured row entirely when the slot is not yet measured", () => {
    const rows = tooltipRows(slot({ actualW: null }));
    expect(rows.some((r) => r.key === "actual")).toBe(false);
  });

  it("always includes the predicted row; adds the uncapped row only when clipping bites", () => {
    expect(tooltipRows(slot({})).some((r) => r.key === "uncapped")).toBe(false);
    const clipped = tooltipRows(slot({ predictedW: 5000, predictedRawW: 9040 }));
    const uncapped = clipped.find((r) => r.key === "uncapped");
    expect(uncapped).toBeDefined();
    expect(uncapped!.avgW).toBe(9040);
  });
});

describe("slotEndLabel", () => {
  it("adds the step to the slot start", () => {
    expect(slotEndLabel("16:15", 15)).toBe("16:30");
    expect(slotEndLabel("13:00", 60)).toBe("14:00");
  });

  it("reads the last slot of the day as 24:00", () => {
    expect(slotEndLabel("23:45", 15)).toBe("24:00");
  });
});
