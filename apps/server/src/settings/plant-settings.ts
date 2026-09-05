/**
 * Plant (site) config — the physical plant zone that drives server-side
 * energy/cost/statistics bucketing — cached in memory and invalidated on write.
 * Persisted via the shared `app_settings` accessor. See {@link getPlantTimeZone}
 * in ./display-settings for the resolved zone the SQL layer uses.
 */

import { PLANT_KEY, defaultPlant, plantConfigSchema } from "@SunReye/db/plant";
import { cachedSetting } from "./app-settings";

const plant = cachedSetting(PLANT_KEY, plantConfigSchema, defaultPlant);

/** Active plant config, falling back to `"auto"` (→ host zone) when unset. */
export const getPlant = plant.get;

/** Validate and persist the plant config (upsert), refreshing the cache. */
export const setPlant = plant.set;
