// The remembered plant peak behind the 2D flow (ADR 21). Ported from v3 (dev 780b4e2,
// lib/inverter/flow-pulse.ts) by way of the prototype.
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

import type { Flow } from "./schematic.ts";

/** Smallest plant a rail is ever measured against (W). */
export const CEILING_FLOOR_W = 1000;

/** How long the plant remembers its peak. Six hours: a 9 kW noon still dims a
 *  300 W midnight import to a single spark. */
const CEILING_HALF_LIFE_MS = 6 * 60 * 60 * 1000;

/** The remembered plant peak, and when it was last folded. */
export type Ceiling = { readonly watts: number; readonly at: number };

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
export function throughputWatts(
  segments: readonly { readonly flow: Flow; readonly value?: number | undefined }[],
): number {
  return segments.reduce((t, s) => (s.flow === "in" ? t + Math.abs(s.value ?? 0) : t), 0);
}

/**
 * A stored ceiling, or a fresh one at the floor. Lives here rather than in the
 * rune shell so the corrupt-entry cases are exercised: this is read before the
 * first paint, and a half-written value must not take the diagram down.
 */
export function parseCeiling(raw: string | null | undefined): Ceiling {
  try {
    const stored: unknown = JSON.parse(raw ?? "");

    if (
      stored instanceof Object &&
      "watts" in stored &&
      finite(stored.watts) &&
      "at" in stored &&
      finite(stored.at)
    )
      return { watts: Math.max(CEILING_FLOOR_W, stored.watts), at: stored.at };
  } catch {
    // Absent, foreign or half-written: start the plant at its floor.
  }

  return { watts: CEILING_FLOOR_W, at: 0 };
}

function finite(value: unknown): value is number {
  return Number.isFinite(value);
}
