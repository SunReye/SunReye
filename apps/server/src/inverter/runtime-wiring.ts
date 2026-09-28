/**
 * The runtime's production collaborators: the database, the settings, the
 * process's broker pool, the automation loop and the background jobs. Wiring
 * only — `./runtime.ts` decides what happens with them, and is tested against
 * doubles of every one; this module is what binds them to the real process.
 */

import { db } from "@SunReye/db";
import { ensureDevice, isRetired, readPlant } from "@SunReye/db/plant-repo";
import { metricsConfigLog, metricsRaw } from "@SunReye/db/schema/metrics";
import { env } from "@SunReye/env/server";
import mqtt from "mqtt";

import { startAutomations, stopAutomations } from "../automation/automation";
import { optimizerDeviceSpec } from "../automation/optimizer-device";
import type { DeviceRowState } from "../automation/optimizer-registrar";
import { brokerPool } from "../devices/broker-pool-instance";
import type { DeviceRegistry } from "../devices/registry";
import { runForecastCorrectionLearn } from "../forecast/forecast-correction-job";
import { fetchSolarForecast } from "../forecast/solar-forecast";
import { runSpotPriceSync } from "../prices/spot-price-job";
import { getMqttConfig, getSimulate } from "../settings/config";
import { getPlantTimeZone } from "../settings/display-settings";
import { readBroker } from "../settings/mqtt-broker-instance";
import { getSpotPriceConfig } from "../settings/spot-price-settings";
import { getWeatherConfig } from "../settings/weather-settings";
import { createIdentityResolver } from "../shared/identity";
import { log } from "../shared/logging";
import {
  type ConnectionProbes,
  type ProbeMqttClient,
  createConnectionProbes,
} from "./connection-probes";
import { dbControlStore } from "./control-store";
import { loadPollEndpoint } from "./endpoint";
import { createHistoryBuffer } from "./history-buffer";
import { buildProfileContext, buildSource, resolveProfileById } from "./inverter";
import { createJobScheduler } from "./job-scheduler";
import { startMqttBridge } from "./mqtt";
import { readMqttNamespace } from "./mqtt-namespace";
import type { RuntimeDeps } from "./runtime";
import { createIdentifiedCommit, createRowIdentifier } from "./storage-identity";
import type { StorageRow } from "./storage-policy";

const logger = log("runtime");

/**
 * The optimizer's `devices` row, over the real plant spine.
 *
 * RETIRED IS NOT REGISTERED. `ensureDevice` is `ON CONFLICT DO NOTHING` +
 * SELECT, so it answers "the row is there" for a row the operator retired in
 * Settings → Devices — while the roster read excludes exactly that row. The
 * registrar has to be told the difference or it waits for an instance that is
 * never coming.
 *
 * `"absent"` is a legal answer: the automation loop can be armed on a boot that
 * has no plant yet, and taking it down over a missing device row would be worse
 * than storing nothing until the next tick.
 */
// fallow-ignore-next-line unused-export -- the production `RuntimeDeps.ensureOptimizerDevice`, also asserted against a stubbed spine in `./optimizer-row.test.ts`; test files aren't traced as consumers.
export async function ensureOptimizerRow(): Promise<DeviceRowState> {
  const plantDb = { execute: (query: Parameters<typeof db.execute>[0]) => db.execute(query) };
  const plant = await readPlant(plantDb);
  if (!plant) return "absent";
  return isRetired(await ensureDevice(plantDb, optimizerDeviceSpec(plant.id)))
    ? "retired"
    : "ready";
}

/** The runtime's collaborators, bound to the real database and settings. */
export function productionRuntimeDeps(wiring: {
  devices: DeviceRegistry;
  onLoadSample: RuntimeDeps["onLoadSample"];
}): RuntimeDeps {
  /**
   * The name -> int2 resolution both commits go through. One resolver for both
   * buffers, so a device or metric id is looked up once per process rather than
   * once per table.
   */
  const identity = createIdentityResolver({ db });
  const rowIdentifier = createRowIdentifier({ resolver: identity, logger });
  /**
   * Commit one batch to `table`, resolving the identity first.
   *
   * These two commits are the ONLY INSERTs into the timeseries and the config
   * change-log, which is exactly why the translation belongs on this path: one
   * place, on the way out, with the in-memory routing above it still keyed by
   * name. The resolve-then-insert step itself lives in `./storage-identity.ts`,
   * where it is reachable by a test.
   */
  const commitIdentified = (table: typeof metricsRaw | typeof metricsConfigLog) =>
    createIdentifiedCommit({
      identify: (rows) => rowIdentifier.identify(rows),
      insert: (values) => db.insert(table).values(values),
    });
  return {
    settings: {
      getMqttConfig,
      getSimulate,
      getPlantTimeZone,
      getWeatherConfig,
      getSpotPriceConfig,
    },
    loadPollEndpoint,
    buildSource,
    startMqttBridge,
    readBroker,
    brokerPool,
    automations: { start: startAutomations, stop: stopAutomations },
    fetchSolarForecast,
    learnCorrection: runForecastCorrectionLearn,
    syncSpotPrices: runSpotPriceSync,
    flushIntervalMs: () => env.HISTORY_FLUSH_INTERVAL_MS,
    history: createHistoryBuffer<StorageRow>({ commit: commitIdentified(metricsRaw), logger }),
    configLog: createHistoryBuffer<StorageRow>({
      commit: commitIdentified(metricsConfigLog),
      logger,
    }),
    scheduler: createJobScheduler(),
    mqttNamespace: readMqttNamespace,
    controlStore: dbControlStore,
    onLoadSample: wiring.onLoadSample,
    ensureOptimizerDevice: ensureOptimizerRow,
    identity,
    devices: wiring.devices,
  };
}

/** The throwaway probes, over the real profile store and `mqtt`. */
export function productionConnectionProbes(devices: DeviceRegistry): ConnectionProbes {
  return createConnectionProbes({
    resolveProfile: resolveProfileById,
    primaryProfile: () => devices.primaryProfile(),
    buildContext: buildProfileContext,
    buildSource,
    connectMqtt: (url, options) => mqtt.connect(url, options) as unknown as ProbeMqttClient,
  });
}
