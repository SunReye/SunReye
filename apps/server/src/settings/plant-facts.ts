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
import type { DeviceRecord, PlantPatch, PlantRecord } from "@SunReye/db/plant-repo";

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
  /**
   * The pack voltage the device rows STATE, or null when they cannot agree.
   *
   * Not `battery().nominalV`, which is the aggregate's — and the aggregate takes
   * "the first stated value" across packs, an arbitrary pick when two packs
   * disagree (`@SunReye/db/batteries` says as much: mixed voltages are a
   * configuration the derivation cannot express, and averaging them would hide
   * that rather than leave it visible).
   *
   * An arbitrary pick is acceptable in a forecast and is not acceptable here: the
   * peak-shaving engine multiplies this by an amp figure and writes the result to
   * a charge-current register on a real battery. So a disagreement reads as
   * "cannot say" and the engine falls back to what the operator stated
   * explicitly, rather than to whichever pack row happened to sort first.
   */
  packNominalV(): Promise<number | null>;
  /**
   * The plant's ACTIVE device rows, for the forecast input that is composed
   * from every inverter's PV description. Cached with the rest.
   */
  devices(): Promise<readonly DeviceRecord[]>;
  /** Update only the named columns, then drop the cache. */
  patch(patch: PlantPatch): Promise<void>;
  /** Drop every cached value. */
  invalidate(): void;
}

export function createPlantFacts(deps: PlantFactsDeps): PlantFacts {
  /**
   * The in-flight or resolved row, so concurrent first callers share one
   * provisioning rather than racing two `ensurePlant` calls. Held as the PROMISE
   * for that reason, not as the value.
   */
  let plantPromise: Promise<PlantRecord> | null = null;
  let packsPromise: Promise<readonly DeviceBattery[]> | null = null;
  let devicesPromise: Promise<readonly DeviceRecord[]> | null = null;

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

  function devices(): Promise<readonly DeviceRecord[]> {
    devicesPromise ??= plant()
      .then((row) => deps.store.readDevices(row.id))
      .catch((error: unknown) => {
        devicesPromise = null;
        throw error;
      });
    return devicesPromise;
  }

  function invalidate(): void {
    plantPromise = null;
    packsPromise = null;
    devicesPromise = null;
  }

  return {
    plant,
    devices,
    async battery() {
      return plantBatteryFrom(await packs());
    },
    async packNominalV() {
      const stated = new Set(
        (await packs()).map((p) => p.nominalV).filter((v): v is number => v !== null),
      );
      // A Set, so two packs stating the SAME voltage is one answer given twice
      // rather than a disagreement — refusing that would drop a two-pack plant to
      // the legacy default for no reason. A silent pack does not veto a stated
      // one either: nothing about it contradicts the value.
      return stated.size === 1 ? ([...stated][0] ?? null) : null;
    },
    async patch(patch: PlantPatch) {
      const row = await plant();
      await deps.store.updatePlant(row.id, patch);
      invalidate();
    },
    invalidate,
  };
}
