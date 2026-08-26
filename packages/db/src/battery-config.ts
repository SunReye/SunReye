/**
 * What the battery is, as opposed to what it is doing.
 *
 * Stored in `app_settings` under {@link BATTERY_KEY} — one instance-wide record,
 * like display and tariff. Only one field for now: the nameplate.
 *
 * Neither supported inverter family reports a pack capacity, an SOH or a cycle
 * count, so state of health is measured against a reference the app has to get
 * from somewhere. Two references exist, and this is the better one: the
 * manufacturer's rating, which is what "90 % healthy" is normally understood to
 * mean. Without it the app falls back to its own first solid measurement, which
 * tracks degradation from the day SunReye met the pack but cannot say how far
 * the pack already was from factory.
 *
 * Optional on purpose. Requiring it would hide the whole feature from everyone
 * who never fills it in, and the fallback is genuinely useful on its own.
 *
 * A flat record, never a discriminated union: `readSetting` safe-parses to the
 * default with no log, so one stale field in a union resets the whole object
 * silently.
 */

import { z } from "zod";

/** `app_settings.key` under which the battery record is stored. */
export const BATTERY_KEY = "battery";

export const batteryConfigSchema = z.object({
  /**
   * Manufacturer's rated usable capacity in kWh, or null when not stated.
   *
   * `.catch(null)` for the same reason the palette catches: a value that fails
   * to parse must degrade to "not stated" — which the app handles — rather than
   * fail the object parse and silently reset every other field beside it.
   *
   * The upper bound is a typo guard, not a product limit: someone entering watt
   * hours instead of kilowatt hours should be rejected at the form rather than
   * produce an SOH of 0.001 %.
   */
  nameplateKwh: z.number().positive().max(10_000).nullable().catch(null).default(null),
});

export type BatteryConfig = z.infer<typeof batteryConfigSchema>;

/** What an instance that has never stated a nameplate reads as. */
export const defaultBatteryConfig: BatteryConfig = batteryConfigSchema.parse({});
