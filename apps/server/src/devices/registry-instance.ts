/**
 * The process's one device registry, and its production wiring.
 *
 * Split from `./registry.ts` so the rules — which rows become instances, what a
 * dangling profile id does, what a failed read must not do — stay testable
 * without a database, and so nothing that only wants the TYPE has to import the
 * client. It is the same split `./registry.ts`'s neighbours use
 * (`../inverter/provision-boot.ts`, `../settings/plant-facts-instance.ts`).
 *
 * A module-level instance, deliberately, and it is the one piece of shared state
 * this deliverable ADDS while removing `activeProfile`. The difference is what
 * it holds: `activeProfile` was one profile for the process — an answer that
 * cannot be right for a plant with two machines — while this holds the plant's
 * device rows, re-read on demand, keyed by the identity the readings already
 * carry.
 */

import { db } from "@SunReye/db";
import { readDevices, readPlant } from "@SunReye/db/plant-repo";

import { resolveProfileById } from "../inverter/inverter";
import { log } from "../shared/logging";
import { resolveCoded } from "./coded";
import { type DeviceRegistry, createDeviceRegistry } from "./registry";

export type { DeviceRegistry };

/**
 * The plant's in-service device rows.
 *
 * `db` is read PER CALL rather than captured at module load: `mock.module`
 * patches a module's exports in place, so it reaches consumers that read `db`
 * when they run and misses consumers that read it at import time.
 */
async function readPlantDevices() {
  const plant = await readPlant({ execute: (query) => db.execute(query) });
  if (!plant) return [];
  // Narrowed in the STATEMENT as well as filtered in the registry: a caller
  // holding the wide list is a caller that can poll a retired device.
  return readDevices({ execute: (query) => db.execute(query) }, plant.id, {
    includeRetired: false,
  });
}

/**
 * The registry every consumer reads. Empty until {@link DeviceRegistry.reload}
 * has run — `../index.ts` provisions the spine and then the runtime reloads it,
 * in that order, because a registry built before provisioning would hold an
 * empty plant for the life of the process.
 */
export const deviceRegistry: DeviceRegistry = createDeviceRegistry({
  readDevices: readPlantDevices,
  resolveProfile: resolveProfileById,
  // The coded tier (`./coded.ts`): a `profile_id` naming a declaration compiled
  // into this server resolves here and never reaches the profile store.
  resolveCoded,
  logger: log("devices"),
});
