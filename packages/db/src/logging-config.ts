/**
 * Runtime logging config — the server log level, adjustable from the UI.
 * Stored in `app_settings` under {@link LOGGING_KEY} and validated with
 * {@link loggingConfigSchema} on read/write. A single instance-wide setting,
 * mirroring the display/tariff config pattern.
 */

import { z } from "zod";

/** `app_settings.key` under which the logging config is stored. */
export const LOGGING_KEY = "logging";

/** LogTape severities, lowest first (mirrors LogTape's `LogLevel`). */
export const LOG_LEVELS = ["trace", "debug", "info", "warning", "error", "fatal"] as const;
export type StoredLogLevel = (typeof LOG_LEVELS)[number];

export const loggingConfigSchema = z.object({
  /**
   * Lowest severity the server emits, or `null` to follow the boot default
   * (`LOG_LEVEL` env var, else debug in development / info otherwise).
   */
  level: z.enum(LOG_LEVELS).nullable().default(null),
});
export type LoggingConfig = z.infer<typeof loggingConfigSchema>;

/** Follow-the-environment default used before a level is configured. */
export const defaultLogging: LoggingConfig = loggingConfigSchema.parse({});
