// The scene's weather at an instant (ADR 23 "Scene weather"): how far the fog closes in, how wet
// the ground is, whether snow lies and covers the modules, and thunder. Pure: the studio and the
// drawn scene apply it, and nothing here moves.
import type { Weather } from "../weather/weather.ts";
import { smoothstep } from "./colour.ts";

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
  /** The sun's elevation in degrees; null where the plant's location is unknown. */
  readonly elevation: number | null;
  /** The measured PV power's share of the plant's peak, 0 to 1; null without a reading. */
  readonly share: number | null;
}

/** Clear and dry: an instant without weather. */
export const DRY: SceneWeather = { fog: 0, wet: 0, snow: false, covered: false, thunder: false };

const UNKNOWN: Plant = { elevation: null, share: null };

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
function coveredBy({ clearness }: Weather, snow: boolean, { elevation, share }: Plant): boolean {
  const risen = elevation !== null && elevation >= SUN;
  const idle = share !== null && share < NOTHING;

  return snow && clearness === null && risen && idle;
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
