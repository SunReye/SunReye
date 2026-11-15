// How diffuse the sky's light is at an instant (ADR 20 Look), from the weather device's forecast
// (ADR 17): the scene's clouds. Pure but for the read it is handed.
import type { Core } from "../api/core.ts";
import type { Target } from "../dashboard/today.ts";

/** The weather computed device's fixed id (ADR 15). */
const WEATHER = 4_294_967_295;

/** A forecast value is in force this long at most: its step is 15 minutes, an older store's an hour. */
const IN_FORCE = 3_600_000;

/** Global and diffuse horizontal irradiance in W/m², each from its target on. */
export interface Irradiance {
  readonly ghi: readonly Target[];
  readonly dhi: readonly Target[];
}

/** The forecast irradiance from `from` to before `to`; nothing where the core has none. */
export async function irradiance(
  core: Pick<Core, "forecasts">,
  from: Readonly<Date>,
  to: Readonly<Date>,
): Promise<Irradiance> {
  const [ghi = [], dhi = []] = await Promise.all(
    ["weather.ghi", "weather.dhi"].map(async (series) => {
      try {
        const read = await core.forecasts(WEATHER, series, from, to);

        return "points" in read ? read.points : [];
      } catch {
        return [];
      }
    }),
  );

  return { ghi, dhi };
}

/** The value in force at `at`, ms since 1970. */
function inForce(targets: readonly Target[], at: number): number | null {
  let found: number | null = null;
  let since = at - IN_FORCE;

  for (const { target, value } of targets) {
    const begun = Date.parse(target);

    if (begun > since && begun <= at) [found, since] = [value, begun];
  }

  return found;
}

/**
 * The diffuse share of the global irradiance at `at`, 0 under a clear sky to 1 under a closed one;
 * null where no forecast covers the instant or the sun gives no light to tell by.
 */
export function diffuseAt(read: Irradiance | undefined, at: number): number | null {
  const [ghi, dhi] = [inForce(read?.ghi ?? [], at), inForce(read?.dhi ?? [], at)];

  if (ghi === null || dhi === null || ghi < 1) return null;

  return Math.min(1, Math.max(0, dhi / ghi));
}
