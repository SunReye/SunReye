/**
 * Peak shaving — the stateful half: the tick state machine that owns the
 * battery max-charge-current register while active.
 *
 * Design rules:
 * - Registers are addressed by canonical *role*, never by raw key; a profile
 *   that doesn't map a required role blocks the automation entirely.
 * - Every write goes through the injected `write` (the runtime funnel), so the
 *   engine can never race the poll loop or open its own Modbus client.
 * - The user's charge-current value is snapshotted when the engine takes the
 *   register and restored when it lets go (disable/idle/blocked). The snapshot
 *   persists in `app_settings`, so a restart never re-captures the engine's
 *   own last write as the "user value".
 * - The decision math is pure ({@link decideTargetA}) and the tick runs against
 *   an injected {@link AutomationIO}, so the whole state machine is unit-testable
 *   without a DB or inverter.
 */

import type { AutomationConfig } from "@SunReye/db/automation-config";
import {
  type AutomationState,
  automationStateKey,
  evccBoostLimitStateKey,
  evccModeStateKey,
  numericSnapshot,
} from "@SunReye/db/automation-state";
import type { WeatherConfig } from "@SunReye/db/weather";
import { entityConstraint } from "@SunReye/inverter-core";
import type { CanonicalRole, InverterSample } from "@SunReye/inverter-core";
import type {
  DecisionPoint,
  PeakShavingPlans,
  PeakShavingRunState,
  PeakShavingStatus,
  PriceRegime,
} from "@SunReye/contracts/automation";
import { type DecisionLog, createDecisionLog } from "./automation-history";
import type { EvccState } from "@SunReye/contracts/evcc";
import type { EvccAction } from "../evcc/evcc";
import type { ProfileContext } from "../inverter/inverter";
import { log } from "../shared/logging";
import {
  type Decision,
  type DecisionInputs,
  type EvInputs,
  NEAR_FULL_KWH,
  GRID_CHARGE_CURRENT_ROLE,
  GRID_CHARGE_ROLE,
  SELL_LIMIT_ROLE,
  decideTargetA,
  effectivePriceConfig,
  evccAutomationInputs,
  keyForRole,
  resolvePeakShavingBlockers,
  resolvePriceAwareBlockers,
} from "./peak-shaving";
import type { ForecastSlice } from "./slot-window";
import {
  BOOST_LIMIT_DISABLED,
  type EvPullInClaim,
  type EvPullInPlan,
  planEvPullIn,
} from "./ev-pull-in";
import { insideNegativeWindow } from "./price-plan";
import type { TariffConfig } from "@SunReye/db/tariff";
import type { SpotSlice } from "@SunReye/contracts/prices";
import { type PlanLimits, projectPeakShavingDays } from "./peak-shaving-plan";
import type { SolarForecast } from "../forecast/solar-forecast";

const logger = log("automation");

/** Id under which peak shaving namespaces its snapshot (see automation-state). */
const PEAK_SHAVING_ID = "peakShaving";

/** A live sample older than this is unusable — hold all writes. */
const STALE_SAMPLE_MS = 30_000;

/**
 * Effectiveness watchdog: the engine only writes a charge-current *ceiling*, so
 * an inverter whose work mode prioritizes selling can ignore it completely and
 * leave the automation a silent no-op. When the ceiling in the register asks for
 * at least {@link INEFFECTIVE_MIN_W} and `battery.power` reports less than
 * {@link INEFFECTIVE_RATIO} of it for {@link INEFFECTIVE_TICKS} ticks in a row,
 * say so instead of pretending to work.
 */
const INEFFECTIVE_MIN_W = 300;
const INEFFECTIVE_RATIO = 0.25;
const INEFFECTIVE_TICKS = 3;

/**
 * Everything the tick touches, injected so tests can run the full state
 * machine with fakes (no DB, no inverter, no clock).
 */
export interface AutomationIO {
  ctx: ProfileContext;
  write(key: string, value: number): Promise<void>;
  getConfig(): Promise<AutomationConfig>;
  getWeather(): Promise<WeatherConfig>;
  getForecast(weather: WeatherConfig): Promise<SolarForecast | null>;
  /**
   * Representative house load for the rest of the day, W — the same figure the
   * forecast's clipping model uses (config override, else the 14-day median).
   * Null when the plant maps no load metric and configures none.
   */
  getBaselineLoadW(weather: WeatherConfig): Promise<number | null>;
  /** Current EVCC snapshot, or null when the integration is off. */
  getEvcc(): EvccState | null;
  /**
   * Day-ahead prices for today+tomorrow, or null when the feed is off or has no
   * data. Never a zero-filled stand-in: under §51 a zero price is a *meaningful*
   * value, so "no data" must stay distinguishable from "the market cleared at 0".
   */
  getPrices(): Promise<SpotSlice | null>;
  /** The active tariff — read for whether the import price follows the market. */
  getTariff(): Promise<TariffConfig>;
  /**
   * Command an EVCC loadpoint (charge mode, battery boost, boost SOC limit).
   * Throws when the broker is unreachable — the caller treats that as "could not
   * claim", never as success.
   */
  evccCommand(loadpoint: number, action: EvccAction, value: string): void;
  latestSample(): InverterSample | null;
  loadState(): Promise<AutomationState>;
  saveState(next: AutomationState): Promise<void>;
  now(): number;
}

export function initialStatus(): PeakShavingStatus {
  return {
    enabled: false,
    mode: "maximize-exports",
    state: "disabled",
    blockers: [],
    priceBlockers: [],
    lastTickAt: null,
    lastWriteAt: null,
    lastError: null,
    targetA: null,
    lastWrittenA: null,
    liveA: null,
    thresholdW: null,
    sellLimitW: null,
    liveSellLimitW: null,
    liveExcessW: null,
    loadW: null,
    headroomKwh: null,
    usableKwh: null,
    remainingAboveLimitKwh: null,
    evChargeW: null,
    evDemandKwh: null,
    forecastAvailable: false,
    externalOverride: false,
    ineffective: false,
    restorePending: false,
    gridChargeA: null,
    priceRegime: "none",
    socEnvelopePct: null,
    windowStartsAt: null,
    windowEndsAt: null,
    soakableKwh: null,
    unavoidableZeroValueKwh: null,
  };
}

const finite = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

export interface PeakShavingEngine {
  tick(): Promise<PeakShavingStatus>;
  status(): PeakShavingStatus;
  /** Rolling decision history for the charts, oldest → newest. */
  history(): DecisionPoint[];
  /**
   * Projections of the rest of today and of the whole of tomorrow, or null
   * when the setup can't produce one (blockers, no forecast, no fresh
   * readings). Available whether or not the automation is switched on — it
   * doubles as a pre-flight preview — and never writes anything.
   */
  plan(): Promise<PeakShavingPlans | null>;
  /** Restore + release the register if held (used on explicit disable). */
  release(): Promise<void>;
}

/** One engine's working set: its IO and the mutable status the tick updates. */
interface Eng {
  io: AutomationIO;
  status: PeakShavingStatus;
  /** Rolling log of decided ticks, live and shadow alike. */
  log: DecisionLog;
  /** Plateau the last decision settled on, W — the slew anchor; null after a release. */
  prevThresholdW: number | null;
  /** Charge ceiling the last decision settled on, A — the ramp anchor; null after a release. */
  prevTargetA: number | null;
  /** When that decision ran, ms; sets the slew budget of the next one. */
  prevDecisionAtMs: number | null;
  /** Consecutive ticks where a settled ceiling produced no absorption. */
  ineffectiveTicks: number;
}

const stateKeyOf = (io: AutomationIO) => automationStateKey(io.ctx.profile.id, PEAK_SHAVING_ID);
const targetKeyOf = (io: AutomationIO) =>
  keyForRole(io.ctx.profile, "setting.battery.max_charge_current");
/** The feed-in ceiling register `grid-friendly` steers; null when unmapped. */
const sellKeyOf = (io: AutomationIO) => keyForRole(io.ctx.profile, SELL_LIMIT_ROLE);
/** Its own snapshot slot — the two registers are taken and given back separately. */
const sellSlotOf = (io: AutomationIO) => `${stateKeyOf(io)}:sell`;
const gridChargeKeyOf = (io: AutomationIO) => keyForRole(io.ctx.profile, GRID_CHARGE_ROLE);
const gridChargeAKeyOf = (io: AutomationIO) => keyForRole(io.ctx.profile, GRID_CHARGE_CURRENT_ROLE);
const gridChargeSlotOf = (io: AutomationIO) => `${stateKeyOf(io)}:gridcharge`;
const gridChargeASlotOf = (io: AutomationIO) => `${stateKeyOf(io)}:gridchargeA`;

/** Both registers the automation may hold, paired with their snapshot slots. */
const steeredRegisters = (io: AutomationIO): { slot: string; key: string | null }[] => [
  { slot: stateKeyOf(io), key: targetKeyOf(io) },
  { slot: sellSlotOf(io), key: sellKeyOf(io) },
];

/**
 * Forget what the last decision established: the plateau is re-solved from
 * scratch on the next activation, and a stale no-absorption verdict must not
 * linger past a release.
 */
function resetSteering(e: Eng): void {
  e.prevThresholdW = null;
  e.prevTargetA = null;
  e.prevDecisionAtMs = null;
  e.ineffectiveTicks = 0;
  e.status.ineffective = false;
}

/**
 * Put one snapshotted value back. False keeps the snapshot so the next release
 * retries — a failed restore must never be forgotten, it is the user's setting.
 */
async function replaySnapshot(
  e: Eng,
  key: string | null,
  snapshot: number | string,
): Promise<boolean> {
  const { io, status } = e;
  // Role unmapped (profile changed): the snapshot can't be replayed — orphan
  // it rather than writing to a guessed register.
  if (!key) return false;
  // The state map also holds non-register snapshots (borrowed EVCC modes). One
  // landing in a register slot means the state is corrupt, so orphan it rather
  // than coerce a string into a register write.
  const value = numericSnapshot(snapshot);
  if (value === null) {
    status.lastError = "restore failed: snapshot is not a register value";
    return false;
  }
  const err = io.ctx.validateWrite(key, value);
  if (err) {
    status.lastError = `restore failed: ${err}`;
    return false;
  }
  try {
    await io.write(key, value);
  } catch (error) {
    status.lastError = error instanceof Error ? error.message : String(error);
    return false;
  }
  logger.info("peak shaving released {key}, restored {value}", { key, value });
  return true;
}

/** Restore every snapshotted register (if held) and drop the snapshots. */
async function restoreSnapshot(e: Eng): Promise<void> {
  const { io, status } = e;
  const state = await io.loadState();
  const next = { ...state };
  let stillHeld = false;
  for (const { slot, key } of steeredRegisters(io)) {
    const snap = state[slot];
    if (!snap) continue;
    if (await replaySnapshot(e, key, snap.previousValue)) delete next[slot];
    else stillHeld = true;
  }
  if (Object.keys(next).length !== Object.keys(state).length) await io.saveState(next);
  status.restorePending = stillHeld;
  if (stillHeld) return;
  status.lastWrittenA = null;
  status.sellLimitW = null;
  status.externalOverride = false;
}

/** Park the run in `state`: stop steering and give the register back. */
async function release(e: Eng, state: PeakShavingRunState): Promise<void> {
  e.status.state = state;
  e.status.targetA = null;
  e.status.priceRegime = "none";
  resetSteering(e);
  await restoreSnapshot(e);
  // Whatever ends the run — disabled, blocked, night, a stale sample — a car
  // borrowed for a window must go back to the user's own settings, and the
  // grid-charge registers must go back to the user's own values.
  await releaseEvPullIn(e);
  await releaseGridCharge(e);
}

/**
 * Capture the user's value for one register on the release→active edge. False
 * means "no readback yet" — hold this tick rather than steer a register whose
 * original value we could not record.
 */
async function ensureSnapshot(e: Eng, slot: string, liveValue: number | null): Promise<boolean> {
  const { io, status } = e;
  const current = await io.loadState();
  if (current[slot]) {
    status.restorePending = true;
    return true;
  }
  if (liveValue === null) return false;
  await io.saveState({
    ...current,
    [slot]: { previousValue: liveValue, capturedAt: new Date(io.now()).toISOString() },
  });
  status.restorePending = true;
  logger.info("peak shaving active, snapshotted {value} for {slot}", { value: liveValue, slot });
  return true;
}

/** The live readings one steering step needs, all from a fresh sample. */
interface LiveInputs {
  pvW: number;
  socPct: number;
  liveA: number | null;
  liveVolt: number | null;
  /** Measured house load, W; null when the profile maps no `load.power`. */
  loadW: number | null;
  /** Power flowing *into* the battery, W; null when `battery.power` is unmapped. */
  chargeW: number | null;
  /** Power flowing *out* to the grid, W; null when `grid.power` is unmapped. */
  exportW: number | null;
  /** Current feed-in ceiling in the solar-sell register, W; null when unmapped. */
  sellLimitW: number | null;
  /** Grid-charge enable register; null when the profile doesn't map it. */
  gridChargeOn: number | null;
  /** Grid-charge current register, A; null when the profile doesn't map it. */
  gridChargeA: number | null;
  nowMs: number;
}

/** Fresh, finite live readings — or null when the sample is missing/stale. */
function readLive(io: AutomationIO, key: string): LiveInputs | null {
  const sample = io.latestSample();
  const nowMs = io.now();
  if (!sample) return null;
  if (nowMs - Date.parse(sample.time) > STALE_SAMPLE_MS) return null;
  /** A role's finite value from this sample; null when unmapped or unusable. */
  const byRole = (role: CanonicalRole): number | null => {
    const roleKey = keyForRole(io.ctx.profile, role);
    return roleKey ? finite(sample.metrics[roleKey]) : null;
  };
  const pvW = byRole("pv.total.power");
  const socPct = byRole("battery.soc");
  if (pvW === null || socPct === null) return null;
  // Sign conventions (as in the power-flow graph): battery power > 0 discharges,
  // grid power > 0 imports — so both inflows are the negative half.
  const battW = byRole("battery.power");
  const gridW = byRole("grid.power");
  return {
    pvW,
    socPct,
    liveA: finite(sample.metrics[key]),
    liveVolt: byRole("battery.voltage"),
    loadW: byRole("load.power"),
    chargeW: battW === null ? null : Math.max(0, -battW),
    exportW: gridW === null ? null : Math.max(0, -gridW),
    sellLimitW: byRole(SELL_LIMIT_ROLE),
    gridChargeOn: byRole(GRID_CHARGE_ROLE),
    gridChargeA: byRole(GRID_CHARGE_CURRENT_ROLE),
    nowMs,
  };
}

/** Clamp a target into the register's own declared bounds. */
function clampToRegister(io: AutomationIO, key: string, targetA: number): number {
  const def = io.ctx.defByKey.get(key);
  if (!def) return targetA;
  const c = entityConstraint(def);
  let clamped = targetA;
  if (c.min !== undefined) clamped = Math.max(clamped, c.min);
  if (c.max !== undefined) clamped = Math.min(clamped, c.max);
  return clamped;
}

/**
 * Write the target to the register, unless it already holds it. Compared
 * against the *live* value (not our last write), so an external edit (Controls,
 * HA) is re-asserted on the next tick.
 */
async function writeRegister(
  e: Eng,
  key: string,
  value: number,
  liveValue: number | null,
  nowMs: number,
): Promise<boolean> {
  const { io, status } = e;
  if (liveValue === value) return false;
  const err = io.ctx.validateWrite(key, value);
  if (err) {
    status.lastError = err;
    return false;
  }
  await io.write(key, value);
  status.lastWriteAt = new Date(nowMs).toISOString();
  return true;
}

async function writeTarget(e: Eng, key: string, targetA: number, live: LiveInputs): Promise<void> {
  if (await writeRegister(e, key, targetA, live.liveA, live.nowMs)) {
    e.status.lastWrittenA = targetA;
  }
}

/**
 * Hold feed-in at the decided level. Only `grid-friendly` steers this: the charge
 * ceiling decides how much PV the battery takes, but nothing stops the inverter
 * from selling the rest up to its own limit, so lowering the midday export curve
 * needs the limit itself as an actuator.
 *
 * Snapshotted like the charge register, so the user's own feed-in setting comes
 * back on release — a plant left at a lowered limit would under-feed silently.
 */
async function steerSellLimit(e: Eng, thresholdW: number, live: LiveInputs): Promise<void> {
  const { io, status } = e;
  const key = sellKeyOf(io); // non-null after the grid-friendly blocker gate
  if (!key) return;
  if (!(await ensureSnapshot(e, sellSlotOf(io), live.sellLimitW))) return;
  const value = clampToRegister(io, key, Math.round(thresholdW));
  await writeRegister(e, key, value, live.sellLimitW, live.nowMs);
  status.sellLimitW = value;
}

/**
 * Turn grid charging on for a window, at the configured current.
 *
 * Both registers are snapshotted before either is written, and a missing
 * readback holds the whole thing — half-claiming would leave the enable flag on
 * with no record of the current the user had set.
 *
 * The profile not mapping these roles is not an error: grid charging is simply
 * unavailable on that inverter, and the rest of price awareness works without it.
 */
async function steerGridCharge(e: Eng, currentA: number, live: LiveInputs): Promise<void> {
  const { io, status } = e;
  const enableKey = gridChargeKeyOf(io);
  const currentKey = gridChargeAKeyOf(io);
  if (!enableKey || !currentKey) return;
  const liveEnable = live.gridChargeOn;
  const liveCurrent = live.gridChargeA;
  if (!(await ensureSnapshot(e, gridChargeSlotOf(io), liveEnable))) return;
  if (!(await ensureSnapshot(e, gridChargeASlotOf(io), liveCurrent))) return;
  const value = clampToRegister(io, currentKey, Math.round(currentA));
  await writeRegister(e, currentKey, value, liveCurrent, live.nowMs);
  await writeRegister(e, enableKey, 1, liveEnable, live.nowMs);
  status.gridChargeA = value;
}

/** Hand both grid-charge registers back, enable flag first. */
async function releaseGridCharge(e: Eng): Promise<void> {
  const { io, status } = e;
  const state = await io.loadState();
  const next = { ...state };
  let changed = false;
  // Enable first: handing back the current while charging is still on would
  // briefly run the user's old current with our command still active.
  for (const [slot, key] of [
    [gridChargeSlotOf(io), gridChargeKeyOf(io)],
    [gridChargeASlotOf(io), gridChargeAKeyOf(io)],
  ] as const) {
    const snap = state[slot];
    if (!snap) continue;
    if (!(await replaySnapshot(e, key, snap.previousValue))) continue;
    delete next[slot];
    changed = true;
  }
  if (changed) await io.saveState(next);
  status.gridChargeA = null;
}

/** Give the feed-in ceiling back without touching the charge register. */
async function releaseSellLimit(e: Eng): Promise<void> {
  const { io, status } = e;
  const state = await io.loadState();
  const snap = state[sellSlotOf(io)];
  if (!snap) return;
  if (!(await replaySnapshot(e, sellKeyOf(io), snap.previousValue))) return;
  const next = { ...state };
  delete next[sellSlotOf(io)];
  await io.saveState(next);
  status.sellLimitW = null;
}

/** Mirror one decision's reasoning into the status the UI polls. */
function recordDecision(
  status: PeakShavingStatus,
  decision: ReturnType<typeof decideTargetA>,
  live: LiveInputs,
  ev: EvInputs,
  evccReachable: boolean,
  loadW: number | null,
): void {
  status.thresholdW = Math.round(decision.thresholdW);
  status.headroomKwh = decision.headroomKwh;
  status.remainingAboveLimitKwh = decision.surplusAboveLimitKwh;
  status.liveExcessW = Math.round(decision.liveExcessW);
  status.loadW = loadW;
  status.evChargeW = evccReachable ? ev.evChargeW : null;
  status.evDemandKwh = evccReachable ? ev.evRemainingKwh : null;
  status.externalOverride =
    status.lastWrittenA !== null && live.liveA !== null && live.liveA !== status.lastWrittenA;
  status.priceRegime = decision.priceRegime;
  status.socEnvelopePct = decision.socEnvelopePct;
  status.windowStartsAt = decision.windowStartsAt;
  status.windowEndsAt = decision.windowEndsAt;
  status.soakableKwh = decision.soakableKwh;
  status.unavoidableZeroValueKwh = decision.unavoidableZeroValueKwh;
}

/**
 * Raise (or clear) {@link PeakShavingStatus.ineffective}: only judged once our
 * ceiling is actually in the register, so the tick that writes it never counts.
 * A near-full pack tapers to nothing on its own — that is the top-balance floor
 * doing its job, not an ignored ceiling, so those ticks never count either.
 */
function updateWatchdog(
  e: Eng,
  live: LiveInputs,
  targetA: number,
  batteryV: number,
  headroomKwh: number,
): void {
  const commandedW = targetA * batteryV;
  const settled = live.liveA === targetA;
  const nearFull = headroomKwh <= NEAR_FULL_KWH;
  if (live.chargeW === null || !settled || nearFull || commandedW < INEFFECTIVE_MIN_W) {
    e.ineffectiveTicks = 0;
  } else {
    e.ineffectiveTicks = live.chargeW < commandedW * INEFFECTIVE_RATIO ? e.ineffectiveTicks + 1 : 0;
  }
  const ineffective = e.ineffectiveTicks >= INEFFECTIVE_TICKS;
  if (ineffective && !e.status.ineffective) {
    logger.warn(
      "peak shaving ceiling {commandedW} W has no effect (battery at {chargeW} W) — check the inverter's work mode",
      { commandedW, chargeW: live.chargeW },
    );
  }
  e.status.ineffective = ineffective;
}

/**
 * The house-load figures one decision runs on: the measured reading wins, the
 * baseline stands in for plants without a `load.power` metric, and neither
 * available leaves `loadW` null — the raw-PV frame the automation had before.
 */
function loadFrame(
  live: LiveInputs,
  baselineLoadW: number | null,
): { loadW: number | null; baselineW: number } {
  const baselineW = Math.max(0, baselineLoadW ?? 0);
  return { loadW: live.loadW ?? (baselineLoadW === null ? null : baselineW), baselineW };
}

/**
 * The plant's own parameters, as the decision sees them.
 *
 * `weather.forecast` fields are non-null once the blocker gate has passed, so
 * the fallbacks here are belt-and-braces. The price config comes through
 * {@link effectivePriceConfig} so the tick honours the same smart-meter gate the
 * settings PUT does — otherwise clearing that date would leave a running loop
 * steering on prices it is no longer entitled to act on.
 */
function plantParams(weather: WeatherConfig, ps: AutomationConfig["peakShaving"]) {
  return {
    exportLimitW: Math.max(0, (weather.forecast.maxOutputW ?? 0) - ps.safetyBufferW),
    // The same real ceiling {@link planLimits} curtails against: the decision
    // needs it to tell PV that is truly lost from PV the grid still takes.
    exportCapW: Math.max(0, weather.forecast.maxOutputW ?? 0),
    usableKwh: weather.forecast.battery?.usableKwh ?? 0,
    minSocPct: weather.forecast.battery?.minSoc ?? 0,
    price: effectivePriceConfig(ps.priceAware, weather),
  };
}

/**
 * The house-battery SOC the car may drain the pack down to while boosting, %.
 *
 * The plant's own reserve floor wins whenever it is higher: the inverter stops
 * discharging there regardless, so asking EVCC for more would only leave it
 * demanding a drain that never arrives.
 */
const boostFloorPct = (weather: WeatherConfig, ps: AutomationConfig["peakShaving"]): number =>
  Math.max(ps.priceAware.evBoostLimitPct, weather.forecast.battery?.minSoc ?? 0);

/** Assemble the pure decision's inputs from config, live readings and forecast. */
function decisionInputs(args: {
  e: Eng;
  ps: AutomationConfig["peakShaving"];
  weather: WeatherConfig;
  live: LiveInputs;
  forecast: SolarForecast | null;
  ev: EvInputs;
  evcc: EvccState | null;
  load: { loadW: number | null; baselineW: number };
  batteryV: number;
  prices: SpotSlice | null;
  tariff: TariffConfig;
}): Parameters<typeof decideTargetA>[0] {
  const { e, ps, weather, live, forecast, ev, evcc, load, batteryV, prices, tariff } = args;
  return {
    ...ev,
    ...plantParams(weather, ps),
    mode: ps.mode,
    pvW: live.pvW,
    socPct: live.socPct,
    batteryV,
    liveLoadW: load.loadW ?? 0,
    baselineLoadW: load.baselineW,
    // The load reading covers the charger only when EVCC says it sits behind the
    // house meter — and only when there is a measured reading to contain it.
    evIncludedInLoad: evcc?.subtractFromHome === true && live.loadW !== null,
    maxChargeA: ps.maxChargeA,
    fallbackChargeA: ps.fallbackChargeA,
    topBalanceFloorA: ps.topBalanceFloorA,
    gridFriendly: ps.gridFriendly,
    priceView: prices,
    // Grid charging only pays when the bill follows the market; the tariff is
    // the authority on that, not the automation config.
    importFollowsMarket: tariff.import.mode === "spot",
    previousThresholdW: e.prevThresholdW,
    previousTargetA: e.prevTargetA,
    sinceLastDecisionMs: e.prevDecisionAtMs === null ? 0 : live.nowMs - e.prevDecisionAtMs,
    forecast: forecast
      ? {
          series: forecast.raw.series,
          stepMinutes: forecast.stepMinutes,
          utcOffsetSeconds: forecast.utcOffsetSeconds,
        }
      : null,
    nowMs: live.nowMs,
  };
}

/** Loadpoints whose mode this automation currently holds, from persisted state. */
function heldLoadpoints(io: AutomationIO, state: AutomationState): number[] {
  const prefix = evccModeStateKey(io.ctx.profile.id, 0).slice(0, -1);
  return Object.keys(state)
    .filter((k) => k.startsWith(prefix))
    .map((k) => Number(k.slice(prefix.length)))
    .filter((n) => Number.isInteger(n));
}

/** Record why a claim or hand-back could not be published, without throwing. */
function noteEvError(e: Eng, error: unknown): void {
  e.status.lastError = error instanceof Error ? error.message : String(error);
}

/**
 * Publish one loadpoint's commands in the order EVCC requires: a mode change
 * clears any boost, and boost is only accepted once the loadpoint is in a PV
 * mode — so mode, then limit, then boost.
 */
function publishClaim(io: AutomationIO, claim: EvPullInClaim): void {
  const { loadpoint } = claim;
  if (claim.mode !== null) io.evccCommand(loadpoint, "mode", claim.mode);
  if (claim.boostLimitPct !== null) {
    io.evccCommand(loadpoint, "batteryBoostLimit", String(claim.boostLimitPct));
  }
  if (claim.boost !== null) io.evccCommand(loadpoint, "batteryBoost", String(claim.boost));
}

/** Bring each loadpoint to its wanted state, remembering the user's values first. */
function claimLoadpoints(
  e: Eng,
  next: AutomationState,
  plan: EvPullInPlan,
  capturedAt: string,
): void {
  const profileId = e.io.ctx.profile.id;
  for (const claim of plan.claim) {
    const { loadpoint, remember } = claim;
    try {
      publishClaim(e.io, claim);
      if (!remember) continue;
      next[evccModeStateKey(profileId, loadpoint)] = { previousValue: remember.mode, capturedAt };
      next[evccBoostLimitStateKey(profileId, loadpoint)] = {
        previousValue: remember.boostLimitPct,
        capturedAt,
      };
    } catch (error) {
      // Not claimed: leave no snapshot, so the next tick simply tries again.
      noteEvError(e, error);
    }
  }
}

/**
 * Hand each released loadpoint back to what the user had set.
 *
 * The reverse order, for the same reason: boost off first, because restoring the
 * mode would clear it anyway and EVCC would refuse the command in a non-PV mode.
 * The boost SOC limit is restored because EVCC *persists* it — unlike the boost
 * flag, which it forgets on its own.
 */
function releaseLoadpoints(e: Eng, next: AutomationState, plan: EvPullInPlan): void {
  const profileId = e.io.ctx.profile.id;
  for (const { loadpoint, restoreMode } of plan.release) {
    const modeSlot = evccModeStateKey(profileId, loadpoint);
    const limitSlot = evccBoostLimitStateKey(profileId, loadpoint);
    const snap = next[modeSlot];
    if (!snap) continue;
    const limit = numericSnapshot(next[limitSlot]?.previousValue) ?? BOOST_LIMIT_DISABLED;
    try {
      e.io.evccCommand(loadpoint, "batteryBoost", "false");
      e.io.evccCommand(loadpoint, "batteryBoostLimit", String(limit));
      if (restoreMode) e.io.evccCommand(loadpoint, "mode", String(snap.previousValue));
      delete next[modeSlot];
      delete next[limitSlot];
    } catch (error) {
      // Keep the snapshot: the car is still on our settings and must be handed
      // back, so the next tick retries the whole sequence.
      noteEvError(e, error);
    }
  }
}

/**
 * Borrow (or hand back) EVCC loadpoints for a negative-price window.
 *
 * Every loadpoint is snapshotted before anything is written to it and the
 * snapshot is dropped only once it has been handed back, so a restart mid-window
 * still returns the car to the user's own settings. A broker error leaves the
 * state exactly as it was: not claimed, or still held and retried next tick.
 */
async function applyEvPullIn(
  e: Eng,
  regime: PriceRegime,
  enabled: boolean,
  boostLimitPct: number,
): Promise<void> {
  const state = await e.io.loadState();
  const plan = planEvPullIn({
    enabled,
    regime,
    evcc: e.io.getEvcc(),
    boostLimitPct,
    heldLoadpoints: heldLoadpoints(e.io, state),
  });
  if (plan.claim.length === 0 && plan.release.length === 0) return;

  const next = { ...state };
  claimLoadpoints(e, next, plan, new Date(e.io.now()).toISOString());
  releaseLoadpoints(e, next, plan);
  await e.io.saveState(next);
}

/** Hand every borrowed loadpoint back. Nothing is claimed, so no floor is needed. */
const releaseEvPullIn = (e: Eng): Promise<void> =>
  applyEvPullIn(e, "none", false, BOOST_LIMIT_DISABLED);

/** Append this tick's decision + the readings behind it to the chart log. */
function logDecision(
  e: Eng,
  decision: Decision,
  live: LiveInputs,
  args: { shadow: boolean; targetA: number; batteryV: number; evcc: EvccState | null },
): void {
  e.log.push({
    t: live.nowMs,
    shadow: args.shadow,
    pvW: live.pvW,
    // Both already resolved onto the status by `recordDecision` (measured load
    // else baseline; EV null when EVCC is off).
    loadW: e.status.loadW,
    evChargeW: e.status.evChargeW,
    localSinkW: decision.localSinkW,
    thresholdW: decision.thresholdW,
    targetA: args.targetA,
    liveA: live.liveA,
    batteryV: args.batteryV,
    chargeW: live.chargeW,
    exportW: live.exportW,
    socPct: live.socPct,
  });
}

/**
 * Decide the tick's target. A live run writes it when the register differs; a
 * shadow run only records it — the register was already handed back by the
 * caller, so there is nothing to command and nothing to watchdog.
 */
async function steer(
  e: Eng,
  ps: AutomationConfig["peakShaving"],
  weather: WeatherConfig,
  live: LiveInputs,
  forecast: SolarForecast | null,
  key: string,
  baselineLoadW: number | null,
  prices: SpotSlice | null,
): Promise<void> {
  const { io, status } = e;
  const evcc = io.getEvcc();
  const ev = evccAutomationInputs(evcc);
  const load = loadFrame(live, baselineLoadW);
  const batteryV = liveBatteryV(live, ps);
  const decision = decideTargetA(
    decisionInputs({
      e,
      ps,
      weather,
      live,
      forecast,
      ev,
      evcc,
      load,
      batteryV,
      prices,
      tariff: await io.getTariff(),
    }),
  );

  recordDecision(status, decision, live, ev, evcc?.reachable === true, load.loadW);
  const targetA = clampToRegister(io, key, Math.round(decision.targetA));
  status.targetA = targetA;
  status.state = ps.shadowMode ? "shadow" : "active";
  e.prevThresholdW = decision.thresholdW;
  e.prevTargetA = targetA;
  e.prevDecisionAtMs = live.nowMs;
  if (ps.shadowMode) {
    e.ineffectiveTicks = 0;
    status.ineffective = false;
    await releaseEvPullIn(e);
    await releaseGridCharge(e);
  } else {
    await writeTarget(e, key, targetA, live);
    // Feed-in ceiling: steered in grid-friendly, handed straight back in the
    // mode that sells everything it can.
    if (ps.mode === "grid-friendly") await steerSellLimit(e, decision.thresholdW, live);
    else await releaseSellLimit(e);
    // Grid charging: only inside a window, only when the import price actually
    // follows the market, and only on an inverter that maps the registers.
    if (decision.gridChargeA !== null) await steerGridCharge(e, decision.gridChargeA, live);
    else await releaseGridCharge(e);
    updateWatchdog(e, live, targetA, batteryV, decision.headroomKwh);
    // Commanding the car is a real write, so a dry run must not do it — but a
    // *held* loadpoint still has to be handed back if the run turns dry, which
    // the shadow branch above does through `releaseEvPullIn`.
    await applyEvPullIn(
      e,
      decision.priceRegime,
      ps.priceAware.pullInEv,
      boostFloorPct(weather, ps),
    );
  }
  logDecision(e, decision, live, { shadow: ps.shadowMode, targetA, batteryV, evcc });
}

/**
 * Assemble the decision inputs for a projection: the current config and weather
 * plus one fresh read of the plant. Null when the setup can't produce a plan —
 * blockers, stale/missing readings, or no forecast.
 */
async function planInputs(
  e: Eng,
): Promise<{ inputs: DecisionInputs & { forecast: ForecastSlice }; limits: PlanLimits } | null> {
  const { io } = e;
  const [cfg, weather] = await Promise.all([io.getConfig(), io.getWeather()]);
  if (resolvePeakShavingBlockers(io.ctx.profile, weather, cfg.peakShaving.mode).length > 0) {
    return null;
  }
  const ready = liveOrHold(io);
  if (!ready) return null;
  const forecast = await io.getForecast(weather);
  if (!forecast) return null;
  const ps = cfg.peakShaving;
  const { live } = ready;
  const evcc = io.getEvcc();
  const inputs = decisionInputs({
    e,
    ps,
    weather,
    live,
    forecast,
    ev: evccAutomationInputs(evcc),
    evcc,
    load: loadFrame(live, await io.getBaselineLoadW(weather)),
    batteryV: liveBatteryV(live, ps),
    prices: await io.getPrices(),
    tariff: await io.getTariff(),
  });
  if (!inputs.forecast) return null;
  return { inputs: { ...inputs, forecast: inputs.forecast }, limits: planLimits(weather) };
}

/** The measured pack voltage when the reading is sane, the nameplate otherwise. */
function liveBatteryV(live: LiveInputs, ps: AutomationConfig["peakShaving"]): number {
  return live.liveVolt !== null && live.liveVolt > 0 ? live.liveVolt : ps.nominalBatteryV;
}

/** The physical bounds a projection runs under, straight from the plant config. */
function planLimits(weather: WeatherConfig): PlanLimits {
  return {
    // The plan curtails against the plant's real ceiling; the safety buffer
    // is a decision margin, not a physical limit.
    exportCapW: Math.max(0, weather.forecast.maxOutputW ?? 0),
    // The modelled overnight discharge stops at the pack's configured floor.
    reserveSocPct: weather.forecast.battery?.minSoc ?? 0,
  };
}

/**
 * One steering step's preconditions: the register key plus fresh live readings,
 * or the run state to park in when either is unavailable.
 */
function liveOrHold(io: AutomationIO): { key: string; live: LiveInputs } | null {
  const key = targetKeyOf(io); // non-null after the blocker gate
  const live = key ? readLive(io, key) : null;
  return key && live ? { key, live } : null;
}

/** Night gate: no PV now and none imminent — hand the register back until dawn. */
/**
 * Nothing to shave: no PV now and none imminent.
 *
 * Price awareness breaks the old assumption that darkness means idleness —
 * negative prices are usually *wind*, and the deepest ones land at night. So a
 * pending price action keeps the loop awake; without this the one case
 * grid-charging exists for could never fire.
 */
const isNight = (live: LiveInputs, forecast: SolarForecast | null, priceActive: boolean): boolean =>
  !priceActive && live.pvW <= 0 && (forecast?.raw.next15.maxPowerW ?? 0) <= 0;

/**
 * Ready the register for this tick: a dry run hands back anything a previous
 * live run took, a live run takes (and snapshots) it. False means "not yet" —
 * no readback to snapshot, so the tick must hold.
 */
async function claimRegister(e: Eng, shadow: boolean, liveA: number | null): Promise<boolean> {
  if (!shadow) return await ensureSnapshot(e, stateKeyOf(e.io), liveA);
  await restoreSnapshot(e);
  return true;
}

/**
 * Everything past the enable/blocker gates: fresh readings, the night check, the
 * register claim, then one decision.
 */
async function decideTick(
  e: Eng,
  ps: AutomationConfig["peakShaving"],
  weather: WeatherConfig,
): Promise<PeakShavingStatus> {
  const { io, status } = e;
  const ready = liveOrHold(io);
  if (!ready) {
    status.state = "stale"; // hold everything — never steer on stale data
    return status;
  }
  status.liveA = ready.live.liveA;
  status.liveSellLimitW = ready.live.sellLimitW;

  const forecast = await io.getForecast(weather);
  status.forecastAvailable = forecast !== null;
  const prices = await io.getPrices();
  const priceActive = insideNegativeWindow(
    prices,
    effectivePriceConfig(ps.priceAware, weather),
    ready.live.nowMs,
  );
  if (isNight(ready.live, forecast, priceActive)) return await releasedStatus(e, "idle");

  if (!(await claimRegister(e, ps.shadowMode, ready.live.liveA))) {
    status.state = "stale";
    return status;
  }

  const baselineLoadW = await io.getBaselineLoadW(weather);
  await steer(e, ps, weather, ready.live, forecast, ready.key, baselineLoadW, prices);
  return status;
}

/**
 * Live simulation while the automation is switched off: run the exact decision
 * path a shadow tick runs — any register still held is handed back, nothing is
 * ever written, the decision is logged for the charts — so the UI can stream
 * what peak shaving *would* do right now. Anything short of a simulated
 * decision (blockers, night, stale readings) parks in plain `disabled`, with
 * any held register restored, as a disable always has.
 */
async function simulateTick(
  e: Eng,
  ps: AutomationConfig["peakShaving"],
  weather: WeatherConfig,
): Promise<PeakShavingStatus> {
  if (e.status.blockers.length > 0) return await releasedStatus(e, "disabled");
  const status = await decideTick(e, { ...ps, shadowMode: true }, weather);
  if (status.state !== "shadow") return await releasedStatus(e, "disabled");
  status.state = "simulating";
  return status;
}

async function runTick(e: Eng): Promise<PeakShavingStatus> {
  const { io, status } = e;
  try {
    status.lastError = null;
    const cfg = await io.getConfig();
    const ps = cfg.peakShaving;
    status.mode = ps.mode;
    status.enabled = cfg.enabled && ps.enabled;

    // Blockers are resolved for disabled runs too: the settings form gates its
    // enable switch on them, and the simulation needs the same go/no-go call.
    const weather = await io.getWeather();
    status.blockers = resolvePeakShavingBlockers(io.ctx.profile, weather, ps.mode);
    status.priceBlockers = resolvePriceAwareBlockers(weather);
    status.usableKwh = weather.forecast.battery?.usableKwh ?? null;
    if (!status.enabled) return await simulateTick(e, ps, weather);
    if (status.blockers.length > 0) return await releasedStatus(e, "blocked");

    return await decideTick(e, ps, weather);
  } catch (error) {
    status.lastError = error instanceof Error ? error.message : String(error);
    logger.error("peak shaving tick failed: {error}", { error });
    return status;
  } finally {
    status.lastTickAt = new Date(io.now()).toISOString();
  }
}

/** Release the register into `state` and report the resulting status. */
async function releasedStatus(e: Eng, state: PeakShavingRunState): Promise<PeakShavingStatus> {
  await release(e, state);
  return e.status;
}

/** Build one engine instance around its IO. Production wires the singleton in ./automation. */
export function createPeakShavingEngine(io: AutomationIO): PeakShavingEngine {
  const e: Eng = {
    io,
    status: initialStatus(),
    log: createDecisionLog(),
    prevThresholdW: null,
    prevTargetA: null,
    prevDecisionAtMs: null,
    ineffectiveTicks: 0,
  };

  /**
   * Ticks are serialized on a bounded queue: an interval tick never stacks on
   * a slow one, and a hot-apply tick (config PUT) is guaranteed to run *after*
   * the in-flight tick — so a disable's restore is never swallowed by a
   * reentrancy guard. Depth 2 (one running + one queued) is enough: a queued
   * run always reads the freshest config.
   */
  let queueDepth = 0;
  let chain: Promise<unknown> = Promise.resolve();
  function tick(): Promise<PeakShavingStatus> {
    if (queueDepth >= 2) return chain.then(() => e.status);
    queueDepth++;
    const run = chain
      .then(() => runTick(e))
      .finally(() => {
        queueDepth--;
      });
    chain = run;
    return run;
  }

  async function plan(): Promise<PeakShavingPlans | null> {
    const ready = await planInputs(e);
    return ready && projectPeakShavingDays(ready.inputs, ready.limits);
  }

  return {
    tick,
    status: () => e.status,
    history: () => e.log.points(),
    plan,
    release: () => release(e, "disabled"),
  };
}
