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
  type DeviceProfileBinding,
  automationStateSchema,
  defaultAutomationState,
  migrateAutomationState,
} from "@SunReye/db/automation-state";
import type { SpotPriceConfig } from "@SunReye/db/spot-price-config";
import type { ZodType } from "zod";
import type {
  AutomationPlanView,
  AutomationStatusView,
  AutomationStreamMessage,
} from "@SunReye/contracts/automation";
import type { SpotSlice } from "@SunReye/contracts/prices";
import { log } from "../shared/logging";
import type { Streams } from "../shared/streams";
import {
  type AutomationIO,
  type PeakShavingEngine,
  createPeakShavingEngine,
  initialStatus,
} from "./peak-shaving-engine";

const logger = log("automation");

/** Tick cadence until the config has been read; writes only happen on change. */
const DEFAULT_TICK_MS = 30_000;

let engine: PeakShavingEngine | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let tickMs = DEFAULT_TICK_MS;
/** The production config reader, kept for the cadence re-read each tick. */
let readConfig: (() => Promise<AutomationConfig>) | null = null;
/**
 * The read-side bus the tick outcome is emitted onto, injected by
 * {@link startAutomations}. Null until the loop is started (and in the
 * onboarding-only boot where it never is); the socket layer fans one emit out
 * to every subscriber of the `automations` topic.
 */
let streams: Streams | null = null;
/**
 * Whether anyone is actually watching the `automations` feed, injected by
 * {@link startAutomations} because only the socket boundary can answer it.
 * Defaults to "assume a viewer": a caller that does not know must not be the
 * reason a frame goes missing.
 */
let hasAudience: () => boolean = () => true;

/**
 * One engine tick, then push the outcome to stream subscribers. The cadence is
 * re-read from config afterwards so a changed control interval takes effect on
 * the very next arm, no restart needed.
 *
 * The tick and the cadence re-read are unconditional — this loop writes the
 * charge register, and an instance nobody has a browser open on must keep
 * steering the plant at the configured interval. Only the frame, and the plan
 * projection built solely for it, are skipped when there is nobody to send it
 * to; the projection re-models the rest of the day and is by far the most
 * expensive thing on this path.
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
    // The plan projection below re-models the rest of the day and is by far the
    // most expensive thing on this path, so it is skipped when nobody is there
    // to receive it.
    if (!hasAudience()) return;
    streams?.emit("automations", { tickMs, status: eng.status(), plan: await eng.plan() });
  } catch (error) {
    // A failed broadcast (config read, plan projection) must never kill the
    // loop — the tick itself already ran and reported into the status.
    logger.warn("automation stream broadcast failed: {error}", { error });
  }
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
 * What the plant is written through: the steered device and the register writer.
 * Exported because it names the parameter of {@link startAutomations},
 * {@link buildProductionIO} and {@link composeAutomationIO} — a caller has to be
 * able to name what it is handing in.
 */
export interface PlantDeps {
  /** The registered device the loop steers — roles in, `devices.slug` as identity. */
  device: AutomationIO["device"];
  /** The register bounds seam; see {@link AutomationIO.constraint}. */
  constraint: AutomationIO["constraint"];
  write: (key: string, value: number) => Promise<void>;
  /**
   * Where a decided tick is STORED — the runtime's optimizer registrar, which
   * ends at the same `createDeviceWriter` every other reading goes through
   * (#172). Omitted, the loop still steers the plant and records nothing.
   */
  recordDecision?: AutomationIO["recordDecision"];
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
  /** `batteries.nominal_v`, the pack voltage's newest home — see the IO field. */
  packNominalV: AutomationIO["getPackNominalV"];
  fetchSolarForecast: AutomationIO["getForecast"];
  representativeHouseLoadW: AutomationIO["getBaselineLoadW"];
  evccSnapshot: AutomationIO["getEvcc"];
  evccControl: AutomationIO["evccCommand"];
  getTariff: AutomationIO["getTariff"];
  getSpotPriceConfig(): Promise<SpotPriceConfig>;
  spotPricesReady(config: SpotPriceConfig): boolean;
  loadSpotSlice(zone: string): Promise<SpotSlice>;
  latestSample: AutomationIO["latestSample"];
  /**
   * Which profile each registered device's row names — the ONE input the
   * one-time re-key of a 1.x, profile-keyed state blob needs. Nothing else on
   * this surface may look at it: profile identity is not a behavioural input.
   */
  deviceProfileBindings(): readonly DeviceProfileBinding[];
  readSetting<T>(key: string, schema: ZodType<T>, fallback: T): Promise<T>;
  writeSetting<T>(key: string, value: T): Promise<void>;
}

/**
 * Read the persisted state, re-keying a 1.x profile-namespaced blob onto the
 * devices that hold those registers today — once, on the first read.
 *
 * The read itself is the validating one, so a hand-mangled row still goes down
 * the quarantine road `readSetting` owns rather than being silently replaced by
 * the default. The re-key never parses anything: it moves keys, and only when
 * exactly one registered device names the profile a key was written under.
 * Anything it cannot place is left untouched and named in the log — every one of
 * those entries is a register value the user themselves set, which the
 * automation borrowed and has not handed back, and it exists nowhere else.
 */
async function readMigratedState(mods: AutomationModules): Promise<AutomationState> {
  const stored = await mods.readSetting(
    AUTOMATION_STATE_KEY,
    automationStateSchema,
    defaultAutomationState,
  );
  const migrated = migrateAutomationState(stored, mods.deviceProfileBindings());
  if (migrated.orphans.length > 0) {
    logger.warn(
      "automation state holds {count} entr(y/ies) no registered device can claim — left in place, restore by hand if needed: {keys}",
      { count: migrated.orphans.length, keys: migrated.orphans.join(", ") },
    );
  }
  // Written only when something actually moved, so the pass is inert on every
  // boot after the first and cannot churn the settings row.
  if (migrated.changed) await mods.writeSetting(AUTOMATION_STATE_KEY, migrated.state);
  return migrated.state;
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
    device: deps.device,
    constraint: deps.constraint,
    write: deps.write,
    ...(deps.recordDecision ? { recordDecision: deps.recordDecision } : {}),
    getConfig: mods.getAutomationConfig,
    getWeather: mods.getWeatherConfig,
    getPackNominalV: mods.packNominalV,
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
      stateCache ??= await readMigratedState(mods);
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
    { plantFacts },
    { fetchSolarForecast, representativeHouseLoadW },
    { evccSnapshot, evccControl },
    { liveState },
    { getTariff },
    { readSetting, writeSetting },
    { getSpotPriceConfig },
    { loadSpotSlice },
    { spotPricesReady },
    { deviceRegistry },
  ] = await Promise.all([
    import("../settings/automation-settings"),
    import("../settings/weather-settings"),
    import("../settings/plant-facts-instance"),
    import("../forecast/solar-forecast"),
    import("../evcc/evcc"),
    import("../shared/state"),
    import("../settings/settings"),
    import("../settings/app-settings"),
    import("../settings/spot-price-settings"),
    import("../prices/spot-price-store"),
    import("@SunReye/db/spot-price-config"),
    import("../devices/registry-instance"),
  ]);
  return composeAutomationIO(deps, {
    getAutomationConfig,
    getWeatherConfig,
    // Through `plantFacts`, whose pack read is cached, so asking once per tick
    // costs one query per invalidation rather than one per tick.
    packNominalV: () => plantFacts.packNominalV(),
    fetchSolarForecast,
    representativeHouseLoadW,
    evccSnapshot,
    evccControl,
    getTariff,
    getSpotPriceConfig,
    spotPricesReady,
    loadSpotSlice,
    latestSample: () => liveState.latest,
    deviceProfileBindings: () => deviceRegistry.bindings(),
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
 *
 * `watching` answers "is anyone subscribed to the `automations` topic right
 * now" — a question only the socket boundary can answer, so it is injected from
 * there rather than reached for here. Omitted, every tick broadcasts.
 */
export async function startAutomations(
  deps: PlantDeps,
  streamBus?: Streams,
  buildIO: (deps: PlantDeps) => Promise<AutomationIO> = buildProductionIO,
  watching: () => boolean = () => true,
): Promise<void> {
  await stopAutomations();
  streams = streamBus ?? null;
  hasAudience = watching;
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
  // Released with the loop: the predicate closes over the server that owned it.
  hasAudience = () => true;
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

/**
 * There is no `automationHistory()` any more (#172).
 *
 * What each tick decided is a READING now: it goes through the runtime's write
 * seam into `metrics_raw` under the device slug `optimizer`, and `GET
 * /api/history` and `GET /api/history/rollup` answer for it like they do for any
 * other device. The function this replaced read a 2 880-slot ring — 24 hours,
 * gone on restart, invisible to rollups, statistics, CSV export and the archive.
 */
/** Live status for `GET /api/automations/status` (tolerates not-started boot). */
export function automationStatus(): AutomationStatusView {
  return { peakShaving: engine?.status() ?? initialStatus() };
}

/**
 * Projection of the rest of today for `GET /api/automations/plan`: when the
 * automation expects to charge and what SOC it expects to reach. Computed on
 * demand from the cached forecast, and available even while the automation is
 * off, so a plant can preview it before switching anything on.
 */
export async function automationPlan(): Promise<AutomationPlanView> {
  return { peakShaving: (await engine?.plan()) ?? null };
}

/**
 * The subscribe-time frame for a new `automations` subscriber: current status
 * and the projection — everything about the LIVE engine that a page needs to
 * paint before the next tick lands. Tolerates not-started boot.
 *
 * It no longer carries a decision backfill, and there is no longer a variant to
 * tell apart: what each tick decided is history in `metrics_raw`, fetched over
 * `GET /api/history/rollup` under the `optimizer` slug like every other device's
 * series. This topic carries only what a hypertable must never hold — live
 * engine state (error strings, blockers, a countdown) and a FORECAST.
 */
export async function automationStreamSnapshot(): Promise<AutomationStreamMessage> {
  return {
    tickMs,
    status: engine?.status() ?? initialStatus(),
    plan: (await engine?.plan()) ?? null,
  };
}
