/**
 * Peak shaving — the pure half: what may run, and what the charge-current
 * target should be for one tick.
 *
 * Everything here is a function of its arguments (no DB, no inverter, no clock),
 * so every mode and boundary is directly unit-testable. The stateful side — the
 * register snapshot, the write funnel, the tick loop — lives in
 * {@link ./peak-shaving-engine}, and the production wiring in {@link ./automation}.
 */

import type {
  AutomationConfig,
  GridFriendlyConfig,
  PeakShavingMode,
} from "@SunReye/db/automation-config";
import type { WeatherConfig } from "@SunReye/db/weather";
import type { CanonicalRole, InverterProfile } from "@SunReye/inverter-core";
import { HOUR_MS } from "./energy-flow";
import type { EvccState } from "./evcc";
import type { SolarForecastPoint } from "./solar-forecast";

/** Battery this close to full (kWh headroom) → drop to the top-balance floor. */
export const NEAR_FULL_KWH = 0.2;
/** Headroom must exceed the coming peak by this margin before fallback charging. */
const RESERVE_MARGIN_KWH = 0.2;
/**
 * Charge-current targets are quantized to this step. PV noise of a few hundred
 * watts would otherwise move the target every tick and grind the inverter's
 * EEPROM with a write each 30 s.
 */
const CHARGE_QUANT_A = 5;

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

/**
 * The feed-in ceiling register. `grid-friendly` steers it — the charge current
 * decides how much PV the battery takes, but only this decides how much the
 * inverter is willing to sell, and the mode exists to push that below the
 * plant's configured limit.
 */
export const SELL_LIMIT_ROLE = "setting.solar_sell.max_power" satisfies CanonicalRole;

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
  mode: PeakShavingMode = "maximize-exports",
): Blocker[] {
  const blockers: Blocker[] = [];
  for (const role of REQUIRED_ROLES) {
    if (!keyForRole(profile, role)) blockers.push({ kind: "role", role });
  }
  // Holding feed-in *below* the plant's own limit needs that limit as an
  // actuator; the charge register alone cannot stop the inverter from selling.
  if (mode === "grid-friendly" && !keyForRole(profile, SELL_LIMIT_ROLE)) {
    blockers.push({ kind: "role", role: SELL_LIMIT_ROLE });
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
    const blockers = resolvePeakShavingBlockers(profile, weather, cfg.peakShaving.mode);
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
  /**
   * House load right now, W — measured from `load.power` when the profile maps
   * it, else the baseline, else 0. PV is only curtailed above `load + limit`
   * (the frame the forecast's clipping model uses), so every threshold is
   * compared against PV minus this.
   */
  liveLoadW: number;
  /**
   * Representative house load for the rest of today, W (config override or the
   * 14-day median; 0 when unknown). Kept separate from {@link liveLoadW} so a
   * kettle cannot move the whole day's plan.
   */
  baselineLoadW: number;
  /**
   * True when the load reading already contains the EV charger's draw (EVCC's
   * `subtractFromHome`), so {@link EvInputs.evChargeW} must not be subtracted
   * a second time.
   */
  evIncludedInLoad: boolean;
  /** Usable battery energy, kWh. */
  usableKwh: number;
  maxChargeA: number;
  fallbackChargeA: number;
  /** Charge-current floor kept near full so BMS top-balancing can finish, A. */
  topBalanceFloorA: number;
  gridFriendly: GridFriendlyConfig;
  /** Threshold the previous tick settled on, W; null after a release. */
  previousThresholdW: number | null;
  /** Charge-current target the previous tick settled on, A; null after a release. */
  previousTargetA: number | null;
  /** Time since that tick, ms — the slew budget this tick may spend. */
  sinceLastDecisionMs: number;
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
  /** PV that cannot reach the grid regardless of the battery (load + EV), W. */
  localSinkW: number;
  /** PV above the export limit once the local sinks have taken their share, W. */
  liveExcessW: number;
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

/** A forecast slot still ahead of a reference time. */
export interface ForecastSlot {
  /** Slot start, epoch ms. */
  startMs: number;
  /** The part of the slot still ahead of the reference time, ms. */
  remainingMs: number;
  /** Raw (uncurtailed) forecast power for the slot, W. */
  watts: number;
}

/**
 * Future slots of the plant-local calendar day, oldest first, with the running
 * slot prorated by the fraction still ahead (mirrors `remainingTodayKwh` in
 * solar-forecast). The one place slot geometry lives: both the shave threshold's
 * surplus integral and the forward projection walk the day through this.
 */
export function remainingSlotsToday(view: ForecastSlice, fromMs: number): ForecastSlot[] {
  const offsetMs = view.utcOffsetSeconds * 1000;
  const today = new Date(fromMs + offsetMs).toISOString().slice(0, 10);
  const fallbackWidth = view.stepMinutes * 60_000;
  const slots: ForecastSlot[] = [];
  for (const [i, point] of view.series.entries()) {
    if (!point.time.startsWith(today)) continue;
    const startMs = Date.parse(`${point.time}:00Z`) - offsetMs;
    const width = slotWidthMs(startMs, view.series[i + 1]?.time, offsetMs, fallbackWidth);
    const remainingMs = Math.min(startMs + width - fromMs, width);
    if (remainingMs <= 0) continue;
    slots.push({ startMs, remainingMs, watts: point.watts });
  }
  return slots;
}

/**
 * Remaining-today energy above `thresholdW` in the raw series, kWh. Observable
 * through {@link Decision.surplusAboveLimitKwh}.
 */
function surplusAboveKwh(view: ForecastSlice, thresholdW: number, nowMs: number): number {
  let kwh = 0;
  for (const slot of remainingSlotsToday(view, nowMs)) {
    kwh += (Math.max(0, slot.watts - thresholdW) * (slot.remainingMs / HOUR_MS)) / 1000;
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
 * Remaining-today energy above `levelW` in the **export** curve, kWh — the raw
 * forecast minus the house load and clamped at the export budget, i.e. what the
 * grid would actually see if the battery took nothing.
 *
 * The clamp is what separates the two modes. {@link surplusAboveKwh} counts the
 * energy the limit blocks (free to store, invisible to the grid);. this counts
 * energy that *would have been sold*, which is the only kind whose diversion
 * lowers the feed-in curve.
 */
function exportSurplusAboveKwh(
  view: ForecastSlice,
  levelW: number,
  budgetW: number,
  loadW: number,
  nowMs: number,
): number {
  let kwh = 0;
  for (const slot of remainingSlotsToday(view, nowMs)) {
    const exportableW = Math.min(Math.max(0, slot.watts - loadW), budgetW);
    kwh += (Math.max(0, exportableW - levelW) * (slot.remainingMs / HOUR_MS)) / 1000;
  }
  return kwh;
}

/**
 * `grid-friendly` feed-in level: the `L` at which the rest of today's
 * *exportable* energy above `L` just fills the battery. Charging the difference
 * holds feed-in at `L` for the whole remaining surplus instead of letting it
 * pin to the limit, which is the entire point of the mode — a flatter, lower
 * midday export curve, paid for with the PV above the budget that the pack no
 * longer has room to rescue.
 *
 * {@link exportSurplusAboveKwh} is monotonically decreasing in `L`, so a
 * bisection finds it, searched in `[minThresholdW, exportLimitW]`: the floor
 * keeps some feed-in flowing instead of absorbing the whole day, and a floor at
 * the limit degenerates to a classic shave.
 *
 * `forecastTrustPct` scales the believed surplus: below 100 the search assumes
 * less will arrive than forecast and lowers the level (charge earlier), above
 * 100 it waits.
 */
function gridFriendlyThresholdW(
  i: DecisionInputs & { forecast: ForecastSlice },
  headroomKwh: number,
): number {
  const floorW = Math.min(i.gridFriendly.minThresholdW, i.exportLimitW);
  const trust = i.gridFriendly.forecastTrustPct / 100;
  const evKwh = i.gridFriendly.reserveForEvDemand ? i.evRemainingKwh : 0;
  const fills = (levelW: number) =>
    exportSurplusAboveKwh(i.forecast, levelW, i.exportLimitW, i.baselineLoadW, i.nowMs) * trust -
      evKwh >
    headroomKwh;
  // Not even the floor gathers enough: sit on it and take everything above.
  if (!fills(floorW)) return floorW;
  let lo = floorW;
  let hi = i.exportLimitW;
  for (let step = 0; step < THRESHOLD_SEARCH_STEPS; step++) {
    const mid = (lo + hi) / 2;
    if (fills(mid)) lo = mid;
    else hi = mid;
  }
  return hi;
}

/**
 * Keep the plateau from stepping around when the forecast moves: allow at most
 * `slewWPerMin` of travel per minute since the last decision. Skipped on the
 * first tick after a release (no previous threshold to move from).
 */
function slewLimited(
  targetW: number,
  previousW: number | null,
  wPerMin: number,
  elapsedMs: number,
): number {
  if (previousW === null || wPerMin <= 0) return targetW;
  const budget = wPerMin * (Math.max(0, elapsedMs) / 60_000);
  return Math.min(previousW + budget, Math.max(previousW - budget, targetW));
}

/**
 * The same damping for the charge-current ceiling. Stepping from idle to the
 * full ceiling swings kilowatts at the connection point in one tick, which is
 * precisely what `grid-friendly` is asked to avoid, so the current travels at
 * most `aPerMin`.
 *
 * The allowance is never smaller than one quantization step: a smaller one would
 * round straight back to the previous target and the ramp would stall instead of
 * creeping.
 */
function slewLimitedA(
  targetA: number,
  previousA: number | null,
  aPerMin: number,
  elapsedMs: number,
): number {
  if (previousA === null || aPerMin <= 0) return targetA;
  const allowance = Math.max(CHARGE_QUANT_A, aPerMin * (Math.max(0, elapsedMs) / 60_000));
  const clamped = Math.min(previousA + allowance, Math.max(previousA - allowance, targetA));
  return Math.round(clamped / CHARGE_QUANT_A) * CHARGE_QUANT_A;
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
 * Frame: every threshold is a **feed-in** figure. PV only has nowhere to go
 * above `load + exportLimit` (the same frame the forecast's clipping model
 * uses), so the house load is subtracted from live PV and from every forecast
 * slot before a threshold is applied. With a measured `load.power` metric that
 * makes the live half a closed loop on actual export rather than on raw PV.
 *
 * EV interplay: power the car draws right now never reaches the grid, so it is
 * subtracted from every live-excess figure — the battery only takes what the
 * car leaves, unless the load reading already contains it
 * ({@link DecisionInputs.evIncludedInLoad}). The car's remaining demand is
 * weighed against the forecast surplus too, which makes the battery charge
 * earlier to still fill up; `reserveForEvDemand` turns that off and leaves the
 * surplus to the car.
 */
export function decideTargetA(i: DecisionInputs): Decision {
  const socPct = Math.min(100, Math.max(0, i.socPct));
  const headroomKwh = (i.usableKwh * (100 - socPct)) / 100;
  // PV the grid can never see: the house load, plus the car's draw when the
  // load reading doesn't already include it.
  const localSinkW = Math.max(0, i.liveLoadW) + (i.evIncludedInLoad ? 0 : Math.max(0, i.evChargeW));
  const liveExcessW = Math.max(0, i.pvW - localSinkW - i.exportLimitW);
  const base = {
    headroomKwh,
    surplusAboveLimitKwh: null as number | null,
    localSinkW,
    liveExcessW,
    degraded: i.forecast === null,
  };
  // `maximize-exports` rounds up — overshooting a real peak is the safe
  // direction. `grid-friendly` rounds to the nearest step instead: rounding up
  // every tick fills the pack ahead of plan and ends the plateau in a spike to
  // the limit, which is exactly what the mode exists to avoid.
  const toA = (watts: number) => {
    const steps = watts / i.batteryV / CHARGE_QUANT_A;
    const rounded = i.mode === "grid-friendly" ? Math.round(steps) : Math.ceil(steps);
    return Math.min(i.maxChargeA, Math.max(0, rounded) * CHARGE_QUANT_A);
  };

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

  // Feed-in frame: the day's load is subtracted before anything can be exported.
  const surplusAtLimit = surplusAboveKwh(forecast, i.exportLimitW + i.baselineLoadW, i.nowMs);
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

  const solvedW = gridFriendlyThresholdW({ ...i, forecast }, headroomKwh);
  const thresholdW = slewLimited(
    solvedW,
    i.previousThresholdW,
    i.gridFriendly.slewWPerMin,
    i.sinceLastDecisionMs,
  );
  // Budget frame: feed-in plus charging stay inside the export budget, so the
  // battery is filled out of energy that would otherwise have been *sold* and
  // the feed-in level actually drops. PV above the budget is left on the table —
  // rescuing it would consume the same headroom and buy no flattening at all.
  const exportableNowW = Math.min(Math.max(0, i.pvW - localSinkW), i.exportLimitW);
  const targetA = slewLimitedA(
    toA(Math.max(0, exportableNowW - thresholdW)),
    i.previousTargetA,
    i.gridFriendly.chargeSlewAPerMin,
    i.sinceLastDecisionMs,
  );
  return { ...base, targetA, thresholdW };
}
