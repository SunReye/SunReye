/**
 * Automation engine — light, opt-in control loops that write inverter
 * registers. Today one automation: **peak shaving**, which owns the
 * battery max-charge-current register while active and steers it from live
 * PV/SOC plus the 15-min production forecast.
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
 *
 * Single-process assumption (same as the composite-control state): exactly one
 * server owns a database. Two servers sharing one DB (e.g. a dev simulator next
 * to a live instance) will fight over the snapshot key and each other's
 * registers — don't do that with an automation enabled.
 */

import type { AutomationConfig, PeakShavingMode } from "@SunReye/db/automation-config";
// Re-exported so the web app can type its client against the exact server
// shapes (see apps/web/src/lib/automations.ts) instead of hand-mirroring them.
export type { AutomationConfig } from "@SunReye/db/automation-config";
import {
  AUTOMATION_STATE_KEY,
  type AutomationState,
  automationStateKey,
  automationStateSchema,
  defaultAutomationState,
} from "@SunReye/db/automation-state";
import type { WeatherConfig } from "@SunReye/db/weather";
import { type CanonicalRole, entityConstraint } from "@SunReye/inverter-core";
import type { InverterProfile, InverterSample } from "@SunReye/inverter-core";
import type { EvccState } from "./evcc";
import type { ProfileContext } from "./inverter";
import { log } from "./logging";
import type { SolarForecast, SolarForecastPoint } from "./solar-forecast";

const logger = log("automation");

/** Id under which peak shaving namespaces its snapshot (see automation-state). */
const PEAK_SHAVING_ID = "peakShaving";

/** Battery this close to full (kWh headroom) → drop to the top-balance floor. */
const NEAR_FULL_KWH = 0.2;
/** Headroom must exceed the coming peak by this margin before fallback charging. */
const RESERVE_MARGIN_KWH = 0.2;
/** A live sample older than this is unusable — hold all writes. */
const STALE_SAMPLE_MS = 30_000;
/** Tick cadence; writes only happen on change, so this is cheap. */
const AUTOMATION_TICK_MS = 30_000;
/**
 * Charge-current targets are rounded **up** to this step. PV noise of a few
 * hundred watts would otherwise move the target every tick and grind the
 * inverter's EEPROM with a write each 30 s; overshooting is the safe direction
 * (a higher ceiling charges more and never raises the export).
 */
const CHARGE_QUANT_A = 5;

const HOUR_MS = 3_600_000;

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

function keyForRole(profile: InverterProfile, role: CanonicalRole): string | null {
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
interface EvInputs {
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
 * Remaining-today energy above `thresholdW` in the raw series, kWh. Future
 * slots of the plant-local calendar day only, with the running slot prorated
 * by the fraction still ahead (mirrors `remainingTodayKwh` in solar-forecast).
 */
export function surplusAboveKwh(view: ForecastSlice, thresholdW: number, nowMs: number): number {
  const offsetMs = view.utcOffsetSeconds * 1000;
  const today = new Date(nowMs + offsetMs).toISOString().slice(0, 10);
  const fallbackWidth = view.stepMinutes * 60_000;
  let kwh = 0;
  for (let i = 0; i < view.series.length; i++) {
    const point = view.series[i];
    if (!point || !point.time.startsWith(today)) continue;
    const startMs = Date.parse(`${point.time}:00Z`) - offsetMs;
    const next = view.series[i + 1];
    // Slot width from the gap to the next slot, but never wider than an hour —
    // a series gap (e.g. day boundary) must not stretch a slot across it.
    const gap = next ? Date.parse(`${next.time}:00Z`) - offsetMs - startMs : 0;
    const width = gap > 0 && gap <= HOUR_MS ? gap : fallbackWidth;
    const left = Math.min(startMs + width - nowMs, width);
    if (left <= 0) continue;
    kwh += (Math.max(0, point.watts - thresholdW) * (left / HOUR_MS)) / 1000;
  }
  return kwh;
}

/**
 * The charge-current target for one tick. Pure — all live/forecast inputs are
 * arguments — so every mode/boundary is directly unit-testable.
 *
 * `maximize-exports`: the battery only absorbs power above the export limit;
 * below it, PV exports freely and the battery charges at the fallback rate
 * only when today's coming peak cannot fill it on its own.
 *
 * `grid-friendly`: flatten the export curve. Find the threshold `T ≤ limit`
 * whose remaining-today surplus just fills the battery; charging everything
 * above `T` spreads the battery charge across the day and plateaus the export
 * at `T` instead of spiking to the limit. Recomputed each tick, so as SOC
 * rises `T` rises toward the limit and exports ramp up smoothly.
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
  if (!i.forecast) {
    return { ...base, targetA: toA(liveExcessW), thresholdW: i.exportLimitW };
  }

  const surplusAtLimit = surplusAboveKwh(i.forecast, i.exportLimitW, i.nowMs);
  base.surplusAboveLimitKwh = surplusAtLimit;
  // The car eats its share of the coming surplus before the battery has to.
  const evShare = Math.min(i.evRemainingKwh, surplusAtLimit);

  if (i.mode === "maximize-exports") {
    if (liveExcessW > 0) return { ...base, targetA: toA(liveExcessW), thresholdW: i.exportLimitW };
    // Hold the headroom for the coming peak; charge at the fallback rate only
    // with room to spare after it.
    const chargeableKwh = headroomKwh - (surplusAtLimit - evShare);
    const targetA =
      chargeableKwh <= RESERVE_MARGIN_KWH ? 0 : Math.min(i.fallbackChargeA, i.maxChargeA);
    return { ...base, targetA, thresholdW: i.exportLimitW };
  }

  // grid-friendly
  let thresholdW = i.exportLimitW;
  if (surplusAtLimit - evShare < headroomKwh) {
    // surplusAboveKwh is monotonically decreasing in T: bisect for the T whose
    // surplus (minus the car's cut) matches the headroom. When even T=0 can't
    // fill the battery the search settles near 0 — the battery absorbs
    // everything, export ≈ 0, which is the grid-friendliest shape available.
    let lo = 0;
    let hi = i.exportLimitW;
    for (let step = 0; step < 32; step++) {
      const mid = (lo + hi) / 2;
      if (surplusAboveKwh(i.forecast, mid, i.nowMs) - i.evRemainingKwh > headroomKwh) lo = mid;
      else hi = mid;
    }
    thresholdW = hi;
  }
  return { ...base, targetA: toA(Math.max(0, i.pvW - i.evChargeW - thresholdW)), thresholdW };
}

// --- Engine ------------------------------------------------------------------

export type PeakShavingRunState = "disabled" | "blocked" | "idle" | "active" | "stale";

export interface PeakShavingStatus {
  /** Effective: master gate AND the peak-shaving toggle. */
  enabled: boolean;
  mode: PeakShavingMode;
  state: PeakShavingRunState;
  blockers: Blocker[];
  lastTickAt: string | null;
  lastWriteAt: string | null;
  lastError: string | null;
  targetA: number | null;
  lastWrittenA: number | null;
  /** Current register value from the live sample. */
  liveA: number | null;
  thresholdW: number | null;
  liveExcessW: number | null;
  headroomKwh: number | null;
  remainingAboveLimitKwh: number | null;
  /** Live EV charge power the decision subtracted; null when EVCC is off. */
  evChargeW: number | null;
  /** Remaining EV charge demand deducted from the surplus; null when EVCC is off. */
  evDemandKwh: number | null;
  forecastAvailable: boolean;
  /** The register drifted from our last write (e.g. edited in Controls). */
  externalOverride: boolean;
  /** A snapshot is held — the user's value will be restored on release. */
  restorePending: boolean;
}

export interface AutomationStatusView {
  peakShaving: PeakShavingStatus;
}

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
  /** Current EVCC snapshot, or null when the integration is off. */
  getEvcc(): EvccState | null;
  latestSample(): InverterSample | null;
  loadState(): Promise<AutomationState>;
  saveState(next: AutomationState): Promise<void>;
  now(): number;
}

function initialStatus(): PeakShavingStatus {
  return {
    enabled: false,
    mode: "maximize-exports",
    state: "disabled",
    blockers: [],
    lastTickAt: null,
    lastWriteAt: null,
    lastError: null,
    targetA: null,
    lastWrittenA: null,
    liveA: null,
    thresholdW: null,
    liveExcessW: null,
    headroomKwh: null,
    remainingAboveLimitKwh: null,
    evChargeW: null,
    evDemandKwh: null,
    forecastAvailable: false,
    externalOverride: false,
    restorePending: false,
  };
}

const finite = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

export interface PeakShavingEngine {
  tick(): Promise<PeakShavingStatus>;
  status(): PeakShavingStatus;
  /** Restore + release the register if held (used on explicit disable). */
  release(): Promise<void>;
}

/** One engine's working set: its IO and the mutable status the tick updates. */
interface Eng {
  io: AutomationIO;
  status: PeakShavingStatus;
}

const stateKeyOf = (io: AutomationIO) => automationStateKey(io.ctx.profile.id, PEAK_SHAVING_ID);
const targetKeyOf = (io: AutomationIO) =>
  keyForRole(io.ctx.profile, "setting.battery.max_charge_current");

/** Restore the snapshotted user value (if held) and drop the snapshot. */
async function release(e: Eng, state: PeakShavingRunState): Promise<void> {
  const { io, status } = e;
  status.state = state;
  status.targetA = null;
  const held = (await io.loadState())[stateKeyOf(io)];
  if (!held) {
    status.restorePending = false;
    return;
  }
  const key = targetKeyOf(io);
  // Role unmapped (profile changed): the snapshot can't be replayed — orphan
  // it rather than writing to a guessed register.
  if (!key) return;
  const err = io.ctx.validateWrite(key, held.previousValue);
  if (err) {
    status.lastError = `restore failed: ${err}`;
    return;
  }
  try {
    await io.write(key, held.previousValue);
  } catch (error) {
    // Keep the snapshot — the next release attempt retries the restore.
    status.lastError = error instanceof Error ? error.message : String(error);
    return;
  }
  const next = { ...(await io.loadState()) };
  delete next[stateKeyOf(io)];
  await io.saveState(next);
  status.restorePending = false;
  status.lastWrittenA = null;
  status.externalOverride = false;
  logger.info("peak shaving released, restored {value} A", { value: held.previousValue });
}

/** Capture the user's register value on the release→active edge. */
async function ensureSnapshot(e: Eng, liveA: number | null): Promise<boolean> {
  const { io, status } = e;
  const current = await io.loadState();
  if (current[stateKeyOf(io)]) {
    status.restorePending = true;
    return true;
  }
  if (liveA === null) return false; // no readback yet — hold, retry next tick
  await io.saveState({
    ...current,
    [stateKeyOf(io)]: { previousValue: liveA, capturedAt: new Date(io.now()).toISOString() },
  });
  status.restorePending = true;
  logger.info("peak shaving active, snapshotted {value} A", { value: liveA });
  return true;
}

/** The live readings one steering step needs, all from a fresh sample. */
interface LiveInputs {
  pvW: number;
  socPct: number;
  liveA: number | null;
  liveVolt: number | null;
  nowMs: number;
}

/** Fresh, finite live readings — or null when the sample is missing/stale. */
function readLive(io: AutomationIO, key: string): LiveInputs | null {
  const pvKey = keyForRole(io.ctx.profile, "pv.total.power");
  const socKey = keyForRole(io.ctx.profile, "battery.soc");
  const voltKey = keyForRole(io.ctx.profile, "battery.voltage");
  const sample = io.latestSample();
  const nowMs = io.now();
  if (!sample || !pvKey || !socKey) return null;
  if (nowMs - Date.parse(sample.time) > STALE_SAMPLE_MS) return null;
  const pvW = finite(sample.metrics[pvKey]);
  const socPct = finite(sample.metrics[socKey]);
  if (pvW === null || socPct === null) return null;
  return {
    pvW,
    socPct,
    liveA: finite(sample.metrics[key]),
    liveVolt: voltKey ? finite(sample.metrics[voltKey]) : null,
    nowMs,
  };
}

/** Decide the tick's target and write it when the register differs. */
async function steer(
  e: Eng,
  ps: AutomationConfig["peakShaving"],
  weather: WeatherConfig,
  live: LiveInputs,
  forecast: SolarForecast | null,
  key: string,
): Promise<void> {
  const { io, status } = e;
  // weather.forecast fields are non-null after the blocker gate.
  const exportLimitW = Math.max(0, (weather.forecast.maxOutputW ?? 0) - ps.safetyBufferW);
  const evcc = io.getEvcc();
  const ev = evccAutomationInputs(evcc);
  const decision = decideTargetA({
    ...ev,
    mode: ps.mode,
    pvW: live.pvW,
    socPct: live.socPct,
    batteryV: live.liveVolt !== null && live.liveVolt > 0 ? live.liveVolt : ps.nominalBatteryV,
    exportLimitW,
    usableKwh: weather.forecast.battery?.usableKwh ?? 0,
    maxChargeA: ps.maxChargeA,
    fallbackChargeA: ps.fallbackChargeA,
    topBalanceFloorA: ps.topBalanceFloorA,
    forecast: forecast
      ? {
          series: forecast.raw.series,
          stepMinutes: forecast.stepMinutes,
          utcOffsetSeconds: forecast.utcOffsetSeconds,
        }
      : null,
    nowMs: live.nowMs,
  });

  status.thresholdW = Math.round(decision.thresholdW);
  status.headroomKwh = decision.headroomKwh;
  status.remainingAboveLimitKwh = decision.surplusAboveLimitKwh;
  status.liveExcessW = Math.max(0, live.pvW - ev.evChargeW - exportLimitW);
  status.evChargeW = evcc?.reachable ? ev.evChargeW : null;
  status.evDemandKwh = evcc?.reachable ? ev.evRemainingKwh : null;
  status.externalOverride =
    status.lastWrittenA !== null && live.liveA !== null && live.liveA !== status.lastWrittenA;

  // Clamp into the register's own bounds before validating.
  let targetA = Math.round(decision.targetA);
  const def = io.ctx.defByKey.get(key);
  if (def) {
    const c = entityConstraint(def);
    if (c.min !== undefined) targetA = Math.max(targetA, c.min);
    if (c.max !== undefined) targetA = Math.min(targetA, c.max);
  }
  status.targetA = targetA;
  status.state = "active";

  // Write on change only — against the *live* register value, so an
  // external edit (Controls, HA) is re-asserted on the next tick.
  if (live.liveA === targetA) return;
  const err = io.ctx.validateWrite(key, targetA);
  if (err) {
    status.lastError = err;
    return;
  }
  await io.write(key, targetA);
  status.lastWrittenA = targetA;
  status.lastWriteAt = new Date(live.nowMs).toISOString();
}

async function runTick(e: Eng): Promise<PeakShavingStatus> {
  const { io, status } = e;
  try {
    status.lastError = null;
    const cfg = await io.getConfig();
    const ps = cfg.peakShaving;
    status.mode = ps.mode;
    status.enabled = cfg.enabled && ps.enabled;
    if (!status.enabled) {
      await release(e, "disabled");
      return status;
    }

    const weather = await io.getWeather();
    status.blockers = resolvePeakShavingBlockers(io.ctx.profile, weather);
    if (status.blockers.length > 0) {
      await release(e, "blocked");
      return status;
    }

    const key = targetKeyOf(io); // non-null after the blocker gate
    const live = key ? readLive(io, key) : null;
    if (!key || !live) {
      status.state = "stale"; // hold everything — never steer on stale data
      return status;
    }
    status.liveA = live.liveA;

    const forecast = await io.getForecast(weather);
    status.forecastAvailable = forecast !== null;

    // Night gate: no PV now and none imminent — hand the register back until dawn.
    if (live.pvW <= 0 && (forecast?.raw.next15.maxPowerW ?? 0) <= 0) {
      await release(e, "idle");
      return status;
    }

    if (!(await ensureSnapshot(e, live.liveA))) {
      status.state = "stale";
      return status;
    }

    await steer(e, ps, weather, live, forecast, key);
    return status;
  } catch (error) {
    status.lastError = error instanceof Error ? error.message : String(error);
    logger.error("peak shaving tick failed: {error}", { error });
    return status;
  } finally {
    status.lastTickAt = new Date(io.now()).toISOString();
  }
}

/** Build one engine instance around its IO. Production wires the singleton below. */
export function createPeakShavingEngine(io: AutomationIO): PeakShavingEngine {
  const e: Eng = { io, status: initialStatus() };

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

  return { tick, status: () => e.status, release: () => release(e, "disabled") };
}

// --- Production wiring ---------------------------------------------------------

let engine: PeakShavingEngine | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

/** Production IO: real config, forecast, live sample and persisted snapshot state. */
async function buildProductionIO(deps: {
  ctx: ProfileContext;
  write: (key: string, value: number) => Promise<void>;
}): Promise<AutomationIO> {
  const [
    { getAutomationConfig },
    { getWeatherConfig },
    { fetchSolarForecast },
    { evccSnapshot },
    { liveState },
    appSettings,
  ] = await Promise.all([
    import("./automation-settings"),
    import("./weather-settings"),
    import("./solar-forecast"),
    import("./evcc"),
    import("./state"),
    import("./app-settings"),
  ]);
  let stateCache: AutomationState | null = null;
  return {
    ctx: deps.ctx,
    write: deps.write,
    getConfig: getAutomationConfig,
    getWeather: getWeatherConfig,
    getForecast: fetchSolarForecast,
    getEvcc: evccSnapshot,
    latestSample: () => liveState.latest,
    async loadState() {
      stateCache ??= await appSettings.readSetting(
        AUTOMATION_STATE_KEY,
        automationStateSchema,
        defaultAutomationState,
      );
      return stateCache;
    },
    async saveState(next) {
      await appSettings.writeSetting(AUTOMATION_STATE_KEY, next);
      stateCache = next;
    },
    now: () => Date.now(),
  };
}

/** Start the automation loop (called by the runtime once a profile is active). */
export async function startAutomations(deps: {
  ctx: ProfileContext;
  write: (key: string, value: number) => Promise<void>;
}): Promise<void> {
  await stopAutomations();
  engine = createPeakShavingEngine(await buildProductionIO(deps));
  timer = setInterval(() => void engine?.tick(), AUTOMATION_TICK_MS);
  void engine.tick();
}

/**
 * Stop the loop (graceful shutdown). Deliberately does **not** restore the
 * snapshot: a reboot with the automation enabled must resume seamlessly, and
 * the persisted snapshot survives for the eventual release.
 */
export async function stopAutomations(): Promise<void> {
  if (timer) clearInterval(timer);
  timer = null;
  engine = null;
}

/**
 * Hot-apply a config change from the settings PUT: one immediate tick picks up
 * the new values (including enable → snapshot+steer and disable → restore).
 * No-op during onboarding-only boot (engine not started).
 */
export async function applyAutomationConfig(): Promise<void> {
  await engine?.tick();
}

/** Live status for `GET /api/automations/status` (tolerates not-started boot). */
export function automationStatus(): AutomationStatusView {
  return { peakShaving: engine?.status() ?? initialStatus() };
}
