/**
 * Automation engine — light, opt-in control loops that write inverter
 * registers. Today one automation: **peak shaving**, which owns the
 * battery max-charge-current register while active and steers it from live
 * PV/SOC plus the 15-min production forecast.
 *
 * This module is the production wiring only: it builds the real
 * {@link AutomationIO} (config, forecast, live sample, persisted snapshot) and
 * owns the interval timer. The decision math lives in {@link ./peak-shaving}
 * and the tick state machine in {@link ./peak-shaving-engine}, both DB-free and
 * unit-tested.
 *
 * Single-process assumption (same as the composite-control state): exactly one
 * server owns a database. Two servers sharing one DB (e.g. a dev simulator next
 * to a live instance) will fight over the snapshot key and each other's
 * registers — don't do that with an automation enabled.
 */

import type { AutomationConfig } from "@SunReye/db/automation-config";
import {
  AUTOMATION_STATE_KEY,
  type AutomationState,
  automationStateSchema,
  defaultAutomationState,
} from "@SunReye/db/automation-state";
import { HISTORY_CAPACITY, type DecisionPoint } from "./automation-history";
import type { ProfileContext } from "./inverter";
import { log } from "./logging";
import type { PeakShavingPlans } from "./peak-shaving-plan";
import {
  type AutomationIO,
  type AutomationStatusView,
  type PeakShavingEngine,
  type PeakShavingStatus,
  createPeakShavingEngine,
  initialStatus,
} from "./peak-shaving-engine";

// Re-exported so the web app can type its client against the exact server
// shapes (see apps/web/src/lib/automations.ts) instead of hand-mirroring them.
export type { AutomationConfig } from "@SunReye/db/automation-config";
export type { DecisionPoint } from "./automation-history";
export type { Blocker } from "./peak-shaving";
export type { PeakShavingPlan, PeakShavingPlans, PlanSlot } from "./peak-shaving-plan";

/** Payload of `GET /api/automations/plan`. */
export interface AutomationPlanView {
  peakShaving: PeakShavingPlans | null;
}

/** Payload of `GET /api/automations/history`. */
export interface AutomationHistoryView {
  /** Engine tick cadence, ms — the nominal spacing between points. */
  tickMs: number;
  /** Ring size, i.e. how many points the window can hold at most. */
  capacity: number;
  peakShaving: DecisionPoint[];
}
export type {
  AutomationStatusView,
  PeakShavingRunState,
  PeakShavingStatus,
} from "./peak-shaving-engine";

const logger = log("automation");

/** Tick cadence until the config has been read; writes only happen on change. */
const DEFAULT_TICK_MS = 30_000;

/**
 * One frame of `/ws/automations`: pushed after every engine tick (and once as
 * the on-open snapshot, then carrying the full ring in `history`).
 */
export interface AutomationStreamMessage {
  /** Engine cadence, ms — the countdown base for "next decision in …". */
  tickMs: number;
  status: PeakShavingStatus;
  /** The decision point this tick appended; null when the tick decided nothing. */
  point: DecisionPoint | null;
  /** Full ring backfill; present only on the socket-open snapshot. */
  history?: DecisionPoint[];
  /** Today/tomorrow projections, recomputed per tick; null without a forecast. */
  plan: PeakShavingPlans | null;
}

let engine: PeakShavingEngine | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let tickMs = DEFAULT_TICK_MS;
/** The production config reader, kept for the cadence re-read each tick. */
let readConfig: (() => Promise<AutomationConfig>) | null = null;
/** `t` of the last decision point already streamed, for the delta framing. */
let streamedT: number | null = null;
let streamListener: ((msg: AutomationStreamMessage) => void) | null = null;

/** Wire (or clear) the broadcast sink for {@link AutomationStreamMessage}s. */
export function setAutomationListener(fn: ((msg: AutomationStreamMessage) => void) | null): void {
  streamListener = fn;
}

/**
 * One engine tick, then push the outcome to stream subscribers. The cadence is
 * re-read from config afterwards so a changed control interval takes effect on
 * the very next arm, no restart needed.
 */
async function tickAndBroadcast(): Promise<void> {
  const eng = engine;
  if (!eng) return;
  await eng.tick();
  try {
    if (readConfig) {
      tickMs = (await readConfig()).peakShaving.controlIntervalS * 1000;
    }
    if (!streamListener || engine !== eng) return;
    streamListener({
      tickMs,
      status: eng.status(),
      point: nextStreamPoint(eng),
      plan: await eng.plan(),
    });
  } catch (error) {
    // A failed broadcast (config read, plan projection) must never kill the
    // loop — the tick itself already ran and reported into the status.
    logger.warn("automation stream broadcast failed: {error}", { error });
  }
}

/** The newest decision point not yet streamed, marking it streamed; else null. */
function nextStreamPoint(eng: PeakShavingEngine): DecisionPoint | null {
  const latest = eng.history().at(-1) ?? null;
  if (!latest || latest.t === streamedT) return null;
  streamedT = latest.t;
  return latest;
}

/** (Re)arm the loop timer at the current cadence. */
function scheduleNext(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!engine) return;
  timer = setTimeout(() => {
    void tickAndBroadcast().finally(scheduleNext);
  }, tickMs);
}

/** Production IO: real config, forecast, live sample and persisted snapshot state. */
async function buildProductionIO(deps: {
  ctx: ProfileContext;
  write: (key: string, value: number) => Promise<void>;
}): Promise<AutomationIO> {
  const [
    { getAutomationConfig },
    { getWeatherConfig },
    { fetchSolarForecast, representativeHouseLoadW },
    { evccSnapshot, evccControl },
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
    getBaselineLoadW: representativeHouseLoadW,
    getEvcc: evccSnapshot,
    setEvccMode: (loadpoint, mode) => evccControl(loadpoint, "mode", mode),
    async getPrices() {
      const [{ getSpotPriceConfig }, { loadSpotSlice }, { spotPricesReady }] = await Promise.all([
        import("./spot-price-settings"),
        import("./spot-price-store"),
        import("@SunReye/db/spot-price-config"),
      ]);
      const config = await getSpotPriceConfig();
      return spotPricesReady(config) ? loadSpotSlice(config.zone) : null;
    },
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
  const io = await buildProductionIO(deps);
  readConfig = io.getConfig;
  engine = createPeakShavingEngine(io);
  void tickAndBroadcast().finally(scheduleNext);
}

/**
 * Stop the loop (graceful shutdown). Deliberately does **not** restore the
 * snapshot: a reboot with the automation enabled must resume seamlessly, and
 * the persisted snapshot survives for the eventual release.
 */
export async function stopAutomations(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  engine = null;
  readConfig = null;
  streamedT = null;
}

/**
 * Hot-apply a config change from the settings PUT: one immediate tick picks up
 * the new values (including enable → snapshot+steer and disable → restore),
 * streams the outcome, and re-arms the timer at the possibly-changed cadence.
 * No-op during onboarding-only boot (engine not started).
 */
export async function applyAutomationConfig(): Promise<void> {
  if (!engine) return;
  await tickAndBroadcast();
  scheduleNext();
}

/** Live status for `GET /api/automations/status` (tolerates not-started boot). */
export function automationStatus(): AutomationStatusView {
  return { peakShaving: engine?.status() ?? initialStatus() };
}

/**
 * Rolling decision history for `GET /api/automations/history` — what each tick
 * decided and what the plant did with it, for the automation charts. In-memory
 * only (see ./automation-history), so it is empty right after a restart.
 */
/**
 * Projection of the rest of today for `GET /api/automations/plan`: when the
 * automation expects to charge and what SOC it expects to reach. Computed on
 * demand from the cached forecast, and available even while the automation is
 * off, so a plant can preview it before switching anything on.
 */
export async function automationPlan(): Promise<AutomationPlanView> {
  return { peakShaving: (await engine?.plan()) ?? null };
}

export function automationHistory(): AutomationHistoryView {
  return {
    tickMs,
    capacity: HISTORY_CAPACITY,
    peakShaving: engine?.history() ?? [],
  };
}

/**
 * The on-open frame for a new `/ws/automations` subscriber: current status,
 * the full decision ring, and the projection — everything the page needs to
 * paint before the next tick lands. Tolerates not-started boot.
 */
export async function automationStreamSnapshot(): Promise<AutomationStreamMessage> {
  return {
    tickMs,
    status: engine?.status() ?? initialStatus(),
    point: null,
    history: engine?.history() ?? [],
    plan: (await engine?.plan()) ?? null,
  };
}
