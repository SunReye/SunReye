/**
 * Runtime log level, persisted in `app_settings` and hot-applied to LogTape
 * via {@link applyLogLevel} — no restart. `level: null` follows the boot
 * default (`LOG_LEVEL` env var, else NODE_ENV-based).
 */

import { LOGGING_KEY, defaultLogging, loggingConfigSchema } from "@SunReye/db/logging-config";
import { cachedSetting } from "./app-settings";
import { applyLogLevel, currentLogLevel, defaultLogLevel } from "../shared/logging";

const logging = cachedSetting(LOGGING_KEY, loggingConfigSchema, defaultLogging);

/** Stored config plus the level actually in effect (for the settings UI). */
export async function getLoggingConfig() {
  const stored = await logging.get();
  return { ...stored, effective: currentLogLevel(), default: defaultLogLevel() };
}

/** Validate, persist, and immediately apply the level. */
export async function setLoggingConfig(input: unknown) {
  const stored = await logging.set(input);
  applyLogLevel(stored.level);
  return { ...stored, effective: currentLogLevel(), default: defaultLogLevel() };
}

/** Apply the persisted level at boot (once the database is reachable). */
export async function initLogLevel(): Promise<void> {
  applyLogLevel((await logging.get()).level);
}
