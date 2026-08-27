/**
 * Statistics page preferences (hidden sections/tiles + per-section options),
 * cached in memory and invalidated on write. Persisted via the shared
 * `app_settings` accessor.
 */

import {
  STATISTICS_PREFS_KEY,
  defaultStatisticsPrefs,
  statisticsPrefsSchema,
} from "@SunReye/db/statistics-prefs";
import { cachedSetting } from "./app-settings";

const statisticsPrefs = cachedSetting(
  STATISTICS_PREFS_KEY,
  statisticsPrefsSchema,
  defaultStatisticsPrefs,
);

/** Active statistics preferences, falling back to "everything visible" when unset. */
export const getStatisticsPrefs = statisticsPrefs.get;

/** Validate and persist the statistics preferences (upsert), refreshing the cache. */
export const setStatisticsPrefs = statisticsPrefs.set;
