// The scene's weather at an instant (ADR 23 "Scene weather"): how far the fog closes in, how wet
// the ground is, whether snow lies and covers the modules, thunder, and what falls. Pure: the studio and the
// drawn scene apply it, and nothing here moves. Its consumer reads it from a weather series.
import type { Point } from "../builder/pv.ts";
import { mix } from "./colour.ts";
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

/** Metres of visibility where fog starts to show and where it is whole; between, it thickens by
 * the visibility's logarithm, as the eye judges distance. */
const VISIBILITY = { clear: 10_000, fog: 200 };

/** The fog, 0 to 1, of `metres` of visibility. */
export function fogAt(metres: number): number {
  const span = Math.log(VISIBILITY.clear / VISIBILITY.fog);

  return Math.min(1, Math.max(0, Math.log(VISIBILITY.clear / Math.max(metres, 1)) / span));
}

/** The metres of visibility a `fog` of 0 to 1 stands for: `fogAt` the other way. */
export function fogMetres(fog: number): number {
  return VISIBILITY.clear * (VISIBILITY.fog / VISIBILITY.clear) ** Math.min(1, Math.max(0, fog));
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

/** The `weather`'s light alone (ADR 23 "Off switch"): thunder darkens the day, and nothing of
 * the weather is drawn. */
export function lightAlone({ thunder }: SceneWeather): SceneWeather {
  return { ...DRY, thunder };
}

/** The `weather` as it is edited under (ADR 23 "Builder"): without fog, wet ground, what falls
 * and the glass, so faces and edges stay exact. Lying snow stays. */
export function exact(weather: SceneWeather): SceneWeather {
  return { ...weather, fog: 0, wet: 0, falling: null, glass: null };
}
