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

import {
  AUTOMATION_STATE_KEY,
  type AutomationState,
  automationStateSchema,
  defaultAutomationState,
} from "@SunReye/db/automation-state";
import type { ProfileContext } from "./inverter";
import {
  type AutomationIO,
  type AutomationStatusView,
  type PeakShavingEngine,
  createPeakShavingEngine,
  initialStatus,
} from "./peak-shaving-engine";

// Re-exported so the web app can type its client against the exact server
// shapes (see apps/web/src/lib/automations.ts) instead of hand-mirroring them.
export type { AutomationConfig } from "@SunReye/db/automation-config";
export type { Blocker } from "./peak-shaving";
export type {
  AutomationStatusView,
  PeakShavingRunState,
  PeakShavingStatus,
} from "./peak-shaving-engine";

/** Tick cadence; writes only happen on change, so this is cheap. */
const AUTOMATION_TICK_MS = 30_000;

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
