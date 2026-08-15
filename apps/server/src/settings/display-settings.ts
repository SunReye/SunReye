/**
 * Display preferences (clock format, time zone), cached in memory and
 * invalidated on write. Persisted via the shared `app_settings` accessor.
 */

import {
  DISPLAY_KEY,
  defaultDisplay,
  displayConfigSchema,
  resolvePlantTimeZone,
} from "@SunReye/db/display";
import { cachedSetting } from "./app-settings";

const display = cachedSetting(DISPLAY_KEY, displayConfigSchema, defaultDisplay);

/** Active display config, falling back to locale-following defaults when unset. */
export const getDisplay = display.get;

/** Validate and persist the display config (upsert), refreshing the cache. */
export const setDisplay = display.set;

/**
 * The concrete IANA zone the server buckets plant-local periods in: the display
 * config's explicit `timeZone`, or the host process zone when it is `"auto"`.
 * The single source of the plant zone for the energy/cost/statistics SQL — see
 * {@link resolvePlantTimeZone} (issues #46, #52).
 */
export async function getPlantTimeZone(): Promise<string> {
  const hostZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return resolvePlantTimeZone(await getDisplay(), hostZone);
}
