// The scene's weather at an instant (ADR 23 "Scene weather"): how far the fog closes in, how wet
// the ground is, whether snow lies and covers the modules, thunder, and what falls. Pure: the studio and the
// drawn scene apply it, and nothing here moves.
import type { Point } from "../builder/pv.ts";
import { codeKind } from "../weather-code.ts";
import { snowLies, type Weather } from "../weather/weather.ts";
import { mix, smoothstep } from "./colour.ts";
import type { Triple } from "./tone.ts";

/** Rain or snow in the air. */
export interface Falling {
  readonly kind: "rain" | "snow";
  /** How much of the whole field falls, above 0 to 1. */
  readonly density: number;
  /** Metres a second the wind carries it: east, north. */
  readonly wind: readonly [number, number];
}

/** What is on the lens, each 0 to 1. */
export interface Glass {
  /** Rain that beads and runs. */
  readonly rain: number;
  /** Snow that settles at the edges and melts. */
  readonly snow: number;
  /** Frost that creeps in from the corners. */
  readonly frost: number;
}

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
  /** What falls; null while it is dry. */
  readonly falling: Falling | null;
  /** What is on the lens; null while it is clear. */
  readonly glass: Glass | null;
}

/** What the plant tells of an instant, which no weather series does. */
export interface Plant {
  /** Toward the sun: east, north, up; null where the plant's location is unknown. */
  readonly sun: Point | null;
  /** The measured PV power's share of the plant's peak, 0 to 1; null without a reading. */
  readonly share: number | null;
}

/** Clear and dry: an instant without weather. */
export const DRY: SceneWeather = {
  fog: 0,
  wet: 0,
  snow: false,
  covered: false,
  thunder: false,
  falling: null,
  glass: null,
};

const UNKNOWN: Plant = { sun: null, share: null };

/** Metres of visibility where fog starts to show and where it is whole; between, it thickens by
 * the visibility's logarithm, as the eye judges distance. */
const VISIBILITY = { clear: 10_000, fog: 200 };

/** Fog by definition: a kilometre of visibility at most. The archive has the code alone. */
const FOG_CODE_METRES = 1000;

/** The ground dries over about an hour. */
const DRIES = 3_600_000;

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
  const coded = codeKind(code) === "fog" ? FOG_CODE_METRES : Infinity;

  return fogAt(Math.min(visibility ?? Infinity, coded));
}

/**
 * Snow covers the modules: the core stores no clear-sky index while it does (ADR 23), so snow
 * lies, the core measured no sky though the sun is well up, and the plant reads next to nothing.
 */
function coveredBy({ clearSkyIndex }: Weather, snow: boolean, { sun, share }: Plant): boolean {
  const risen = sun !== null && sun[2] >= Math.sin((SUN * Math.PI) / 180);
  const idle = share !== null && share < NOTHING;

  return snow && clearSkyIndex === null && risen && idle;
}

/** The amounts from which the whole field falls: mm/h of rain, cm/h of snow. */
const WHOLE = { rain: 8, snow: 3 };

/** `value` to the nearest `step`: what falls changes only where it would show, so the scene is
 * not lit anew for less. */
const stepped = (value: number, step: number): number => Math.round(value / step) * step + 0;

/** By the amount's root: drizzle shows, and a downpour is not ten times a shower. */
function densityOf(amount: number, whole: number): number {
  return Math.min(1, Math.max(0.1, stepped(Math.sqrt(amount / whole), 0.05)));
}

/** Where the wind carries what falls: away from where it blows from. */
function carried({ wind, windDirection }: Weather): [number, number] {
  if (wind === null || windDirection === null) return [0, 0];

  const from = (windDirection * Math.PI) / 180;

  return [stepped(-Math.sin(from) * wind, 0.5), stepped(-Math.cos(from) * wind, 0.5)];
}

/** Snow while snow falls, whose water the precipitation counts too; else rain. */
function fallingOf(weather: Weather): Falling | null {
  const snowfall = weather.snowfall ?? 0;
  const rain = weather.precipitation ?? 0;

  if (snowfall <= 0 && rain <= 0) return null;

  return snowfall > 0
    ? { kind: "snow", density: densityOf(snowfall, WHOLE.snow), wind: carried(weather) }
    : { kind: "rain", density: densityOf(rain, WHOLE.rain), wind: carried(weather) };
}

/** Frost forms from a little above freezing, the lens being colder than the air, and is whole
 * three degrees under; the air is humid enough from 70 % and wholly so at 90 %. The ADR gives
 * "about 0 °C in humid air": the spans are where frost would be seen on a window. */
const FROST = { celsius: { whole: -3, none: 0.5 }, humidity: { none: 70, whole: 90 } };

function frostOf({ celsius, humidity }: Weather): number {
  if (celsius === null || humidity === null) return 0;

  const cold = 1 - smoothstep(FROST.celsius.whole, FROST.celsius.none, celsius);
  const humid = smoothstep(FROST.humidity.none, FROST.humidity.whole, humidity);

  return stepped(cold * humid, 0.1);
}

/** What falls is on the lens as densely as it falls, and frost besides. */
function glassOf(weather: Weather, falling: Falling | null): Glass | null {
  const frost = frostOf(weather);

  if (falling === null && frost === 0) return null;

  return {
    rain: falling?.kind === "rain" ? falling.density : 0,
    snow: falling?.kind === "snow" ? falling.density : 0,
    frost,
  };
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
  const snow = snowLies(snowDepth);
  const falling = fallingOf(weather);

  return {
    fog: fogOf(weather),
    wet: dry === null ? 0 : 1 - smoothstep(0, DRIES, dry),
    snow,
    covered: coveredBy(weather, snow, plant),
    thunder: codeKind(code) === "thunder",
    falling,
    glass: glassOf(weather, falling),
  };
}

/** The `weather`'s light alone (ADR 23 "Off switch"): thunder darkens the day, and nothing of
 * the weather is drawn. */
export function lightAlone({ thunder }: SceneWeather): SceneWeather {
  return { ...DRY, thunder };
}

/** The `weather` as it is edited under (ADR 23 "Builder"): without fog, what falls and the
 * glass, so faces and edges stay exact. */
export function exact(weather: SceneWeather): SceneWeather {
  return { ...weather, fog: 0, falling: null, glass: null };
}
