/**
 * Peak shaving — the pure half: what may run, and what the charge-current
 * target should be for one tick.
 *
 * Everything here is a function of its arguments (no DB, no inverter, no clock),
 * so every mode and boundary is directly unit-testable. The stateful side — the
 * register snapshot, the write funnel, the tick loop — lives in
 * {@link ./peak-shaving-engine}, and the production wiring in {@link ./automation}.
 */

import type { AutomationConfig, PeakShavingMode } from "@SunReye/db/automation-config";
import type { WeatherConfig } from "@SunReye/db/weather";
import type { CanonicalRole, InverterProfile } from "@SunReye/inverter-core";
import type { EvccState } from "./evcc";
import type { SolarForecastPoint } from "./solar-forecast";

/** Battery this close to full (kWh headroom) → drop to the top-balance floor. */
const NEAR_FULL_KWH = 0.2;
/** Headroom must exceed the coming peak by this margin before fallback charging. */
const RESERVE_MARGIN_KWH = 0.2;
/**
 * Charge-current targets are rounded **up** to this step. PV noise of a few
 * hundred watts would otherwise move the target every tick and grind the
 * inverter's EEPROM with a write each 30 s; overshooting is the safe direction
 * (a higher ceiling charges more and never raises the export).
 */
const CHARGE_QUANT_A = 5;

const HOUR_MS = 3_600_000;

/** Bisection steps for the grid-friendly threshold search (≈ limit/2³² W). */
const THRESHOLD_SEARCH_STEPS = 32;

// --- Blockers ----------------------------------------------------------------

/** Why the automation cannot run: an unmapped role or missing plant config. */
export type Blocker =
  | { kind: "role"; role: CanonicalRole }
  | { kind: "config"; what: "export-limit" | "battery" };

const REQUIRED_ROLES = [
  "setting.battery.max_charge_current",
  "pv.total.power",
  "battery.soc",
] as const satisfies readonly CanonicalRole[];

/** The profile's metric key for a canonical role, or null when unmapped. */
export function keyForRole(profile: InverterProfile, role: CanonicalRole): string | null {
  return profile.metrics.find((m) => m.role === role)?.key ?? null;
}

/**
 * Everything that must be in place before peak shaving may run: the three
 * required roles mapped in the active profile, plus the export limit and
 * battery capacity from the weather (forecast) config — the single source of
 * truth the clipping model already uses. Shared by the PUT enable-guard and
 * the runtime tick, so "can enable" and "keeps running" can never drift.
 */
export function resolvePeakShavingBlockers(
  profile: InverterProfile,
  weather: WeatherConfig,
): Blocker[] {
  const blockers: Blocker[] = [];
  for (const role of REQUIRED_ROLES) {
    if (!keyForRole(profile, role)) blockers.push({ kind: "role", role });
  }
  if (weather.forecast.maxOutputW == null) blockers.push({ kind: "config", what: "export-limit" });
  if (weather.forecast.battery == null) blockers.push({ kind: "config", what: "battery" });
  return blockers;
}

/**
 * Guard for the settings PUT — what must hold before an enable is persisted:
 * the master gate needs the accepted disclaimer, and a per-automation enable
 * needs the master gate on plus a runnable setup (no blockers). Pure, so the
 * route stays a thin shell and the rules are unit-testable.
 */
export function validateAutomationEnable(
  cfg: AutomationConfig,
  profile: InverterProfile | null,
  weather: WeatherConfig,
): { error: string; blockers?: Blocker[] } | null {
  if (cfg.enabled && !cfg.disclaimerAcceptedAt) {
    return { error: "Enabling automations requires accepting the disclaimer" };
  }
  if (cfg.peakShaving.enabled) {
    if (!cfg.enabled) return { error: "Enable the automations master switch first" };
    if (!profile) return { error: "No active inverter profile" };
    const blockers = resolvePeakShavingBlockers(profile, weather);
    if (blockers.length > 0) {
      return { error: "Peak shaving cannot run with this setup", blockers };
    }
  }
  return null;
}

// --- Pure decision math -------------------------------------------------------

/** The slice of a forecast the decision needs (raw/uncurtailed view). */
export interface ForecastSlice {
  series: SolarForecastPoint[];
  stepMinutes: number;
  utcOffsetSeconds: number;
}

/** The EV picture the decision accounts for (zeros when EVCC is off/unreachable). */
export interface EvInputs {
  /** Live EV charge power across all loadpoints, W. */
  evChargeW: number;
  /** Energy connected cars still want today (charge limit gap), kWh. */
  evRemainingKwh: number;
}

/**
 * Condense the EVCC snapshot into what the decision needs. The car is treated
 * as the surplus consumer of first rank: its live draw never reaches the grid,
 * and its remaining demand will eat forecast surplus before the battery must.
 * Unreachable/absent EVCC degrades to zeros — exactly the pre-EVCC behavior.
 */
export function evccAutomationInputs(state: EvccState | null): EvInputs {
  if (!state?.reachable) return { evChargeW: 0, evRemainingKwh: 0 };
  let evChargeW = 0;
  let evRemainingKwh = 0;
  for (const lp of state.loadpoints) {
    evChargeW += Math.max(0, lp.chargePowerLive);
    // Demand counts only when a connected car is allowed to charge; a
    // loadpoint in `off` mode (or with no car) won't consume the surplus.
    if (lp.connected && lp.mode !== null && lp.mode !== "off") {
      evRemainingKwh += Math.max(0, lp.chargeRemainingEnergy ?? 0) / 1000;
    }
  }
  return { evChargeW, evRemainingKwh };
}

export interface DecisionInputs extends EvInputs {
  mode: PeakShavingMode;
  /** Live PV output, W. */
  pvW: number;
  /** Live battery SOC, %. */
  socPct: number;
  /** Battery voltage for W→A, V (live when mapped, else nominal). */
  batteryV: number;
  /** Effective export ceiling: `maxOutputW − safetyBufferW`, W. */
  exportLimitW: number;
  /** Usable battery energy, kWh. */
  usableKwh: number;
  maxChargeA: number;
  fallbackChargeA: number;
  /** Charge-current floor kept near full so BMS top-balancing can finish, A. */
  topBalanceFloorA: number;
  /** Raw (uncurtailed) forecast, or null when the provider is unavailable. */
  forecast: ForecastSlice | null;
  nowMs: number;
}

export interface Decision {
  targetA: number;
  /** The shave threshold applied this tick (dynamic in grid-friendly), W. */
  thresholdW: number;
  headroomKwh: number;
  /** Remaining-today energy above the export limit, kWh; null without forecast. */
  surplusAboveLimitKwh: number | null;
  /** True when the forecast was unavailable and only live shaving ran. */
  degraded: boolean;
}

/**
 * Width of the slot starting at `startMs`, ms: the gap to the next slot's local
 * time, but never wider than an hour — a series gap (e.g. a day boundary) must
 * not stretch a slot across it. Falls back to the nominal step at the tail.
 */
function slotWidthMs(
  startMs: number,
  nextTime: string | undefined,
  offsetMs: number,
  fallbackWidthMs: number,
): number {
  if (nextTime === undefined) return fallbackWidthMs;
  const gap = Date.parse(`${nextTime}:00Z`) - offsetMs - startMs;
  return gap > 0 && gap <= HOUR_MS ? gap : fallbackWidthMs;
}

/**
 * Remaining-today energy above `thresholdW` in the raw series, kWh. Future
 * slots of the plant-local calendar day only, with the running slot prorated
 * by the fraction still ahead (mirrors `remainingTodayKwh` in solar-forecast).
 * Observable through {@link Decision.surplusAboveLimitKwh}.
 */
function surplusAboveKwh(view: ForecastSlice, thresholdW: number, nowMs: number): number {
  const offsetMs = view.utcOffsetSeconds * 1000;
  const today = new Date(nowMs + offsetMs).toISOString().slice(0, 10);
  const fallbackWidth = view.stepMinutes * 60_000;
  let kwh = 0;
  for (const [i, point] of view.series.entries()) {
    if (!point.time.startsWith(today)) continue;
    const startMs = Date.parse(`${point.time}:00Z`) - offsetMs;
    const width = slotWidthMs(startMs, view.series[i + 1]?.time, offsetMs, fallbackWidth);
    // Only the part of the slot still ahead of `now` counts.
    const left = Math.min(startMs + width - nowMs, width);
    if (left <= 0) continue;
    kwh += (Math.max(0, point.watts - thresholdW) * (left / HOUR_MS)) / 1000;
  }
  return kwh;
}

/**
 * `maximize-exports` target: absorb whatever exceeds the export limit right
 * now; with nothing to absorb, hold the headroom for the coming peak and fall
 * back to the configured rate only when there is room to spare after it.
 */
function maximizeExportsA(
  i: DecisionInputs,
  liveExcessW: number,
  headroomKwh: number,
  peakKwh: number,
  toA: (watts: number) => number,
): number {
  if (liveExcessW > 0) return toA(liveExcessW);
  const chargeableKwh = headroomKwh - peakKwh;
  return chargeableKwh <= RESERVE_MARGIN_KWH ? 0 : Math.min(i.fallbackChargeA, i.maxChargeA);
}

/**
 * `grid-friendly` shave threshold: the `T ≤ limit` whose remaining-today
 * surplus just fills the battery. {@link surplusAboveKwh} is monotonically
 * decreasing in `T`, so a bisection finds it; when even `T = 0` cannot fill the
 * battery the search settles near 0 — the battery absorbs everything, export
 * ≈ 0, the grid-friendliest shape available. Staying at the limit is correct
 * when the coming peak alone already overfills the battery (a classic shave).
 */
function gridFriendlyThresholdW(
  i: DecisionInputs & { forecast: ForecastSlice },
  headroomKwh: number,
  peakKwh: number,
): number {
  if (peakKwh >= headroomKwh) return i.exportLimitW;
  let lo = 0;
  let hi = i.exportLimitW;
  for (let step = 0; step < THRESHOLD_SEARCH_STEPS; step++) {
    const mid = (lo + hi) / 2;
    if (surplusAboveKwh(i.forecast, mid, i.nowMs) - i.evRemainingKwh > headroomKwh) lo = mid;
    else hi = mid;
  }
  return hi;
}

/**
 * The charge-current target for one tick. Pure — all live/forecast inputs are
 * arguments — so every mode/boundary is directly unit-testable.
 *
 * `maximize-exports`: the battery only absorbs power above the export limit;
 * below it, PV exports freely and the battery charges at the fallback rate
 * only when today's coming peak cannot fill it on its own.
 *
 * `grid-friendly`: flatten the export curve. Charging everything above the
 * dynamic threshold ({@link gridFriendlyThresholdW}) spreads the battery charge
 * across the day and plateaus the export there instead of spiking to the limit.
 * Recomputed each tick, so as SOC rises the threshold rises toward the limit
 * and exports ramp up smoothly.
 *
 * EV interplay: power the car draws right now never reaches the grid, so it is
 * subtracted from every live-excess figure — the battery only takes what the
 * car leaves. Likewise the car's remaining demand is subtracted from the
 * forecast surplus before it is weighed against the battery headroom (the car
 * charges from surplus first; EVCC's own PV mode does exactly that).
 */
export function decideTargetA(i: DecisionInputs): Decision {
  const socPct = Math.min(100, Math.max(0, i.socPct));
  const headroomKwh = (i.usableKwh * (100 - socPct)) / 100;
  const base = {
    headroomKwh,
    surplusAboveLimitKwh: null as number | null,
    degraded: i.forecast === null,
  };
  const toA = (watts: number) =>
    Math.min(i.maxChargeA, Math.ceil(watts / i.batteryV / CHARGE_QUANT_A) * CHARGE_QUANT_A);
  const liveExcessW = Math.max(0, i.pvW - i.evChargeW - i.exportLimitW);

  // Near-full: the pack stops drawing on its own, but the ceiling must stay
  // above 0 A — the BMS top-balances during the absorption dwell at the top,
  // and a hard 0 would cut that short. Keep the configured floor instead.
  if (headroomKwh <= NEAR_FULL_KWH) {
    const floorA = Math.min(i.topBalanceFloorA, i.maxChargeA);
    return { ...base, targetA: floorA, thresholdW: i.exportLimitW };
  }

  // Provider down: never miss a real peak — degrade to pure live shaving.
  const forecast = i.forecast;
  if (!forecast) {
    return { ...base, targetA: toA(liveExcessW), thresholdW: i.exportLimitW };
  }

  const surplusAtLimit = surplusAboveKwh(forecast, i.exportLimitW, i.nowMs);
  base.surplusAboveLimitKwh = surplusAtLimit;
  // The car eats its share of the coming surplus before the battery has to.
  const peakKwh = surplusAtLimit - Math.min(i.evRemainingKwh, surplusAtLimit);

  if (i.mode === "maximize-exports") {
    return {
      ...base,
      targetA: maximizeExportsA(i, liveExcessW, headroomKwh, peakKwh, toA),
      thresholdW: i.exportLimitW,
    };
  }

  const thresholdW = gridFriendlyThresholdW({ ...i, forecast }, headroomKwh, peakKwh);
  return { ...base, targetA: toA(Math.max(0, i.pvW - i.evChargeW - thresholdW)), thresholdW };
}
