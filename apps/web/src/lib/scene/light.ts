// The studio's light for a sun and a theme (ADR 20 Look). Pure: the studio applies it.
import type { Point } from "../builder/pv.ts";
import { blend, linear, luma, mix, smoothstep, type Rgb } from "./colour.ts";
import { CLEAR, CLOSED, skylight } from "./skylight.ts";

export type { Rgb };

export interface Fill {
  readonly sky: Rgb;
  readonly ground: Rgb;
  readonly intensity: number;
}

export interface Clouds {
  readonly coverage: number;
  readonly density: number;
}

export interface Daylight {
  /** Unit vector toward the sun, for the sky model, even below the horizon. */
  readonly sun: Point;
  /** Unit vector toward the light, the sun or the moon: east, north, up. */
  readonly toward: Point;
  readonly colour: Rgb;
  readonly intensity: number;
  /** The sky environment's strength. */
  readonly environment: number;
  /** A shadowless light from above and below: a faint bounce by day, the night's sky. */
  readonly fill: Fill;
  /** How far the string glow shows: the light it stands for, off at night. */
  readonly glow: number;
  /** How far the house's lamps are on: 0 by day, 1 at night, coming on across dusk. */
  readonly lamps: number;
  /** The sky model's clouds: how much of the sky they cover and how solid they are, 0 to 1. */
  readonly clouds: Clouds;
  /** How hazy the sky model is: 1 at a low sun, 0 at a high one. */
  readonly haze: number;
  /** The shadow's blur radius in shadow-map texels: wider under cloud. */
  readonly shadow: number;
  /** The moon lights the plant. */
  readonly night: boolean;
  /** The sun's elevation in degrees. */
  readonly elevation: number;
}

/** The light's look at a low sun (5°) and a high one (42°); between, it blends. */
const LOW = { colour: 0xff9c66, intensity: 2, environment: 0.65, glow: 0.25, elevation: 5 };
const HIGH = { colour: 0xfff4e5, intensity: 3.4, environment: 1, glow: 1, elevation: 42 };

const MOON = { colour: 0xb4c4ff, intensity: 2.3, environment: 0.35 };

/** A sky's shadowless fill: its colours. */
interface Tint {
  readonly sky: number;
  readonly ground: number;
}

/** The fill's colours by sky. */
const TINT = {
  // A faint bounce under a high sun, where the sky model lights the day.
  bounce: { sky: 0xcfe0ff, ground: 0x4b5b35 },
  // A low sun's sky, a little warm, and the horizon's, warmer.
  golden: { sky: 0xfff0e2, ground: 0x9a9082 },
  horizon: { sky: 0xffe4cc, ground: 0x8f8070 },
  // The blue hour, at the end of civil twilight.
  civil: { sky: 0x9fb8f0, ground: 0x56628a },
  // The night's own blue sky.
  night: { sky: 0x93a5d8, ground: 0x4a5475 },
  // A closed sky: grey.
  overcast: { sky: 0xd6d9dd, ground: 0x777a7c },
} satisfies Record<string, Tint>;

/** The fill's least light, by day and by night. */
const FAINT = {
  day: 0.15 * luma(linear(TINT.bounce.sky)),
  night: 1.5 * luma(linear(TINT.night.sky)),
};

/**
 * The least light a face gets from the sun or the moon, the sky model and the fill together: the
 * fill tops the others up to it. Real daylight is mostly the sky's while the sun is low, so the
 * day's floor, about a November noon's own light, holds from the horizon up; it eases to the
 * blue hour's at the end of civil twilight and to the night's at the end of nautical.
 */
const FLOOR = {
  night: MOON.intensity * luma(linear(MOON.colour)) + FAINT.night,
  civil: 3,
  day: 4.5,
};

/**
 * The sky model is dim at a low sun and black under the horizon. Up to `most` times stronger, it
 * gives a low sun's day the sky light of a November noon, `light`: reflections and all.
 */
const SKY = { light: 2.9, most: 10 };

/** The share of the sun's own light that gets through a closed sky, and of the sky model's:
 * its clouds are twice as bright as its clear sky. */
const THROUGH = { sun: 0.06, sky: 0.45 };

/** The shadow's blur radius under a clear sky and a closed one. */
const SHADOW = { clear: 3.5, closed: 9 };

/** The radius under a clear sky: what a shadow's spread under cloud is measured against. */
export const CLEAR_SHADOW = SHADOW.clear;

/** The diffuse fractions where cloud starts to show and where the sky is closed: the dashboard
 * calls 0.45 partly cloudy and 0.8 cloudy. */
const CLOUD = [0.25, 0.85] as const;

/** Degrees under the horizon where civil twilight ends and the moon starts to show. */
const CIVIL_END = -6;

/** Degrees under the horizon where the night is whole: the end of nautical twilight. */
const NIGHT = -12;

/** Degrees over it where the sun's own light starts to fade and the sky to turn. */
const DUSK = 3;

const DEGREES = Math.PI / 180;

/** Toward compass `azimuth` (0 north, 90 east) at `elevation`, both in degrees. */
function compass(azimuth: number, elevation: number): Point {
  const [a, e] = [azimuth * DEGREES, elevation * DEGREES];

  return [Math.sin(a) * Math.cos(e), Math.cos(a) * Math.cos(e), Math.sin(e)];
}

/** Without the plant's location: the prototype's afternoon sun from the west-south-west. */
const FIXED = compass(238, 42);

/** The moon, from the north-west. */
const MOON_TOWARD = compass(300, 50);

/** What the sky is at an instant, whichever light shines. */
type Sky = Pick<Daylight, "sun" | "elevation" | "clouds" | "haze" | "lamps">;

/** Under the horizon: the sky lights civil twilight alone; the moon comes up as that light goes. */
function twilight(sky: Sky): Daylight {
  const civil = smoothstep(0, CIVIL_END, sky.elevation);
  const moonlit = smoothstep(CIVIL_END, NIGHT, sky.elevation);
  const moon = { colour: linear(MOON.colour), intensity: MOON.intensity * moonlit };
  const environment = mix(SKY.most, MOON.environment, civil);

  const [tint, floor] =
    sky.elevation > CIVIL_END
      ? [between(TINT.horizon, TINT.civil, civil), mix(FLOOR.day, FLOOR.civil, civil)]
      : [between(TINT.civil, TINT.night, moonlit), mix(FLOOR.civil, FLOOR.night, moonlit)];

  return {
    ...sky,
    ...moon,
    toward: MOON_TOWARD,
    environment,
    fill: fill(tint, FAINT.night, floor, {
      ...moon,
      sky: environment * skylight(sky.elevation, sky.clouds.coverage),
    }),
    glow: 0,
    shadow: SHADOW.clear,
    night: true,
  };
}

/** Over the horizon, under `cloud` of a closed sky. */
function day(sky: Sky, cloud: number): Daylight {
  const k = 1 - sky.haze;
  // The sun's own light fades out toward the horizon, and the sky's makes up for it.
  const risen = smoothstep(0, DUSK, sky.elevation);
  // Cloud shows as the sun rises: at the horizon every sky is the twilight's.
  const veil = cloud * risen;
  const model = skylight(sky.elevation, sky.clouds.coverage);

  const direct = {
    colour: blend(linear(LOW.colour), linear(HIGH.colour), k),
    intensity: mix(LOW.intensity, HIGH.intensity, k) * risen * mix(1, THROUGH.sun, veil),
  };

  const environment = Math.min(
    SKY.most,
    Math.max(
      mix(LOW.environment, HIGH.environment, k) * mix(1, THROUGH.sky, veil),
      SKY.light / Math.max(model, 1e-6),
    ),
  );

  const clear =
    sky.elevation < DUSK
      ? between(TINT.horizon, TINT.golden, risen)
      : between(TINT.golden, TINT.bounce, k);

  const tint = {
    sky: blend(clear.sky, linear(TINT.overcast.sky), veil),
    ground: blend(clear.ground, linear(TINT.overcast.ground), veil),
  };

  return {
    ...sky,
    ...direct,
    toward: sky.sun,
    environment,
    fill: fill(tint, FAINT.day, FLOOR.day, { ...direct, sky: environment * model }),
    glow: mix(LOW.glow, HIGH.glow, k) * risen,
    shadow: mix(SHADOW.clear, SHADOW.closed, cloud),
    night: false,
  };
}

/**
 * The light for a sun toward `sun` under a sky whose light is `diffuse` of the way diffuse
 * (diffuse over global irradiance); a null sun is a fixed afternoon one, a null sky a clear one.
 */
export function daylight(sun: Point | null, diffuse: number | null = null): Daylight {
  const toward = sun ?? FIXED;
  const elevation = Math.asin(Math.max(-1, Math.min(1, toward[2]))) / DEGREES;
  const cloud = smoothstep(...CLOUD, diffuse ?? 0);

  const sky = {
    sun: toward,
    elevation,
    clouds: {
      coverage: mix(CLEAR.coverage, CLOSED.coverage, cloud),
      density: mix(CLEAR.density, CLOSED.density, cloud),
    },
    haze: 1 - smoothstep(LOW.elevation, HIGH.elevation, elevation),
    lamps: smoothstep(DUSK, CIVIL_END, elevation),
  };

  return elevation <= 0 ? twilight(sky) : day(sky, cloud);
}

/** The fill's colours `k` of the way `from` one sky `to` the next. */
function between(from: Tint, to: Tint, k: number): Pick<Fill, "sky" | "ground"> {
  return {
    sky: blend(linear(from.sky), linear(to.sky), k),
    ground: blend(linear(from.ground), linear(to.ground), k),
  };
}

/** What already lights a face: the sun or the moon, and the sky model. */
interface Lit {
  readonly colour: Rgb;
  readonly intensity: number;
  readonly sky: number;
}

/** The fill in `tint` that tops what is `lit` up to `floor`, and is never under `faint`. */
function fill(tint: Pick<Fill, "sky" | "ground">, faint: number, floor: number, lit: Lit): Fill {
  const light = Math.max(faint, floor - lit.intensity * luma(lit.colour) - lit.sky);

  return { ...tint, intensity: light / luma(tint.sky) };
}

export interface Theme {
  readonly dark: boolean;
  readonly exposure: number;
  /** Scales the sky environment. */
  readonly environment: number;
}

const EXPOSURE = 0.62;

/** Dark mode: a lower exposure and a dimmer sky at the same sun. */
export function theme(dark: boolean): Theme {
  return dark
    ? { dark, exposure: EXPOSURE * 0.82, environment: 0.75 }
    : { dark, exposure: EXPOSURE, environment: 1 };
}

/** ACES's curve as three applies it. */
function rrt(v: number): number {
  return (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081);
}

/** The linear value that lands on `target` after `exposure` and ACES: the backdrop and the fog
 * then meet the page colour exactly. */
export function untone(target: number, exposure: number): number {
  let [lo, hi] = [0, 60];

  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;

    if (rrt((mid * exposure) / 0.6) < target) lo = mid;
    else hi = mid;
  }

  return (lo + hi) / 2;
}
