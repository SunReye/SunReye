/**
 * The signal behind the power-flow diagram's comet streams.
 *
 * A rail's motion has to say how much power is on it, and the reference it is
 * measured against decides whether the picture means anything. Measuring each
 * rail against "the biggest rail right now" pins the busiest cable at exactly
 * 1.0 forever: 300 W at midnight then paints the same picture as 9 kW at noon,
 * and the diagram stops being a status display.
 *
 * So the reference is a remembered PLANT peak — the sum of what is arriving,
 * held with a six-hour half-life. Any one rail is then a genuine fraction of
 * it. The memory decays by WALL-CLOCK elapsed time rather than per call, which
 * makes the fold idempotent: an extra invocation (EVCC's own cadence, a resize
 * storm, a `$derived` recompute) cannot age the plant.
 *
 * Plain `.ts`, no runes: all of this is exercised under `bun test`. The rune
 * shell that owns the `$state` and `localStorage` is `plant-ceiling.svelte.ts`
 * and holds no arithmetic at all.
 */

import type { Flow } from "./power-graph";

/** Comet speed, px/s. Constant for every rail: rate is density, never speed. */
// fallow-ignore-next-line unused-export -- the design's constants are asserted against in flow-pulse.test.ts (the ladder invariants) and in power-flow-pulse-wiring.test.ts; web test files aren't traced as consumers
export const PULSE_SPEED = 80;
/** Base span (px) one keyframe cycle travels. All dash periods divide it. */
// fallow-ignore-next-line unused-export -- same: the keyframe travel every layer period has to divide, pinned by its test rather than restated there
export const PULSE_SPAN = 200;
/** The one animation-duration in the diagram: PULSE_SPAN / PULSE_SPEED. */
// fallow-ignore-next-line unused-export -- the rails spell this out as a CSS literal on purpose; the wiring test imports it so the literal is checked against the decision instead of a second copy of "2.5s"
export const PULSE_PERIOD_S = PULSE_SPAN / PULSE_SPEED; // 2.5

/** Smallest plant a rail is ever measured against (W). */
// fallow-ignore-next-line unused-export -- the floor IS the contract: stated once here and pinned by flow-pulse.test.ts rather than restated there
export const CEILING_FLOOR_W = 1000;
/** How long the plant remembers its peak. Six hours: a 9 kW noon still dims a
 *  300 W midnight import to a single spark. */
const CEILING_HALF_LIFE_MS = 6 * 60 * 60 * 1000;

/** The remembered plant peak, and when it was last folded. */
export type Ceiling = { watts: number; at: number };

/**
 * Rises instantly to what the plant is moving now, forgets slowly, never falls
 * below the floor. Decay is a function of ELAPSED TIME, not of call count — so
 * an extra invocation (a resize, EVCC's own cadence) cannot age it.
 *
 * An unreadable clock reading holds the previous instant rather than being
 * written into the memory: a NaN `at` otherwise poisons every later fold
 * through `now - NaN` and paints every rail from a NaN ceiling forever.
 */
export function decayCeiling(prev: Ceiling, nowMs: number, instantW: number): Ceiling {
  const at = Number.isFinite(nowMs) ? nowMs : prev.at;
  const elapsed = Math.max(0, at - prev.at);
  const remembered =
    Number.isFinite(prev.watts) && Number.isFinite(elapsed)
      ? prev.watts * 2 ** (-elapsed / CEILING_HALF_LIFE_MS)
      : 0;
  const now = Number.isFinite(instantW) ? Math.abs(instantW) : 0;
  return { watts: Math.max(CEILING_FLOOR_W, now, remembered), at };
}

/** How much higher a peak has to be before it is worth a synchronous write. */
const PERSIST_RISE = 1.05;
/** …and how long a rising ramp may go unwritten regardless (ms). */
const PERSIST_INTERVAL_MS = 60_000;

/**
 * Whether a new peak is worth putting through `localStorage.setItem`.
 *
 * Only a rise is ever a candidate: the descent is pure decay, which a reload
 * recomputes from the stored value and its timestamp. But most of a clear-sky
 * morning is a rise — the plant sets a record on nearly every consecutive
 * sample for hours — so "any rise" is the same 1 Hz synchronous write on the
 * main thread of a fanless kiosk that skipping the descent was meant to avoid.
 *
 * A meaningful step is written immediately; a creep is written once a minute.
 * Either way the stored peak is at most slightly low, and a slightly low stored
 * peak is self-correcting: the plant simply reaches it again.
 */
export function shouldPersist(last: Ceiling, next: Ceiling): boolean {
  if (!(next.watts > last.watts)) return false;
  return next.watts >= last.watts * PERSIST_RISE || next.at - last.at >= PERSIST_INTERVAL_MS;
}

/** Total power the plant is moving right now: what the ceiling is fed. */
export function throughputWatts(segments: readonly { flow: Flow; value?: number }[]): number {
  return segments.reduce((t, s) => (s.flow === "in" ? t + Math.abs(s.value ?? 0) : t), 0);
}

/**
 * Magnitude relative to the remembered plant, quantized so a 1 Hz wobble
 * writes no styles at all. Sign is carried by colour and travel direction.
 */
export function pulseShare(watts: number | undefined, ceilingW: number): number {
  const a = Math.abs(watts ?? 0);
  const c = Number.isFinite(ceilingW) && ceilingW > 0 ? ceilingW : CEILING_FLOOR_W;
  if (Number.isNaN(a)) return 0; // no measurement is no flow, not full throttle
  if (!Number.isFinite(a)) return 1; // Infinity reads as full, not 0
  return Math.round(Math.min(1, a / c) * 20) / 20;
}

/**
 * A stored ceiling, or a fresh one at the floor. Lives here rather than in the
 * rune shell so the corrupt-entry cases are exercised: this is read before the
 * first paint, and a half-written value must not take the diagram down.
 */
export function parseCeiling(raw: string | null | undefined): Ceiling {
  try {
    const stored: unknown = JSON.parse(raw ?? "");
    if (stored && typeof stored === "object") {
      const { watts, at } = stored as Partial<Ceiling>;
      if (Number.isFinite(watts) && Number.isFinite(at))
        return { watts: Math.max(CEILING_FLOOR_W, watts as number), at: at as number };
    }
  } catch {
    // Absent, foreign or half-written: start the plant at its floor.
  }
  return { watts: CEILING_FLOOR_W, at: 0 };
}

/**
 * Interleaved comet layers. `period`/`delay` are fractions of PULSE_SPAN and
 * PULSE_PERIOD_S; both are constants of the design and never see a reading.
 *
 * Every period divides PULSE_SPAN and the cycle travels exactly PULSE_SPAN, so
 * the loop is seamless at every level and lighting a layer ADDS comets between
 * the existing ones without moving any of them. Density is therefore an opacity
 * fade of an already-running path — the single most important property here,
 * and the reason density is not a changing dash period (which respaces, i.e.
 * teleports, every comet on the rail).
 *
 * `from`/`to` are the share window over which that layer fades in.
 */
// fallow-ignore-next-line unused-export -- the ladder table is what the interleaving invariant is asserted on; layerStyle and railPulse read it internally
export const PULSE_LAYERS = [
  { period: 1, delay: 0, from: 0, to: 0 }, // layer 0: any flow shows one comet
  { period: 1, delay: 1 / 2, from: 0.02, to: 0.18 },
  { period: 1 / 2, delay: 1 / 4, from: 0.22, to: 0.5 },
  { period: 1 / 4, delay: 1 / 8, from: 0.52, to: 0.95 },
] as const;

export type RailPulse = {
  share: number;
  /** Per-layer opacity, 0..1. Index 0 is always 1 on a flowing rail. */
  layers: number[];
  /** Comet head length (px) — grows forward from a fixed dash start. */
  dot: number;
  /** Core stroke width (px); the bloom is 2.6x this. */
  width: number;
  /** Bloom stroke-opacity. */
  glow: number;
};

const round1 = (n: number): number => Math.round(n * 10) / 10;
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Everything one flowing rail's comets need, from its watts and the plant's. */
export function railPulse(watts: number | undefined, ceilingW: number): RailPulse {
  const share = pulseShare(watts, ceilingW);
  return {
    share,
    layers: PULSE_LAYERS.map(({ from, to }) =>
      to <= from ? 1 : Math.min(1, Math.max(0, (share - from) / (to - from))),
    ),
    dot: round1(5 + share * 9),
    width: round1(3 + share * 1.5),
    glow: round2(0.12 + share * 0.22),
  };
}

/**
 * Inline style for layer `i`. Its ONLY input is the layer index — that is what
 * makes the delay a constant of the design rather than a datum. The duration
 * stays a literal in the stylesheet: a timing property reachable by a reading
 * remaps elapsed time, which jumps every comet on every sample.
 */
export function layerStyle(i: number): string {
  const l = PULSE_LAYERS[i]!;
  return `--lvl-period:${l.period * PULSE_SPAN}px;--lvl-phase:${l.delay * PULSE_SPAN}px;animation-delay:-${l.delay * PULSE_PERIOD_S}s`;
}

/**
 * Comet positions inside one base span at a given lit-layer count — the proof
 * that lighting a layer interleaves rather than respaces. Tests only.
 */
// fallow-ignore-next-line unused-export -- the interleaving invariant is the whole design; its test asserts on it
export function dotPositions(lit: number): number[] {
  const spots = new Set<number>();
  for (const { period, delay } of PULSE_LAYERS.slice(0, Math.max(0, lit))) {
    const step = period * PULSE_SPAN;
    for (let x = delay * PULSE_SPAN; x < PULSE_SPAN; x += step) spots.add(x);
  }
  return [...spots].sort((a, b) => a - b);
}

/**
 * The node's glow colour at a given share of the plant. A mix of the node's own
 * accent token, so it follows the palette instead of baking a colour in.
 */
export function nodeGlow(accent: string, share: number): string {
  const s = Number.isFinite(share) ? Math.min(1, Math.max(0, share)) : 0;
  return `color-mix(in oklab, ${accent} ${Math.round(20 + s * 60)}%, transparent)`;
}
