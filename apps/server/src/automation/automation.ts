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
import type { SpotPriceConfig } from "@SunReye/db/spot-price-config";
import type { ZodType } from "zod";
import { HISTORY_CAPACITY, type DecisionPoint } from "./automation-history";
import type { ProfileContext } from "../inverter/inverter";
import type { SpotSlice } from "@SunReye/contracts/prices";
import { log } from "../shared/logging";
import type { Streams } from "../shared/streams";
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
/**
 * The read-side bus the tick outcome is emitted onto, injected by
 * {@link startAutomations}. Null until the loop is started (and in the
 * onboarding-only boot where it never is); the socket layer fans one emit out
 * to every `/ws/automations` subscriber.
 */
let streams: Streams | null = null;

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
    // The config read above is an await; a stop (or restart) may have run in
    // between, so re-check we are still the live engine before emitting.
    if (engine !== eng) return;
    streams?.emit("automations", {
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

/**
 * What the plant is written through: the active profile and the register writer.
 * Exported because it names the parameter of {@link startAutomations},
 * {@link buildProductionIO} and {@link composeAutomationIO} — a caller has to be
 * able to name what it is handing in.
 */
export interface PlantDeps {
  ctx: ProfileContext;
  write: (key: string, value: number) => Promise<void>;
}

/**
 * Everything the production IO reads the plant through. Injected into
 * {@link composeAutomationIO} rather than imported by it, so the wiring — the
 * price gate and the snapshot cache especially — can be proven without a
 * database behind it.
 */
export interface AutomationModules {
  getAutomationConfig: AutomationIO["getConfig"];
  getWeatherConfig: AutomationIO["getWeather"];
  fetchSolarForecast: AutomationIO["getForecast"];
  representativeHouseLoadW: AutomationIO["getBaselineLoadW"];
  evccSnapshot: AutomationIO["getEvcc"];
  evccControl: AutomationIO["evccCommand"];
  getTariff: AutomationIO["getTariff"];
  getSpotPriceConfig(): Promise<SpotPriceConfig>;
  spotPricesReady(config: SpotPriceConfig): boolean;
  loadSpotSlice(zone: string): Promise<SpotSlice>;
  latestSample: AutomationIO["latestSample"];
  readSetting<T>(key: string, schema: ZodType<T>, fallback: T): Promise<T>;
  writeSetting<T>(key: string, value: T): Promise<void>;
}

/**
 * Wire the plant modules onto the tick's IO surface: pass-throughs, the price
 * gate (a disabled or zone-less feed reads as "no prices", never as a price of
 * zero) and the snapshot cache that keeps the persisted state to one read per
 * engine run.
 */
// fallow-ignore-next-line unused-export -- wiring asserted by automation.test.ts; test files aren't traced as consumers
export function composeAutomationIO(deps: PlantDeps, mods: AutomationModules): AutomationIO {
  let stateCache: AutomationState | null = null;
  return {
    ctx: deps.ctx,
    write: deps.write,
    getConfig: mods.getAutomationConfig,
    getWeather: mods.getWeatherConfig,
    getForecast: mods.fetchSolarForecast,
    getBaselineLoadW: mods.representativeHouseLoadW,
    getEvcc: mods.evccSnapshot,
    evccCommand: mods.evccControl,
    getTariff: mods.getTariff,
    async getPrices() {
      const config = await mods.getSpotPriceConfig();
      return mods.spotPricesReady(config) ? mods.loadSpotSlice(config.zone) : null;
    },
    latestSample: mods.latestSample,
    async loadState() {
      stateCache ??= await mods.readSetting(
        AUTOMATION_STATE_KEY,
        automationStateSchema,
        defaultAutomationState,
      );
      return stateCache;
    },
    async saveState(next) {
      await mods.writeSetting(AUTOMATION_STATE_KEY, next);
      stateCache = next;
    },
    now: () => Date.now(),
  };
}

/** Production IO: real config, forecast, live sample and persisted snapshot state. */
// fallow-ignore-next-line unused-export -- the default `buildIO` of startAutomations, also asserted by automation.test.ts; defaults and test files aren't traced as consumers
export async function buildProductionIO(deps: PlantDeps): Promise<AutomationIO> {
  const [
    { getAutomationConfig },
    { getWeatherConfig },
    { fetchSolarForecast, representativeHouseLoadW },
    { evccSnapshot, evccControl },
    { liveState },
    { getTariff },
    { readSetting, writeSetting },
    { getSpotPriceConfig },
    { loadSpotSlice },
    { spotPricesReady },
  ] = await Promise.all([
    import("../settings/automation-settings"),
    import("../settings/weather-settings"),
    import("../forecast/solar-forecast"),
    import("../evcc/evcc"),
    import("../shared/state"),
    import("../settings/settings"),
    import("../settings/app-settings"),
    import("../settings/spot-price-settings"),
    import("../prices/spot-price-store"),
    import("@SunReye/db/spot-price-config"),
  ]);
  return composeAutomationIO(deps, {
    getAutomationConfig,
    getWeatherConfig,
    fetchSolarForecast,
    representativeHouseLoadW,
    evccSnapshot,
    evccControl,
    getTariff,
    getSpotPriceConfig,
    spotPricesReady,
    loadSpotSlice,
    latestSample: () => liveState.latest,
    readSetting,
    writeSetting,
  });
}

/**
 * Start the automation loop (called by the runtime once a profile is active):
 * stop whatever ran before, build the IO, tick once immediately, then arm the
 * interval. `buildIO` is the injection seam — production always takes
 * {@link buildProductionIO}; a caller that owns its own IO (tests, a harness)
 * passes one in and drives the same loop without a database behind it.
 *
 * `streamBus` is the read-side bus the tick outcome is emitted onto; omitted
 * (the runtime-mock fallback) the loop still ticks and records, it just has
 * nowhere to broadcast.
 */
export async function startAutomations(
  deps: PlantDeps,
  streamBus?: Streams,
  buildIO: (deps: PlantDeps) => Promise<AutomationIO> = buildProductionIO,
): Promise<void> {
  await stopAutomations();
  streams = streamBus ?? null;
  const io = await buildIO(deps);
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
