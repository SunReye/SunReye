// fallow-ignore-file unused-file -- the signal ships with its tests before the rails consume it; the rails rewrite removes this line
// fallow-ignore-file unused-export -- same reason: every export here is exercised by flow-pulse.test.ts, and web test files aren't traced as consumers
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
export const PULSE_SPEED = 80;
/** Base span (px) one keyframe cycle travels. All dash periods divide it. */
export const PULSE_SPAN = 200;
/** The one animation-duration in the diagram: PULSE_SPAN / PULSE_SPEED. */
export const PULSE_PERIOD_S = PULSE_SPAN / PULSE_SPEED; // 2.5

/** Smallest plant a rail is ever measured against (W). */
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
