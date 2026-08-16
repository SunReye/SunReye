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
  PriceAwareConfig,
} from "@SunReye/db/automation-config";
import type { WeatherConfig } from "@SunReye/db/weather";
import type { CanonicalRole, InverterProfile } from "@SunReye/inverter-core";
import { HOUR_MS } from "../energy/energy-flow";
import type { Blocker, PriceRegime } from "@SunReye/contracts/automation";
import type { EvccLoadpoint, EvccState } from "@SunReye/contracts/evcc";
import { type PriceAction, planPriceAction } from "./price-plan";
import { type ForecastSlice, remainingSlotsToday } from "./slot-window";
import type { SpotSlice } from "@SunReye/contracts/prices";

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
/** Registers grid-charging needs; absent from a profile simply disables it. */
export const GRID_CHARGE_ROLE = "setting.battery.grid_charge" satisfies CanonicalRole;
export const GRID_CHARGE_CURRENT_ROLE =
  "setting.battery.max_grid_charge_current" satisfies CanonicalRole;

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
 * What must hold before price awareness may be switched on.
 *
 * The smart-meter-gateway date is the gate, and it is the whole "this is an
 * option for people who got the gateway installed" condition: §51 applies to the
 * cohort whose 60 % cap was lifted by that install, and acting on negative prices
 * makes no sense for anyone else. Expressed as a plant fact via the same
 * {@link Blocker} type the settings form already uses to lock a switch, and
 * shared by the PUT guard and the runtime tick so the two cannot drift.
 */
export function resolvePriceAwareBlockers(weather: WeatherConfig): Blocker[] {
  const blockers: Blocker[] = [];
  if (!weather.forecast.smartMeterSince) blockers.push({ kind: "config", what: "smart-meter" });
  return blockers;
}

/**
 * The price-aware config the tick may actually act on: forced off whenever the
 * plant no longer satisfies {@link resolvePriceAwareBlockers}.
 *
 * Without this the gate would only exist at the settings PUT, and clearing the
 * smart-meter date afterwards would leave a running loop steering on prices it
 * is no longer entitled to act on.
 */
export function effectivePriceConfig(
  price: PriceAwareConfig,
  weather: WeatherConfig,
): PriceAwareConfig {
  return resolvePriceAwareBlockers(weather).length > 0 ? { ...price, enabled: false } : price;
}

/**
 * Guard for the settings PUT — what must hold before an enable is persisted:
 * the master gate needs the accepted disclaimer, and a per-automation enable
 * needs the master gate on plus a runnable setup (no blockers). Pure, so the
 * route stays a thin shell and the rules are unit-testable.
 */
/** Why an enable was refused: a message, plus the blockers behind it when any. */
export type EnableError = { error: string; blockers?: Blocker[] };

/** The peak-shaving half of the enable guard. */
function validatePeakShavingEnable(
  cfg: AutomationConfig,
  profile: InverterProfile | null,
  weather: WeatherConfig,
): EnableError | null {
  if (!cfg.enabled) return { error: "Enable the automations master switch first" };
  if (!profile) return { error: "No active inverter profile" };
  const blockers = resolvePeakShavingBlockers(profile, weather, cfg.peakShaving.mode);
  return blockers.length > 0
    ? { error: "Peak shaving cannot run with this setup", blockers }
    : null;
}

export function validateAutomationEnable(
  cfg: AutomationConfig,
  profile: InverterProfile | null,
  weather: WeatherConfig,
): EnableError | null {
  if (cfg.enabled && !cfg.disclaimerAcceptedAt) {
    return { error: "Enabling automations requires accepting the disclaimer" };
  }
  if (cfg.peakShaving.enabled) {
    const failed = validatePeakShavingEnable(cfg, profile, weather);
    if (failed) return failed;
  }
  if (cfg.peakShaving.priceAware.enabled) {
    const blockers = resolvePriceAwareBlockers(weather);
    if (blockers.length > 0) {
      return { error: "Price-aware charging needs a smart meter gateway install date", blockers };
    }
  }
  return null;
}

// --- Pure decision math -------------------------------------------------------

/** The EV picture the decision accounts for (zeros when EVCC is off/unreachable). */
export interface EvInputs {
  /** Live EV charge power across all loadpoints, W. */
  evChargeW: number;
  /** Energy connected cars still want today (charge limit gap), kWh. */
  evRemainingKwh: number;
}

/**
 * EVCC's own charge-efficiency constant (`soc.ChargeEfficiency`). Its estimate
 * is meter-side energy, so the pack-side gap is grossed up by the same 10% —
 * the point of the fallback is to land on EVCC's number, not to offer a second,
 * quieter opinion that disagrees with it once EVCC does report one.
 */
const EV_CHARGE_EFFICIENCY = 0.9;

/**
 * The SOC the charge actually stops at, or null when neither limit is known.
 *
 * Not the same question as the limit *write* path ({@link ../evcc/evcc}), which
 * targets EVCC's own resolution of the session and vehicle limits. What stops
 * the charge is the lower of that and the car's own limit: a Tesla set to 75%
 * in its app stops there whatever EVCC intends, and the difference is energy no
 * automation should plan around. `0` is EVCC's "no limit", not a limit of zero,
 * so it never wins.
 */
export function chargeStopSoc(lp: EvccLoadpoint): number | null {
  const limits = [lp.effectiveLimitSoc, lp.vehicleLimitSoc].filter(
    (v): v is number => v !== null && v > 0,
  );
  return limits.length === 0 ? null : Math.min(...limits);
}

/**
 * Energy one loadpoint still wants, kWh.
 *
 * EVCC's `chargeRemainingEnergy` is preferred whenever it says anything: it is
 * the estimator's view, informed by the real pack and the charge taper. But
 * EVCC only produces it while its SoC estimator is actually running — a car
 * plugged in and waiting for surplus publishes `0` although it plainly still
 * wants the gap to its limit. Taking that `0` at face value told the decision
 * to reserve nothing and let the battery soak the surplus the car was waiting
 * for, so derive the gap ourselves whenever EVCC declines to.
 */
function loadpointDemandKwh(lp: EvccLoadpoint): number {
  const reported = Math.max(0, lp.chargeRemainingEnergy ?? 0) / 1000;
  if (reported > 0) return reported;
  const soc = lp.vehicleSoc;
  // Reserving surplus above the stop SOC reserves it for nobody.
  const limit = chargeStopSoc(lp);
  const capacityKwh = lp.vehicleCapacityKwh;
  // No SOC, no limit or no pack size: nothing to derive from. Unlike the
  // pull-in decision (where guessing costs nothing), a guess here would reserve
  // real surplus the car may not want.
  if (soc === null || limit === null || capacityKwh === null) return 0;
  const gapPct = limit - soc;
  if (gapPct <= 0) return 0;
  return ((gapPct / 100) * capacityKwh) / EV_CHARGE_EFFICIENCY;
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
      evRemainingKwh += loadpointDemandKwh(lp);
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
   * The plant's *physical* feed-in ceiling: `maxOutputW`, no buffer, W. PV
   * between this and {@link exportLimitW} would still have reached the grid, so
   * storing it rescues nothing — it only spends headroom the real clipping peak
   * needs later. Absent, it falls back to {@link exportLimitW}, i.e. the old
   * behaviour of treating the decision margin as a physical loss.
   */
  exportCapW?: number;
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
  /** Config echo for price awareness (never nullable; inert when disabled). */
  price: PriceAwareConfig;
  /** Day-ahead prices, or null when unavailable — never a zero-filled stand-in. */
  priceView: SpotSlice | null;
  /** Battery reserve floor, % — the envelope never plans below it. */
  minSocPct: number;
  /** Whether the tariff's import price tracks the market (gates grid-charging). */
  importFollowsMarket: boolean;
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
  /**
   * The surplus {@link targetA} was sized from, W — the watts absorption must not
   * exceed however the register write rounded.
   *
   * `targetA` is quantized to {@link CHARGE_QUANT_A}, and `maximize-exports`
   * rounds *up*, so the commanded ceiling can sit a whole step (5 A × the pack
   * voltage — 256 W on a 51.2 V pack) above the excess the reserve arithmetic
   * budgeted in exact watts. Spending that ceiling absorbs PV the grid was going
   * to pay for, which is the opposite of the mode's job. Rounding down instead
   * would under-absorb real clipping energy — the loss this whole feature exists
   * to prevent — so the write keeps its round-up and the *spending* is bounded
   * here instead.
   *
   * `null` where no such bound exists, and every one of those is deliberate:
   * - the near-full top-balance floor and the fallback rate are not derived from
   *   an excess at all; bounding them by a surplus of zero would cut the BMS's
   *   dwell short and defeat the fallback outright;
   * - `grid-friendly` steers the sell-limit register to the very threshold it
   *   charges against, so surplus above the target has nowhere to go but the
   *   pack. Bounding it there would curtail PV, never rescue an export.
   */
  absorbCeilingW: number | null;
  /** True when the forecast was unavailable and only live shaving ran. */
  degraded: boolean;
  /** What price awareness is doing this tick (`none` when off or price-less). */
  priceRegime: PriceRegime;
  /** SOC bound the pre-window envelope allows now, %; null when not shaping. */
  socEnvelopePct: number | null;
  /** Start/end of the window being planned for, epoch ms; null when none. */
  windowStartsAt: number | null;
  windowEndsAt: number | null;
  /** Energy the window can push into the pack, kWh; null when none. */
  soakableKwh: number | null;
  /**
   * Window energy that will earn nothing whatever the pack does, kWh. Reported
   * rather than hidden: on many days withholding charge cannot empty the pack in
   * time, and a planner that pretends otherwise is worse than one that says so.
   */
  unavoidableZeroValueKwh: number | null;
  /** Grid-charge current for this tick, A; null = don't charge from the grid. */
  gridChargeA: number | null;
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
 * `maximize-exports` target: absorb whatever the plant genuinely cannot export
 * right now, plus — only when there is room to spare after the coming peak —
 * the safety-buffer band on top; with nothing to absorb, hold the headroom for
 * that peak and fall back to the configured rate under the same condition.
 *
 * The band between `exportLimitW` and `exportCapW` is discretionary in exactly
 * the way the fallback rate already is: that PV is being sold either way, so
 * paying for it with headroom is a straight loss whenever the peak still needs
 * the room. Above the cap the energy is gone if the pack does not take it, so
 * that half is never negotiable.
 */
function maximizeExportsA(
  i: DecisionInputs,
  hardExcessW: number,
  bufferExcessW: number,
  headroomKwh: number,
  peakKwh: number,
  toA: (watts: number) => number,
): { targetA: number; absorbCeilingW: number | null } {
  const roomToSpare = headroomKwh - peakKwh > RESERVE_MARGIN_KWH;
  if (hardExcessW + bufferExcessW > 0) {
    // The excess is carried out alongside the current so the round-up cannot be
    // spent — see {@link Decision.absorbCeilingW}.
    const excessW = roomToSpare ? hardExcessW + bufferExcessW : hardExcessW;
    return { targetA: toA(excessW), absorbCeilingW: excessW };
  }
  // The fallback rate charges from PV that *is* selling, on purpose: no bound.
  return {
    targetA: roomToSpare ? Math.min(i.fallbackChargeA, i.maxChargeA) : 0,
    absorbCeilingW: null,
  };
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
  exportLimitW: number,
): number {
  const floorW = Math.min(i.gridFriendly.minThresholdW, exportLimitW);
  const trust = i.gridFriendly.forecastTrustPct / 100;
  const evKwh = i.gridFriendly.reserveForEvDemand ? i.evRemainingKwh : 0;
  const fills = (levelW: number) =>
    exportSurplusAboveKwh(i.forecast, levelW, exportLimitW, i.baselineLoadW, i.nowMs) * trust -
      evKwh >
    headroomKwh;
  // Not even the floor gathers enough: sit on it and take everything above.
  if (!fills(floorW)) return floorW;
  let lo = floorW;
  let hi = exportLimitW;
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
 * The charge-current target one *mode* wants for this tick, given the feed-in
 * ceiling to respect.
 *
 * The ceiling arrives as a parameter rather than being read off `i` so that a
 * caller can hand it something other than the plant's own export limit — which
 * is the whole mechanism behind price-aware absorption: lowering this one number
 * to zero makes "soak everything" fall out of the existing frame, because
 * `liveExcessW`, both surplus integrals and the grid-friendly bisection all
 * already read it. No second set of physics.
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
function decideModeTargetA(i: DecisionInputs, exportLimitW: number): Decision {
  const socPct = Math.min(100, Math.max(0, i.socPct));
  const headroomKwh = (i.usableKwh * (100 - socPct)) / 100;
  // PV the grid can never see: the house load, plus the car's draw when the
  // load reading doesn't already include it.
  const localSinkW = Math.max(0, i.liveLoadW) + (i.evIncludedInLoad ? 0 : Math.max(0, i.evChargeW));
  const liveExcessW = Math.max(0, i.pvW - localSinkW - exportLimitW);
  // The physical ceiling this tick. Only the plant's own safety buffer is a
  // paper limit: a price action collapses the ceiling *because* it wants that
  // energy in the pack, so the band it opens is not discretionary at all.
  const capW =
    exportLimitW < i.exportLimitW ? exportLimitW : Math.max(exportLimitW, i.exportCapW ?? 0);
  // PV that is lost unless the pack takes it, and the buffer band on top of it
  // — energy the grid would still have accepted.
  const hardExcessW = Math.max(0, i.pvW - localSinkW - capW);
  const bufferExcessW = liveExcessW - hardExcessW;
  const base = {
    headroomKwh,
    surplusAboveLimitKwh: null as number | null,
    localSinkW,
    liveExcessW,
    // Unbounded unless a branch below sized its target from an excess figure.
    absorbCeilingW: null as number | null,
    degraded: i.forecast === null,
    // Filled in by `priceAdjust`; the mode itself knows nothing about prices.
    priceRegime: "none" as PriceRegime,
    socEnvelopePct: null as number | null,
    windowStartsAt: null as number | null,
    windowEndsAt: null as number | null,
    soakableKwh: null as number | null,
    unavoidableZeroValueKwh: null as number | null,
    gridChargeA: null as number | null,
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
    return { ...base, targetA: floorA, thresholdW: exportLimitW };
  }

  // Provider down: never miss a real peak — degrade to pure live shaving.
  const forecast = i.forecast;
  if (!forecast) {
    return {
      ...base,
      targetA: toA(liveExcessW),
      absorbCeilingW: liveExcessW,
      thresholdW: exportLimitW,
    };
  }

  // Feed-in frame: the day's load is subtracted before anything can be exported.
  //
  // Note the asymmetry with the spending below, which is deliberate: this
  // integral runs against the *buffered* limit, so it counts the buffer band as
  // part of the coming peak — while `maximizeExportsA` refuses to store that
  // band whenever the peak has a claim on the headroom. The reserve is therefore
  // sized against a peak figure that includes energy it will never spend, a
  // systematic over-estimate. Kept on purpose: erring toward holding headroom
  // costs a little discretionary charging, erring the other way loses clipping
  // energy for good. The two halves genuinely describe different quantities —
  // "how much could still need rescuing" vs "how much may be taken now" — so do
  // not "fix" one to match the other without deciding which loss you prefer.
  const surplusAtLimit = surplusAboveKwh(forecast, exportLimitW + i.baselineLoadW, i.nowMs);
  base.surplusAboveLimitKwh = surplusAtLimit;
  // The car eats its share of the coming surplus before the battery has to.
  const peakKwh = surplusAtLimit - Math.min(i.evRemainingKwh, surplusAtLimit);

  if (i.mode === "maximize-exports") {
    return {
      ...base,
      ...maximizeExportsA(i, hardExcessW, bufferExcessW, headroomKwh, peakKwh, toA),
      thresholdW: exportLimitW,
    };
  }

  const solvedW = gridFriendlyThresholdW({ ...i, forecast }, headroomKwh, exportLimitW);
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
  const exportableNowW = Math.min(Math.max(0, i.pvW - localSinkW), exportLimitW);
  const targetA = slewLimitedA(
    toA(Math.max(0, exportableNowW - thresholdW)),
    i.previousTargetA,
    i.gridFriendly.chargeSlewAPerMin,
    i.sinceLastDecisionMs,
  );
  return { ...base, targetA, thresholdW };
}

/** Round a power ceiling down to a charge current — never up: overshoot is the unsafe way. */
const floorToA = (watts: number, volts: number, maxA: number): number =>
  Math.min(maxA, Math.max(0, Math.floor(watts / volts / CHARGE_QUANT_A) * CHARGE_QUANT_A));

/**
 * Layer the price action onto the mode's decision.
 *
 * Three effects, each one line, all orthogonal to the mode:
 * 1. **Soak** — already applied, by handing `decideModeTargetA` a lower ceiling.
 * 2. **Pre-window envelope** — cap the charge current so the pack keeps room.
 *    The near-full top-balance floor keeps precedence: a pack that full has no
 *    room to protect anyway, and cutting the BMS's dwell short would be a real
 *    harm for an imaginary gain.
 * 3. **Reporting** — carry the regime and the honest kWh figures out to the log
 *    and the UI, which is the whole value on days when shaping cannot win.
 */
function priceAdjust(i: DecisionInputs, decision: Decision, action: PriceAction): Decision {
  const capped =
    action.chargeCeilingW === null || decision.headroomKwh <= NEAR_FULL_KWH
      ? decision.targetA
      : Math.min(decision.targetA, floorToA(action.chargeCeilingW, i.batteryV, i.maxChargeA));
  return {
    ...decision,
    targetA: capped,
    priceRegime: action.regime,
    socEnvelopePct: action.socEnvelopePct,
    windowStartsAt: action.window?.startMs ?? null,
    windowEndsAt: action.window?.endMs ?? null,
    soakableKwh: action.soakableKwh,
    unavoidableZeroValueKwh: action.unavoidableZeroValueKwh,
    gridChargeA: action.gridChargeA,
  };
}

/**
 * The charge-current target for one tick — the entry point the live tick and the
 * forward projection both call.
 *
 * A thin composition on purpose. Peak shaving's own maths is one thing and the
 * price adjustment is another, and keeping them separable is what lets a
 * reviewer answer "did the shaving behaviour change?" by reading
 * {@link decideModeTargetA} alone.
 */
export function decideTargetA(i: DecisionInputs): Decision {
  const action = planPriceAction({
    price: i.price,
    prices: i.priceView,
    forecast: i.forecast,
    nowMs: i.nowMs,
    socPct: i.socPct,
    minSocPct: i.minSocPct,
    usableKwh: i.usableKwh,
    baselineLoadW: i.baselineLoadW,
    maxChargeW: i.maxChargeA * i.batteryV,
    importFollowsMarket: i.importFollowsMarket,
  });
  // Soaking is expressed as a *lower feed-in ceiling*, so absorption falls out
  // of the existing frame instead of needing a branch of its own.
  return priceAdjust(i, decideModeTargetA(i, action.exportLimitW ?? i.exportLimitW), action);
}
