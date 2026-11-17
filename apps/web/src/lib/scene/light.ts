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
  /** How strong the cast shadow is: 1 under a clear sky, 0 under a closed one. */
  readonly shadow: number;
  /** The moon lights the plant. */
  readonly night: boolean;
  /** The sun's elevation in degrees. */
  readonly elevation: number;
}

/** The sun's own light at a low sun (5°) and a high one (42°); between, it blends. Warm: the
 * model is white, so the sun's colour and the sky's are all the colour its faces have. */
const LOW = { colour: 0xffb07a, intensity: 2.8, glow: 0.25, elevation: 5 };
const HIGH = { colour: 0xffedd6, intensity: 3.6, glow: 1, elevation: 42 };

const MOON = { colour: 0xd0d9f5, intensity: 1.6, environment: 0.35 };

/** A sky's shadowless fill: its colours. */
interface Tint {
  readonly sky: number;
  readonly ground: number;
}

/** The fill's colours by sky. */
const TINT = {
  // Under a high sun: a room's worth of neutral bounce, a little cool from above and warm from
  // the floor. The sky model alone would light a white model blue.
  bounce: { sky: 0xeef2fa, ground: 0xb5b0a8 },
  // A low sun's sky, a little warm, and the horizon's, warmer.
  golden: { sky: 0xfff0e2, ground: 0x9a9082 },
  horizon: { sky: 0xffe4cc, ground: 0x8f8070 },
  // The blue hour, at the end of civil twilight.
  civil: { sky: 0xbccbee, ground: 0x7a829c },
  // The night's own blue sky.
  night: { sky: 0xb9c2dc, ground: 0x70778c },
  // A closed sky: grey.
  overcast: { sky: 0xd6d9dd, ground: 0x777a7c },
} satisfies Record<string, Tint>;

/** The fill's least light, by day and by night. */
const FAINT = {
  day: 1.3,
  night: 0.8 * luma(linear(TINT.night.sky)),
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
  day: 3.6,
};

/**
 * The sky model's light on a face turned up, whatever the sun's height and the clouds: it is dim
 * at a low sun and black under the horizon, so it is strengthened up to `most` times. Kept well
 * under the sun's own, so the sun models the faces and the sky only tints their shade and
 * mirrors in the glass; the fill brings the rest.
 */
const SKY = { light: 0.45, most: 10 };

/** The share of the sun's own light that gets through a closed sky: a soft key light is left,
 * so a white model keeps its form on a grey day. */
const THROUGH = 0.35;

/** The share of the day's light a thunderstorm takes: the sun's, the sky's and the fill's alike. */
const STORM = 0.35;

/** The cloud (the diffuse fraction's scale) where it starts to show and where the sky is closed:
 * the sky's word is fair from 0.45 and overcast from 0.85 (`weather/sky.ts`). */
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
    shadow: 1,
    night: true,
  };
}

/** Over the horizon, under `cloud` of a closed sky, a thunderstorm's while `thunder`. */
function day(sky: Sky, cloud: number, thunder: boolean): Daylight {
  const k = 1 - sky.haze;
  // The sun's own light fades out toward the horizon, and the sky's makes up for it.
  const risen = smoothstep(0, DUSK, sky.elevation);
  // The storm darkens as the sun rises: the twilight is left as it is.
  const left = thunder ? 1 - STORM * risen : 1;
  // Cloud shows as the sun rises: at the horizon every sky is the twilight's.
  const veil = cloud * risen;
  const model = skylight(sky.elevation, sky.clouds.coverage);

  const direct = {
    colour: blend(linear(LOW.colour), linear(HIGH.colour), k),
    intensity: mix(LOW.intensity, HIGH.intensity, k) * risen * mix(1, THROUGH, veil) * left,
  };

  const environment = Math.min(SKY.most, SKY.light / Math.max(model, 1e-6)) * left;

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
    fill: fill(tint, FAINT.day * left, FLOOR.day * left, {
      ...direct,
      sky: environment * model,
    }),
    glow: mix(LOW.glow, HIGH.glow, k) * risen,
    shadow: 1 - cloud,
    night: false,
  };
}

/**
 * The light for a sun toward `sun` under a sky whose light is `diffuse` of the way diffuse
 * (diffuse over global irradiance); a null sun is a fixed afternoon one, a null sky a clear one.
 * `thunder` closes the sky and darkens the day (ADR 23).
 */
export function daylight(
  sun: Point | null,
  diffuse: number | null = null,
  thunder = false,
): Daylight {
  const toward = sun ?? FIXED;
  const elevation = Math.asin(Math.max(-1, Math.min(1, toward[2]))) / DEGREES;
  const cloud = thunder ? 1 : smoothstep(...CLOUD, diffuse ?? 0);

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

  return elevation <= 0 ? twilight(sky) : day(sky, cloud, thunder);
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

const EXPOSURE = 0.85;

/** Dark mode: a lower exposure and a dimmer sky at the same sun. */
export function theme(dark: boolean): Theme {
  return dark
    ? { dark, exposure: EXPOSURE * 0.7, environment: 0.75 }
    : { dark, exposure: EXPOSURE, environment: 1 };
}
