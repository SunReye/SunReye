// The studio's light for a sun and a theme (ADR 20 Look). Pure: the studio applies it.
import type { Point } from "../builder/pv.ts";
import type { MotionTier } from "../motion/tier.ts";

/** Linear RGB, 0 to 1. */
export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface Fill {
  readonly sky: Rgb;
  readonly ground: Rgb;
  readonly intensity: number;
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
  /** The moon lights the plant. */
  readonly night: boolean;
  /** The sun's elevation in degrees. */
  readonly elevation: number;
}

/** The light's look at a low sun (5°) and a high one (42°); between, it blends. */
const LOW = { colour: 0xff9c66, intensity: 2, environment: 0.65, glow: 0.25, elevation: 5 };
const HIGH = { colour: 0xfff4e5, intensity: 3.4, environment: 1, glow: 1, elevation: 42 };

const MOON = { colour: 0xb4c4ff, intensity: 2.3, environment: 0.35 };

/** The sky's and the ground's bounce by day, and the night's own blue sky: the sky model is
 * nearly black below the horizon. */
const BOUNCE = { sky: 0xcfe0ff, ground: 0x4b5b35, intensity: 0.15 };
const NIGHT_SKY = { sky: 0x93a5d8, ground: 0x4a5475, intensity: 1.5 };

/** Degrees under the horizon where the night is whole: the end of civil twilight. */
const NIGHT = -6;

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

/** One sRGB byte, linear. */
function channel(byte: number): number {
  const c = byte / 255;

  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** sRGB hex to linear RGB. */
function linear(hex: number): Rgb {
  return { r: channel(hex >> 16), g: channel((hex >> 8) & 0xff), b: channel(hex & 0xff) };
}

function mix(from: number, to: number, k: number): number {
  return from + (to - from) * k;
}

function smoothstep(from: number, to: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)));

  return t * t * (3 - 2 * t);
}

/** The light for a sun toward `sun`; null keeps a fixed afternoon sun. */
export function daylight(sun: Point | null): Daylight {
  const toward = sun ?? FIXED;
  const elevation = Math.asin(Math.max(-1, Math.min(1, toward[2]))) / DEGREES;

  // The sky's light turns to the night's across dusk; its fill is whole by the horizon, where
  // the sun's own light has gone and the moon's has yet to come.
  const dusk = smoothstep(DUSK, NIGHT, elevation);

  const ambient = {
    lamps: dusk,
    environment: mix(LOW.environment, MOON.environment, dusk),
    fill: fill(smoothstep(LOW.elevation, 0, elevation), dusk),
  };

  if (elevation <= 0) {
    return {
      sun: toward,
      toward: MOON_TOWARD,
      colour: linear(MOON.colour),
      // The moon comes up as the sun's light has gone: the one light is out as it turns.
      intensity: MOON.intensity * smoothstep(0, NIGHT, elevation),
      ...ambient,
      glow: 0,
      night: true,
      elevation,
    };
  }

  const k = smoothstep(LOW.elevation, HIGH.elevation, elevation);
  // The sun's own light fades out toward the horizon.
  const risen = smoothstep(0, DUSK, elevation);

  return {
    sun: toward,
    toward,
    colour: blend(linear(LOW.colour), linear(HIGH.colour), k),
    intensity: mix(LOW.intensity, HIGH.intensity, k) * risen,
    environment:
      elevation < LOW.elevation ? ambient.environment : mix(LOW.environment, HIGH.environment, k),
    fill: ambient.fill,
    lamps: ambient.lamps,
    glow: mix(LOW.glow, HIGH.glow, k) * risen,
    night: false,
    elevation,
  };
}

function blend(from: Rgb, to: Rgb, k: number): Rgb {
  return { r: mix(from.r, to.r, k), g: mix(from.g, to.g, k), b: mix(from.b, to.b, k) };
}

/** The fill `strength` of the way to the night's, its colours `dusk` of the way. */
function fill(strength: number, dusk: number): Fill {
  return {
    sky: blend(linear(BOUNCE.sky), linear(NIGHT_SKY.sky), dusk),
    ground: blend(linear(BOUNCE.ground), linear(NIGHT_SKY.ground), dusk),
    intensity: mix(BOUNCE.intensity, NIGHT_SKY.intensity, strength),
  };
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

/** One ambient-occlusion pass, off on the lite and still tiers (ADR 21). */
export function occlusion(tier: MotionTier): boolean {
  return tier === "full";
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
