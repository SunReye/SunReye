// The scene's weather at an instant (ADR 23 "Scene weather"): how far the fog closes in, how wet
// the ground is, whether snow lies and covers the modules, and thunder. Pure: the studio and the
// drawn scene apply it, and nothing here moves.
import type { Point } from "../builder/pv.ts";
import type { Weather } from "../weather/weather.ts";
import { mix, smoothstep } from "./colour.ts";
import type { Triple } from "./tone.ts";

export interface SceneWeather {
  /** How far the distance fog closes in toward grey, 0 to 1. */
  readonly fog: number;
  /** How wet the ground and roofs are: 1 while it falls, drying to 0. */
  readonly wet: number;
  /** Snow lies on the ground and roofs. */
  readonly snow: boolean;
  /** Snow covers the modules. */
  readonly covered: boolean;
  /** A thunderstorm darkens the sky. */
  readonly thunder: boolean;
}

/** What the plant tells of an instant, which no weather series does. */
export interface Plant {
  /** Toward the sun: east, north, up; null where the plant's location is unknown. */
  readonly sun: Point | null;
  /** The measured PV power's share of the plant's peak, 0 to 1; null without a reading. */
  readonly share: number | null;
}

/** Clear and dry: an instant without weather. */
export const DRY: SceneWeather = { fog: 0, wet: 0, snow: false, covered: false, thunder: false };

const UNKNOWN: Plant = { sun: null, share: null };

/** Metres of visibility where fog starts to show and where it is whole; between, it thickens by
 * the visibility's logarithm, as the eye judges distance. */
const VISIBILITY = { clear: 10_000, fog: 200 };

/** Fog by definition: a kilometre of visibility at most. The archive has the code alone. */
const FOG_CODE_METRES = 1000;

/** The ground dries over about an hour. */
const DRIES = 3_600_000;

/** Metres of snow depth from which snow lies, as in the core. */
const SNOW_DEPTH = 0.01;

/**
 * Degrees of sun from which missing clear-sky indices tell of snow. The core measures none under
 * 5°, and the index that stands for an instant is of a quarter up to 35 minutes before it, when
 * the sun was lower.
 */
const SUN = 10;

/** Under this share of its peak the plant makes next to nothing. The core's own bound is 5 % of
 * the clear-sky estimate, which is never over the peak. */
const NOTHING = 0.05;

function fogAt(metres: number): number {
  const span = Math.log(VISIBILITY.clear / VISIBILITY.fog);

  return Math.min(1, Math.max(0, Math.log(VISIBILITY.clear / Math.max(metres, 1)) / span));
}

function fogOf({ code, visibility }: Weather): number {
  const coded = code === 45 || code === 48 ? FOG_CODE_METRES : Infinity;

  return fogAt(Math.min(visibility ?? Infinity, coded));
}

/**
 * Snow covers the modules: the core stores no clear-sky index while it does (ADR 23), so snow
 * lies, the core measured no sky though the sun is well up, and the plant reads next to nothing.
 */
function coveredBy({ clearness }: Weather, snow: boolean, { sun, share }: Plant): boolean {
  const risen = sun !== null && sun[2] >= Math.sin((SUN * Math.PI) / 180);
  const idle = share !== null && share < NOTHING;

  return snow && clearness === null && risen && idle;
}

/** Thick fog as it lands on screen, by theme: linear grey, a little cool. */
const GREY = {
  light: [0.42, 0.44, 0.47],
  dark: [0.05, 0.055, 0.062],
} as const;

/** The distance fog's colour, linear and as tone mapped: the `page`'s in clear air, grey `fog`
 * of the way. */
export function fogColour(page: Triple, dark: boolean, fog: number): [number, number, number] {
  const grey = dark ? GREY.dark : GREY.light;

  return [mix(page[0], grey[0], fog), mix(page[1], grey[1], fog), mix(page[2], grey[2], fog)];
}

/** The scene's weather for the `weather` at an instant and what the `plant` reads then. */
export function sceneWeather(weather: Weather, plant: Plant = UNKNOWN): SceneWeather {
  const { code, dry, snowDepth } = weather;
  const snow = snowDepth !== null && snowDepth >= SNOW_DEPTH;

  return {
    fog: fogOf(weather),
    wet: dry === null ? 0 : 1 - smoothstep(0, DRIES, dry),
    snow,
    covered: coveredBy(weather, snow, plant),
    thunder: code !== null && code >= 95 && code <= 99,
  };
}
