/**
 * Display preferences — how the web app renders dates and times. Stored in
 * `app_settings` under the key {@link DISPLAY_KEY} and validated with
 * {@link displayConfigSchema} on read/write. A single instance-wide setting
 * (shared across users and devices), mirroring the tariff/MQTT config pattern.
 */

import { z } from "zod";

/** `app_settings.key` under which the display config is stored. */
export const DISPLAY_KEY = "display";

/** `"auto"` sentinel = follow the viewer's system time zone. */
const TIME_ZONE_AUTO = "auto";

/** True when `tz` is a time zone the runtime's Intl implementation accepts. */
function isValidTimeZone(tz: string): boolean {
  try {
    // Constructing with an unknown zone throws a RangeError.
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const displayConfigSchema = z.object({
  /**
   * Clock format for times: `auto` follows the locale, `12h`/`24h` force
   * `hour12` on/off regardless of locale.
   */
  hourCycle: z.enum(["auto", "12h", "24h"]).default("auto"),
  /**
   * IANA time zone (e.g. `Europe/Berlin`) all timestamps render in, or
   * {@link TIME_ZONE_AUTO} to follow the viewer's system zone.
   */
  timeZone: z
    .string()
    .refine((tz) => tz === TIME_ZONE_AUTO || isValidTimeZone(tz), "unknown time zone")
    .default(TIME_ZONE_AUTO),
});
export type DisplayConfig = z.infer<typeof displayConfigSchema>;

/** Locale-following defaults used before a preference is configured. */
export const defaultDisplay: DisplayConfig = displayConfigSchema.parse({});

/**
 * The concrete IANA zone the server buckets plant-local energy/cost/statistics
 * periods in. An explicit `timeZone` wins; `"auto"` falls back to `hostZone`
 * (the process zone) so an unconfigured instance behaves exactly as before.
 *
 * Server-side SQL has no viewer to follow, so a mis-zoned host silently filed
 * periods against the wrong calendar day (issues #46, #52). Setting Display →
 * time zone to an explicit zone now also fixes server bucketing, from one knob.
 */
export function resolvePlantTimeZone(config: DisplayConfig, hostZone: string): string {
  return config.timeZone === TIME_ZONE_AUTO ? hostZone : config.timeZone;
}
