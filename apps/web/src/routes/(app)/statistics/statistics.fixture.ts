import type { BatteryHealth } from "@SunReye/contracts/energy";
import type { HeatmapCell } from "@SunReye/contracts/statistics";
import { costRangeFor } from "$lib/cost/ranges";
import type { SectionData } from "$lib/statistics/sections";
import { statisticsQuery, type StatisticsApi } from "$lib/statistics/statistics-query";
import { energyBreakdown } from "$lib/statistics/window-energy";
import { periodWindow } from "$lib/time/period";

/** One slot with the four fields the panel reads; the rest of the cell is not drawn. */
const HEATMAP = [
  { hod: 9, dow: 1, occurrences: 4, loadKwh: 2, importKwh: 1, exportKwh: 0, productionKwh: 3 },
] as HeatmapCell[];

const HEALTH: BatteryHealth = {
  capacity: null,
  baseline: null,
  health: null,
  trend: [
    { measuredAt: "2026-06-01T00:00:00Z", capacityKwh: 9.9, tempC: null },
    { measuredAt: "2026-07-01T00:00:00Z", capacityKwh: 9.8, tempC: null },
  ],
};

const answer = (data: unknown) => async () => ({ data });

/** Every read answers something, so a section that stays away was gated, not empty. */
export const FAKE_API: StatisticsApi = {
  comparison: answer({ current: null, previous: null }),
  costSeries: answer([]),
  energySeries: answer([]),
  records: answer({}),
  amortisation: answer({}),
  heatmap: answer(HEATMAP),
  spotStats: answer({}),
  dayAheadPrices: answer({}),
  batteryHealth: answer(HEALTH),
};

export const fakeStatisticsQuery = () =>
  statisticsQuery({
    api: FAKE_API,
    live: { revision: 0, priceRevision: 0 },
    source: { query: { source: "plant" } },
  });

/** A month window with no energy in it. */
export function fakeSectionData(): SectionData {
  const now = new Date("2026-08-15T12:00:00Z");
  const range = costRangeFor(periodWindow(now, "month", { timeZone: "UTC" }), now, "UTC");
  return {
    cost: energyBreakdown([], range),
    previous: null,
    mode: "previous",
    windowDays: 14,
    range,
  };
}
