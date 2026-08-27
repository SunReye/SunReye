/**
 * The provisioning hook: where the dimension spine is ensured to exist.
 *
 * TWO CALL SITES, AND WHY EACH ONE
 *
 *  1. BOOT (`../index.ts`, right after `initProfiles`). This is the one that
 *     matters: without it a fresh 2.0.0 install has no `devices` row, so the
 *     writer resolves nothing, drops every batch with one warning, and records
 *     no history at all. It runs whether or not a profile is active — see
 *     {@link syncProvisioning} on why the plant does not wait for one.
 *  2. SAVING THE CONNECTION (`../routes/settings.ts`, the inverter PUT). The
 *     host, port, transport, timeout and unit id the operator just typed are the
 *     `connections` row and the device's `unit_id`. Re-running provisioning there
 *     EDITS those in place — it never adds a second endpoint — so the row keeps
 *     describing where the machine actually is instead of drifting from the
 *     config the poll loop is using.
 *
 * NOTHING HERE THROWS
 *
 * A failure is logged and swallowed. The dashboard, the history reads, the
 * settings pages and the MQTT bridge are all still worth serving without a plant
 * row, and the write path already degrades the same way — it drops rows with a
 * warning rather than failing a 100 000-row flush. Propagating from here would
 * turn a database hiccup at boot into a crash loop on the one deployment target
 * (a Home Assistant addon) whose supervisor restarts it forever.
 */

import { db } from "@SunReye/db";
import type { InverterConfig } from "@SunReye/db/inverter-config";

import { getInverterConfig } from "../settings/config";
import { log } from "../shared/logging";
import {
  type ProvisionLogger,
  type ProvisionProfile,
  type ProvisionResult,
  type ProvisionStore,
  dbProvisionStore,
  provisionDevice,
  provisionPlantRow,
} from "./provision";

export interface BootProvisionDeps {
  store: ProvisionStore;
  logger: ProvisionLogger;
  config: () => Promise<InverterConfig>;
}

/**
 * Production wiring, built PER CALL rather than once at module load.
 *
 * `mock.module` patches a module's exports in place, so it reaches consumers
 * that read `db` when they run and misses consumers that read it at import time.
 * Building here also means a `DATABASE_URL` change (there is none today, but a
 * reconnect is the obvious next thing) does not need this module reloaded.
 */
// fallow-ignore-next-line unused-export -- the default wiring, exercised by provision-boot.test.ts; test files are not traced as consumers.
export function defaultDeps(): BootProvisionDeps {
  return {
    // `db` read per call — see `../settings/plant-facts-instance.ts` for what
    // capturing it at module evaluation costs.
    store: dbProvisionStore({ execute: (query) => db.execute(query) }),
    logger: log("provision"),
    config: getInverterConfig,
  };
}

/**
 * Ensure this install's plant — and, when a profile is active, its endpoint and
 * device — exist.
 *
 * Safe to call as often as you like: every step adopts what is already there
 * rather than inserting (`./provision.ts`). That is not a nicety — `devices.id`
 * is written into every one of five years of raw readings, and a re-insert would
 * take a NEW int2 and silently strand all of them.
 *
 * With no active profile only the PLANT is provisioned. A plant is a site:
 * coordinates, PV surfaces, a time zone, a bidding zone — none of it depends on
 * which inverter is attached, and the settings pages that edit those facts are
 * live during an onboarding-only boot. A device is the thing a profile describes
 * how to talk to, so it waits for one.
 *
 * Returns the provisioned ids, or null when there was no profile (or the attempt
 * failed).
 */
export async function syncProvisioning(
  profile: ProvisionProfile | null,
  deps: BootProvisionDeps = defaultDeps(),
): Promise<ProvisionResult | null> {
  try {
    if (!profile) {
      await provisionPlantRow(deps);
      return null;
    }
    return await provisionDevice({ ...deps, profile, config: await deps.config() });
  } catch (error) {
    deps.logger.warn(
      "plant provisioning failed: {error} — readings cannot be stored until this succeeds",
      { error: error instanceof Error ? error.message : String(error) },
    );
    return null;
  }
}
