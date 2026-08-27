import { beforeEach, describe, expect, test } from "bun:test";
import {
  type AutomationConfig,
  type GridFriendlyConfig,
  automationConfigSchema,
} from "@SunReye/db/automation-config";
import type { AutomationState } from "@SunReye/db/automation-state";
import { type WeatherConfig, weatherConfigSchema } from "@SunReye/db/weather";
import type { InverterProfile, InverterSample, MetricDef } from "@SunReye/inverter-core";
import {
  decideTargetA,
  evccAutomationInputs,
  resolvePeakShavingBlockers,
  validateAutomationEnable,
} from "./peak-shaving";
import { tariffConfigSchema } from "@SunReye/db/tariff";
import type { ForecastSlice } from "./slot-window";
import type { SpotSlice } from "@SunReye/contracts/prices";
import type { DecisionPoint } from "@SunReye/contracts/automation";
import { createDecisionLog } from "./automation-history";
import { projectPeakShaving } from "./peak-shaving-plan";
import { type AutomationIO, createPeakShavingEngine, planLimits } from "./peak-shaving-engine";
import type { EvccLoadpoint, EvccState } from "@SunReye/contracts/evcc";
import type { EvccAction } from "../evcc/evcc";
import { buildProfileContext, type ProfileContext } from "../inverter/inverter";
import { createControlWriter } from "../inverter/control-writer";
import type { SolarForecast } from "../forecast/solar-forecast";

// --- Fixtures ------------------------------------------------------------------

const CHARGE_KEY = "settings.battery.max_charge_current";
const PV_KEY = "pv.power";
const SOC_KEY = "battery.soc";
const VOLT_KEY = "battery.voltage";
const LOAD_KEY = "load.power";
const BATT_POWER_KEY = "battery.power";
const GRID_KEY = "grid.power";
const SELL_KEY = "settings.solar_sell_max_power";

const metric = ({
  type = "U_WORD",
  addresses = [1],
  ...over
}: Partial<MetricDef> & { key: string }): MetricDef => ({
  topic: over.key.replaceAll(".", "/"),
  label: over.key,
  unit: null,
  group: "test",
  type,
  addresses,
  // The codec addresses through the binding; the legacy mirror stays in step
  // with it exactly as `hydrateProfile` keeps it.
  binding: { via: "modbus", addr: addresses, type },
  scale: 1,
  access: "r",
  ...over,
});

/** A synthetic profile mapping the peak-shaving roles (charge register 0–185 A). */
function profileWith(roles: Partial<Record<string, string>> = {}): InverterProfile {
  const defaults: Record<string, string> = {
    "setting.battery.max_charge_current": CHARGE_KEY,
    "pv.total.power": PV_KEY,
    "battery.soc": SOC_KEY,
    "battery.voltage": VOLT_KEY,
    "load.power": LOAD_KEY,
    "battery.power": BATT_POWER_KEY,
    "grid.power": GRID_KEY,
    "setting.solar_sell.max_power": SELL_KEY,
    ...roles,
  };
  const metrics: MetricDef[] = [];
  for (const [role, key] of Object.entries(defaults)) {
    if (!key) continue;
    // Settings are writable and bounded; a watt register (the feed-in ceiling, a
    // power-denominated battery limit) cannot share the charge register's
    // 0–185 A range.
    const range = role.endsWith("power") ? { min: 0, max: 15_000 } : { min: 0, max: 185 };
    metrics.push(
      metric({
        key,
        role: role as MetricDef["role"],
        access: role.startsWith("setting.") ? "rw" : "r",
        ...(role.startsWith("setting.") ? { range } : {}),
      }),
    );
  }
  return { id: "test-profile", name: "Test", manufacturer: "Test", metrics };
}

const weather = (forecastOver: object = {}): WeatherConfig =>
  weatherConfigSchema.parse({
    enabled: true,
    latitude: 50,
    longitude: 8,
    forecast: {
      enabled: true,
      arrays: [{ kwp: 12, tilt: 30, azimuth: 0 }],
      maxOutputW: 8400,
      battery: { usableKwh: 15 },
      ...forecastOver,
    },
  });

const config = (over: object = {}, psOver: object = {}): AutomationConfig =>
  automationConfigSchema.parse({
    enabled: true,
    disclaimerAcceptedAt: "2026-07-25T00:00:00Z",
    peakShaving: { enabled: true, safetyBufferW: 400, ...psOver },
    ...over,
  });

// Noon UTC with a zero plant offset keeps local == UTC in every fixture.
const NOON = Date.parse("2026-07-25T12:00:00Z");

/** 15-min slots from `startHour`, one entry per watts value. */
function slice(startHour: number, watts: number[], utcOffsetSeconds = 0): ForecastSlice {
  return {
    stepMinutes: 15,
    utcOffsetSeconds,
    series: watts.map((w, i) => {
      const totalMin = startHour * 60 + i * 15;
      const hh = String(Math.floor(totalMin / 60)).padStart(2, "0");
      const mm = String(totalMin % 60).padStart(2, "0");
      return { time: `2026-07-25T${hh}:${mm}`, watts: w, peakWatts: w };
    }),
  };
}

function asForecast(view: ForecastSlice, next15MaxW?: number): SolarForecast {
  const first = view.series.find(
    (p) => Date.parse(`${p.time}:00Z`) - view.utcOffsetSeconds * 1000 >= NOON,
  );
  // Only the fields the engine touches are populated; the rest is inert filler.
  const filler = { todayKwh: 0, remainingTodayKwh: 0, tomorrowKwh: 0 };
  const raw = {
    series: view.series,
    ...filler,
    next15: {
      maxPowerW: next15MaxW ?? first?.watts ?? 0,
      avgPowerW: next15MaxW ?? first?.watts ?? 0,
      energyKwh: 0,
    },
  };
  return {
    provider: "test",
    stepMinutes: view.stepMinutes,
    utcOffsetSeconds: view.utcOffsetSeconds,
    ...raw,
    raw,
  };
}

/** Grid-friendly knobs at their schema defaults; override per case. */
const gridFriendly = (over: Partial<GridFriendlyConfig> = {}): GridFriendlyConfig => ({
  ...automationConfigSchema.parse({}).peakShaving.gridFriendly,
  ...over,
});

const baseInputs = {
  mode: "maximize-exports" as const,
  pvW: 5000,
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
  gridFriendly: gridFriendly({ chargeSlewAPerMin: 0 }),
  previousThresholdW: null,
  previousTargetA: null,
  sinceLastDecisionMs: 30_000,
  forecast: null,
  // Price awareness off by default, so every existing case asserts the
  // unchanged shaving behaviour.
  price: automationConfigSchema.parse({}).peakShaving.priceAware,
  priceView: null,
  minSocPct: 10,
  importFollowsMarket: false,
  nowMs: NOON,
};

/** A filled decision point; the ring tests override only what they assert on. */
const logPoint: DecisionPoint = {
  t: 0,
  shadow: false,
  pvW: 0,
  loadW: null,
  evChargeW: null,
  localSinkW: 0,
  thresholdW: 0,
  targetA: 0,
  liveA: null,
  batteryV: 50,
  chargeW: null,
  exportW: null,
  socPct: 50,
};

/** A connected pv-mode loadpoint; override what the case needs. */
const loadpoint = (over: Partial<EvccLoadpoint> = {}): EvccLoadpoint => ({
  index: 1,
  title: null,
  mode: "pv",
  chargePower: 0,
  chargePowerLive: 0,
  chargePowerSource: "measured",
  charging: false,
  connected: true,
  vehicleSoc: null,
  vehicleRange: null,
  vehicleTitle: null,
  vehicleName: null,
  sessionEnergy: null,
  chargeRemainingEnergy: null,
  limitSoc: null,
  effectiveLimitSoc: null,
  vehicleLimitSoc: null,
  vehicleCapacityKwh: null,
  phasesActive: null,
  batteryBoost: false,
  batteryBoostLimit: 100,
  ...over,
});

const evccState = (
  loadpoints: EvccLoadpoint[],
  reachable = true,
  subtractFromHome = true,
): EvccState => ({ reachable, loadpoints, subtractFromHome });

// --- remaining-today surplus -------------------------------------------------------
//
// The slot math is internal to decideTargetA; it is observed through the
// `surplusAboveLimitKwh` it reports (energy above `exportLimitW` still ahead
// today), which is exactly what the engine surfaces in the automation status.

/**
 * Remaining-today energy above `levelW` in the *export* curve: the forecast minus
 * the house load, clamped at the export budget. This is the integral the
 * `grid-friendly` level solves against — energy that would have been sold.
 */
const exportSurplusAbove = (view: ForecastSlice, levelW: number, budgetW = 8000, loadW = 0) =>
  view.series.reduce(
    (kwh, p) =>
      kwh + Math.max(0, Math.min(Math.max(0, p.watts - loadW), budgetW) - levelW) * 0.25 * 0.001,
    0,
  );

/** Remaining-today surplus above `thresholdW`, as the decision computes it. */
const surplusAbove = (view: ForecastSlice, thresholdW: number, nowMs: number): number | null =>
  decideTargetA({ ...baseInputs, forecast: view, exportLimitW: thresholdW, nowMs })
    .surplusAboveLimitKwh;

describe("remaining-today surplus above the export limit", () => {
  test("sums only the energy above the threshold", () => {
    // Four future 15-min slots: 1000 W above the limit for one full hour.
    const view = slice(13, [9000, 9000, 9000, 9000]);
    expect(surplusAbove(view, 8000, NOON)).toBeCloseTo(1, 6);
    expect(surplusAbove(view, 9000, NOON)).toBe(0);
  });

  test("prorates the running slot by the fraction still ahead", () => {
    const view = slice(12, [9000]); // 12:00–12:15, 1000 W above
    const halfway = NOON + 7.5 * 60_000;
    expect(surplusAbove(view, 8000, halfway)).toBeCloseTo(0.125, 6);
  });

  test("ignores past slots and other days", () => {
    const view: ForecastSlice = {
      stepMinutes: 15,
      utcOffsetSeconds: 0,
      series: [
        { time: "2026-07-25T10:00", watts: 20_000, peakWatts: 20_000 }, // past
        { time: "2026-07-26T12:00", watts: 20_000, peakWatts: 20_000 }, // tomorrow
      ],
    };
    expect(surplusAbove(view, 0, NOON)).toBe(0);
  });

  test("a series gap wider than an hour falls back to the nominal step", () => {
    // 13:00 then 15:00: the 2 h gap must not stretch the 13:00 slot across it,
    // so both slots count as one nominal 15-min step — 0.25 kWh above the limit
    // each. Stretching would report 2.25 kWh.
    const view: ForecastSlice = {
      stepMinutes: 15,
      utcOffsetSeconds: 0,
      series: [
        { time: "2026-07-25T13:00", watts: 9000, peakWatts: 9000 },
        { time: "2026-07-25T15:00", watts: 9000, peakWatts: 9000 },
      ],
    };
    expect(surplusAbove(view, 8000, NOON)).toBeCloseTo(0.5, 6);
  });

  test("respects the plant's UTC offset when bucketing the local day", () => {
    // Plant at UTC+2: local 23:45 of the 25th is 21:45 UTC. At 21:00 UTC the
    // slot is still "today" locally and future — it must count.
    const view = slice(23, [9000], 2 * 3600);
    view.series[0]!.time = "2026-07-25T23:45";
    const nowMs = Date.parse("2026-07-25T21:00:00Z");
    expect(surplusAbove(view, 8000, nowMs)).toBeCloseTo(0.25, 6);
  });
});

// --- decideTargetA ----------------------------------------------------------------

describe("decideTargetA — shared", () => {
  test("near-full holds the top-balance floor, not zero", () => {
    const d = decideTargetA({ ...baseInputs, socPct: 99 }); // 0.15 kWh headroom
    expect(d.targetA).toBe(5);
  });

  test("top-balance floor of zero restores blueprint behavior", () => {
    const d = decideTargetA({ ...baseInputs, socPct: 99, topBalanceFloorA: 0 });
    expect(d.targetA).toBe(0);
  });

  test("no forecast degrades to pure live shaving", () => {
    const d = decideTargetA({ ...baseInputs, pvW: 10_000 });
    expect(d.degraded).toBe(true);
    expect(d.targetA).toBe(Math.ceil(2000 / 50));
    expect(d.surplusAboveLimitKwh).toBeNull();
  });

  test("live-only shaving is still bounded by the live excess it saw", () => {
    // 100 W above the limit rounds up to a 5 A / 250 W write; the degraded path
    // has no forecast but it does know the excess, so it can still say so.
    const d = decideTargetA({ ...baseInputs, pvW: 8100 });
    expect(d.degraded).toBe(true);
    expect(d.targetA).toBe(5);
    expect(d.absorbCeilingW).toBe(100);
  });

  test("live shaving is capped at maxChargeA", () => {
    const d = decideTargetA({ ...baseInputs, pvW: 20_000, maxChargeA: 60 });
    expect(d.targetA).toBe(60);
  });

  test("targets are quantized up to 5 A steps (write-churn guard)", () => {
    // 210 W of excess at 50 V is 4.2 A raw → rounds up to the 5 A step, so
    // sub-step PV noise cannot move the target (and the register) every tick.
    const d = decideTargetA({ ...baseInputs, pvW: 8210 });
    expect(d.targetA).toBe(5);
    expect(decideTargetA({ ...baseInputs, pvW: 8260 }).targetA).toBe(10);
  });

  test("battery voltage drives the W→A conversion", () => {
    const at50 = decideTargetA({ ...baseInputs, pvW: 10_000, batteryV: 50 });
    const at400 = decideTargetA({ ...baseInputs, pvW: 10_000, batteryV: 400 });
    expect(at50.targetA).toBe(40);
    expect(at400.targetA).toBe(5);
  });
});

describe("decideTargetA — maximize-exports", () => {
  test("live excess above the limit is absorbed immediately", () => {
    const forecast = slice(13, [0, 0]);
    const d = decideTargetA({ ...baseInputs, pvW: 9500, forecast });
    expect(d.targetA).toBe(Math.ceil(1500 / 50));
    expect(d.thresholdW).toBe(8000);
  });

  test("holds charging when the coming peak alone fills the battery", () => {
    // 8 slots × 2h avg 11000 W → 6 kWh above the 8000 W limit; headroom at
    // 62% SOC is 5.7 kWh < 6 → every kWh is spoken for.
    const forecast = slice(13, Array(8).fill(11_000));
    const d = decideTargetA({ ...baseInputs, socPct: 62, pvW: 4000, forecast });
    expect(d.targetA).toBe(0);
  });

  test("falls back to the configured rate when headroom exceeds the peak", () => {
    // Same peak (6 kWh) but 7.5 kWh headroom at 50% → room to spare.
    const forecast = slice(13, Array(8).fill(11_000));
    const d = decideTargetA({ ...baseInputs, socPct: 50, pvW: 4000, forecast });
    expect(d.targetA).toBe(25);
  });

  test("PV inside the safety-buffer band is left to the grid when the peak needs it", () => {
    // 8300 W clears the 8000 W decision limit but not the 8400 W the plant can
    // physically push out, so absorbing it saves nothing — and the coming peak
    // (6 kWh against 5.7 kWh of headroom at 62%) has a claim on every kWh.
    const forecast = slice(13, Array(8).fill(11_000));
    const d = decideTargetA({
      ...baseInputs,
      socPct: 62,
      pvW: 8300,
      exportCapW: 8400,
      forecast,
    });
    expect(d.targetA).toBe(0);
    // The band is still reported as live excess — it is the *spending* that stops.
    expect(d.liveExcessW).toBe(300);
  });

  test("the buffer band is absorbed anyway once the peak is covered", () => {
    // Same band, but 7.5 kWh of headroom at 50% against the same 6 kWh peak:
    // room to spare, so there is no reason to be picky about which watts fill it.
    const forecast = slice(13, Array(8).fill(11_000));
    const d = decideTargetA({ ...baseInputs, socPct: 50, pvW: 8300, exportCapW: 8400, forecast });
    expect(d.targetA).toBe(10); // 300 W / 50 V rounded up to the 5 A step
  });

  test("the absorb ceiling names the excess the target was sized from", () => {
    // 100 W above the limit is 2 A, which the 5 A register grid rounds up to
    // 5 A = 250 W. The write has to stay on the grid; the *spending* must not.
    const forecast = slice(13, [0, 0]);
    const d = decideTargetA({ ...baseInputs, pvW: 8100, forecast });
    expect(d.targetA).toBe(5);
    expect(d.absorbCeilingW).toBe(100);
  });

  test("inside the reserve margin the ceiling is the hard excess alone", () => {
    // 6 kWh of coming peak against 5.7 kWh of headroom at 62%: the buffer band
    // is left to the grid, so it must not ride in on the round-up either.
    const forecast = slice(13, Array(8).fill(11_000));
    const d = decideTargetA({ ...baseInputs, socPct: 62, pvW: 8600, exportCapW: 8400, forecast });
    expect(d.targetA).toBe(5); // 200 W of hard excess → 4 A → one step
    expect(d.liveExcessW).toBe(600); // the band is still *reported*…
    expect(d.absorbCeilingW).toBe(200); // …but it is not in the budget
  });

  test("the top-balance floor and the fallback rate carry no absorb ceiling", () => {
    // Neither target is sized from an excess. Bounding the floor by a surplus of
    // zero would cut the BMS's dwell short, and bounding the fallback rate would
    // defeat it outright — its whole job is to charge from PV that *is* selling.
    expect(decideTargetA({ ...baseInputs, socPct: 99 }).absorbCeilingW).toBeNull();
    const forecast = slice(13, Array(8).fill(11_000));
    const fallback = decideTargetA({ ...baseInputs, socPct: 50, pvW: 4000, forecast });
    expect(fallback.targetA).toBe(25);
    expect(fallback.absorbCeilingW).toBeNull();
  });

  test("boundary: room inside the reserve margin still holds", () => {
    // Headroom − surplus = 0.1 kWh, inside the 0.2 kWh margin → hold.
    const forecast = slice(13, Array(8).fill(11_000)); // 6 kWh surplus
    const usableKwh = (6 + 0.1) * 2; // 50% SOC → headroom = 6.1
    const d = decideTargetA({ ...baseInputs, usableKwh, socPct: 50, pvW: 4000, forecast });
    expect(d.targetA).toBe(0);
  });
});

describe("decideTargetA — grid-friendly", () => {
  // A midday bell: ramps 2→12 kW and back over 4 h of 15-min slots.
  const bell = slice(
    12,
    [2, 4, 6, 8, 10, 12, 12, 10, 8, 6, 4, 2].map((kw) => kw * 1000),
  );

  test("threshold search matches surplus to headroom", () => {
    // 4.5 kWh headroom at 70% SOC exceeds the 3 kWh above the limit, so the
    // search must lower the threshold until the surplus fills the battery.
    const inputs = { ...baseInputs, mode: "grid-friendly" as const, socPct: 70, forecast: bell };
    const d = decideTargetA(inputs);
    expect(d.thresholdW).toBeLessThan(inputs.exportLimitW);
    expect(exportSurplusAbove(bell, d.thresholdW)).toBeCloseTo(4.5, 1);
  });

  test("grid-friendly publishes no absorb ceiling", () => {
    // The mode steers the sell-limit register to the same threshold it charges
    // against, so surplus above the target has nowhere to go but the pack:
    // bounding absorption there would only curtail PV, never rescue an export.
    const d = decideTargetA({
      ...baseInputs,
      mode: "grid-friendly",
      socPct: 70,
      pvW: 11_000,
      forecast: bell,
    });
    expect(d.targetA).toBeGreaterThan(0);
    expect(d.absorbCeilingW).toBeNull();
  });

  test("a peak that overfills the pack no longer pins the level at the limit", () => {
    const d = decideTargetA({
      ...baseInputs,
      mode: "grid-friendly",
      socPct: 99, // tiny headroom → near-full branch guards first…
      forecast: bell,
    });
    expect(d.targetA).toBe(5); // …so the floor wins
    // 1 kWh of headroom against 3 kWh above the limit. Shaving at the limit here
    // would fill the pack from energy the grid never sees and leave the feed-in
    // curve untouched — so the level drops into the exportable part instead.
    const d2 = decideTargetA({
      ...baseInputs,
      mode: "grid-friendly",
      usableKwh: 2,
      forecast: bell,
    });
    expect(d2.thresholdW).toBeLessThan(8000);
    expect(exportSurplusAbove(bell, d2.thresholdW)).toBeCloseTo(1, 1);
  });

  test("threshold rises toward the limit as SOC rises", () => {
    const lo = decideTargetA({ ...baseInputs, mode: "grid-friendly", socPct: 50, forecast: bell });
    const hi = decideTargetA({ ...baseInputs, mode: "grid-friendly", socPct: 85, forecast: bell });
    expect(hi.thresholdW).toBeGreaterThan(lo.thresholdW);
  });

  test("charges with the exportable power above the level", () => {
    const inputs = { ...baseInputs, mode: "grid-friendly" as const, socPct: 80, forecast: bell };
    const d = decideTargetA({ ...inputs, pvW: 10_000 });
    // 10 kW of PV against an 8 kW budget: the 2 kW above it is not harvested, so
    // the charge is what the *export* gives up, quantized to the nearest step.
    expect(d.targetA).toBe(Math.round((8000 - d.thresholdW) / 50 / 5) * 5);
  });

  test("absorbs all PV when the battery dwarfs the remaining day", () => {
    const smallDay = slice(13, [3000, 3000]);
    const d = decideTargetA({
      ...baseInputs,
      mode: "grid-friendly",
      socPct: 10,
      pvW: 3000,
      forecast: smallDay,
    });
    expect(d.thresholdW).toBeLessThan(50);
    expect(d.targetA).toBe(Math.ceil((3000 - d.thresholdW) / 50));
  });
});

// --- Grid-friendly: the export-budget frame -----------------------------------------
//
// The mode's point is to *lower* midday feed-in, which means the battery must be
// charged out of energy that would otherwise have been exported — not just out
// of the excess the export limit blocks. So `export + charge` is held inside the
// export budget, and the level is solved against the *clamped* export curve
// (`min(pv − load, budget)`), which is what the grid actually sees.

describe("decideTargetA — grid-friendly export budget", () => {
  // One hour of hard clipping: 12 kW against an 8 kW limit.
  const clipping = slice(12, [12_000, 12_000, 12_000, 12_000]);

  const gf = (over: Partial<GridFriendlyConfig> = {}) => ({
    ...baseInputs,
    mode: "grid-friendly" as const,
    gridFriendly: gridFriendly({ chargeSlewAPerMin: 0, ...over }),
  });

  test("feed-in level drops below the limit even when the peak alone overfills the pack", () => {
    // 1.5 kWh of headroom against 4 kWh above the limit. The old search gave up
    // here and pinned the level at the limit, which is no flattening at all.
    const d = decideTargetA({ ...gf(), socPct: 90, pvW: 12_000, forecast: clipping });
    expect(d.thresholdW).toBe(6500);
    expect(exportSurplusAbove(clipping, d.thresholdW)).toBeCloseTo(1.5, 6);
  });

  test("charge plus feed-in never exceeds the export budget", () => {
    const d = decideTargetA({ ...gf(), socPct: 90, pvW: 12_000, forecast: clipping });
    // 30 A × 50 V = 1500 W of charging, 6500 W of export: 8000 W, the budget.
    expect(d.targetA).toBe(30);
    expect(d.targetA * 50 + d.thresholdW).toBe(8000);
  });

  test("PV above the budget is not harvested — that is the price of the flattening", () => {
    // Raising PV from 8 kW to 20 kW cannot buy more charging: everything above
    // `budget` is thrown away so the feed-in level can stay down.
    const at = (pvW: number) => decideTargetA({ ...gf(), socPct: 90, pvW, forecast: clipping });
    expect(at(20_000).targetA).toBe(at(8000).targetA);
  });

  test("level respects the configured feed-in floor", () => {
    // 7.5 kWh of headroom wants a 500 W level, but the floor holds it at 5000 W
    // and the pack simply does not fill today.
    const d = decideTargetA({
      ...gf({ minThresholdW: 5000 }),
      socPct: 50,
      pvW: 12_000,
      forecast: clipping,
    });
    expect(d.thresholdW).toBe(5000);
    expect(d.targetA).toBe(60); // (8000 − 5000) / 50 V
  });

  test("charge current ramps instead of stepping to the target", () => {
    const inputs = {
      ...gf({ chargeSlewAPerMin: 10 }),
      socPct: 90,
      pvW: 12_000,
      forecast: clipping,
    };
    // 30 A is wanted, but a 30 s tick may only travel 5 A.
    expect(decideTargetA({ ...inputs, previousTargetA: 0 }).targetA).toBe(5);
    expect(decideTargetA({ ...inputs, previousTargetA: 25 }).targetA).toBe(30);
    // …and down as well: dropping the ceiling in one step is just as abrupt.
    expect(decideTargetA({ ...inputs, previousTargetA: 60 }).targetA).toBe(55);
    // No previous target (first tick after a release) starts where it likes.
    expect(decideTargetA({ ...inputs, previousTargetA: null }).targetA).toBe(30);
  });

  test("maximize-exports never ramps — a real peak has to be met at once", () => {
    const d = decideTargetA({
      ...baseInputs,
      gridFriendly: gridFriendly({ chargeSlewAPerMin: 10 }),
      previousTargetA: 0,
      pvW: 12_000,
      forecast: clipping,
    });
    expect(d.targetA).toBe(80); // (12_000 − 8000) / 50 V, unramped
  });

  test("a day below the budget behaves as before", () => {
    // Nothing is clipped, so the clamp is inert and the level is the plain
    // water-fill of the day's export curve.
    const gentle = slice(12, [6000, 6000, 6000, 6000]);
    const d = decideTargetA({ ...gf(), socPct: 90, pvW: 6000, forecast: gentle });
    expect(d.thresholdW).toBe(4500);
    expect(d.targetA).toBe(30);
  });

  test("solar-sell max power is required for grid-friendly", () => {
    const without = profileWith({ "setting.solar_sell.max_power": "" });
    expect(resolvePeakShavingBlockers(without, weather(), "grid-friendly")).toEqual([
      { kind: "role", role: "setting.solar_sell.max_power" },
    ]);
    // maximize-exports holds feed-in at the plant limit, so it needs no such write.
    expect(resolvePeakShavingBlockers(without, weather(), "maximize-exports")).toEqual([]);
  });
});

// --- House-load frame --------------------------------------------------------------
//
// Curtailment starts when PV exceeds `load + exportLimit` — the frame the
// forecast's clipping model already uses. Thresholds must live in that same
// feed-in frame instead of being compared against raw PV.

describe("decideTargetA — house-load frame", () => {
  test("live load defers live shaving until PV clears load + limit", () => {
    const forecast = slice(13, [0, 0]); // nothing coming → no peak to reserve for
    // 9000 W PV with 2000 W of house load only feeds 7000 W: below the limit.
    const d = decideTargetA({ ...baseInputs, pvW: 9000, liveLoadW: 2000, forecast });
    expect(d.liveExcessW).toBe(0);
    expect(d.targetA).toBe(25); // fallback, not a shave
    // Once PV clears load + limit the excess is real again.
    const shaving = decideTargetA({ ...baseInputs, pvW: 11_000, liveLoadW: 2000, forecast });
    expect(shaving.liveExcessW).toBe(1000);
    expect(shaving.targetA).toBe(20);
  });

  test("EV draw already inside the load metric is not double-counted", () => {
    const forecast = slice(13, [0, 0]);
    const inputs = { ...baseInputs, pvW: 12_000, liveLoadW: 3000, evChargeW: 2000, forecast };
    // Charger behind the house meter: the 2 kW is part of the 3 kW load.
    expect(decideTargetA({ ...inputs, evIncludedInLoad: true }).liveExcessW).toBe(1000);
    // Charger on its own meter: both sinks count.
    expect(decideTargetA({ ...inputs, evIncludedInLoad: false }).liveExcessW).toBe(0);
  });

  test("baseline load shrinks the remaining-day surplus", () => {
    // 4 slots of 9000 W = 1 kWh above an 8000 W limit, but 1000 W of baseline
    // load eats exactly that — nothing reaches the grid above the limit.
    const forecast = slice(13, [9000, 9000, 9000, 9000]);
    expect(decideTargetA({ ...baseInputs, forecast }).surplusAboveLimitKwh).toBeCloseTo(1, 6);
    const withLoad = decideTargetA({ ...baseInputs, forecast, baselineLoadW: 1000 });
    expect(withLoad.surplusAboveLimitKwh).toBe(0);
  });

  test("baseline load lowers the grid-friendly plateau", () => {
    const bell = slice(
      12,
      [2, 4, 6, 8, 10, 12, 12, 10, 8, 6, 4, 2].map((kw) => kw * 1000),
    );
    const inputs = { ...baseInputs, mode: "grid-friendly" as const, socPct: 70, forecast: bell };
    const bare = decideTargetA(inputs);
    // With 1 kW of standing load, less of the day's PV is exportable, so the
    // same battery headroom has to be filled from a lower feed-in plateau…
    const loaded = decideTargetA({ ...inputs, baselineLoadW: 1000 });
    expect(loaded.thresholdW).toBeLessThan(bare.thresholdW);
    // …and the reported surplus is the feed-in-frame figure.
    expect(loaded.surplusAboveLimitKwh).toBeLessThan(bare.surplusAboveLimitKwh ?? 0);
  });
});

// --- Grid-friendly options ---------------------------------------------------------

describe("decideTargetA — grid-friendly options", () => {
  const bell = slice(
    12,
    [2, 4, 6, 8, 10, 12, 12, 10, 8, 6, 4, 2].map((kw) => kw * 1000),
  );
  const smallDay = slice(13, [3000, 3000]);

  test("minThresholdW floors the plateau so some feed-in always flows", () => {
    const inputs = {
      ...baseInputs,
      mode: "grid-friendly" as const,
      socPct: 10,
      pvW: 3000,
      forecast: smallDay,
    };
    expect(decideTargetA(inputs).thresholdW).toBeLessThan(50); // absorbs everything
    const floored = decideTargetA({
      ...inputs,
      gridFriendly: gridFriendly({ minThresholdW: 2000 }),
    });
    expect(floored.thresholdW).toBe(2000);
    expect(floored.targetA).toBe(20); // (3000 − 2000) / 50 V
  });

  test("a min threshold at or above the limit degenerates to a classic shave", () => {
    const inputs = {
      ...baseInputs,
      mode: "grid-friendly" as const,
      socPct: 50,
      forecast: bell,
      gridFriendly: gridFriendly({ minThresholdW: 20_000 }),
    };
    expect(decideTargetA(inputs).thresholdW).toBe(8000);
  });

  test("forecastTrustPct below 100 lowers the plateau (charges earlier)", () => {
    const inputs = { ...baseInputs, mode: "grid-friendly" as const, socPct: 70, forecast: bell };
    const trusted = decideTargetA(inputs);
    const hedged = decideTargetA({
      ...inputs,
      gridFriendly: gridFriendly({ forecastTrustPct: 70 }),
    });
    expect(hedged.thresholdW).toBeLessThan(trusted.thresholdW);
    // Only 70% of the forecast surplus is believed, so the search must gather
    // headroom/0.7 of nominal surplus above the plateau.
    expect(exportSurplusAbove(bell, hedged.thresholdW)).toBeCloseTo(4.5 / 0.7, 1);
  });

  test("forecastTrustPct above 100 raises the plateau (charges later)", () => {
    const inputs = { ...baseInputs, mode: "grid-friendly" as const, socPct: 70, forecast: bell };
    const eager = decideTargetA({
      ...inputs,
      gridFriendly: gridFriendly({ forecastTrustPct: 130 }),
    });
    expect(eager.thresholdW).toBeGreaterThan(decideTargetA(inputs).thresholdW);
  });

  test("slew caps how far the plateau moves in one tick", () => {
    const inputs = {
      ...baseInputs,
      mode: "grid-friendly" as const,
      socPct: 70,
      forecast: bell,
      previousThresholdW: 8000,
      sinceLastDecisionMs: 30_000, // half a minute of budget
    };
    const undamped = decideTargetA({ ...inputs, gridFriendly: gridFriendly({ slewWPerMin: 0 }) });
    // 4.5 kWh of headroom fills from 1.5 h above 8 kW plus the 6 kW shoulders.
    expect(undamped.thresholdW).toBeCloseTo(5250, 2);
    // 600 W/min × 0.5 min = 300 W of movement allowed.
    const damped = decideTargetA({ ...inputs, gridFriendly: gridFriendly({ slewWPerMin: 600 }) });
    expect(damped.thresholdW).toBe(7700);
  });

  test("slew is symmetric and skipped on the first tick after a release", () => {
    const inputs = {
      ...baseInputs,
      mode: "grid-friendly" as const,
      socPct: 70,
      forecast: bell,
      sinceLastDecisionMs: 60_000,
    };
    // Coming from a very low plateau, the rise is capped the same way.
    const rising = decideTargetA({ ...inputs, previousThresholdW: 1000 });
    expect(rising.thresholdW).toBe(1600);
    // No previous threshold → the solved value lands unclamped.
    expect(decideTargetA({ ...inputs, previousThresholdW: null }).thresholdW).toBeGreaterThan(1600);
  });

  test("reserveForEvDemand=false leaves the car's share out of the plan", () => {
    const inputs = {
      ...baseInputs,
      mode: "grid-friendly" as const,
      socPct: 70,
      forecast: bell,
      evRemainingKwh: 1.5,
    };
    const reserved = decideTargetA(inputs);
    const ignored = decideTargetA({
      ...inputs,
      gridFriendly: gridFriendly({ reserveForEvDemand: false }),
    });
    expect(ignored.thresholdW).toBeGreaterThan(reserved.thresholdW);
    // Identical to the no-car plan: the surplus is left for the car to take.
    expect(ignored.thresholdW).toBeCloseTo(
      decideTargetA({ ...inputs, evRemainingKwh: 0 }).thresholdW,
      6,
    );
  });

  test("grid-friendly rounds to the nearest step, maximize-exports still up", () => {
    // 82% SOC → 2.7 kWh headroom → a 6200 W feed-in level.
    const inputs = { ...baseInputs, socPct: 82, forecast: bell };
    // maximize-exports: 100 W above the limit is 2 A, and it rounds *up* — never
    // under-shave a real peak.
    expect(decideTargetA({ ...inputs, mode: "maximize-exports", pvW: 8100 }).targetA).toBe(5);
    // grid-friendly: 100 W above the level is 0.4 of a step, so it waits.
    expect(decideTargetA({ ...inputs, mode: "grid-friendly", pvW: 6300 }).targetA).toBe(0);
    // Above the half-step the nearest rounding charges.
    expect(decideTargetA({ ...inputs, mode: "grid-friendly", pvW: 6350 }).targetA).toBe(5);
  });
});

// --- Forward projection -------------------------------------------------------------
//
// The plan replays the *same* pure decision over the remaining forecast slots,
// carrying SOC forward — so "when does it charge, when is it full" comes from
// the rules themselves rather than a second, drifting model.

describe("projectPeakShaving", () => {
  // A day that ramps over the export limit at midday and back down.
  const day = slice(
    12,
    [2, 4, 6, 9, 11, 12, 11, 9, 6, 4, 2, 0].map((kw) => kw * 1000),
  );
  const planInputs = (over: object = {}) => ({
    ...baseInputs,
    mode: "grid-friendly" as const,
    forecast: day,
    baselineLoadW: 500,
    socPct: 20,
    ...over,
  });
  const CAP = { exportCapW: 8400 };

  test("carries SOC forward, and stored energy matches the SOC it gained", () => {
    const plan = projectPeakShaving(planInputs(), CAP);
    expect(plan.slots.length).toBe(day.series.length);
    // SOC rises while PV covers the load; only the dark tail (0 kW against the
    // 500 W baseline) discharges. Stored energy is the gross charge, so it
    // matches the *peak* SOC, not the end-of-day one.
    const socs = plan.slots.map((s) => s.socPct);
    const peakSoc = Math.max(...socs);
    expect(socs.indexOf(peakSoc)).toBe(socs.length - 2); // rise, then the dark dip
    expect(plan.storedKwh).toBeCloseTo((baseInputs.usableKwh * (peakSoc - 20)) / 100, 6);
    // The level keeps feed-in flowing all day, so this day cannot fill a 15 kWh
    // pack from 20% — the plan says so instead of promising a full battery.
    // 89.6% at the peak, minus the last slot's 500 W × 15 min drain.
    expect(peakSoc).toBeCloseTo(89.6, 1);
    expect(plan.endSocPct).toBeCloseTo(88.75, 2);
    expect(plan.fullAt).toBeNull();
  });

  test("reports when the pack fills, when it can", () => {
    // 8 kWh usable from 20% needs 6.4 kWh — inside what this day delivers.
    const plan = projectPeakShaving(planInputs({ usableKwh: 8 }), CAP);
    // Full at midday; the dark last slot then drains 500 W × 15 min.
    expect(plan.endSocPct).toBeCloseTo(98.4, 1);
    expect(plan.fullAt).not.toBeNull();
    // Full somewhere inside the plotted day, after the first slot.
    expect(plan.fullAt!).toBeGreaterThan(plan.slots[0]!.t);
    expect(plan.fullAt!).toBeLessThanOrEqual(plan.slots.at(-1)!.t + 15 * 60_000);
    // …and it stops charging once there (the tail slots only sell).
    expect(plan.slots.at(-1)?.chargeW).toBe(0);
  });

  test("reports the slot charging starts in", () => {
    // Noon is exactly the first slot's start, so nothing is clamped here.
    const plan = projectPeakShaving(planInputs(), CAP);
    const firstCharging = plan.slots.find((s) => s.chargeW > 0);
    expect(plan.chargeStartsAt).toBe(firstCharging?.t ?? null);
  });

  test("charging already under way is reported as now, not in the past", () => {
    // Mid-slot: the running slot began 8 minutes ago and is already charging, so
    // the answer is "now" — a start time in the past would just read as wrong.
    const nowMs = NOON + 8 * 60_000;
    const plan = projectPeakShaving(planInputs({ mode: "maximize-exports", nowMs }), CAP);
    expect(plan.slots[0]!.t).toBeLessThan(nowMs); // the slot itself still starts earlier
    expect(plan.slots[0]!.chargeW).toBeGreaterThan(0);
    expect(plan.chargeStartsAt).toBe(nowMs);
  });

  test("a plan that never charges reports no start and drains into the load", () => {
    // Night: no PV left, so the pack serves the 500 W baseline for the hour.
    const plan = projectPeakShaving(planInputs({ forecast: slice(12, [0, 0, 0, 0]) }), CAP);
    expect(plan.chargeStartsAt).toBeNull();
    expect(plan.fullAt).toBeNull();
    expect(plan.slots.every((s) => s.dischargeW === 500)).toBe(true);
    // 0.5 kWh out of 15 kWh usable ≈ 3.3% below the starting 20%.
    expect(plan.endSocPct).toBeCloseTo(16.7, 1);
    expect(plan.storedKwh).toBe(0);
  });

  test("the modelled discharge stops at the reserve floor", () => {
    // 2 kW of load against no PV wants 2 kWh, but only 0.3 kWh (22% → 20% of
    // 15 kWh) sit above the floor — the drain flattens out there.
    const plan = projectPeakShaving(
      planInputs({ forecast: slice(12, [0, 0, 0, 0]), socPct: 22, baselineLoadW: 2000 }),
      { exportCapW: 8400, reserveSocPct: 20 },
    );
    expect(plan.endSocPct).toBeCloseTo(20, 5);
    expect(plan.slots.at(-1)?.dischargeW).toBe(0);
  });

  test("nothing left of the local day → an empty plan", () => {
    const plan = projectPeakShaving(planInputs({ nowMs: Date.parse("2026-07-25T23:59:00Z") }), CAP);
    expect(plan.slots).toEqual([]);
    expect(plan.endSocPct).toBe(20);
  });

  test("caps export at the plant limit and curtails the rest", () => {
    // A 1 kWh battery fills almost immediately, so the midday peak above the
    // 8.4 kW cap has nowhere left to go.
    const plan = projectPeakShaving(planInputs({ usableKwh: 1 }), CAP);
    expect(Math.max(...plan.slots.map((s) => s.exportW))).toBeLessThanOrEqual(CAP.exportCapW);
    expect(plan.curtailedKwh).toBeGreaterThan(0);
    // Full at midday; the dark last slot then drains 500 W × 15 min of the 1 kWh.
    expect(plan.fullAt).not.toBeNull();
    expect(plan.endSocPct).toBeCloseTo(87.5, 2);
  });

  test("even a big battery cannot rescue PV above the budget in grid-friendly", () => {
    // Feed-in plus charging stay inside the export budget, so the peak above it
    // is discarded no matter how much room the pack has — that discard is the
    // price of the lower feed-in curve.
    const plan = projectPeakShaving(planInputs({ usableKwh: 40 }), CAP);
    expect(plan.curtailedKwh).toBeGreaterThan(0);
    expect(plan.endSocPct).toBeLessThan(100);
    // maximize-exports, with the same room, throws nothing away.
    const soaking = projectPeakShaving(
      planInputs({ usableKwh: 40, mode: "maximize-exports" }),
      CAP,
    );
    expect(soaking.curtailedKwh).toBe(0);
  });

  test("never charges beyond a full pack", () => {
    const plan = projectPeakShaving(planInputs({ socPct: 99.9 }), CAP);
    expect(plan.endSocPct).toBeLessThanOrEqual(100);
    expect(plan.storedKwh).toBeLessThan(0.2);
  });

  test("grid-friendly plans a lower feed-in peak than maximize-exports", () => {
    const grid = projectPeakShaving(planInputs(), CAP);
    const exports_ = projectPeakShaving(planInputs({ mode: "maximize-exports" }), CAP);
    const peakExportW = (p: typeof grid) => Math.max(...p.slots.map((s) => s.exportW));
    // The whole point of the mode: the grid sees less at midday…
    expect(peakExportW(grid)).toBeLessThan(peakExportW(exports_));
    // …and it is paid for in PV that neither the grid nor the pack takes.
    expect(grid.curtailedKwh).toBeGreaterThan(exports_.curtailedKwh);
    expect(grid.storedKwh).toBeGreaterThan(0);
    expect(exports_.storedKwh).toBeGreaterThan(0);
  });

  test("does not spend headroom on PV the plant could still export", () => {
    // 3 h of plateau sitting inside the safety-buffer band — 8850 W of PV less
    // the 500 W load feeds 8350 W, under the 8400 W plant cap, so not one watt
    // of it was ever going to be lost — followed by 30 min of real clipping at
    // 12 kW. The pack holds just enough for that clipping peak (1.55 kWh of hard
    // excess into 1.8 kWh of headroom), so every kWh taken from the band is a
    // kWh missing when the peak arrives.
    const plateauThenPeak = slice(12, [...Array(12).fill(8850), 12_000, 12_000, 0]);
    const plan = projectPeakShaving(
      planInputs({
        mode: "maximize-exports",
        forecast: plateauThenPeak,
        exportCapW: 8400,
        usableKwh: 2.25,
      }),
      CAP,
    );
    expect(plan.curtailedKwh).toBe(0);
    // The band stayed with the grid: the plateau slots store nothing and sell all of it.
    const plateau = plan.slots.slice(0, 12);
    expect(plateau.map((s) => s.chargeW)).toEqual(Array(12).fill(0));
    expect(plateau.map((s) => s.exportW)).toEqual(Array(12).fill(8350));
    // …and the pack did fill on the peak instead.
    expect(plan.slots[12]!.chargeW).toBeGreaterThan(3000);
  });

  test("the charge-current round-up never eats PV the plant could still export", () => {
    // One clipping slot. 9000 W of PV less the 500 W load leaves 8500 W, of
    // which only 100 W sits above the 8400 W the plant can physically push out
    // — the other 8400 W is sold. 100 W at 50 V is 2 A, and the 5 A register
    // grid rounds that up to 5 A = 250 W, so the pack would swallow 150 W the
    // grid was going to pay for. Headroom (0.3 kWh at 97 %) sits inside the
    // reserve margin of the 0.125 kWh peak, so this is the hard-excess-only
    // branch: the buffer band is deliberately left to the grid.
    const spike = slice(12, [9000, 0]);
    const plan = projectPeakShaving(
      planInputs({
        mode: "maximize-exports",
        forecast: spike,
        exportCapW: 8400,
        usableKwh: 10,
        socPct: 97,
      }),
      CAP,
    );
    const peak = plan.slots[0]!;
    // The write stays a legal multiple of the quantum — the inverter rejects
    // anything else — but only the true excess is spent.
    expect(peak.targetA).toBe(5);
    expect(peak.chargeW).toBe(100);
    expect(peak.exportW).toBe(8400);
    expect(peak.curtailedW).toBe(0);
  });

  test("a light-clipping day sells the round-up instead of storing it", () => {
    // Throttling absorption is exactly the change that could leave the pack
    // short after sunset, so pin the end SOC on a day whose clipping is a single
    // slot. The buffer band is still absorbed here (12 kWh of headroom against a
    // peak that claims almost none) — but only the band itself: 350 W per
    // plateau slot, not the 500 W its 10 A write would have taken. The 150 W
    // difference is a sale, not a loss, so the missing 1.5 % of SOC has an
    // exact counterpart in `exportedKwh`.
    const light = slice(12, [8850, 8850, 8850, 8850, 9000, 8850, 8850, 0]);
    const inputs = planInputs({ mode: "maximize-exports", forecast: light, exportCapW: 8400 });
    const plan = projectPeakShaving(inputs, CAP);
    expect(plan.curtailedKwh).toBe(0);
    // Six 8850 W slots absorb their 350 W band, the 9000 W slot its 500 W, and
    // the dark tail drains 500 W for a quarter hour.
    expect(plan.slots.slice(0, 4).map((s) => s.chargeW)).toEqual(Array(4).fill(350));
    expect(plan.slots[4]!.chargeW).toBe(500);
    expect(plan.storedKwh).toBeCloseTo(0.65, 6);
    expect(plan.endSocPct).toBeCloseTo(23.5, 5);
    // Feed-in lands exactly on the decision's own threshold rather than 150 W
    // under it: the plan now spends what the threshold said it would.
    expect(plan.slots.slice(0, 4).map((s) => s.exportW)).toEqual(Array(4).fill(8000));
  });

  test("the house load is served before anything can be stored or sold", () => {
    const plan = projectPeakShaving(planInputs({ baselineLoadW: 2000 }), CAP);
    // First slot is 2 kW of PV against 2 kW of load: nothing to store or sell.
    expect(plan.slots[0]).toMatchObject({ chargeW: 0, exportW: 0, curtailedW: 0 });
  });
});

// --- EVCC inputs -------------------------------------------------------------------

describe("evccAutomationInputs", () => {
  test("absent or unreachable EVCC degrades to zeros", () => {
    expect(evccAutomationInputs(null)).toEqual({ evChargeW: 0, evRemainingKwh: 0 });
    const state = evccState([loadpoint({ chargePowerLive: 5000 })], false);
    expect(evccAutomationInputs(state)).toEqual({ evChargeW: 0, evRemainingKwh: 0 });
  });

  test("sums live charge power and remaining demand across loadpoints", () => {
    const state = evccState([
      loadpoint({ chargePowerLive: 7000, chargeRemainingEnergy: 12_000 }),
      loadpoint({ index: 2, chargePowerLive: 4000, chargeRemainingEnergy: 3000 }),
    ]);
    expect(evccAutomationInputs(state)).toEqual({ evChargeW: 11_000, evRemainingKwh: 15 });
  });

  test("demand only counts connected loadpoints allowed to charge", () => {
    const state = evccState([
      loadpoint({ mode: "off", chargeRemainingEnergy: 9000 }),
      loadpoint({ index: 2, connected: false, chargeRemainingEnergy: 9000 }),
      loadpoint({ index: 3, mode: null, chargeRemainingEnergy: 9000 }),
      loadpoint({ index: 4, mode: "minpv", chargeRemainingEnergy: 2000 }),
    ]);
    expect(evccAutomationInputs(state)).toEqual({ evChargeW: 0, evRemainingKwh: 2 });
  });

  test("derives the demand from the SOC gap when EVCC reports none", () => {
    // The bug this pins: a car plugged in and waiting for surplus at 73% with a
    // 75% limit reported 0.0 kWh, so nothing was reserved for it.
    const state = evccState([
      loadpoint({ vehicleSoc: 73, effectiveLimitSoc: 75, vehicleCapacityKwh: 75 }),
    ]);
    // 2% of 75 kWh, grossed up by the 90% charge efficiency EVCC assumes.
    expect(evccAutomationInputs(state).evRemainingKwh).toBeCloseTo(1.667, 3);
  });

  test("the car's own limit caps the derived gap", () => {
    // Live shape: EVCC would charge to 80%, the car is set to stop at 75%.
    const state = evccState([
      loadpoint({
        vehicleSoc: 74,
        effectiveLimitSoc: 80,
        vehicleLimitSoc: 75,
        vehicleCapacityKwh: 79,
      }),
    ]);
    expect(evccAutomationInputs(state).evRemainingKwh).toBeCloseTo(0.878, 3);
  });

  test("a limit of 0 means no limit, so the other one decides", () => {
    const state = evccState([
      loadpoint({
        vehicleSoc: 74,
        effectiveLimitSoc: 80,
        vehicleLimitSoc: 0,
        vehicleCapacityKwh: 79,
      }),
    ]);
    expect(evccAutomationInputs(state).evRemainingKwh).toBeCloseTo(5.267, 3);
  });

  test("EVCC's own estimate wins over the derived gap", () => {
    const state = evccState([
      loadpoint({
        chargeRemainingEnergy: 4000,
        vehicleSoc: 50,
        effectiveLimitSoc: 80,
        vehicleCapacityKwh: 75,
      }),
    ]);
    expect(evccAutomationInputs(state).evRemainingKwh).toBe(4);
  });

  test("no demand is derived without an SOC, a limit or a pack size", () => {
    const full = { vehicleSoc: 73, effectiveLimitSoc: 75, vehicleCapacityKwh: 75 };
    const cases: Partial<EvccLoadpoint>[] = [
      { ...full, vehicleSoc: null },
      { ...full, effectiveLimitSoc: null },
      { ...full, vehicleCapacityKwh: null },
      // Already at (or past) the limit: nothing left to want.
      { ...full, vehicleSoc: 75 },
      { ...full, vehicleSoc: 80 },
    ];
    for (const over of cases) {
      expect(evccAutomationInputs(evccState([loadpoint(over)])).evRemainingKwh).toBe(0);
    }
  });
});

describe("decideTargetA — EV interplay", () => {
  // Same midday bell as the grid-friendly suite: 2→12 kW and back, 15-min slots.
  const bell = slice(
    12,
    [2, 4, 6, 8, 10, 12, 12, 10, 8, 6, 4, 2].map((kw) => kw * 1000),
  );

  test("live EV draw is subtracted before shaving", () => {
    const forecast = slice(13, [0, 0]);
    const without = decideTargetA({ ...baseInputs, pvW: 9500, forecast });
    const withEv = decideTargetA({ ...baseInputs, pvW: 9500, evChargeW: 1500, forecast });
    expect(without.targetA).toBe(30);
    // The car already absorbs the whole excess → nothing to shave; small
    // remaining day + full headroom → fallback charging instead.
    expect(withEv.targetA).toBe(25);
  });

  test("EV demand frees held headroom for fallback charging", () => {
    // 6 kWh above the limit vs 5.7 kWh headroom at 62% → hold without the car.
    const forecast = slice(13, Array(8).fill(11_000));
    const inputs = { ...baseInputs, socPct: 62, pvW: 4000, forecast };
    expect(decideTargetA(inputs).targetA).toBe(0);
    // The car will eat 2 kWh of that peak → room to spare → fallback rate.
    expect(decideTargetA({ ...inputs, evRemainingKwh: 2 }).targetA).toBe(25);
  });

  test("grid-friendly lowers the plateau to cover the car's cut", () => {
    const inputs = { ...baseInputs, mode: "grid-friendly" as const, socPct: 70, forecast: bell };
    const without = decideTargetA(inputs);
    const withEv = decideTargetA({ ...inputs, evRemainingKwh: 1.5 });
    // Battery headroom AND the car must fill from above the threshold.
    expect(withEv.thresholdW).toBeLessThan(without.thresholdW);
    expect(exportSurplusAbove(bell, withEv.thresholdW)).toBeCloseTo(4.5 + 1.5, 1);
  });

  test("grid-friendly EV demand lowers the level further", () => {
    const inputs = { ...baseInputs, mode: "grid-friendly" as const, socPct: 82, forecast: bell };
    expect(decideTargetA(inputs).thresholdW).toBeCloseTo(6200, 0);
    expect(decideTargetA({ ...inputs, evRemainingKwh: 1 }).thresholdW).toBeLessThan(8000);
  });

  test("grid-friendly charges with what the car leaves below the budget", () => {
    // 2.25 kWh headroom at 85% → a 6500 W level; PV is far above the 8 kW budget,
    // so the charge is the budget minus the level: 1500 W = 30 A.
    const inputs = {
      ...baseInputs,
      mode: "grid-friendly" as const,
      socPct: 85,
      pvW: 12_000,
      forecast: bell,
    };
    expect(decideTargetA(inputs).targetA).toBe(30);
    // With PV above the budget the car's kW comes out of what was being thrown
    // away, so the pack's ceiling is untouched.
    expect(decideTargetA({ ...inputs, evChargeW: 1000 }).targetA).toBe(30);
    // Below the budget there is nothing spare: the car is served before the pack.
    expect(decideTargetA({ ...inputs, pvW: 8000 }).targetA).toBe(30);
    expect(decideTargetA({ ...inputs, pvW: 8000, evChargeW: 1000 }).targetA).toBe(10);
  });
});

// --- Blockers + enable guard -----------------------------------------------------

describe("resolvePeakShavingBlockers", () => {
  test("all mapped and configured → no blockers", () => {
    expect(resolvePeakShavingBlockers(profileWith(), weather())).toEqual([]);
  });

  test.each(["pv.total.power", "battery.soc"] as const)("missing role %s blocks", (role) => {
    const profile = profileWith({ [role]: undefined });
    expect(resolvePeakShavingBlockers(profile, weather())).toEqual([{ kind: "role", role }]);
  });

  test("a power-denominated charge ceiling satisfies the same requirement", () => {
    // Victron/SMA and friends set the battery limit in watts. The requirement is
    // "a charge ceiling this automation can steer", not "an ampere register".
    const profile = profileWith({
      "setting.battery.max_charge_current": "",
      "setting.battery.max_charge_power": CHARGE_KEY,
    });
    expect(resolvePeakShavingBlockers(profile, weather())).toEqual([]);
  });

  test("neither denomination mapped blocks, naming the conventional role", () => {
    const profile = profileWith({ "setting.battery.max_charge_current": "" });
    expect(resolvePeakShavingBlockers(profile, weather())).toEqual([
      { kind: "role", role: "setting.battery.max_charge_current" },
    ]);
  });

  test("battery.voltage is optional", () => {
    const profile = profileWith({ "battery.voltage": undefined });
    expect(resolvePeakShavingBlockers(profile, weather())).toEqual([]);
  });

  test("missing plant config blocks", () => {
    expect(resolvePeakShavingBlockers(profileWith(), weather({ maxOutputW: null }))).toEqual([
      { kind: "config", what: "export-limit" },
    ]);
    expect(resolvePeakShavingBlockers(profileWith(), weather({ battery: null }))).toEqual([
      { kind: "config", what: "battery" },
    ]);
  });
});

describe("validateAutomationEnable", () => {
  test("master enable without accepted disclaimer is rejected", () => {
    const cfg = config({ disclaimerAcceptedAt: null }, { enabled: false });
    expect(validateAutomationEnable(cfg, profileWith(), weather())?.error).toContain("disclaimer");
  });

  test("peak shaving without the master gate is rejected", () => {
    const cfg = config({ enabled: false, disclaimerAcceptedAt: null });
    expect(validateAutomationEnable(cfg, profileWith(), weather())?.error).toContain("master");
  });

  test("peak shaving with blockers is rejected and carries them", () => {
    const result = validateAutomationEnable(config(), profileWith(), weather({ battery: null }));
    expect(result?.blockers).toEqual([{ kind: "config", what: "battery" }]);
  });

  test("no active profile is rejected", () => {
    expect(validateAutomationEnable(config(), null, weather())?.error).toContain("profile");
  });

  test("valid enables pass", () => {
    expect(validateAutomationEnable(config(), profileWith(), weather())).toBeNull();
    const offCfg = config({ enabled: false, disclaimerAcceptedAt: null }, { enabled: false });
    expect(validateAutomationEnable(offCfg, null, weather())).toBeNull();
  });
});

// --- Engine tick state machine ----------------------------------------------------

interface Harness {
  io: AutomationIO;
  writes: { key: string; value: number }[];
  /** Every EVCC command the engine published, in order — the order is contractual. */
  evccCommands: { loadpoint: number; action: EvccAction; value: string }[];
  set: {
    config(c: AutomationConfig): void;
    weather(w: WeatherConfig): void;
    forecast(f: SolarForecast | null): void;
    evcc(state: EvccState | null): void;
    baselineLoad(w: number | null): void;
    sample(metrics: Record<string, number>, ageMs?: number): void;
    now(ms: number): void;
    state(s: AutomationState): void;
    /** Make every EVCC command throw, as an unreachable broker does. */
    evccError(message: string | null): void;
    /**
     * Point the write funnel at another profile context — pair it with an
     * `{ ...h.io, ctx }` override so the engine and the funnel it writes
     * through agree on which profile is active.
     */
    ctx(c: ProfileContext): void;
  };
  state(): AutomationState;
}

function harness(over: { config?: AutomationConfig; prices?: SpotSlice | null } = {}): Harness {
  const ctx = buildProfileContext(profileWith());
  let writeCtx: ProfileContext = ctx;
  let cfg = over.config ?? config();
  let wx = weather();
  let prices: SpotSlice | null = over.prices ?? null;
  const evccCommands: Harness["evccCommands"] = [];
  let evccError: string | null = null;
  let fc: SolarForecast | null = asForecast(slice(12, [6000, 6000, 6000, 6000]));
  let ev: EvccState | null = null;
  let baselineLoadW: number | null = null;
  let nowMs = NOON;
  let sample: InverterSample | null = null;
  let state: AutomationState = {};
  const writes: { key: string; value: number }[] = [];

  const setSample = (metrics: Record<string, number>, ageMs = 0) => {
    sample = {
      time: new Date(nowMs - ageMs).toISOString(),
      inverterId: "test-profile",
      metrics,
    };
  };
  setSample({ [PV_KEY]: 5000, [SOC_KEY]: 50, [VOLT_KEY]: 50, [CHARGE_KEY]: 120 });

  return {
    io: {
      ctx,
      // The engine writes through the production funnel, which owns the
      // validation every entry point shares; only the transport is a double.
      write: createControlWriter({
        getSource: () => ({
          profile: ctx.profile,
          read: async () => ({ time: "", inverterId: "test-profile", metrics: {} }),
          write: async (key, value) => {
            writes.push({ key, value });
            // Mirror the register readback the next poll would deliver.
            if (sample) sample.metrics[key] = value;
          },
          close: async () => {},
        }),
        getContext: () => writeCtx,
        store: { get: async () => ({}), set: async () => {} },
        readLive: (target) => sample?.metrics[target],
      }).write,
      getConfig: async () => cfg,
      // No price feed unless a case installs one: every existing engine test
      // must keep exercising the unchanged shaving path.
      getPrices: async () => prices,
      getTariff: async () => tariffConfigSchema.parse({}),
      evccCommand: (loadpoint, action, value) => {
        if (evccError) throw new Error(evccError);
        evccCommands.push({ loadpoint, action, value });
      },
      getWeather: async () => wx,
      getForecast: async () => fc,
      getBaselineLoadW: async () => baselineLoadW,
      getEvcc: () => ev,
      latestSample: () => sample,
      loadState: async () => state,
      saveState: async (next) => {
        state = next;
      },
      now: () => nowMs,
    },
    writes,
    set: {
      config: (c) => (cfg = c),
      weather: (w) => (wx = w),
      forecast: (f) => (fc = f),
      evcc: (state) => (ev = state),
      baselineLoad: (w) => (baselineLoadW = w),
      sample: setSample,
      now: (ms) => (nowMs = ms),
      state: (s) => (state = s),
      evccError: (message) => (evccError = message),
      ctx: (c) => (writeCtx = c),
    },
    evccCommands,
    state: () => state,
  };
}

describe("peak-shaving engine", () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  test("activation snapshots the user value, then steers", async () => {
    const engine = createPeakShavingEngine(h.io);
    const status = await engine.tick();
    expect(status.state).toBe("active");
    expect(status.restorePending).toBe(true);
    expect(h.state()["test-profile:peakShaving"]?.previousValue).toBe(120);
    // 50% SOC, small forecast surplus → fallback rate (default 50 A).
    expect(h.writes).toEqual([{ key: CHARGE_KEY, value: 50 }]);
  });

  test("writes only on change", async () => {
    const engine = createPeakShavingEngine(h.io);
    await engine.tick();
    await engine.tick();
    await engine.tick();
    expect(h.writes).toHaveLength(1);
  });

  test("re-asserts after an external register edit and flags the override", async () => {
    const engine = createPeakShavingEngine(h.io);
    await engine.tick();
    h.set.sample({ [PV_KEY]: 5000, [SOC_KEY]: 50, [VOLT_KEY]: 50, [CHARGE_KEY]: 80 });
    const status = await engine.tick();
    expect(status.externalOverride).toBe(true);
    expect(h.writes).toHaveLength(2);
    expect(h.writes[1]).toEqual({ key: CHARGE_KEY, value: 50 });
  });

  test("stale sample halts all writes", async () => {
    const engine = createPeakShavingEngine(h.io);
    h.set.sample({ [PV_KEY]: 5000, [SOC_KEY]: 50, [CHARGE_KEY]: 120 }, 60_000);
    const status = await engine.tick();
    expect(status.state).toBe("stale");
    expect(h.writes).toHaveLength(0);
    expect(h.state()).toEqual({});
  });

  test("missing sample metrics halt writes", async () => {
    const engine = createPeakShavingEngine(h.io);
    h.set.sample({ [SOC_KEY]: 50 });
    expect((await engine.tick()).state).toBe("stale");
    expect(h.writes).toHaveLength(0);
  });

  test("night gate restores and idles, and re-activates at dawn", async () => {
    const engine = createPeakShavingEngine(h.io);
    await engine.tick();
    expect(h.writes).toHaveLength(1);
    // Sun gone: PV 0 and nothing imminent in the forecast.
    h.set.sample({ [PV_KEY]: 0, [SOC_KEY]: 50, [VOLT_KEY]: 50, [CHARGE_KEY]: 50 });
    h.set.forecast(asForecast(slice(12, [0, 0, 0, 0]), 0));
    const night = await engine.tick();
    expect(night.state).toBe("idle");
    expect(h.writes[1]).toEqual({ key: CHARGE_KEY, value: 120 }); // restored
    expect(h.state()).toEqual({});
    // Dawn: PV still 0 but the next 15 min promise output → take over again.
    h.set.forecast(asForecast(slice(12, [500, 3000, 6000, 6000]), 500));
    const dawn = await engine.tick();
    expect(dawn.state).toBe("active");
    expect(h.state()["test-profile:peakShaving"]?.previousValue).toBe(120);
  });

  test("disable restores the snapshot and falls back to simulating", async () => {
    const engine = createPeakShavingEngine(h.io);
    await engine.tick();
    h.set.config(config({}, { enabled: false }));
    const status = await engine.tick();
    // Runnable setup in daylight: the disabled engine keeps deciding dry-run.
    expect(status.state).toBe("simulating");
    expect(status.restorePending).toBe(false);
    expect(h.writes[1]).toEqual({ key: CHARGE_KEY, value: 120 });
    expect(h.state()).toEqual({});
  });

  test("master gate off simulates but never writes", async () => {
    h.set.config(config({ enabled: false }));
    const engine = createPeakShavingEngine(h.io);
    const status = await engine.tick();
    expect(status.state).toBe("simulating");
    expect(status.enabled).toBe(false);
    expect(status.targetA).toBe(50); // same call a live run would make
    expect(h.writes).toHaveLength(0);
    expect(h.state()).toEqual({}); // no snapshot: nothing is held
  });

  test("disabled with blockers or at night parks in plain disabled", async () => {
    h.set.config(config({ enabled: false }));
    const engine = createPeakShavingEngine(h.io);
    h.set.weather(weather({ maxOutputW: null }));
    const blocked = await engine.tick();
    expect(blocked.state).toBe("disabled");
    expect(blocked.blockers).toEqual([{ kind: "config", what: "export-limit" }]);
    h.set.weather(weather());
    h.set.sample({ [PV_KEY]: 0, [SOC_KEY]: 50, [VOLT_KEY]: 50, [CHARGE_KEY]: 120 });
    h.set.forecast(asForecast(slice(12, [0, 0, 0, 0]), 0));
    expect((await engine.tick()).state).toBe("disabled");
    expect(h.writes).toHaveLength(0);
  });

  test("simulation logs shadow points for the charts", async () => {
    h.set.config(config({ enabled: false }));
    const engine = createPeakShavingEngine(h.io);
    await engine.tick();
    expect(engine.history()).toHaveLength(1);
    expect(engine.history()[0]?.shadow).toBe(true);
  });

  test("blocked mid-run restores and reports the blockers", async () => {
    const engine = createPeakShavingEngine(h.io);
    await engine.tick();
    h.set.weather(weather({ maxOutputW: null }));
    const status = await engine.tick();
    expect(status.state).toBe("blocked");
    expect(status.blockers).toEqual([{ kind: "config", what: "export-limit" }]);
    expect(h.writes[1]).toEqual({ key: CHARGE_KEY, value: 120 });
    await engine.tick();
    expect(h.writes).toHaveLength(2); // no further writes while blocked
  });

  test("a persisted snapshot survives a restart without re-capture", async () => {
    const first = createPeakShavingEngine(h.io);
    await first.tick();
    expect(h.state()["test-profile:peakShaving"]?.previousValue).toBe(120);
    // "Restart": new engine over the same persisted state; the register now
    // holds the automation's own value (50), which must NOT become the snapshot.
    const second = createPeakShavingEngine(h.io);
    await second.tick();
    expect(h.state()["test-profile:peakShaving"]?.previousValue).toBe(120);
  });

  test("failed restore keeps the snapshot for a retry", async () => {
    const engine = createPeakShavingEngine(h.io);
    await engine.tick();
    const originalWrite = h.io.write;
    h.io.write = async () => {
      throw new Error("modbus timeout");
    };
    h.set.config(config({}, { enabled: false }));
    const failed = await engine.tick();
    expect(failed.lastError).toContain("modbus timeout");
    expect(h.state()["test-profile:peakShaving"]?.previousValue).toBe(120);
    h.io.write = originalWrite;
    const retried = await engine.tick();
    expect(retried.restorePending).toBe(false);
    expect(h.state()).toEqual({});
  });

  test("target respects the register's own bounds", async () => {
    // 30 kW of PV at 50 V wants 432 A; maxChargeA 500 lets it through to the
    // register clamp (0–185 A from the profile range).
    h.set.config(config({}, { maxChargeA: 500 }));
    h.set.sample({ [PV_KEY]: 30_000, [SOC_KEY]: 50, [VOLT_KEY]: 50, [CHARGE_KEY]: 120 });
    const engine = createPeakShavingEngine(h.io);
    const status = await engine.tick();
    expect(status.targetA).toBe(185);
    expect(h.writes[0]).toEqual({ key: CHARGE_KEY, value: 185 });
  });

  test("nominal voltage is used when the voltage metric is absent", async () => {
    h.set.config(config({}, { nominalBatteryV: 100 }));
    h.set.sample({ [PV_KEY]: 18_000, [SOC_KEY]: 50, [CHARGE_KEY]: 120 });
    const engine = createPeakShavingEngine(h.io);
    // Live excess 18000 − 8000 = 10000 W at 100 V nominal → 100 A.
    const status = await engine.tick();
    expect(status.targetA).toBe(100);
  });

  test("the plant's stated voltage wins over the legacy automation field", async () => {
    // The field describes the battery, so it moved to the plant settings. While
    // both exist, the plant's is the one being maintained.
    // Both candidate answers must land inside the register's own 0-185 A range,
    // or the clamp decides the test instead of the precedence.
    h.set.config(config({}, { nominalBatteryV: 100 }));
    h.set.weather(weather({ battery: { usableKwh: 15, nominalV: 200 } }));
    h.set.sample({ [PV_KEY]: 18_000, [SOC_KEY]: 50, [CHARGE_KEY]: 120 });
    const status = await createPeakShavingEngine(h.io).tick();
    // 10000 W at 200 V → 50 A, not the 100 A the legacy field would give.
    expect(status.targetA).toBe(50);
  });

  test("an install that never restated it keeps charging at the voltage it set", async () => {
    // The reason the plant field is nullable rather than defaulted: a default of
    // 51.2 would silently shadow a 48 V pack's existing setting, and every
    // commanded current would be 7 % off with nothing to show for it.
    h.set.config(config({}, { nominalBatteryV: 100 }));
    h.set.weather(weather({ battery: { usableKwh: 15 } }));
    h.set.sample({ [PV_KEY]: 18_000, [SOC_KEY]: 50, [CHARGE_KEY]: 120 });
    const status = await createPeakShavingEngine(h.io).tick();
    expect(status.targetA).toBe(100);
  });

  test("a live voltage reading beats both stated values", async () => {
    // maxChargeA raised past the answer: the default 100 A ceiling would clamp
    // the live-voltage result down onto the legacy one and hide the difference.
    h.set.config(config({}, { nominalBatteryV: 100, maxChargeA: 300 }));
    h.set.weather(weather({ battery: { usableKwh: 15, nominalV: 200 } }));
    h.set.sample({ [PV_KEY]: 18_000, [SOC_KEY]: 50, [VOLT_KEY]: 62.5, [CHARGE_KEY]: 120 });
    const status = await createPeakShavingEngine(h.io).tick();
    // 10000 W at the measured 62.5 V → 160 A; neither stated value gives that.
    expect(status.targetA).toBe(160);
  });

  test("the reported live limit reads a watt register back at the stated voltage", async () => {
    // `liveA` is the register as it read before this tick's write, and the page
    // reports every figure in amps. A watt-denominated plant with no voltage
    // metric has only the plant's stated voltage to divide by — the one place
    // the readback and the target resolve it from different call sites.
    const ctx = buildProfileContext(
      profileWith({
        "setting.battery.max_charge_current": "",
        "setting.battery.max_charge_power": CHARGE_KEY,
        "battery.voltage": undefined,
      }),
    );
    h.set.ctx(ctx);
    h.set.weather(weather({ battery: { usableKwh: 15, nominalV: 200 } }));
    h.set.sample({ [PV_KEY]: 18_000, [SOC_KEY]: 50, [CHARGE_KEY]: 10_000 });
    const status = await createPeakShavingEngine({ ...h.io, ctx }).tick();
    // The 10000 W the register held, read back at 200 V → 50 A.
    expect(status.liveA).toBe(50);
  });

  test("the plant's real export cap reaches the live decision, not just the plan", async () => {
    // 8300 W clears the 8000 W decision limit (8400 maxOutput − 400 buffer) but
    // not the 8400 W the plant can physically push out, and the coming peak
    // (6 kWh) outsizes the headroom at 62% SOC (5.7 kWh) — so that band is the
    // grid's and the register is told to take nothing.
    h.set.forecast(asForecast(slice(13, Array(8).fill(11_000))));
    h.set.sample({ [PV_KEY]: 8300, [SOC_KEY]: 62, [VOLT_KEY]: 50, [CHARGE_KEY]: 120 });
    const engine = createPeakShavingEngine(h.io);
    const status = await engine.tick();
    expect(status.liveExcessW).toBe(300);
    expect(status.targetA).toBe(0);
  });

  test("a charging car shrinks the shave target and shows in the status", async () => {
    // 3 kW of excess without the car → 60 A; the car eats all of it → the
    // battery falls back to the configured rate instead.
    h.set.sample({ [PV_KEY]: 11_000, [SOC_KEY]: 50, [VOLT_KEY]: 50, [CHARGE_KEY]: 120 });
    h.set.evcc(evccState([loadpoint({ chargePowerLive: 3000, charging: true })]));
    const engine = createPeakShavingEngine(h.io);
    const status = await engine.tick();
    expect(status.evChargeW).toBe(3000);
    expect(status.liveExcessW).toBe(0);
    expect(h.writes[0]).toEqual({ key: CHARGE_KEY, value: 50 });
  });

  test("unreachable EVCC is ignored (pre-EVCC behavior)", async () => {
    h.set.sample({ [PV_KEY]: 11_000, [SOC_KEY]: 50, [VOLT_KEY]: 50, [CHARGE_KEY]: 120 });
    h.set.evcc(evccState([loadpoint({ chargePowerLive: 3000, charging: true })], false));
    const engine = createPeakShavingEngine(h.io);
    const status = await engine.tick();
    expect(status.evChargeW).toBeNull();
    expect(h.writes[0]).toEqual({ key: CHARGE_KEY, value: 60 });
  });

  test("forecast outage degrades to live-only shaving", async () => {
    h.set.forecast(null);
    h.set.sample({ [PV_KEY]: 10_000, [SOC_KEY]: 50, [VOLT_KEY]: 50, [CHARGE_KEY]: 120 });
    const engine = createPeakShavingEngine(h.io);
    const status = await engine.tick();
    expect(status.forecastAvailable).toBe(false);
    expect(status.state).toBe("active");
    expect(h.writes[0]).toEqual({ key: CHARGE_KEY, value: 40 }); // (10000−8000)/50
  });
});

// --- Engine: load frame, effectiveness watchdog, plateau damping -------------------

describe("peak-shaving engine — house-load frame", () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  test("the measured load metric defers shaving and shows in the status", async () => {
    h.set.sample({
      [PV_KEY]: 9000,
      [SOC_KEY]: 50,
      [VOLT_KEY]: 50,
      [LOAD_KEY]: 2000,
      [CHARGE_KEY]: 120,
    });
    const engine = createPeakShavingEngine(h.io);
    const status = await engine.tick();
    expect(status.loadW).toBe(2000);
    expect(status.liveExcessW).toBe(0); // 9000 − 2000 is under the 8000 W limit
    expect(h.writes[0]).toEqual({ key: CHARGE_KEY, value: 50 }); // fallback, no shave
  });

  test("the baseline load stands in when the sample carries no load reading", async () => {
    h.set.baselineLoad(1500);
    h.set.sample({ [PV_KEY]: 9000, [SOC_KEY]: 50, [VOLT_KEY]: 50, [CHARGE_KEY]: 120 });
    const engine = createPeakShavingEngine(h.io);
    const status = await engine.tick();
    expect(status.loadW).toBe(1500);
    expect(status.liveExcessW).toBe(0);
  });

  test("an unknown load keeps the raw-PV behavior", async () => {
    h.set.sample({ [PV_KEY]: 9000, [SOC_KEY]: 50, [VOLT_KEY]: 50, [CHARGE_KEY]: 120 });
    const engine = createPeakShavingEngine(h.io);
    const status = await engine.tick();
    expect(status.loadW).toBeNull();
    expect(status.liveExcessW).toBe(1000);
  });

  test("a charger behind the house meter is not double-counted", async () => {
    const sample = {
      [PV_KEY]: 12_000,
      [SOC_KEY]: 50,
      [VOLT_KEY]: 50,
      [LOAD_KEY]: 3000,
      [CHARGE_KEY]: 120,
    };
    h.set.sample(sample);
    // subtractFromHome: the 2 kW of EV draw is already inside the 3 kW load.
    h.set.evcc(evccState([loadpoint({ chargePowerLive: 2000, charging: true })], true, true));
    expect((await createPeakShavingEngine(h.io).tick()).liveExcessW).toBe(1000);
    // Charger on its own meter → both sinks are subtracted.
    h.set.sample(sample);
    h.set.evcc(evccState([loadpoint({ chargePowerLive: 2000, charging: true })], true, false));
    expect((await createPeakShavingEngine(h.io).tick()).liveExcessW).toBe(0);
  });
});

describe("peak-shaving engine — effectiveness watchdog", () => {
  let h: Harness;
  const shaving = (batteryPowerW: number) => ({
    [PV_KEY]: 12_000,
    [SOC_KEY]: 50,
    [VOLT_KEY]: 50,
    [BATT_POWER_KEY]: batteryPowerW,
    [CHARGE_KEY]: 120,
  });
  beforeEach(() => {
    h = harness();
  });

  test("a ceiling the inverter ignores is flagged after repeated ticks", async () => {
    const engine = createPeakShavingEngine(h.io);
    h.set.sample(shaving(0)); // battery idle despite 4 kW of commanded charge
    expect((await engine.tick()).ineffective).toBe(false); // the write just landed
    expect((await engine.tick()).ineffective).toBe(false);
    expect((await engine.tick()).ineffective).toBe(false);
    expect((await engine.tick()).ineffective).toBe(true);
  });

  test("no flag while the battery actually absorbs", async () => {
    const engine = createPeakShavingEngine(h.io);
    h.set.sample(shaving(-4000)); // negative = charging
    for (let i = 0; i < 5; i++) await engine.tick();
    expect(engine.status().ineffective).toBe(false);
  });

  test("absorption clears a raised flag", async () => {
    const engine = createPeakShavingEngine(h.io);
    h.set.sample(shaving(0));
    for (let i = 0; i < 4; i++) await engine.tick();
    expect(engine.status().ineffective).toBe(true);
    h.set.sample(shaving(-4000));
    expect((await engine.tick()).ineffective).toBe(false);
  });

  test("a full pack tapering at the top-balance floor is never flagged", async () => {
    const engine = createPeakShavingEngine(h.io);
    // A floor of 20 A at 50 V commands 1000 W — above the watchdog minimum —
    // but the near-full pack refusing it is the taper working, not a sell mode.
    h.set.config(config({}, { topBalanceFloorA: 20 }));
    h.set.sample({
      [PV_KEY]: 12_000,
      [SOC_KEY]: 100,
      [VOLT_KEY]: 50,
      [BATT_POWER_KEY]: 0,
      [CHARGE_KEY]: 120,
    });
    for (let i = 0; i < 5; i++) await engine.tick();
    expect(engine.status().ineffective).toBe(false);
  });

  test("no battery power metric means no watchdog", async () => {
    const engine = createPeakShavingEngine(h.io);
    h.set.sample({ [PV_KEY]: 12_000, [SOC_KEY]: 50, [VOLT_KEY]: 50, [CHARGE_KEY]: 120 });
    for (let i = 0; i < 5; i++) await engine.tick();
    expect(engine.status().ineffective).toBe(false);
  });

  test("a released register clears the flag", async () => {
    const engine = createPeakShavingEngine(h.io);
    h.set.sample(shaving(0));
    for (let i = 0; i < 4; i++) await engine.tick();
    expect(engine.status().ineffective).toBe(true);
    h.set.config(config({}, { enabled: false }));
    expect((await engine.tick()).ineffective).toBe(false);
  });
});

describe("peak-shaving engine — shadow mode", () => {
  let h: Harness;
  beforeEach(() => {
    h = harness({ config: config({}, { shadowMode: true }) });
  });

  test("decides without touching the register", async () => {
    const engine = createPeakShavingEngine(h.io);
    const status = await engine.tick();
    expect(status.state).toBe("shadow");
    expect(status.targetA).toBe(50); // the same call a live run would make
    expect(h.writes).toHaveLength(0);
    expect(h.state()).toEqual({}); // no snapshot: nothing to hand back
    expect(status.restorePending).toBe(false);
  });

  test("switching a live run to shadow hands the register back once", async () => {
    h.set.config(config());
    const engine = createPeakShavingEngine(h.io);
    await engine.tick();
    expect(h.state()["test-profile:peakShaving"]?.previousValue).toBe(120);
    h.set.config(config({}, { shadowMode: true }));
    const status = await engine.tick();
    expect(h.writes[1]).toEqual({ key: CHARGE_KEY, value: 120 }); // restored
    expect(h.state()).toEqual({});
    expect(status.state).toBe("shadow");
    expect(status.targetA).not.toBeNull(); // still reporting what it would do
    await engine.tick();
    await engine.tick();
    expect(h.writes).toHaveLength(2); // and never writes again
  });

  test("the watchdog stays quiet — nothing was commanded", async () => {
    h.set.sample({
      [PV_KEY]: 12_000,
      [SOC_KEY]: 50,
      [VOLT_KEY]: 50,
      [BATT_POWER_KEY]: 0,
      [CHARGE_KEY]: 80,
    });
    const engine = createPeakShavingEngine(h.io);
    for (let i = 0; i < 5; i++) await engine.tick();
    expect(engine.status().targetA).toBe(80);
    expect(engine.status().ineffective).toBe(false);
  });

  test("night and blockers still park the run state", async () => {
    const engine = createPeakShavingEngine(h.io);
    h.set.sample({ [PV_KEY]: 0, [SOC_KEY]: 50, [VOLT_KEY]: 50, [CHARGE_KEY]: 120 });
    h.set.forecast(asForecast(slice(12, [0, 0, 0, 0]), 0));
    expect((await engine.tick()).state).toBe("idle");
    h.set.weather(weather({ maxOutputW: null }));
    expect((await engine.tick()).state).toBe("blocked");
    expect(h.writes).toHaveLength(0);
  });
});

// --- The feed-in ceiling register ----------------------------------------------------
//
// `grid-friendly` steers two registers: the charge ceiling decides how much PV
// the battery takes, the solar-sell ceiling decides how much the inverter is
// willing to sell. Without the second one the inverter simply sells up to its own
// limit and the mode cannot lower the midday curve at all.

describe("peak-shaving engine — feed-in ceiling", () => {
  let h: Harness;
  const gridCfg = (over: object = {}) => config({}, { mode: "grid-friendly", ...over });

  beforeEach(() => {
    h = harness({ config: gridCfg() });
    h.set.sample({
      [PV_KEY]: 7000,
      [SOC_KEY]: 50,
      [VOLT_KEY]: 50,
      [CHARGE_KEY]: 120,
      [SELL_KEY]: 8000,
    });
  });

  test("writes the decided level and snapshots the user's own setting", async () => {
    const engine = createPeakShavingEngine(h.io);
    const status = await engine.tick();
    expect(status.thresholdW).not.toBeNull();
    const write = h.writes.find((w) => w.key === SELL_KEY);
    expect(write?.value).toBe(status.thresholdW!);
    expect(status.sellLimitW).toBe(status.thresholdW!);
    // Both registers are held, each in its own slot, so each can be given back.
    expect(h.state()["test-profile:peakShaving"]?.previousValue).toBe(120);
    expect(h.state()["test-profile:peakShaving:sell"]?.previousValue).toBe(8000);
  });

  test("hands both registers back on disable", async () => {
    const engine = createPeakShavingEngine(h.io);
    await engine.tick();
    h.set.config(config({}, { enabled: false }));
    const status = await engine.tick();
    expect(h.writes.at(-2)).toEqual({ key: CHARGE_KEY, value: 120 });
    expect(h.writes.at(-1)).toEqual({ key: SELL_KEY, value: 8000 });
    expect(h.state()).toEqual({});
    expect(status.restorePending).toBe(false);
    expect(status.sellLimitW).toBeNull();
  });

  test("shadow mode decides the level but writes neither register", async () => {
    h.set.config(gridCfg({ shadowMode: true }));
    const engine = createPeakShavingEngine(h.io);
    const status = await engine.tick();
    expect(status.thresholdW).not.toBeNull();
    expect(status.liveSellLimitW).toBe(8000);
    expect(h.writes).toHaveLength(0);
    expect(h.state()).toEqual({});
  });

  test("switching to maximize-exports gives the feed-in ceiling back", async () => {
    const engine = createPeakShavingEngine(h.io);
    await engine.tick();
    expect(h.state()["test-profile:peakShaving:sell"]).toBeDefined();
    h.set.config(config()); // maximize-exports sells everything it can
    await engine.tick();
    expect(h.writes.at(-1)).toEqual({ key: SELL_KEY, value: 8000 });
    // …and keeps the charge register it is still steering.
    expect(h.state()["test-profile:peakShaving:sell"]).toBeUndefined();
    expect(h.state()["test-profile:peakShaving"]).toBeDefined();
  });

  test("a plant without the register cannot run grid-friendly", async () => {
    const bare = harness({ config: gridCfg() });
    // Same setup, minus the mapping.
    const ctx = buildProfileContext(profileWith({ "setting.solar_sell.max_power": "" }));
    bare.set.ctx(ctx);
    const engine = createPeakShavingEngine({ ...bare.io, ctx });
    const status = await engine.tick();
    expect(status.state).toBe("blocked");
    expect(status.blockers).toEqual([{ kind: "role", role: "setting.solar_sell.max_power" }]);
  });
});

// --- Decision log --------------------------------------------------------------------

describe("decision log", () => {
  test("keeps the newest points up to its capacity", () => {
    const log = createDecisionLog(3);
    for (let t = 1; t <= 5; t++) log.push({ ...logPoint, t });
    expect(log.points().map((p) => p.t)).toEqual([3, 4, 5]);
  });

  test("starts empty and preserves push order", () => {
    const log = createDecisionLog(10);
    expect(log.points()).toEqual([]);
    log.push({ ...logPoint, t: 2 });
    log.push({ ...logPoint, t: 1 });
    expect(log.points().map((p) => p.t)).toEqual([2, 1]);
  });
});

describe("peak-shaving engine — decision log", () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  test("records one point per steering tick with the chart's ingredients", async () => {
    h.set.baselineLoad(400);
    h.set.sample({
      [PV_KEY]: 11_000,
      [SOC_KEY]: 50,
      [VOLT_KEY]: 50,
      [LOAD_KEY]: 1000,
      [BATT_POWER_KEY]: -2600,
      [GRID_KEY]: -4000, // exporting 4 kW
      [CHARGE_KEY]: 120,
    });
    const engine = createPeakShavingEngine(h.io);
    const status = await engine.tick();
    const [point] = engine.history();
    expect(engine.history()).toHaveLength(1);
    expect(point).toMatchObject({
      t: NOON,
      shadow: false,
      pvW: 11_000,
      loadW: 1000,
      localSinkW: 1000,
      socPct: 50,
      batteryV: 50,
      chargeW: 2600,
      exportW: 4000,
      liveA: 120, // the register as read before this tick's write
      targetA: status.targetA,
      thresholdW: status.thresholdW,
    });
    await engine.tick();
    expect(engine.history()).toHaveLength(2);
  });

  test("marks shadow ticks so the chart can label them", async () => {
    h.set.config(config({}, { shadowMode: true }));
    const engine = createPeakShavingEngine(h.io);
    await engine.tick();
    expect(engine.history()[0]?.shadow).toBe(true);
  });

  test("nothing is recorded unless the tick actually decided", async () => {
    const engine = createPeakShavingEngine(h.io);
    // Blocked and stale ticks have no decision to log — disabled or not
    // (a disabled *runnable* tick simulates and does log).
    h.set.weather(weather({ battery: null }));
    h.set.config(config({}, { enabled: false }));
    await engine.tick();
    h.set.config(config());
    await engine.tick();
    h.set.weather(weather());
    h.set.sample({ [PV_KEY]: 5000, [SOC_KEY]: 50, [CHARGE_KEY]: 120 }, 60_000);
    await engine.tick();
    expect(engine.history()).toEqual([]);
  });

  test("unmapped optional metrics are logged as null", async () => {
    h.set.sample({ [PV_KEY]: 9000, [SOC_KEY]: 50, [VOLT_KEY]: 50, [CHARGE_KEY]: 120 });
    const engine = createPeakShavingEngine(h.io);
    await engine.tick();
    expect(engine.history()[0]).toMatchObject({ loadW: null, chargeW: null, exportW: null });
  });
});

describe("peak-shaving engine — plan", () => {
  const bell = asForecast(
    slice(
      12,
      [2, 4, 6, 9, 11, 12, 11, 9, 6, 4, 2, 0].map((kw) => kw * 1000),
    ),
  );
  let h: Harness;
  beforeEach(() => {
    h = harness();
    h.set.forecast(bell);
  });

  test("projects from the live SOC and the plant's real export cap", async () => {
    h.set.sample({ [PV_KEY]: 4000, [SOC_KEY]: 30, [VOLT_KEY]: 50, [CHARGE_KEY]: 120 });
    const plan = (await createPeakShavingEngine(h.io).plan())?.today;
    expect(plan?.slots.length).toBe(12);
    expect(plan?.slots[0]?.socPct).toBeGreaterThanOrEqual(30);
    // The cap is maxOutputW (8400), not the buffered decision limit (8000).
    expect(Math.max(...plan!.slots.map((s) => s.exportW))).toBeLessThanOrEqual(8400);
  });

  test("a fuller battery plans less charging", async () => {
    h.set.sample({ [PV_KEY]: 4000, [SOC_KEY]: 30, [VOLT_KEY]: 50, [CHARGE_KEY]: 120 });
    const low = await createPeakShavingEngine(h.io).plan();
    h.set.sample({ [PV_KEY]: 4000, [SOC_KEY]: 85, [VOLT_KEY]: 50, [CHARGE_KEY]: 120 });
    const high = await createPeakShavingEngine(h.io).plan();
    expect(high!.today.storedKwh).toBeLessThan(low!.today.storedKwh);
  });

  test("available before the automation is switched on (pre-flight)", async () => {
    h.set.config(config({}, { enabled: false }));
    const plan = await createPeakShavingEngine(h.io).plan();
    expect(plan).not.toBeNull();
    expect(plan!.today.slots.length).toBeGreaterThan(0);
  });

  test("tomorrow projects the next local day, seeded with today's end SOC", async () => {
    // One slot left of today, two of tomorrow, hourly to keep the math small.
    h.set.forecast(
      asForecast({
        stepMinutes: 60,
        utcOffsetSeconds: 0,
        series: [
          { time: "2026-07-25T12:00", watts: 9000, peakWatts: 9000 },
          { time: "2026-07-26T11:00", watts: 12_000, peakWatts: 12_000 },
          { time: "2026-07-26T12:00", watts: 12_000, peakWatts: 12_000 },
        ],
      }),
    );
    h.set.sample({ [PV_KEY]: 4000, [SOC_KEY]: 30, [VOLT_KEY]: 50, [CHARGE_KEY]: 120 });
    const plans = await createPeakShavingEngine(h.io).plan();
    expect(plans!.today.slots).toHaveLength(1);
    expect(plans!.tomorrow.slots.map((s) => new Date(s.t).toISOString().slice(0, 10))).toEqual([
      "2026-07-26",
      "2026-07-26",
    ]);
    // The pack is assumed to hold overnight: tomorrow starts where today ends.
    expect(plans!.tomorrow.slots[0]!.socPct).toBeGreaterThanOrEqual(plans!.today.endSocPct);
  });

  test("tomorrow is empty when the forecast stops today", async () => {
    h.set.sample({ [PV_KEY]: 4000, [SOC_KEY]: 30, [VOLT_KEY]: 50, [CHARGE_KEY]: 120 });
    const plans = await createPeakShavingEngine(h.io).plan();
    expect(plans!.tomorrow.slots).toEqual([]);
  });

  test("no plan without a runnable setup, a forecast or fresh readings", async () => {
    h.set.weather(weather({ maxOutputW: null }));
    expect(await createPeakShavingEngine(h.io).plan()).toBeNull();
    h.set.weather(weather());
    h.set.forecast(null);
    expect(await createPeakShavingEngine(h.io).plan()).toBeNull();
    h.set.forecast(bell);
    h.set.sample({ [PV_KEY]: 4000, [SOC_KEY]: 30, [CHARGE_KEY]: 120 }, 60_000);
    expect(await createPeakShavingEngine(h.io).plan()).toBeNull();
  });

  test("planning never writes a register", async () => {
    const engine = createPeakShavingEngine(h.io);
    await engine.plan();
    expect(h.writes).toHaveLength(0);
    expect(h.state()).toEqual({});
  });
});

const ENGINE_SRC = await Bun.file(new URL("./peak-shaving-engine.ts", import.meta.url)).text();

/**
 * `PlanLimits.exportCapW` and `DecisionInputs.exportCapW` are the same physical
 * figure seen from two sides: the ceiling the projection curtails against, and
 * the one the live decision refuses to absorb below. Two independent
 * derivations would fail the worst possible way — silently, on a sunny
 * afternoon, with the pack declining energy that is about to be curtailed,
 * which is the exact loss the absorb ceiling exists to prevent. So the cap is
 * derived once and handed on; these cases fail if a second source comes back.
 */
describe("peak-shaving engine — one export cap", () => {
  /**
   * The initializer of every `key:` property in `code`, read to the comma that
   * ends it at depth 0 — so a `Math.max(0, …)` value is captured whole instead
   * of being cut at its own comma.
   */
  function initializersOf(code: string, key: string): string[] {
    const found: string[] = [];
    for (const match of code.matchAll(new RegExp(`\\b${key}\\s*:`, "g"))) {
      const from = code.indexOf(":", match.index) + 1;
      let depth = 0;
      for (let i = from; i < code.length; i++) {
        const ch = code[i]!;
        depth += Number("([{".includes(ch)) - Number(")]}".includes(ch));
        if (depth < 0 || (depth === 0 && (ch === "," || ch === ";"))) {
          found.push(code.slice(from, i).trim());
          break;
        }
      }
    }
    return found;
  }

  test("the cap is derived from the weather config in exactly one place", () => {
    const initializers = initializersOf(ENGINE_SRC, "exportCapW");
    // Both the type's declaration site and the plan's copy show up here; only
    // one of them may compute the figure from the plant config.
    const derived = initializers.filter((v) => v.includes("weather"));
    expect(derived).toEqual(["Math.max(0, weather.forecast.maxOutputW ?? 0)"]);
    expect(initializers.length).toBeGreaterThan(1); // the copy still exists
  });

  test("planLimits reports the cap it is handed, never one of its own", () => {
    // A figure no weather config could produce: if this survives the round
    // trip, `planLimits` cannot be recomputing the ceiling behind the plan's
    // back.
    expect(planLimits({ exportCapW: 4242 }, weather()).exportCapW).toBe(4242);
    expect(planLimits({ exportCapW: 0 }, weather({ maxOutputW: 9000 })).exportCapW).toBe(0);
    // The reserve floor stays the weather config's job.
    expect(
      planLimits({ exportCapW: 4242 }, weather({ battery: { usableKwh: 15, minSoc: 20 } }))
        .reserveSocPct,
    ).toBe(20);
  });

  /**
   * The argument list of the first *call* to `name`, split at the commas that
   * sit outside any nesting. The declaration of the same name is skipped —
   * taking its parameter list instead would pass on anything at all.
   */
  function argumentsOf(code: string, name: string): string[] {
    const call = [...code.matchAll(new RegExp(`(function\\s+)?\\b${name}\\s*\\(`, "g"))].find(
      (m) => m[1] === undefined,
    );
    if (!call) throw new Error(`no call to ${name}`);
    const from = code.indexOf("(", call.index) + 1;
    const parts = [""];
    let depth = 0;
    for (let i = from; i < code.length; i++) {
      const ch = code[i]!;
      depth += Number("([{".includes(ch)) - Number(")]}".includes(ch));
      if (depth < 0) return parts.map((p) => p.trim());
      if (ch === "," && depth === 0) parts.push("");
      else parts[parts.length - 1] += ch;
    }
    throw new Error(`unbalanced call to ${name}`);
  }

  test("the plan is handed the very inputs object the decision runs on", () => {
    // Pins the identifier, not a mention: a `planLimits(weather)` call or a
    // freshly built literal would both read fine and reintroduce the drift.
    const [capArg] = argumentsOf(ENGINE_SRC, "planLimits");
    const built = /const\s+(\w+)\s*=\s*(?:await\s+)?decisionInputs\(/.exec(ENGINE_SRC)?.[1];
    expect(built).toBeDefined();
    expect(capArg).toBe(built);
  });
});

describe("peak-shaving engine — plateau damping", () => {
  // A midday bell wide enough that the solved plateau sits well below the limit.
  const bell = asForecast(
    slice(
      12,
      [2, 4, 6, 8, 10, 12, 12, 10, 8, 6, 4, 2].map((kw) => kw * 1000),
    ),
  );
  let h: Harness;
  beforeEach(() => {
    h = harness({
      config: config({}, { mode: "grid-friendly", gridFriendly: { slewWPerMin: 60 } }),
    });
    h.set.forecast(bell);
  });

  test("the plateau moves only within the tick's slew budget, and a release resets it", async () => {
    const engine = createPeakShavingEngine(h.io);
    // 50% SOC → 7.5 kWh of headroom, filled from the exportable energy above the
    // level the search settles on.
    const settled = (await engine.tick()).thresholdW;
    expect(settled).not.toBeNull();
    expect(settled!).toBeLessThan(8000);
    // 90% SOC alone would jump the level much higher, but no time has passed, so
    // the budget is zero and the level holds.
    h.set.sample({ [PV_KEY]: 5000, [SOC_KEY]: 90, [VOLT_KEY]: 50, [CHARGE_KEY]: 50 });
    expect((await engine.tick()).thresholdW).toBe(settled!);
    // One minute of budget at 60 W/min (a fresh sample too — the old one would
    // now be stale, and a stale tick steers nothing).
    h.set.now(NOON + 60_000);
    h.set.sample({ [PV_KEY]: 5000, [SOC_KEY]: 90, [VOLT_KEY]: 50, [CHARGE_KEY]: 0 });
    expect((await engine.tick()).thresholdW).toBe(settled! + 60);
    // Off and on again: the level is re-solved from scratch, undamped — so it
    // lands where a whole minute of slew could not have carried it.
    h.set.config(config({}, { enabled: false }));
    await engine.tick();
    h.set.config(config({}, { mode: "grid-friendly", gridFriendly: { slewWPerMin: 60 } }));
    const undamped = (await engine.tick()).thresholdW;
    expect(undamped!).toBeGreaterThan(settled! + 60);
  });
});

describe("price-aware charging", () => {
  const HOUR = 3_600_000;
  const MIDNIGHT = Date.parse("2026-08-01T22:00:00Z"); // 00:00 local at UTC+2
  const at = (hours: number) => MIDNIGHT + hours * HOUR;

  const priceCfg = (over: object = {}) => ({
    ...automationConfigSchema.parse({}).peakShaving.priceAware,
    enabled: true,
    ...over,
  });

  /** Quarter-hourly prices: `n` slots from `fromHour` at `eurPerMwh`. */
  const priceView = (fromHour: number, n: number, eurPerMwh: number): SpotSlice => ({
    zone: "DE-LU",
    stepMinutes: 15,
    utcOffsetSeconds: 0,
    coverage: { today: "complete", tomorrow: "complete" },
    availability: "ok",
    series: Array.from({ length: n }, (_, i) => ({
      time: "2026-08-02T00:00",
      startMs: at(fromHour + i * 0.25),
      minutes: 15,
      eurPerMwh,
      negative: eurPerMwh < 0,
    })),
  });

  /** A flat forecast for the whole local day at UTC+0, so `at()` lines up. */
  const flatForecast = (watts: number): ForecastSlice => ({
    stepMinutes: 15,
    utcOffsetSeconds: 0,
    series: Array.from({ length: 96 }, (_, i) => {
      const minutes = i * 15;
      const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
      return {
        time: `2026-08-02T${hh}:${String(minutes % 60).padStart(2, "0")}`,
        watts,
        peakWatts: watts,
      };
    }),
  });

  const withPrices = (over: object = {}) => ({
    ...baseInputs,
    forecast: flatForecast(6000),
    priceView: priceView(12, 12, -40),
    price: priceCfg(),
    nowMs: at(9),
    ...over,
  });

  test("prices present but the feature off changes nothing at all", () => {
    // The regression guard: the same inputs with and without a price feed must
    // produce byte-identical decisions while `enabled` is false.
    const off = { ...withPrices(), price: priceCfg({ enabled: false }) };
    expect(decideTargetA(off)).toEqual(decideTargetA({ ...off, priceView: null }));
  });

  test("inside a window the feed-in ceiling collapses to the soak floor", () => {
    const inside = decideTargetA(withPrices({ nowMs: at(13), socPct: 30 }));
    expect(inside.priceRegime).toBe("absorb");
    expect(inside.thresholdW).toBe(0);
    // With the ceiling at zero, everything the house cannot eat is excess to take.
    expect(inside.liveExcessW).toBe(baseInputs.pvW);
    expect(inside.targetA).toBeGreaterThan(0);
  });

  test("a soak window absorbs the whole band, peak or no peak", () => {
    // The plant's safety buffer is discretionary; a ceiling a *price* window
    // collapsed is not — it was lowered precisely because that energy is worth
    // more in the pack than sold into a negative price. So even with a huge
    // coming peak laying claim to every kWh of headroom, the soak takes the lot.
    const soaking = decideTargetA(
      withPrices({ nowMs: at(13), socPct: 30, exportCapW: 8400, forecast: flatForecast(12_000) }),
    );
    expect(soaking.thresholdW).toBe(0);
    expect(soaking.liveExcessW).toBe(baseInputs.pvW);
    expect(soaking.targetA).toBe(100); // 5000 W / 50 V, at the maxChargeA ceiling
  });

  test("soaking works the same way in grid-friendly", () => {
    const inside = decideTargetA(
      withPrices({ nowMs: at(13), socPct: 30, mode: "grid-friendly" as const }),
    );
    expect(inside.priceRegime).toBe("absorb");
    expect(inside.thresholdW).toBe(0);
  });

  test("ahead of a modest window the charge target is capped, not zeroed", () => {
    // One hour of window needs ~5 kWh of room in a 15 kWh pack, putting the
    // bound near 62 %. A pack at 61 % may still charge, but only at the rate
    // that keeps it under the bound — well below the mode's own target.
    const shaping = withPrices({ socPct: 61, priceView: priceView(12, 4, -40) });
    const shaped = decideTargetA(shaping);
    expect(shaped.priceRegime).toBe("pre-shape");
    expect(shaped.socEnvelopePct).not.toBeNull();
    expect(shaped.targetA).toBeGreaterThan(0);
    expect(shaped.targetA).toBeLessThan(
      decideTargetA({ ...shaping, price: priceCfg({ enabled: false }) }).targetA,
    );
  });

  test("a pack already past the bound stops charging and says why", () => {
    // Three hours of window against a 15 kWh pack: no amount of withholding gets
    // there, so the regime names the shortfall instead of quietly under-delivering.
    const shaped = decideTargetA(withPrices({ socPct: 70 }));
    expect(shaped.priceRegime).toBe("spend-down");
    expect(shaped.targetA).toBe(0);
    expect(shaped.unavoidableZeroValueKwh).toBeGreaterThan(0);
  });

  test("a near-full pack keeps its top-balance floor over the envelope", () => {
    // Cutting the BMS's absorption dwell short is a real harm; a pack that full
    // has no room left to protect anyway.
    const nearFull = decideTargetA(withPrices({ socPct: 99.9 }));
    expect(nearFull.targetA).toBe(baseInputs.topBalanceFloorA);
  });

  test("the window and the unrescuable energy are reported for the UI", () => {
    const shaped = decideTargetA(withPrices({ socPct: 70 }));
    expect(shaped.windowStartsAt).toBe(at(12));
    expect(shaped.windowEndsAt).toBe(at(15));
    expect(shaped.soakableKwh).toBeGreaterThan(0);
    expect(shaped.unavoidableZeroValueKwh).not.toBeNull();
  });
});

describe("peak-shaving engine — borrowing the car", () => {
  const HOUR = 3_600_000;
  // The engine's fixtures run at NOON UTC with a zero plant offset, so a window
  // an hour out lands at 13:00 and the pack has one hour to be emptied.
  const window = (fromHour: number, slots: number): SpotSlice => ({
    zone: "DE-LU",
    stepMinutes: 15,
    utcOffsetSeconds: 0,
    coverage: { today: "complete", tomorrow: "complete" },
    availability: "ok",
    series: Array.from({ length: slots }, (_, i) => ({
      time: "2026-07-25T00:00",
      startMs: Date.parse("2026-07-25T00:00:00Z") + (fromHour + i * 0.25) * HOUR,
      minutes: 15,
      eurPerMwh: -40,
      negative: true,
    })),
  });

  const MODE_SLOT = "test-profile:evccMode:1";
  const LIMIT_SLOT = "test-profile:evccBoostLimit:1";

  /** A plant an hour ahead of a three-hour window, too full to make room alone. */
  function spendDown(pullInEv = true): Harness {
    const h = harness({
      config: config({}, { priceAware: { enabled: true, pullInEv, evBoostLimitPct: 15 } }),
      prices: window(13, 12),
    });
    h.set.weather(
      weather({ smartMeterSince: "2026-06-01", battery: { usableKwh: 15, minSoc: 5 } }),
    );
    // Sun right through the window, so it can soak more than the pack can hold.
    h.set.forecast(
      asForecast(
        slice(
          12,
          Array.from({ length: 16 }, () => 7000),
        ),
      ),
    );
    h.set.sample({ [PV_KEY]: 5000, [SOC_KEY]: 85, [VOLT_KEY]: 50, [CHARGE_KEY]: 120 });
    h.set.evcc({
      reachable: true,
      subtractFromHome: false,
      loadpoints: [loadpoint({ index: 1, mode: "pv", vehicleSoc: 40, effectiveLimitSoc: 80 })],
    });
    return h;
  }

  test("boosts the car to empty the pack, remembering both EVCC settings", async () => {
    const h = spendDown();
    const status = await createPeakShavingEngine(h.io).tick();
    expect(status.priceRegime).toBe("spend-down");
    // Order is EVCC's: the limit must be in place before the boost that uses it,
    // and a mode command would clear a boost already set.
    expect(h.evccCommands).toEqual([
      { loadpoint: 1, action: "batteryBoostLimit", value: "15" },
      { loadpoint: 1, action: "batteryBoost", value: "true" },
    ]);
    expect(h.state()[MODE_SLOT]?.previousValue).toBe("pv");
    expect(h.state()[LIMIT_SLOT]?.previousValue).toBe(100);
  });

  test("the plant's reserve floor wins over a lower configured boost limit", async () => {
    // Asking EVCC to drain below the floor the inverter enforces would leave it
    // demanding a discharge that never arrives.
    const h = spendDown();
    h.set.weather(
      weather({ smartMeterSince: "2026-06-01", battery: { usableKwh: 15, minSoc: 30 } }),
    );
    await createPeakShavingEngine(h.io).tick();
    expect(h.evccCommands[0]).toEqual({
      loadpoint: 1,
      action: "batteryBoostLimit",
      value: "30",
    });
  });

  test("a second tick republishes nothing", async () => {
    const h = spendDown();
    const engine = createPeakShavingEngine(h.io);
    await engine.tick();
    // Mirror what EVCC would report back once the commands landed.
    h.set.evcc({
      reachable: true,
      subtractFromHome: false,
      loadpoints: [
        loadpoint({
          index: 1,
          mode: "pv",
          vehicleSoc: 40,
          effectiveLimitSoc: 80,
          batteryBoost: true,
          batteryBoostLimit: 15,
        }),
      ],
    });
    await engine.tick();
    expect(h.evccCommands).toHaveLength(2);
    // And the remembered originals are still the user's, not our own.
    expect(h.state()[LIMIT_SLOT]?.previousValue).toBe(100);
  });

  test("hands everything back when the automation is switched off", async () => {
    const h = spendDown();
    const engine = createPeakShavingEngine(h.io);
    await engine.tick();
    h.set.config(config({}, { enabled: false }));
    await engine.tick();
    expect(h.evccCommands.slice(2)).toEqual([
      { loadpoint: 1, action: "batteryBoost", value: "false" },
      { loadpoint: 1, action: "batteryBoostLimit", value: "100" },
      { loadpoint: 1, action: "mode", value: "pv" },
    ]);
    expect(h.state()[MODE_SLOT]).toBeUndefined();
    expect(h.state()[LIMIT_SLOT]).toBeUndefined();
  });

  test("shadow mode borrows nothing", async () => {
    const h = spendDown();
    h.set.config(
      config(
        {},
        { shadowMode: true, priceAware: { enabled: true, pullInEv: true, evBoostLimitPct: 15 } },
      ),
    );
    await createPeakShavingEngine(h.io).tick();
    expect(h.evccCommands).toEqual([]);
  });

  test("the switch off means the car is never touched", async () => {
    const h = spendDown(false);
    await createPeakShavingEngine(h.io).tick();
    expect(h.evccCommands).toEqual([]);
  });

  test("a broker error leaves no snapshot, so the next tick tries again", async () => {
    const h = spendDown();
    h.set.evccError("EVCC MQTT is not connected");
    const engine = createPeakShavingEngine(h.io);
    await engine.tick();
    expect(h.state()[MODE_SLOT]).toBeUndefined();
    h.set.evccError(null);
    await engine.tick();
    expect(h.state()[MODE_SLOT]?.previousValue).toBe("pv");
  });

  test("a broker error during hand-back keeps the snapshot", async () => {
    const h = spendDown();
    const engine = createPeakShavingEngine(h.io);
    await engine.tick();
    h.set.evccError("EVCC MQTT is not connected");
    h.set.config(config({}, { enabled: false }));
    await engine.tick();
    // Still held: the car is on our settings and must not be forgotten.
    expect(h.state()[MODE_SLOT]?.previousValue).toBe("pv");
  });
});

// --- Price awareness is gated on the plant, not on the shaving mode -----------------

describe("validateAutomationEnable — price awareness", () => {
  test("price-aware charging without a smart-meter install date is rejected", () => {
    const cfg = config({}, { priceAware: { enabled: true } });
    const result = validateAutomationEnable(cfg, profileWith(), weather());
    expect(result?.error).toContain("smart meter");
    expect(result?.blockers).toEqual([{ kind: "config", what: "smart-meter" }]);
  });

  test("the install date is the whole gate", () => {
    const cfg = config({}, { priceAware: { enabled: true } });
    const wx = weather({ smartMeterSince: "2026-06-01" });
    expect(validateAutomationEnable(cfg, profileWith(), wx)).toBeNull();
  });

  test("the gate applies with peak shaving itself switched off", () => {
    // §51 is a fact about the plant, so the check cannot be reachable only
    // through the peak-shaving branch above it.
    const cfg = config({}, { enabled: false, priceAware: { enabled: true } });
    expect(validateAutomationEnable(cfg, null, weather())?.blockers).toEqual([
      { kind: "config", what: "smart-meter" },
    ]);
  });
});

// --- Engine: registers it cannot write, snapshots it cannot replay ------------------

describe("peak-shaving engine — a register it may not write", () => {
  test("a read-only charge register is reported, never written", async () => {
    // Mapping the role is all the blocker gate checks; a profile that maps it to
    // a register this firmware exposes read-only only shows up at the write.
    const h = harness();
    const bare = profileWith();
    const ctx = buildProfileContext({
      ...bare,
      metrics: bare.metrics.map((m) =>
        m.role === "setting.battery.max_charge_current" ? { ...m, access: "r" as const } : m,
      ),
    });
    h.set.ctx(ctx);
    const status = await createPeakShavingEngine({ ...h.io, ctx }).tick();
    expect(h.writes).toEqual([]);
    expect(status.lastError).toContain("not writable");
    expect(status.lastWrittenA).toBeNull();
    // The decision itself still runs, and the register was claimed before the
    // write revealed it could not be steered.
    expect(status.targetA).toBe(50);
    expect(status.restorePending).toBe(true);
  });
});

describe("peak-shaving engine — snapshots it cannot replay", () => {
  const CAPTURED = "2026-07-25T11:00:00Z";

  test("a snapshot outside the register's bounds is kept, with the reason", async () => {
    // A profile update can narrow a register's range under a snapshot taken when
    // it was wider. Writing it anyway is not an option, and dropping it would
    // silently lose the user's own setting.
    const h = harness();
    h.set.state({ "test-profile:peakShaving": { previousValue: 250, capturedAt: CAPTURED } });
    const engine = createPeakShavingEngine(h.io);
    await engine.release();
    expect(h.writes).toEqual([]);
    expect(engine.status().lastError).toContain("above maximum 185");
    expect(engine.status().restorePending).toBe(true);
    expect(h.state()["test-profile:peakShaving"]?.previousValue).toBe(250);
  });

  test("a non-numeric snapshot in a register slot is refused as corrupt", async () => {
    // The same state map holds borrowed EVCC modes; one landing in a register
    // slot means the state is corrupt, and a string is never coerced to a write.
    const h = harness();
    h.set.state({ "test-profile:peakShaving": { previousValue: "pv", capturedAt: CAPTURED } });
    const engine = createPeakShavingEngine(h.io);
    await engine.release();
    expect(h.writes).toEqual([]);
    expect(engine.status().lastError).toContain("not a register value");
    expect(h.state()["test-profile:peakShaving"]).toBeDefined();
  });

  test("a snapshot for a role the profile no longer maps is never guessed at", async () => {
    // The feed-in ceiling was held under a profile that mapped it; the new one
    // does not, so there is no register to give it back to.
    const h = harness();
    h.set.state({ "test-profile:peakShaving:sell": { previousValue: 8000, capturedAt: CAPTURED } });
    const ctx = buildProfileContext(profileWith({ "setting.solar_sell.max_power": "" }));
    h.set.ctx(ctx);
    const engine = createPeakShavingEngine({ ...h.io, ctx });
    await engine.release();
    expect(h.writes).toEqual([]);
    expect(engine.status().restorePending).toBe(true);
    expect(h.state()["test-profile:peakShaving:sell"]).toBeDefined();
  });
});

describe("peak-shaving engine — no readback of the register it steers", () => {
  test("the tick holds until the register has been read back once", async () => {
    // Steering a register whose original value was never recorded would leave
    // nothing to restore on release, so the tick waits for the poll instead.
    const h = harness();
    h.set.sample({ [PV_KEY]: 5000, [SOC_KEY]: 50, [VOLT_KEY]: 50 });
    const engine = createPeakShavingEngine(h.io);
    const status = await engine.tick();
    expect(status.state).toBe("stale");
    expect(h.writes).toEqual([]);
    expect(h.state()).toEqual({});
    // Once the poll delivers it, the same engine takes over and snapshots it.
    h.set.sample({ [PV_KEY]: 5000, [SOC_KEY]: 50, [VOLT_KEY]: 50, [CHARGE_KEY]: 120 });
    expect((await engine.tick()).state).toBe("active");
    expect(h.state()["test-profile:peakShaving"]?.previousValue).toBe(120);
  });
});

// --- Engine: buying from the grid inside a negative-price window --------------------

describe("peak-shaving engine — grid charging inside a window", () => {
  const HOUR = 3_600_000;
  const GRID_CHARGE_KEY = "settings.grid_charge";
  const GRID_CHARGE_A_KEY = "settings.max_grid_charge_current";
  const ENABLE_SLOT = "test-profile:peakShaving:gridcharge";
  const CURRENT_SLOT = "test-profile:peakShaving:gridchargeA";

  /** `slots` quarter-hours of negative prices from `fromHour` (UTC == local here). */
  const negativeWindow = (fromHour: number, slots: number): SpotSlice => ({
    zone: "DE-LU",
    stepMinutes: 15,
    utcOffsetSeconds: 0,
    coverage: { today: "complete", tomorrow: "complete" },
    availability: "ok",
    series: Array.from({ length: slots }, (_, i) => ({
      time: "2026-07-25T00:00",
      startMs: Date.parse("2026-07-25T00:00:00Z") + (fromHour + i * 0.25) * HOUR,
      minutes: 15,
      eurPerMwh: -40,
      negative: true,
    })),
  });

  /** A plant sitting inside an 11:30–13:30 window, half full, with both registers. */
  function inWindow(
    over: {
      gridChargeInWindow?: boolean;
      spotTariff?: boolean;
      metrics?: Record<string, number>;
    } = {},
  ) {
    const h = harness({
      config: config(
        {},
        {
          priceAware: {
            enabled: true,
            gridChargeInWindow: over.gridChargeInWindow ?? true,
            gridChargeMaxA: 20,
          },
        },
      ),
      prices: negativeWindow(11.5, 8),
    });
    h.set.weather(weather({ smartMeterSince: "2026-06-01" }));
    h.set.sample(
      over.metrics ?? {
        [PV_KEY]: 5000,
        [SOC_KEY]: 50,
        [VOLT_KEY]: 50,
        [CHARGE_KEY]: 120,
        [GRID_CHARGE_KEY]: 0,
        [GRID_CHARGE_A_KEY]: 40,
      },
    );
    const ctx = buildProfileContext(
      profileWith({
        "setting.battery.grid_charge": GRID_CHARGE_KEY,
        "setting.battery.max_grid_charge_current": GRID_CHARGE_A_KEY,
      }),
    );
    h.set.ctx(ctx);
    const io: AutomationIO = {
      ...h.io,
      ctx,
      getTariff: async () =>
        tariffConfigSchema.parse({
          import: { mode: over.spotTariff === false ? "static" : "spot" },
        }),
    };
    return { h, io };
  }

  const gridWrites = (h: Harness) =>
    h.writes.filter((w) => w.key === GRID_CHARGE_KEY || w.key === GRID_CHARGE_A_KEY);

  test("sets the current before switching grid charging on, and remembers both", async () => {
    // Enabling first would run the user's own (possibly much higher) current
    // for a tick before ours lands.
    const { h, io } = inWindow();
    const status = await createPeakShavingEngine(io).tick();
    expect(status.priceRegime).toBe("absorb");
    expect(gridWrites(h)).toEqual([
      { key: GRID_CHARGE_A_KEY, value: 20 },
      { key: GRID_CHARGE_KEY, value: 1 },
    ]);
    expect(status.gridChargeA).toBe(20);
    expect(h.state()[ENABLE_SLOT]?.previousValue).toBe(0);
    expect(h.state()[CURRENT_SLOT]?.previousValue).toBe(40);
  });

  test("a second tick in the same window writes nothing more", async () => {
    const { h, io } = inWindow();
    const engine = createPeakShavingEngine(io);
    await engine.tick();
    await engine.tick();
    expect(gridWrites(h)).toHaveLength(2);
    // And the remembered originals are still the user's, not our own commands.
    expect(h.state()[CURRENT_SLOT]?.previousValue).toBe(40);
  });

  test("the window ending hands both registers back, enable flag first", async () => {
    const { h, io } = inWindow();
    const engine = createPeakShavingEngine(io);
    await engine.tick();
    const claimed = h.writes.length;
    // 14:00: the window closed at 13:30. The sample is re-read at the new clock,
    // otherwise it would be stale and the tick would hold everything.
    h.set.now(NOON + 2 * HOUR);
    h.set.sample({
      [PV_KEY]: 5000,
      [SOC_KEY]: 50,
      [VOLT_KEY]: 50,
      [CHARGE_KEY]: 100,
      [GRID_CHARGE_KEY]: 1,
      [GRID_CHARGE_A_KEY]: 20,
    });
    const status = await engine.tick();
    expect(status.priceRegime).toBe("none");
    expect(h.writes.slice(claimed).filter((w) => w.key !== CHARGE_KEY)).toEqual([
      { key: GRID_CHARGE_KEY, value: 0 },
      { key: GRID_CHARGE_A_KEY, value: 40 },
    ]);
    expect(status.gridChargeA).toBeNull();
    expect(h.state()[ENABLE_SLOT]).toBeUndefined();
    expect(h.state()[CURRENT_SLOT]).toBeUndefined();
  });

  test("a fixed import price never buys from the grid", async () => {
    // A negative wholesale price does not lower a bill that does not follow it.
    const { h, io } = inWindow({ spotTariff: false });
    const status = await createPeakShavingEngine(io).tick();
    expect(status.priceRegime).toBe("absorb");
    expect(gridWrites(h)).toEqual([]);
    expect(status.gridChargeA).toBeNull();
    expect(h.state()[ENABLE_SLOT]).toBeUndefined();
  });

  test("the switch off leaves both registers alone", async () => {
    const { h, io } = inWindow({ gridChargeInWindow: false });
    const status = await createPeakShavingEngine(io).tick();
    expect(gridWrites(h)).toEqual([]);
    expect(status.gridChargeA).toBeNull();
  });

  test("no readback of the enable register holds the whole claim", async () => {
    // Half-claiming would turn grid charging on with no record of the current
    // the user had set.
    const { h, io } = inWindow({
      metrics: {
        [PV_KEY]: 5000,
        [SOC_KEY]: 50,
        [VOLT_KEY]: 50,
        [CHARGE_KEY]: 120,
        [GRID_CHARGE_A_KEY]: 40,
      },
    });
    const status = await createPeakShavingEngine(io).tick();
    expect(gridWrites(h)).toEqual([]);
    expect(status.gridChargeA).toBeNull();
    expect(h.state()[ENABLE_SLOT]).toBeUndefined();
    expect(h.state()[CURRENT_SLOT]).toBeUndefined();
  });

  test("a missing current readback holds too, and the claim completes when it arrives", async () => {
    const { h, io } = inWindow({
      metrics: {
        [PV_KEY]: 5000,
        [SOC_KEY]: 50,
        [VOLT_KEY]: 50,
        [CHARGE_KEY]: 120,
        [GRID_CHARGE_KEY]: 0,
      },
    });
    const engine = createPeakShavingEngine(io);
    const held = await engine.tick();
    expect(gridWrites(h)).toEqual([]);
    expect(held.gridChargeA).toBeNull();
    // The next poll carries the current register too.
    h.set.sample({
      [PV_KEY]: 5000,
      [SOC_KEY]: 50,
      [VOLT_KEY]: 50,
      [CHARGE_KEY]: 100,
      [GRID_CHARGE_KEY]: 0,
      [GRID_CHARGE_A_KEY]: 40,
    });
    const claimed = await engine.tick();
    expect(gridWrites(h)).toEqual([
      { key: GRID_CHARGE_A_KEY, value: 20 },
      { key: GRID_CHARGE_KEY, value: 1 },
    ]);
    expect(claimed.gridChargeA).toBe(20);
    // The enable flag's original value was captured on the first tick and must
    // not have been re-captured from our own command.
    expect(h.state()[ENABLE_SLOT]?.previousValue).toBe(0);
    expect(h.state()[CURRENT_SLOT]?.previousValue).toBe(40);
  });

  test("an inverter without the registers soaks anyway, it just cannot buy", async () => {
    // Grid charging is simply unavailable on that plant; the rest of price
    // awareness must keep working.
    const h = harness({
      config: config(
        {},
        { priceAware: { enabled: true, gridChargeInWindow: true, gridChargeMaxA: 20 } },
      ),
      prices: negativeWindow(11.5, 8),
    });
    h.set.weather(weather({ smartMeterSince: "2026-06-01" }));
    const io: AutomationIO = {
      ...h.io,
      getTariff: async () => tariffConfigSchema.parse({ import: { mode: "spot" } }),
    };
    const status = await createPeakShavingEngine(io).tick();
    expect(status.priceRegime).toBe("absorb");
    expect(status.gridChargeA).toBeNull();
    expect(h.writes).toEqual([{ key: CHARGE_KEY, value: 100 }]);
  });
});

describe("peak-shaving engine — tick queue", () => {
  test("a third tick behind a slow one rides the queue instead of stacking", async () => {
    // The interval fires every 30 s and a hot-apply (config PUT) can fire in
    // between; a slow Modbus tick must never leave a pile of runs waiting to
    // re-decide on readings that have long since moved on.
    const h = harness();
    let runs = 0;
    let open!: () => void;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const io: AutomationIO = {
      ...h.io,
      getConfig: async () => {
        runs += 1;
        if (runs === 1) await gate; // hold the first tick open
        return await h.io.getConfig();
      },
    };
    const engine = createPeakShavingEngine(io);
    const first = engine.tick();
    const second = engine.tick();
    const third = engine.tick(); // one running + one queued is the whole depth
    open();
    const settled = await Promise.all([first, second, third]);
    expect(runs).toBe(2);
    // The rider still reports the freshest status, and the queued run decided
    // on the same reading, so only the first tick wrote.
    expect(settled[2]).toBe(engine.status());
    expect(settled[2].state).toBe("active");
    expect(h.writes).toEqual([{ key: CHARGE_KEY, value: 50 }]);
  });
});
