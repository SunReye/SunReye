/**
 * What the battery is — currently just its nameplate capacity — cached in
 * memory and invalidated on write. Persisted via the shared `app_settings`
 * accessor.
 *
 * Read by the battery-health summary, which measures the pack's estimated
 * capacity against this when it is stated and against the install's own first
 * solid measurement when it is not.
 */

import { BATTERY_KEY, batteryConfigSchema, defaultBatteryConfig } from "@SunReye/db/battery-config";
import { cachedSetting } from "./app-settings";

const battery = cachedSetting(BATTERY_KEY, batteryConfigSchema, defaultBatteryConfig);

/** The instance's battery record, or the empty one when nothing is stored. */
export const getBatteryConfig = battery.get;

/** Validate and persist the battery record (upsert), refreshing the cache. */
export const setBatteryConfig = battery.set;
