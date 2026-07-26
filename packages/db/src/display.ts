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
