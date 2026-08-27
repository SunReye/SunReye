/**
 * Display preferences (clock format, time zone), cached in memory and
 * invalidated on write. Persisted via the shared `app_settings` accessor.
 */

import { DISPLAY_KEY, defaultDisplay, displayConfigSchema } from "@SunReye/db/display";
import { resolveServerZone } from "@SunReye/db/plant";
import { cachedSetting } from "./app-settings";
import { getPlant } from "./plant-settings";

const display = cachedSetting(DISPLAY_KEY, displayConfigSchema, defaultDisplay);

/** Active display config, falling back to locale-following defaults when unset. */
export const getDisplay = display.get;

/** Validate and persist the display config (upsert), refreshing the cache. */
export const setDisplay = display.set;

/**
 * The concrete IANA zone the server buckets plant-local periods in: the explicit
 * plant zone, else an explicit (legacy) display zone, else the host — see
 * {@link resolveServerZone} (issues #46, #52). The single source of the plant
 * zone for the energy/cost/statistics SQL.
 */
export async function getPlantTimeZone(): Promise<string> {
  const hostZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [plant, display] = await Promise.all([getPlant(), getDisplay()]);
  return resolveServerZone(plant.timeZone, display.timeZone, hostZone);
}
