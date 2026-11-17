// The sky in a word (ADR 23 "Dashboard"): what the weather code says falls or hangs, else how
// closed the sky is. Pure.
import { DARK, type Weather } from "./weather.ts";

export type Sky =
  | "sunny"
  | "fair"
  | "cloudy"
  | "overcast"
  /** An open sky at night. */
  | "clear"
  | "fog"
  | "drizzle"
  | "rain"
  | "snow"
  | "showers"
  | "thunder";

/** The cloud from which the sky is fair, cloudy and overcast: the scene's light closes its sky
 * at the last (`light.ts`). */
const FAIR = 0.45;
const CLOUDY = 0.65;
const OVERCAST = 0.85;

/** WMO weather codes from each first code on, as Open-Meteo serves them; the codes under 45
 * only tell the cloud. */
const CODES: readonly (readonly [number, Sky | null])[] = [
  [95, "thunder"],
  [87, null],
  [85, "snow"],
  [80, "showers"],
  [71, "snow"],
  [61, "rain"],
  [51, "drizzle"],
  [45, "fog"],
];

/** The codes 0 to 3: clear, mainly clear, partly cloudy, overcast. */
const BY_CODE: readonly Sky[] = ["sunny", "fair", "cloudy", "overcast"];

function byCloud(cloud: number): Sky {
  if (cloud >= OVERCAST) return "overcast";

  if (cloud >= CLOUDY) return "cloudy";

  return cloud >= FAIR ? "fair" : "sunny";
}

/** The word for `weather`'s sky; null where neither a code nor a cloud value tells. */
export function skyOf({ code, cloud, ghi }: Weather): Sky | null {
  const falling = CODES.find(([first]) => code !== null && code >= first)?.[1] ?? null;

  if (falling !== null) return falling;

  const open = cloud === null ? (BY_CODE[code ?? -1] ?? null) : byCloud(cloud);
  const night = ghi !== null && ghi < DARK;

  return night && (open === "sunny" || open === "fair") ? "clear" : open;
}
