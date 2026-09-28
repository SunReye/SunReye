/**
 * The EVCC ingest wired to the real plant: its settings, its broker, its row's
 * topic root, and the path from a loadpoint to `metrics_raw` — a device row per
 * loadpoint, then the runtime's ONE wired writer. Composition only; the ingest
 * (`./evcc.ts`) owns none of these, which is what lets its suite run unmocked.
 */

import { ensureDevice, isRetired, readPlant } from "@SunReye/db/plant-repo";

import { brokerPool } from "../devices/broker-pool-instance";
import type { DeviceRegistry } from "../devices/registry";
import { readEvccTopicRoot } from "../integrations/evcc-topic-root";
import { getEvccConfig } from "../settings/evcc-settings";
import { readBroker } from "../settings/mqtt-broker-instance";
import { log } from "../shared/logging";
import { plantClient } from "../shared/plant-client";
import type { Streams } from "../shared/streams";
import { type EvccIngest, createEvccIngest } from "./evcc";
import { loadpointDeviceSpec } from "./evcc-devices";
import type { LoadpointRegistrarDeps } from "./evcc-registrar";

/** Where the loadpoints' readings go: the runtime's write seam. */
export interface LoadpointWriter {
  commit: LoadpointRegistrarDeps["commit"];
  forgetDevice: LoadpointRegistrarDeps["forgetDevice"];
}

/**
 * Ensure a loadpoint's device row, bound to EVCC's OWN broker connection (#217)
 * with its topic root on the row. The config is read per call, not captured at
 * boot: a settings save may have re-pointed either, and a row created against
 * the previous broker would sit on an endpoint nothing subscribes to.
 */
async function ensureLoadpointDevice(
  _id: string,
  index: number,
  title: string | null,
): ReturnType<LoadpointRegistrarDeps["ensureDevice"]> {
  const client = plantClient();
  const plant = await readPlant(client);
  // Onboarding-only boot: EVCC ingest starts before there is a plant to hang a
  // device on. The live feed runs; storage starts on the next snapshot after
  // provisioning.
  if (!plant) return "absent";
  const config = await getEvccConfig();
  const row = await ensureDevice(
    client,
    loadpointDeviceSpec(plant.id, index, title, {
      connectionId: config.connectionId,
      topicRoot: config.topicRoot,
    }),
  );
  // RETIRED IS NOT REGISTERED. `ensureDevice` is `ON CONFLICT DO NOTHING` +
  // SELECT, so it answers "the row is there" for a row the operator retired in
  // Settings → Devices — while the roster read excludes retired rows. The
  // registrar has to be told the difference or it waits for an instance that
  // is never coming.
  return isRetired(row) ? "retired" : "ready";
}

/** The process's EVCC ingest, over the real settings, pool and plant. */
export function createPlantEvccIngest(wiring: {
  streams: Streams;
  registry: Pick<DeviceRegistry, "reload" | "get">;
  writer: LoadpointWriter;
}): EvccIngest {
  const logger = log("evcc");
  return createEvccIngest({
    streams: wiring.streams,
    storage: {
      ensureDevice: ensureLoadpointDevice,
      reloadRegistry: async () => void (await wiring.registry.reload()),
      device: (id) => wiring.registry.get(id),
      commit: (device, sample) => wiring.writer.commit(device, sample),
      forgetDevice: (id) => wiring.writer.forgetDevice(id),
      logger,
    },
    readConfig: getEvccConfig,
    readBroker,
    readTopicRoot: readEvccTopicRoot,
    pool: brokerPool,
    logger,
  });
}
