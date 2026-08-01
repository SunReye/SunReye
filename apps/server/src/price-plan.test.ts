import { describe, expect, test } from "bun:test";
import { automationConfigSchema } from "@SunReye/db/automation-config";
import { type PriceInputs, planPriceAction } from "./price-plan";
import type { ForecastSlice } from "./slot-window";
import type { SpotSlice } from "./spot-price";

const HOUR_MS = 3_600_000;
/** 2026-08-02T00:00 local at UTC+2 — the grid every fixture sits on. */
const MIDNIGHT = Date.parse("2026-08-01T22:00:00Z");
const at = (hours: number) => MIDNIGHT + hours * HOUR_MS;

/**
 * Windows the planner sees, read back through the action — the only consumer
 * that matters, and the one that proves detection and use agree.
 */
const windowsOf = (slice: SpotSlice, price: ReturnType<typeof cfg>) => {
  const found: { startMs: number; endMs: number; slots: number; minEurPerMwh: number }[] = [];
  // Step through the day and collect each distinct window the planner reports.
  for (let h = 0; h < 24; h += 0.25) {
    const w = planPriceAction(inputs({ prices: slice, price, nowMs: at(h) })).window;
    if (w && !found.some((f) => f.startMs === w.startMs)) found.push(w);
  }
  return found;
};

const cfg = (over: object = {}) => ({
  ...automationConfigSchema.parse({}).peakShaving.priceAware,
  enabled: true,
  ...over,
});

/** A price slice from `[hour, price]` pairs at quarter-hour resolution. */
function prices(slots: [number, number][]): SpotSlice {
  return {
    zone: "DE-LU",
    stepMinutes: 15,
    utcOffsetSeconds: 7200,
    coverage: { today: "complete", tomorrow: "complete" },
    availability: "ok",
    series: slots.map(([hour, eurPerMwh]) => ({
      time: "2026-08-02T00:00",
      startMs: at(hour),
      minutes: 15,
      eurPerMwh,
      negative: eurPerMwh < 0,
    })),
  };
}

/** `n` consecutive quarter-hour slots from `fromHour`, all at `eurPerMwh`. */
const run = (fromHour: number, n: number, eurPerMwh: number): [number, number][] =>
  Array.from({ length: n }, (_, i) => [fromHour + i * 0.25, eurPerMwh] as [number, number]);

/** A flat PV forecast of `watts` for the whole day, quarter-hourly. */
function forecast(watts: number | ((hour: number) => number)): ForecastSlice {
  const at15 = (i: number) => {
    const minutes = i * 15;
    const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
    return `2026-08-02T${hh}:${String(minutes % 60).padStart(2, "0")}`;
  };
  return {
    stepMinutes: 15,
    utcOffsetSeconds: 7200,
    series: Array.from({ length: 96 }, (_, i) => ({
      time: at15(i),
      watts: typeof watts === "number" ? watts : watts((i * 15) / 60),
      peakWatts: 0,
    })),
  };
}

const inputs = (over: Partial<PriceInputs> = {}): PriceInputs => ({
  price: cfg(),
  prices: prices(run(12, 12, -40)), // 12:00–15:00 negative
  forecast: forecast(7000),
  nowMs: at(9),
  socPct: 62,
  minSocPct: 10,
  usableKwh: 15,
  baselineLoadW: 400,
  maxChargeW: 5120,
  importFollowsMarket: false,
  ...over,
});

describe("window detection", () => {
  test("groups a contiguous run and reports its depth", () => {
    const [w, ...rest] = windowsOf(prices(run(12, 8, -40)), cfg());
    expect(rest).toHaveLength(0);
    expect(w).toMatchObject({ startMs: at(12), endMs: at(14), slots: 8, minEurPerMwh: -40 });
  });

  test("the threshold is inclusive and 0 counts as negative by default", () => {
    // §51 pays nothing *below* zero, but the planner's own threshold is a knob:
    // at the default 0 a slot at exactly 0 is worth acting on too, since there is
    // nothing to lose by soaking it.
    expect(windowsOf(prices(run(12, 4, 0)), cfg())).toHaveLength(1);
    expect(windowsOf(prices(run(12, 4, 0.01)), cfg())).toHaveLength(0);
  });

  test("a lone stray slot is ignored", () => {
    expect(windowsOf(prices(run(12, 1, -40)), cfg({ minWindowMinutes: 30 }))).toHaveLength(0);
    expect(windowsOf(prices(run(12, 2, -40)), cfg({ minWindowMinutes: 30 }))).toHaveLength(1);
  });

  test("one positive slot between runs is bridged, two are not", () => {
    // Emptying the pack twice for two windows a quarter-hour apart is worse than
    // treating them as one.
    const bridged = prices([...run(12, 4, -40), ...run(13, 1, 20), ...run(13.25, 4, -40)]);
    expect(windowsOf(bridged, cfg({ bridgeGapSlots: 1 }))).toHaveLength(1);
    expect(windowsOf(bridged, cfg({ bridgeGapSlots: 0 }))).toHaveLength(2);
  });

  test("a hole in the stored series splits the window", () => {
    // 12:00 and 12:30 are both negative but 12:15 has no price at all, so they
    // are not one window — an absent slot is unknown, not negative.
    const holed = prices([
      [12, -40],
      [12.5, -40],
    ]);
    expect(windowsOf(holed, cfg({ bridgeGapSlots: 0, minWindowMinutes: 15 }))).toHaveLength(2);
  });
});

describe("planPriceAction", () => {
  test("off, no prices, or no battery leaves the decision untouched", () => {
    for (const over of [
      { price: cfg({ enabled: false }) },
      { prices: null },
      { usableKwh: 0 },
    ] satisfies Partial<PriceInputs>[]) {
      const action = planPriceAction(inputs(over));
      expect(action.regime).toBe("none");
      expect(action.exportLimitW).toBeNull();
      expect(action.chargeCeilingW).toBeNull();
    }
  });

  test("inside a window it soaks: the feed-in ceiling drops to the soak floor", () => {
    const action = planPriceAction(inputs({ nowMs: at(13) }));
    expect(action.regime).toBe("absorb");
    expect(action.exportLimitW).toBe(0);
    expect(action.window?.startMs).toBe(at(12));
  });

  test("the soak floor is configurable, so some export can keep flowing", () => {
    const action = planPriceAction(inputs({ nowMs: at(13), price: cfg({ soakFloorW: 1500 }) }));
    expect(action.exportLimitW).toBe(1500);
  });

  test("a window beyond the lookahead is not planned for", () => {
    expect(
      planPriceAction(inputs({ nowMs: at(2), price: cfg({ lookaheadHours: 4 }) })).regime,
    ).toBe("none");
  });

  test("an overcast run-up needs no shaping and stays silent", () => {
    // The pack arrives with room on its own; holding the ceiling down would
    // make peak shaving look broken for nothing.
    const action = planPriceAction(inputs({ forecast: forecast(300), socPct: 20 }));
    expect(action.regime).toBe("waiting");
    expect(action.chargeCeilingW).toBeNull();
  });

  test("shaping can be turned off while windows are still reported", () => {
    const action = planPriceAction(inputs({ price: cfg({ shapeSoc: false }) }));
    expect(action.regime).toBe("waiting");
    expect(action.chargeCeilingW).toBeNull();
    expect(action.window?.startMs).toBe(at(12));
  });

  test("without a forecast it will not shape blind", () => {
    const action = planPriceAction(inputs({ forecast: null }));
    expect(action.regime).toBe("waiting");
    expect(action.chargeCeilingW).toBeNull();
  });

  test("a sunny run-up above the envelope stops charging entirely", () => {
    // The worked case: 15 kWh pack at 62 %, 5.12 kW charger, three hours of
    // ~6.6 kW surplus in the window — the pack must be as empty as allowed, and
    // 0 A is all withholding can do.
    const action = planPriceAction(inputs());
    expect(action.regime).toBe("spend-down");
    expect(action.chargeCeilingW).toBe(0);
    expect(action.socEnvelopePct).toBeCloseTo(10, 6); // clamped at the reserve floor
  });

  test("a modest window still allows charging, just not past the bound", () => {
    // One hour of 2 kW surplus needs ~2 kWh of room in a 15 kWh pack, so the
    // bound sits near 82 %. A pack at 75 % that would otherwise reach 87 % is
    // capped rather than stopped — the point of an envelope over a flat 0 A.
    const action = planPriceAction(
      inputs({
        prices: prices(run(12, 4, -40)),
        forecast: forecast((h) => (h >= 12 && h < 13 ? 2400 : 1000)),
        socPct: 75,
      }),
    );
    expect(action.regime).toBe("pre-shape");
    expect(action.chargeCeilingW).toBeGreaterThan(0);
    expect(action.socEnvelopePct).toBeCloseTo(100 - (100 * 2) / 15 - 5, 5);
  });

  test("a draining run-up needs no shaping even with a window ahead", () => {
    // PV below the house load all morning: the pack arrives well under the
    // target on its own, so the planner stays out of the way.
    const action = planPriceAction(
      inputs({
        prices: prices(run(12, 4, -40)),
        forecast: forecast((h) => (h >= 12 && h < 13 ? 2400 : 100)),
        socPct: 40,
      }),
    );
    expect(action.regime).toBe("waiting");
    expect(action.chargeCeilingW).toBeNull();
  });

  test("the envelope never plans below the battery's reserve floor", () => {
    const action = planPriceAction(inputs({ minSocPct: 30 }));
    expect(action.socEnvelopePct).toBeCloseTo(30, 6);
  });

  test("reports the energy that cannot be rescued, rather than hiding it", () => {
    // 6.6 kW of surplus against a 5.12 kW charger spills ~1.5 kW for 3 h, and
    // 15.4 kWh of soakable energy cannot fit a 15 kWh pack either.
    const action = planPriceAction(inputs());
    expect(action.soakableKwh).toBeCloseTo(5.12 * 3, 5);
    expect(action.unavoidableZeroValueKwh).toBeGreaterThan(4);
  });

  test("surplus beyond the charger's rate never drives the envelope lower", () => {
    // Doubling the in-window PV cannot make the pack emptier than empty; it only
    // increases the honest "this will earn nothing" figure.
    const modest = planPriceAction(inputs({ forecast: forecast(7000) }));
    const huge = planPriceAction(inputs({ forecast: forecast(14_000) }));
    expect(huge.socEnvelopePct).toBe(modest.socEnvelopePct);
    expect(huge.unavoidableZeroValueKwh ?? 0).toBeGreaterThan(modest.unavoidableZeroValueKwh ?? 0);
  });
});

describe("grid charging in a window", () => {
  const inWindow = (over: object = {}) =>
    planPriceAction(inputs({ nowMs: at(13), socPct: 30, ...over }));

  test("off by default, even inside a window", () => {
    expect(inWindow().gridChargeA).toBeNull();
  });

  test("refused on a fixed tariff — a negative wholesale price is not a cheaper bill", () => {
    expect(inWindow({ price: cfg({ gridChargeInWindow: true }) }).gridChargeA).toBeNull();
  });

  test("draws the configured current when the bill follows the market", () => {
    const action = inWindow({
      price: cfg({ gridChargeInWindow: true, gridChargeMaxA: 20 }),
      importFollowsMarket: true,
    });
    expect(action.gridChargeA).toBe(20);
  });

  test("never outside a window", () => {
    const action = planPriceAction(
      inputs({
        nowMs: at(9),
        price: cfg({ gridChargeInWindow: true }),
        importFollowsMarket: true,
      }),
    );
    expect(action.gridChargeA).toBeNull();
  });

  test("not into a full pack", () => {
    const action = inWindow({
      socPct: 100,
      price: cfg({ gridChargeInWindow: true }),
      importFollowsMarket: true,
    });
    expect(action.gridChargeA).toBeNull();
  });
});
