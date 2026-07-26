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
import { type AutomationState, automationStateKey } from "@SunReye/db/automation-state";
import type { PeakShavingMode } from "@SunReye/db/automation-config";
import type { WeatherConfig } from "@SunReye/db/weather";
import { entityConstraint } from "@SunReye/inverter-core";
import type { InverterSample } from "@SunReye/inverter-core";
import type { EvccState } from "./evcc";
import type { ProfileContext } from "./inverter";
import { log } from "./logging";
import {
  type Blocker,
  type EvInputs,
  decideTargetA,
  evccAutomationInputs,
  keyForRole,
  resolvePeakShavingBlockers,
} from "./peak-shaving";
import type { SolarForecast } from "./solar-forecast";

const logger = log("automation");

/** Id under which peak shaving namespaces its snapshot (see automation-state). */
const PEAK_SHAVING_ID = "peakShaving";

/** A live sample older than this is unusable — hold all writes. */
const STALE_SAMPLE_MS = 30_000;

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

export function initialStatus(): PeakShavingStatus {
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
async function writeTarget(e: Eng, key: string, targetA: number, live: LiveInputs): Promise<void> {
  const { io, status } = e;
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

/** Mirror one decision's reasoning into the status the UI polls. */
function recordDecision(
  status: PeakShavingStatus,
  decision: ReturnType<typeof decideTargetA>,
  live: LiveInputs,
  ev: EvInputs,
  evccReachable: boolean,
  exportLimitW: number,
): void {
  status.thresholdW = Math.round(decision.thresholdW);
  status.headroomKwh = decision.headroomKwh;
  status.remainingAboveLimitKwh = decision.surplusAboveLimitKwh;
  status.liveExcessW = Math.max(0, live.pvW - ev.evChargeW - exportLimitW);
  status.evChargeW = evccReachable ? ev.evChargeW : null;
  status.evDemandKwh = evccReachable ? ev.evRemainingKwh : null;
  status.externalOverride =
    status.lastWrittenA !== null && live.liveA !== null && live.liveA !== status.lastWrittenA;
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

  recordDecision(status, decision, live, ev, evcc?.reachable === true, exportLimitW);
  const targetA = clampToRegister(io, key, Math.round(decision.targetA));
  status.targetA = targetA;
  status.state = "active";
  await writeTarget(e, key, targetA, live);
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
const isNight = (live: LiveInputs, forecast: SolarForecast | null): boolean =>
  live.pvW <= 0 && (forecast?.raw.next15.maxPowerW ?? 0) <= 0;

async function runTick(e: Eng): Promise<PeakShavingStatus> {
  const { io, status } = e;
  try {
    status.lastError = null;
    const cfg = await io.getConfig();
    const ps = cfg.peakShaving;
    status.mode = ps.mode;
    status.enabled = cfg.enabled && ps.enabled;
    if (!status.enabled) return await releasedStatus(e, "disabled");

    const weather = await io.getWeather();
    status.blockers = resolvePeakShavingBlockers(io.ctx.profile, weather);
    if (status.blockers.length > 0) return await releasedStatus(e, "blocked");

    const ready = liveOrHold(io);
    if (!ready) {
      status.state = "stale"; // hold everything — never steer on stale data
      return status;
    }
    status.liveA = ready.live.liveA;

    const forecast = await io.getForecast(weather);
    status.forecastAvailable = forecast !== null;
    if (isNight(ready.live, forecast)) return await releasedStatus(e, "idle");

    if (!(await ensureSnapshot(e, ready.live.liveA))) {
      status.state = "stale";
      return status;
    }

    await steer(e, ps, weather, ready.live, forecast, ready.key);
    return status;
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
