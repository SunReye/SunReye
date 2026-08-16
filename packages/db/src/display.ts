/**
 * Display preferences — how the web app renders dates and times. Stored in
 * `app_settings` under the key {@link DISPLAY_KEY} and validated with
 * {@link displayConfigSchema} on read/write. A single instance-wide setting
 * (shared across users and devices), mirroring the tariff/MQTT config pattern.
 *
 * This is a *viewer render* preference (`timeZone: "auto"` follows the browser).
 * The *server-side* plant zone that drives energy/cost bucketing lives separately
 * in {@link ./plant} — see the note there on why the two must not be conflated.
 */

import { z } from "zod";
import { timeZoneField } from "./time-zone";

/** `app_settings.key` under which the display config is stored. */
export const DISPLAY_KEY = "display";

export const displayConfigSchema = z.object({
  /**
   * Clock format for times: `auto` follows the locale, `12h`/`24h` force
   * `hour12` on/off regardless of locale.
   */
  hourCycle: z.enum(["auto", "12h", "24h"]).default("auto"),
  /**
   * IANA time zone (e.g. `Europe/Berlin`) all timestamps render in, or `"auto"`
   * to follow the viewer's system zone.
   */
  timeZone: timeZoneField,
});
export type DisplayConfig = z.infer<typeof displayConfigSchema>;

/** Locale-following defaults used before a preference is configured. */
export const defaultDisplay: DisplayConfig = displayConfigSchema.parse({});
