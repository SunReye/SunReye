/**
 * Dashboard visibility preferences (hidden metrics/groups), cached in memory
 * and invalidated on write. Persisted via the shared `app_settings` accessor.
 */

import { UI_PREFS_KEY, defaultUiPrefs, uiPrefsSchema } from "@SunReye/db/ui-prefs";
import { cachedSetting } from "./app-settings";

const uiPrefs = cachedSetting(UI_PREFS_KEY, uiPrefsSchema, defaultUiPrefs);

/** Active visibility preferences, falling back to "nothing hidden" when unset. */
export const getUiPrefs = uiPrefs.get;

/** Validate and persist the visibility preferences (upsert), refreshing the cache. */
export const setUiPrefs = uiPrefs.set;
