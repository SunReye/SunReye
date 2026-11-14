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

/** The sky's shadowless light: its colours, and how much lands on a face turned up to it. */
interface Ambient {
  readonly sky: number;
  readonly ground: number;
  readonly light: number;
}

/** A faint bounce under a high sun: the sky model lights the day. */
const BOUNCE: Ambient = { sky: 0xcfe0ff, ground: 0x4b5b35, light: 0.15 * luma(linear(0xcfe0ff)) };
/** A low sun's warm sky, stronger as the sun's own light goes: the sky model is dim there. */
const GOLDEN: Ambient = { sky: 0xffdcc0, ground: 0x8a7866, light: 1.65 };
const HORIZON: Ambient = { ...GOLDEN, light: 2.55 };
/** The blue hour, at the end of civil twilight: the sky still lights everything. */
const CIVIL: Ambient = { sky: 0x9fb8f0, ground: 0x56628a, light: 2 };
/** The night's own blue sky: the sky model is nearly black below the horizon. */
const NIGHT_SKY: Ambient = { sky: 0x93a5d8, ground: 0x4a5475, light: 1.5 * luma(linear(0x93a5d8)) };

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
  const dusk = smoothstep(DUSK, CIVIL_END, elevation);

  if (elevation <= 0) {
    const civil = smoothstep(0, CIVIL_END, elevation);
    // The sky lights civil twilight alone; the moon comes up as that light goes.
    const moonlit = smoothstep(CIVIL_END, NIGHT, elevation);

    return {
      sun: toward,
      toward: MOON_TOWARD,
      colour: linear(MOON.colour),
      intensity: MOON.intensity * moonlit,
      environment: mix(LOW.environment, MOON.environment, civil),
      fill: elevation > CIVIL_END ? fill(HORIZON, CIVIL, civil) : fill(CIVIL, NIGHT_SKY, moonlit),
      lamps: dusk,
      glow: 0,
      night: true,
      elevation,
    };
  }

  const k = smoothstep(LOW.elevation, HIGH.elevation, elevation);
  // The sun's own light fades out toward the horizon, and the sky's makes up for it.
  const risen = smoothstep(0, DUSK, elevation);

  return {
    sun: toward,
    toward,
    colour: blend(linear(LOW.colour), linear(HIGH.colour), k),
    intensity: mix(LOW.intensity, HIGH.intensity, k) * risen,
    environment: mix(LOW.environment, HIGH.environment, k),
    fill: elevation < DUSK ? fill(HORIZON, GOLDEN, risen) : fill(GOLDEN, BOUNCE, k),
    lamps: dusk,
    glow: mix(LOW.glow, HIGH.glow, k) * risen,
    night: false,
    elevation,
  };
}

function blend(from: Rgb, to: Rgb, k: number): Rgb {
  return { r: mix(from.r, to.r, k), g: mix(from.g, to.g, k), b: mix(from.b, to.b, k) };
}

/** Relative luminance. */
function luma({ r, g, b }: Rgb): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The sky's light `k` of the way `from` one `to` the next. Its light blends, not the lamp's
 * intensity: the light then never dips between two skies of different colours. */
function fill(from: Ambient, to: Ambient, k: number): Fill {
  const sky = blend(linear(from.sky), linear(to.sky), k);

  return {
    sky,
    ground: blend(linear(from.ground), linear(to.ground), k),
    intensity: mix(from.light, to.light, k) / luma(sky),
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
