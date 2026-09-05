/**
 * Plant (site) configuration — physical facts about the installation the SERVER
 * needs, independent of any viewer. Currently just the plant's IANA time zone,
 * which drives all server-side energy/cost/statistics period bucketing.
 *
 * Distinct from {@link ./display}'s `timeZone`: that is a per-viewer *render*
 * preference (`"auto"` = follow the browser), meaningless on the server where
 * there is no viewer. Bucketing a fixed plant's days/tariff/records by whoever
 * happens to be looking would make two viewers disagree on the same history, so
 * the plant zone is one instance-wide value (issues #46, #52).
 *
 * Stored in `app_settings` under {@link PLANT_KEY}.
 */

import { z } from "zod";
import { TIME_ZONE_AUTO, timeZoneField } from "./time-zone";

/** `app_settings.key` under which the plant config is stored. */
export const PLANT_KEY = "plant";

export const plantConfigSchema = z.object({
  /**
   * IANA time zone (e.g. `Europe/Berlin`) the server buckets plant-local periods
   * in, or {@link TIME_ZONE_AUTO} to fall back to the host process zone.
   */
  timeZone: timeZoneField,
});
export type PlantConfig = z.infer<typeof plantConfigSchema>;

/** Defaults used before a plant zone is configured (`"auto"` → host). */
export const defaultPlant: PlantConfig = plantConfigSchema.parse({});

/**
 * The concrete IANA zone the server buckets plant-local periods in, in priority
 * order:
 *
 * 1. the explicit plant zone, once an operator sets it;
 * 2. else an explicit *display* zone — legacy inheritance: before this dedicated
 *    setting existed, an instance-wide Display → time zone drove server bucketing
 *    (PR #54 for #46/#52). Honouring it keeps those instances correct without a
 *    data migration, until the plant zone is set explicitly and takes over;
 * 3. else the host process zone — server SQL has no viewer to follow, so an
 *    otherwise-unconfigured instance behaves as it always has.
 *
 * `displayZone` is the instance-wide display pref (also `"auto"` when unset), not
 * a per-viewer value, so an explicit one is a sound plant-zone proxy.
 */
export function resolveServerZone(
  plantZone: string,
  displayZone: string,
  hostZone: string,
): string {
  if (plantZone !== TIME_ZONE_AUTO) return plantZone;
  if (displayZone !== TIME_ZONE_AUTO) return displayZone;
  return hostZone;
}
