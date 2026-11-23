// The scene's weather (ADR 23 "Scene weather") from an instant's weather, in the builder's own
// shape which the consumer fills (ADR 25), and what the plant reads then. Pure.
import { smoothstep } from "./colour.ts";
import { fogAt, type Falling, type Glass, type Plant, type SceneWeather } from "./weather.ts";

/** What is known of an instant's weather; null where nothing stored covers it. */
export interface Weather {
  /**
   * How closed the sky is, on the scale of the diffuse share of the global irradiance: 0 under
   * a clear sky to 1 under a closed one. The clear-sky index alone where it has a value; else
   * the diffuse share with the cloud cover while the sun gives light, and the cloud cover while
   * it gives none. Not the cloud cover itself, which an hour's `cloudCover` is.
   */
  readonly cloud: number | null;
  /** The WMO weather code. */
  readonly code: number | null;
  /** mm/h. */
  readonly precipitation: number | null;
  /** cm/h. */
  readonly snowfall: number | null;
  /** m. */
  readonly snowDepth: number | null;
  /** m; forecasts alone have it. */
  readonly visibility: number | null;
  /** m/s. */
  readonly wind: number | null;
  /** Degrees it blows from: 0 north, 90 east. */
  readonly windDirection: number | null;
  readonly celsius: number | null;
  /** Relative, in %. */
  readonly humidity: number | null;
  /** Global horizontal irradiance in W/m²: under 1 it is night. */
  readonly ghi: number | null;
  /** The clear-sky index that stands for the instant: null where the core measured none. */
  readonly clearSkyIndex: number | null;
  /** Ms since precipitation last fell, 0 while it falls; null where none fell in what was read. */
  readonly dry: number | null;
}

/** An instant nothing stored covers. */
export const NO_WEATHER: Weather = {
  cloud: null,
  code: null,
  precipitation: null,
  snowfall: null,
  snowDepth: null,
  visibility: null,
  wind: null,
  windDirection: null,
  celsius: null,
  humidity: null,
  ghi: null,
  clearSkyIndex: null,
  dry: null,
};

/** Metres of snow depth from which snow lies (ADR 23), as in the core. */
const SNOW_LIES = 0.01;

/** Whether snow `depth` m deep lies; not without a depth. */
export function snowLies(depth: number | null): depth is number {
  return depth !== null && depth >= SNOW_LIES;
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

const UNKNOWN: Plant = { sun: null, share: null };

/** Fog by definition: a kilometre of visibility at most. The archive has the code alone. */
const FOG_CODE_METRES = 1000;

/** The ground dries over about an hour. */
const DRIES = 3_600_000;

/**
 * Degrees of sun from which missing clear-sky indices tell of snow. The core measures none under
 * 5°, and the index that stands for an instant is of a quarter up to half an hour before it,
 * when the sun was lower.
 */
const SUN = 10;

/** Under this share of its peak the plant makes next to nothing. The core's own bound is 5 % of
 * the clear-sky estimate, which is never over the peak. */
const NOTHING = 0.05;

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

/** Snow while snow falls, whose water the precipitation counts too; else rain. A thunderstorm
 * pours: its rain is the whole field, whatever the amount, so it reads as more than rain. */
function fallingOf(weather: Weather, thunder: boolean): Falling | null {
  const snowfall = weather.snowfall ?? 0;
  const rain = weather.precipitation ?? 0;

  if (snowfall <= 0 && rain <= 0) return null;

  return snowfall > 0
    ? { kind: "snow", density: densityOf(snowfall, WHOLE.snow), wind: carried(weather) }
    : {
        kind: "rain",
        density: thunder ? 1 : densityOf(rain, WHOLE.rain),
        wind: carried(weather),
      };
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

/** The scene's weather for the `weather` at an instant and what the `plant` reads then. */
export function sceneWeather(weather: Weather, plant: Plant = UNKNOWN): SceneWeather {
  const { code, dry, snowDepth } = weather;
  const snow = snowLies(snowDepth);
  const thunder = codeKind(code) === "thunder";
  const falling = fallingOf(weather, thunder);

  return {
    fog: fogOf(weather),
    wet: dry === null ? 0 : 1 - smoothstep(0, DRIES, dry),
    snow,
    covered: coveredBy(weather, snow, plant),
    thunder,
    falling,
    glass: glassOf(weather, falling),
  };
}
