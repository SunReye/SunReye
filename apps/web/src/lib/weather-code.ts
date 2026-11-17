// A weather code (ADR 23): the WMO codes Open-Meteo serves, each named in the viewer's language,
// and what each says falls or hangs. The one table and the one reading of them: Explore's bands,
// the dashboard's weather cell, the weather detail and the scene read it.
import { m } from "./paraglide/messages.js";
import type { Locale } from "./paraglide/runtime.js";

/** Every code of Open-Meteo's table, in its order. Codes 0 to 3 are the sky's words (ADR 23). */
export const WEATHER_CODES: ReadonlyMap<number, typeof m.weather_code_0> = new Map([
  [0, m.weather_code_0],
  [1, m.weather_code_1],
  [2, m.weather_code_2],
  [3, m.weather_code_3],
  [45, m.weather_code_45],
  [48, m.weather_code_48],
  [51, m.weather_code_51],
  [53, m.weather_code_53],
  [55, m.weather_code_55],
  [56, m.weather_code_56],
  [57, m.weather_code_57],
  [61, m.weather_code_61],
  [63, m.weather_code_63],
  [65, m.weather_code_65],
  [66, m.weather_code_66],
  [67, m.weather_code_67],
  [71, m.weather_code_71],
  [73, m.weather_code_73],
  [75, m.weather_code_75],
  [77, m.weather_code_77],
  [80, m.weather_code_80],
  [81, m.weather_code_81],
  [82, m.weather_code_82],
  [85, m.weather_code_85],
  [86, m.weather_code_86],
  [95, m.weather_code_95],
  [96, m.weather_code_96],
  [97, m.weather_code_97],
  [99, m.weather_code_99],
]);

/** A code's word in the locale in use, or in `locale`; null for a code the table lacks. */
export function weatherWord(code: number, locale?: Locale): string | null {
  return WEATHER_CODES.get(code)?.({}, locale && { locale }) ?? null;
}

/** What a code says falls or hangs. */
export type CodeKind = "fog" | "drizzle" | "rain" | "snow" | "showers" | "thunder";

/** The codes from each first to each last, both included; the codes under 45 only tell the cloud. */
const KINDS: readonly (readonly [number, number, CodeKind])[] = [
  [45, 48, "fog"],
  [51, 57, "drizzle"],
  [61, 67, "rain"],
  [71, 77, "snow"],
  [80, 82, "showers"],
  [85, 86, "snow"],
  [95, 99, "thunder"],
];

/** What `code` says falls or hangs; null for a dry code, one past the table or none. */
export function codeKind(code: number | null): CodeKind | null {
  if (code === null) return null;

  return KINDS.find(([first, last]) => code >= first && code <= last)?.[2] ?? null;
}
