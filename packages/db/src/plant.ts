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
 * Stored in `plants` since 2.0.0 — one column per fact
 * (`./schema/plants.ts`). {@link PLANT_KEY} is retained as the name of the 1.x
 * `app_settings` row, which `apps/server/src/inverter/provision.ts` still probes
 * once, to seed the columns from whatever an upgrading install had set.
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
  /**
   * The plant's user-facing label. Editable, always — and OPTIONAL on a write.
   *
   * `plants.name` and `plants.slug` are separate columns for one reason: the slug
   * becomes the MQTT namespace (`<prefix>/<plant-slug>/<device-slug>/<topic>`)
   * and Home Assistant keys its entities on `unique_id`, so changing it would
   * orphan every discovered entity and every retained topic. It is frozen at
   * onboarding; this is the field that exists so it never has to move.
   *
   * Optional because absent means "leave it alone": the Display form sends the
   * time zone alone, and a required name there would make saving a zone either
   * fail or blank the plant's label. Never `""` — see `plantPatchFrom`.
   */
  name: z.string().trim().min(1).max(120).optional(),
});
export type PlantConfig = z.infer<typeof plantConfigSchema>;

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

/**
 * The plant config as a column patch.
 *
 * Deliberately narrow: `timeZone` and `name`, and nothing else this shape could
 * ever grow into a slug. Renaming a plant must stay a NAME-only operation —
 * `plants.slug` is the MQTT namespace and is frozen at onboarding — and the way
 * to guarantee that is for the write path to have no expression for it.
 *
 * `name` is included only when it was sent. An `undefined` here means the
 * `UPDATE` never names the column, which is what lets two forms edit two facts
 * about one plant without either writing back the other's stale value.
 */
export function plantPatchFrom(config: PlantConfig): {
  timeZone: string;
  name?: string;
} {
  return {
    timeZone: config.timeZone,
    ...(config.name === undefined ? {} : { name: config.name }),
  };
}
