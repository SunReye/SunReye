/**
 * Display preferences (clock format, time zone), cached in memory and
 * invalidated on write. Persisted via the shared `app_settings` accessor.
 */

import { DISPLAY_KEY, defaultDisplay, displayConfigSchema } from "@SunReye/db/display";
import { cachedSetting } from "./app-settings";

const display = cachedSetting(DISPLAY_KEY, displayConfigSchema, defaultDisplay);

/** Active display config, falling back to locale-following defaults when unset. */
export const getDisplay = display.get;

/** Validate and persist the display config (upsert), refreshing the cache. */
export const setDisplay = display.set;
