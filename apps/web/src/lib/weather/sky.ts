// The sky in a word (ADR 23 "Dashboard"): what the weather code says falls or hangs, else how
// closed the sky is. Pure.
import { codeKind } from "../weather-code.ts";
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

/** The codes 0 to 3: clear, mainly clear, partly cloudy, overcast. */
const BY_CODE: readonly Sky[] = ["sunny", "fair", "cloudy", "overcast"];

function byCloud(cloud: number): Sky {
  if (cloud >= OVERCAST) return "overcast";

  if (cloud >= CLOUDY) return "cloudy";

  return cloud >= FAIR ? "fair" : "sunny";
}

/** How open a dry sky is: by its cloud, else by its code. */
function openness(code: number | null, cloud: number | null): Sky | null {
  if (cloud !== null) return byCloud(cloud);

  return BY_CODE[code ?? -1] ?? null;
}

/** The word for `weather`'s sky; null where neither a code nor a cloud value tells. */
export function skyOf({ code, cloud, ghi }: Pick<Weather, "code" | "cloud" | "ghi">): Sky | null {
  const wet = codeKind(code);

  if (wet !== null) return wet;

  const open = openness(code, cloud);
  const night = ghi !== null && ghi < DARK;

  return night && (open === "sunny" || open === "fair") ? "clear" : open;
}
