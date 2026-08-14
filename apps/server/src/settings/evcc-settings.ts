/**
 * EVCC integration config (enable flag + topic root), cached in memory and
 * invalidated on write. Persisted via the shared `app_settings` accessor.
 * Broker parameters are deliberately absent — they come from the MQTT config.
 */

import { EVCC_KEY, defaultEvcc, evccConfigSchema } from "@SunReye/db/evcc-config";
import { cachedSetting } from "./app-settings";

const evcc = cachedSetting(EVCC_KEY, evccConfigSchema, defaultEvcc);

export const getEvccConfig = evcc.get;
export const setEvccConfig = evcc.set;
