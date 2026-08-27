/**
 * The plant's facts, read from and written to the COLUMNS that now own them.
 *
 * One cache, deliberately. The plant row and its pack rows are read by the
 * weather config, the plant time zone and the spot-price zone, and each of those
 * used to be its own `cachedSetting` over its own `app_settings` key. Three
 * caches over one row would need cross-invalidation — saving a time zone would
 * have to know to drop the weather cache — and the first missed edge would serve
 * a stale value on the automation tick. So the row is cached HERE, once, and the
 * three accessors above it are pure compositions over it
 * (`@SunReye/db/plant-facts`), cheap enough to run per call.
 *
 * A factory, like the runtime and the storage policy: every field is
 * closure-local, so a second instance shares nothing and the whole thing is
 * testable against the in-memory spine rather than a database.
 */

import type { PlantBattery } from "@SunReye/db/batteries";
import type { DeviceBattery } from "@SunReye/db/batteries";
import { plantBatteryFrom } from "@SunReye/db/plant-facts";
import type { PlantPatch, PlantRecord } from "@SunReye/db/plant-repo";

import {
  type ProvisionLogger,
  type ProvisionStore,
  provisionPlantRow,
} from "../inverter/provision";

export interface PlantFactsDeps {
  store: ProvisionStore;
  logger: ProvisionLogger;
}

export interface PlantFacts {
  /** The plant row, provisioning it on first use. Cached. */
  plant(): Promise<PlantRecord>;
  /** The DERIVED plant battery, or null when no device reports a pack. Cached. */
  battery(): Promise<PlantBattery | null>;
  /** Update only the named columns, then drop the cache. */
  patch(patch: PlantPatch): Promise<void>;
  /** Describe the plant's storage, or `null` for "there is none". */
  writeBattery(battery: DeviceBattery | null): Promise<void>;
  /** Drop every cached value. */
  invalidate(): void;
}

/** The role whose device owns the plant's pack description — see {@link writeBattery}. */
const INVERTER_ROLE = "inverter";

export function createPlantFacts(deps: PlantFactsDeps): PlantFacts {
  /**
   * The in-flight or resolved row, so concurrent first callers share one
   * provisioning rather than racing two `ensurePlant` calls. Held as the PROMISE
   * for that reason, not as the value.
   */
  let plantPromise: Promise<PlantRecord> | null = null;
  let packsPromise: Promise<readonly DeviceBattery[]> | null = null;

  function plant(): Promise<PlantRecord> {
    plantPromise ??= provisionPlantRow(deps).catch((error: unknown) => {
      // A failed read must not be cached as a value: the next caller has to be
      // able to try again, or one hiccup at boot idles the settings layer for
      // the life of the process.
      plantPromise = null;
      throw error;
    });
    return plantPromise;
  }

  function packs(): Promise<readonly DeviceBattery[]> {
    packsPromise ??= plant()
      .then((row) => deps.store.readPlantBatteries(row.id))
      .catch((error: unknown) => {
        packsPromise = null;
        throw error;
      });
    return packsPromise;
  }

  function invalidate(): void {
    plantPromise = null;
    packsPromise = null;
  }

  /**
   * The device a pack description belongs to, or null when there is no single
   * answer.
   *
   * Only `role = 'inverter'` devices are candidates: a controller or a meter
   * reports plant-level values from its own registers and is not where storage
   * is described.
   */
  async function packOwner(): Promise<number | null> {
    const row = await plant();
    const devices = await deps.store.readDevices(row.id);
    const inverters = devices.filter((d) => d.role === INVERTER_ROLE);
    return inverters[0]?.id ?? null;
  }

  return {
    plant,
    async battery() {
      return plantBatteryFrom(await packs());
    },
    async patch(patch: PlantPatch) {
      const row = await plant();
      await deps.store.updatePlant(row.id, patch);
      invalidate();
    },
    /**
     * Write the plant's storage description onto the device that reports it.
     *
     * THE AGGREGATE IS NOT INVERTIBLE. The plant battery the forms edit is
     * DERIVED — capacities summed, the reserve capacity-weighted — so with two
     * packs there is no way back from "35 kWh, 11.43 %" to the 30/5 and 5/50 it
     * came from. Any split would be a guess, and a guess here silently changes
     * what the automation engine reserves and what the forecast believes it can
     * store. So the write is refused and says so, which is the honest answer
     * until a per-device UI exists to ask the question properly.
     *
     * With no inverter device at all — an onboarding-only boot, where the
     * settings pages are live before any profile is active — there is nothing to
     * hang a pack off. Also refused, also logged: silently dropping the
     * operator's input is how a form comes to lie about what it saved.
     */
    async writeBattery(battery: DeviceBattery | null) {
      const row = await plant();
      const existing = await deps.store.readPlantBatteries(row.id);
      if (existing.length > 1) {
        deps.logger.warn(
          "the plant has more than one battery ({count} packs), so the plant-level battery cannot be written back — edit each device's pack instead",
          { count: existing.length },
        );
        return;
      }
      const target = existing[0]?.deviceId ?? (await packOwner());
      if (target === null) {
        deps.logger.warn(
          "no device to attach the battery to — the plant's inverter has not been provisioned yet, so the storage description was not saved",
        );
        return;
      }
      if (battery === null) await deps.store.deleteDeviceBattery(target);
      else await deps.store.upsertDeviceBattery(target, battery);
      invalidate();
    },
    invalidate,
  };
}
