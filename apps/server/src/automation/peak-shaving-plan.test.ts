import { describe, expect, test } from "bun:test";
import { automationConfigSchema } from "@SunReye/db/automation-config";
import type { DecisionInputs } from "./peak-shaving";
import { projectPeakShavingDays } from "./peak-shaving-plan";
import type { ForecastSlice } from "./slot-window";

// Tomorrow's plan starts at the plant's next local midnight. The forecast labels
// sit at one fixed offset, so on a DST-change day that offset lands the start an
// hour off; the boundary has to come from the plant zone.
const BERLIN = "Europe/Berlin";
const QUARTER_MS = 15 * 60_000;

/** 15-min slots from `fromUtc`, labelled at the series' single fixed offset. */
function sliceAt(fromUtc: string, count: number, utcOffsetSeconds: number): ForecastSlice {
  const startMs = Date.parse(fromUtc);
  return {
    stepMinutes: 15,
    utcOffsetSeconds,
    timeZone: BERLIN,
    series: Array.from({ length: count }, (_, i) => ({
      time: new Date(startMs + i * QUARTER_MS + utcOffsetSeconds * 1000).toISOString().slice(0, 16),
      watts: 0,
      peakWatts: 0,
    })),
  };
}

const ps = automationConfigSchema.parse({}).peakShaving;

function base(
  nowUtc: string,
  forecast: ForecastSlice,
): DecisionInputs & { forecast: ForecastSlice } {
  return {
    mode: "maximize-exports",
    pvW: 0,
    socPct: 50,
    batteryV: 50,
    exportLimitW: 8000,
    usableKwh: 15,
    maxChargeA: 100,
    fallbackChargeA: 25,
    topBalanceFloorA: 5,
    evChargeW: 0,
    evRemainingKwh: 0,
    evIncludedInLoad: false,
    liveLoadW: 0,
    baselineLoadW: 0,
    gridFriendly: ps.gridFriendly,
    previousThresholdW: null,
    previousTargetA: null,
    sinceLastDecisionMs: 0,
    price: ps.priceAware,
    priceView: null,
    minSocPct: 10,
    importFollowsMarket: false,
    forecast,
    nowMs: Date.parse(nowUtc),
  };
}

const firstTomorrow = (b: DecisionInputs & { forecast: ForecastSlice }): string | undefined => {
  const t = projectPeakShavingDays(b, { exportCapW: 8000 }).tomorrow.slots[0]?.t;
  return t === undefined ? undefined : new Date(t).toISOString();
};

describe("projectPeakShavingDays: tomorrow starts at the plant's midnight", () => {
  test("spring-forward day (Berlin, series at CET)", () => {
    const forecast = sliceAt("2026-03-29T20:00:00Z", 16, 3600);
    expect(firstTomorrow(base("2026-03-29T10:00:00Z", forecast))).toBe("2026-03-29T22:00:00.000Z");
  });

  test("fall-back day (Berlin, series at CEST)", () => {
    const forecast = sliceAt("2026-10-25T20:00:00Z", 16, 7200);
    expect(firstTomorrow(base("2026-10-25T10:00:00Z", forecast))).toBe("2026-10-25T23:00:00.000Z");
  });

  test("an ordinary summer day", () => {
    const forecast = sliceAt("2026-07-25T20:00:00Z", 16, 7200);
    expect(firstTomorrow(base("2026-07-25T10:00:00Z", forecast))).toBe("2026-07-25T22:00:00.000Z");
  });
});
