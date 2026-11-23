// The scene's weather (ADR 23 "Scene weather") read from the core's weather at an instant and
// what the plant reads then. Pure.
import { smoothstep } from "../scene/colour.ts";
import {
  fogAt,
  type Falling,
  type Glass,
  type Plant,
  type SceneWeather,
} from "../scene/weather.ts";
import { codeKind } from "../weather-code.ts";
import { snowLies, type Weather } from "./weather.ts";

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
