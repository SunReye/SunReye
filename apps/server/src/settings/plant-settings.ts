/**
 * Plant (site) config — the physical plant zone that drives server-side
 * energy/cost/statistics bucketing.
 *
 * Now backed by `plants.time_zone` rather than the `app_settings.plant` row. The
 * shape ({@link PlantConfig}) and the resolution order are unchanged — see
 * `@SunReye/db/plant`'s `resolveServerZone` and {@link getPlantTimeZone} in
 * ./display-settings, both of which stay the authority — so the legacy
 * display-zone inheritance for instances that predate this setting keeps working.
 *
 * The 1.x value is carried over by provisioning, which seeds the column from the
 * raw `plant` row when it creates the plant
 * (`apps/server/src/inverter/provision.ts`). It is a seeding step rather than a
 * read-time fallback on purpose: a fallback could not tell "never set" from
 * "deliberately set back to auto".
 */

import { type PlantConfig, plantConfigSchema, plantPatchFrom } from "@SunReye/db/plant";

import { plantFacts } from "./plant-facts-instance";

/** Active plant config, falling back to `"auto"` (→ host zone) when unset. */
export async function getPlant(): Promise<PlantConfig> {
  const plant = await plantFacts.plant();
  return { timeZone: plant.timeZone, name: plant.name };
}

/**
 * Validate and persist the plant config, refreshing the cached plant row.
 *
 * Only the fields the caller sent are written (`plantPatchFrom`), so the form
 * that owns the time zone cannot blank the plant's name — and neither can name a
 * SLUG, which is frozen at onboarding because it is the MQTT namespace.
 */
export async function setPlant(input: unknown): Promise<PlantConfig> {
  const config = plantConfigSchema.parse(input);
  await plantFacts.patch(plantPatchFrom(config));
  return getPlant();
}
