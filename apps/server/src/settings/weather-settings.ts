/**
 * The weather/plant record, composed from the COLUMNS that now own it.
 *
 * WHAT CHANGED IN 2.0.0
 *
 * The shape did not. Around twenty call sites read `weather.forecast.*` — the
 * forecast's clipping model, the peak-shaving engine, the blocker list, three
 * routes, two settings forms — and `WeatherConfig` is the app's vocabulary for
 * "what is true about this plant". Only the STORAGE moved: the coordinates, the
 * PV arrays, the export cap, the assumed house load and the smart-meter date are
 * columns on `plants`, the battery is DERIVED from the plant's device packs, and
 * what is left in `app_settings` is the handful of fields that really are
 * preferences (see `@SunReye/db/plant-facts`).
 *
 * WHY THAT KILLS A WHOLE CLASS OF BUG
 *
 * The 1.x record was one JSONB document edited by two settings pages. A JSONB
 * save is a read-modify-write of the whole document, so saving a location wrote
 * back whatever arrays that page had loaded and the other page's edit vanished.
 * `apps/web/src/lib/components/settings/plant-fields-placement.test.ts` existed
 * to police which form was allowed to name which field, because no type could.
 *
 * Now each fact is a column and {@link setWeatherConfig} emits an `UPDATE`
 * naming ONLY the fields the incoming patch mentioned
 * (`splitWeatherWrite`). Two saves of disjoint fields cannot overwrite each
 * other, whatever either page had loaded — so the rule is enforced by the write,
 * not by a source-text guard over the forms.
 */

import {
  columnsFromPlantRow,
  composeWeatherConfig,
  movedToDevice,
  defaultWeatherPrefs,
  splitWeatherWrite,
  weatherPrefsSchema,
} from "@SunReye/db/plant-facts";
import { WEATHER_KEY, type WeatherConfig, weatherConfigSchema } from "@SunReye/db/weather";

import { cachedSetting } from "./app-settings";
import { mergeSetting } from "./merge-setting";
import { plantFacts } from "./plant-facts-instance";

/**
 * The preference remainder, still an `app_settings` row.
 *
 * Written as a WHOLE record, which is safe here for exactly the reason it was
 * not safe for the plant half: these fields have a single editor. The clobber
 * needed two pages racing over one document; one page cannot race itself.
 */
const prefs = cachedSetting(WEATHER_KEY, weatherPrefsSchema, defaultWeatherPrefs);

/**
 * The active record: preferences from `app_settings`, plant facts from the plant
 * row, battery derived from the device packs.
 *
 * Composed per call rather than cached here. The two reads underneath it are
 * cached (`./plant-facts.ts` holds the row and the packs, once, for every
 * accessor that composes over them) and the composition itself is a pure object
 * literal — so a second cache at this level would buy nothing and would need
 * invalidating from three places.
 */
export async function getWeatherConfig(): Promise<WeatherConfig> {
  const [stored, plant, battery, devices] = await Promise.all([
    prefs.get(),
    plantFacts.plant(),
    plantFacts.battery(),
    plantFacts.devices(),
  ]);
  return composeWeatherConfig(stored, columnsFromPlantRow(plant), battery, devices);
}

/**
 * Apply a partial update, routing each field to whatever owns it now.
 *
 * A patch, still, and for the original reason: this record is edited from two
 * places — its location half on the Weather page, the plant it describes with the
 * inverter — so each form sends only what it owns.
 *
 * VALIDATION IS UNCHANGED. The patch is merged onto the current record and the
 * whole thing is parsed with `weatherConfigSchema`, exactly as before, so a tilt
 * of 400 or a negative capacity is rejected the same way. What changed is that
 * the WRITE that follows names only the fields the patch itself mentioned.
 */
export async function setWeatherConfig(patch: unknown): Promise<WeatherConfig> {
  // PV arrays, panel physics and the pack describe an INVERTER now and are
  // edited on its device. Refused, not dropped: a 200 would tell a stale client
  // its save landed while the legacy plant column it wrote is read by nothing.
  const moved = movedToDevice(patch);
  if (moved !== null) {
    throw new Error(`forecast.${moved} is edited on the inverter in Settings → Devices`);
  }
  const current = await getWeatherConfig();
  const validated = weatherConfigSchema.parse(mergeSetting(current, patch));
  const split = splitWeatherWrite(patch, validated);

  await prefs.set(split.settings);
  if (Object.keys(split.columns).length > 0) await plantFacts.patch(split.columns);

  return getWeatherConfig();
}
