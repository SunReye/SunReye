// The backdrop's lights (ADR 21): where each drifts to, and how strongly the PV light glows.

/** Below this the PV counts as idle: an inverter's standby draw, not production. */
const IDLE_WATTS = 50;

/** The glow of a plant that has just started producing. */
const FLOOR = 0.35;

/** The PV power that takes the glow halfway from the floor to full; no plant size is needed. */
const HALF_WATTS = 3000;

/** Steps of the glow: a tick's jitter stays on its step, so the light does not chase every sample. */
const STEPS = 20;

/** The PV light's opacity, 0 to 1: out while PV is idle, rising with production and levelling off. */
export function pvGlow(watts?: number): number {
  if (watts === undefined || !Number.isFinite(watts) || watts <= IDLE_WATTS) return 0;

  const glow = FLOOR + ((1 - FLOOR) * watts) / (watts + HALF_WATTS);

  return Math.round(glow * STEPS) / STEPS;
}

export const LIGHTS = ["sun", "pv", "battery", "grid"] as const;

export type Light = (typeof LIGHTS)[number];

/** How far a light wanders from its place in vmax, and the seconds each cycle takes. */
interface Drift {
  readonly x: number;
  readonly y: number;
  readonly across: number;
  readonly down: number;
  readonly breath: number;
}

/** Periods share no factor, so the four never repeat a picture within hours. */
const DRIFTS: Readonly<Record<Light, Drift>> = {
  sun: { x: 5, y: 2, across: 106, down: 74, breath: 34 },
  pv: { x: 7, y: 5, across: 82, down: 118, breath: 26 },
  battery: { x: 8, y: 5, across: 94, down: 62, breath: 38 },
  grid: { x: 6, y: 7, across: 118, down: 86, breath: 46 },
};

/** A light never dims below this share of its strength. */
const DIMMEST = 0.7;

/** How much a light swells at its widest. */
const SWELL = 0.12;

export interface Pose {
  /** CSS `transform`. */
  readonly transform: string;
  readonly opacity: number;
}

const wave = (seconds: number, period: number): number =>
  Math.sin((2 * Math.PI * seconds) / period);

/** Where `light` has drifted `seconds` in: at 0 it rests in its place at full strength. */
export function pose(light: Light, seconds: number): Pose {
  const drift = DRIFTS[light];
  const x = drift.x * wave(seconds, drift.across);
  const y = drift.y * wave(seconds, drift.down);
  const breath = (1 - Math.cos((2 * Math.PI * seconds) / drift.breath)) / 2;

  return {
    // 2D on purpose: a 3D transform would give each light its own compositor layer.
    transform: `translate(${x.toFixed(2)}vmax, ${y.toFixed(2)}vmax) scale(${(1 + SWELL * breath).toFixed(3)})`,
    opacity: Number((1 - (1 - DIMMEST) * breath).toFixed(3)),
  };
}

/** Calls `step` with the seconds since it started; returns its stop. */
export type Beat = (step: (seconds: number) => void) => () => void;

/** How often the lights move. Slow enough that a step is a pixel or two of a very soft edge. */
const BEAT_MS = 1000;

/** Once a second while the page is shown. */
export const beat: Beat = (step) => {
  const started = performance.now();

  const id = setInterval(() => {
    if (!document.hidden) step((performance.now() - started) / 1000);
  }, BEAT_MS);

  return () => {
    clearInterval(id);
  };
};
