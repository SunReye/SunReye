// A weather code (ADR 23) as its word: the WMO codes Open-Meteo serves, each named in the viewer's
// language. The one table of them: Explore's bands and the dashboard's weather cell read it.
import { m } from "./paraglide/messages.js";
import type { Locale } from "./paraglide/runtime.js";

/** Every code of Open-Meteo's table, in its order. Codes 0 to 3 are the sky's words (ADR 23). */
export const WEATHER_CODES: ReadonlyMap<number, typeof m.wmo_0> = new Map([
  [0, m.wmo_0],
  [1, m.wmo_1],
  [2, m.wmo_2],
  [3, m.wmo_3],
  [45, m.wmo_45],
  [48, m.wmo_48],
  [51, m.wmo_51],
  [53, m.wmo_53],
  [55, m.wmo_55],
  [56, m.wmo_56],
  [57, m.wmo_57],
  [61, m.wmo_61],
  [63, m.wmo_63],
  [65, m.wmo_65],
  [66, m.wmo_66],
  [67, m.wmo_67],
  [71, m.wmo_71],
  [73, m.wmo_73],
  [75, m.wmo_75],
  [77, m.wmo_77],
  [80, m.wmo_80],
  [81, m.wmo_81],
  [82, m.wmo_82],
  [85, m.wmo_85],
  [86, m.wmo_86],
  [95, m.wmo_95],
  [96, m.wmo_96],
  [97, m.wmo_97],
  [99, m.wmo_99],
]);

/** A code's word in the locale in use, or in `locale`; null for a code the table lacks. */
export function weatherWord(code: number, locale?: Locale): string | null {
  return WEATHER_CODES.get(code)?.({}, locale && { locale }) ?? null;
}
