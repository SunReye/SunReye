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
 * The slowest and fastest a charge crosses a rail, seconds. A trickle drifts;
 * a rail at the plant's remembered peak snaps across.
 */
const CROSS_SLOWEST_S = 4.5;
const CROSS_FASTEST_S = 1.1;

/**
 * Crossing time is QUANTIZED to quarter-seconds, and that is load-bearing.
 *
 * One charge per rail means the magnitude has to live in the speed, and speed is
 * a timing property — the one thing this diagram otherwise refuses to derive
 * from a reading. Changing a running animation's duration remaps its elapsed
 * time, so the charge visibly jumps to a new position at the moment of the
 * change; with a 1 Hz feed and a continuous mapping that is a stutter every
 * single second. Coarse steps mean an unchanged-enough reading emits a
 * byte-identical duration and the animation is never touched at all, so the
 * jump is confined to the rare sample where the power really moved.
 */
const CROSS_STEP_S = 0.25;

export type RailPulse = {
  share: number;
  /** Crossing time (s) — the magnitude, quantized so most samples change it not at all. */
  dur: number;
  /** Sprite scale — a busier rail flies a bigger charge. */
  scale: number;
  /** Blur radius (px) softening the sprite's edge. */
  blur: number;
  /** Near-glow spread (px); the far glow is 3x it. */
  glow: number;
  /** Overlay stroke width (px) for the reduced-motion still. */
  width: number;
};

/**
 * Share → crossing time. Inverted: more power is less time on the wire.
 */
// fallow-ignore-next-line unused-export -- railPulse calls it internally; it is exported so the quantization contract is asserted directly in flow-pulse.test.ts and power-flow-pulse-wiring.test.ts, and web test files are not traced as consumers
export function crossingSeconds(share: number): number {
  const s = Number.isFinite(share) ? Math.min(1, Math.max(0, share)) : 0;
  const raw = CROSS_SLOWEST_S + (CROSS_FASTEST_S - CROSS_SLOWEST_S) * s;
  return Math.round(raw / CROSS_STEP_S) * CROSS_STEP_S;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;
const round2 = (n: number): number => Math.round(n * 100) / 100;
/** Lags are seconds and land in an attribute; float noise reads badly there. */
const round4 = (n: number): number => Math.round(n * 10000) / 10000;

/** Everything one flowing rail's charge needs, from its watts and the plant's. */
export function railPulse(watts: number | undefined, ceilingW: number): RailPulse {
  const share = pulseShare(watts, ceilingW);
  return {
    share,
    dur: round2(crossingSeconds(share)),
    scale: round2(0.55 + share * 0.75),
    blur: round1(1.6 + share * 1.6),
    glow: round1(3 + share * 9),
    width: round1(2 + share * 3),
  };
}

/**
 * Which end of the motion path a charge starts from. `in` runs the path as
 * authored (node → hub, because `power-graph.ts` puts the hub last in `pts`);
 * `out` runs it backwards. Reversing the KEY POINTS rather than the path string
 * means both directions share one `<mpath>` — the rail's own cable — so a
 * resize moves the charges with the wire instead of stranding them.
 */
export function moverKeyPoints(flow: Flow): string {
  return flow === "in" ? "0;1" : "1;0";
}

/**
 * A charge is a CHAIN of beads, not one sprite.
 *
 * A single lens sprite can only be placed and rotated — `rotate="auto"` aims it
 * along the tangent, so on the diagram's Béziers it cuts the corner and reads as
 * a straight splinter laid across a curved wire. Giving every bead its own
 * `<animateMotion>` down the same cable, each lagging the one ahead of it, makes
 * the comet follow the curve exactly, because every part of it is separately on
 * the path. Blurred together they read as one tapered streak.
 */
export const BEAD_COUNT = 24;

/** How much of the whole crossing the comet's own length occupies. */
const COMET_SPAN = 0.13;

/**
 * Bead `k`'s shape: 0 is the head. Radius falls off slower than opacity, so the
 * comet keeps a body before it closes to a point rather than fading to a stub.
 */
export function beadShape(k: number): { radius: number; opacity: number } {
  const t = BEAD_COUNT <= 1 ? 0 : Math.min(1, Math.max(0, k / (BEAD_COUNT - 1)));
  return { radius: round2((1 - t) ** 0.55), opacity: round2((1 - t) ** 1.35) };
}

/**
 * The negative `begin` that puts bead `k` its own lag behind the head. Scaled by
 * the crossing time so the comet is the same LENGTH at every speed: a fixed lag
 * in seconds would stretch the comet into a smear whenever the rail slowed down.
 */
export function beadBegin(k: number, dur: number, headBegin = 0): string {
  const t = BEAD_COUNT <= 1 ? 0 : Math.min(1, Math.max(0, k / (BEAD_COUNT - 1)));
  const lead = COMET_SPAN * (1 - t) * (Number.isFinite(dur) && dur > 0 ? dur : 1);
  if (headBegin === 0) return `-${round4(lead)}s`;
  return `${round4(headBegin - lead)}s`;
}

/**
 * How far through its period (0..1) a repeating animation is at `nowS`, given
 * the `begin` it was authored with and its `dur` — all in the SVG document's
 * own seconds, because that is the one clock SMIL resolves `begin` against
 * (a begin offset counts from the time container's start, not from when the
 * element was inserted). Not yet begun is 0, and so is anything unreadable.
 */
// fallow-ignore-next-line unused-export -- carryHead calls it internally; exported so the phase arithmetic is asserted directly in flow-pulse.test.ts, and web test files are not traced as consumers
export function animationPhase(nowS: number, beginS: number, dur: number): number {
  if (![nowS, beginS, dur].every(Number.isFinite) || dur <= 0) return 0;
  const elapsed = nowS - beginS;
  if (elapsed <= 0) return 0;
  return (elapsed % dur) / dur;
}

/**
 * The head `begin` that puts a chain at `phase` at `nowS` under a new period.
 *
 * This is what lets a change of speed leave the comet where it is: the chain is
 * rebuilt (SMIL remaps a running animation's elapsed time when its dur changes,
 * so the old one cannot be kept), and the new one is told to have begun at
 * exactly the instant that makes its head sit where the old head was. A
 * quantized step then changes only how fast the comet moves on from there.
 *
 * Normalised into (-dur, 0] so it reads like every other lag the chain uses and
 * can never name an instant that has not happened yet. A nonsense input starts
 * from the top of the path — the behaviour before rephasing existed.
 */
// fallow-ignore-next-line unused-export -- carryHead calls it internally; exported so the re-phasing contract is asserted directly in flow-pulse.test.ts, and web test files are not traced as consumers
export function rephasedBegin(nowS: number, phase: number, dur: number): number {
  if (![nowS, phase, dur].every(Number.isFinite) || dur <= 0) return 0;
  const p = Math.min(1, Math.max(0, phase));
  if (p === 0) return -0;
  const begin = nowS - p * dur;
  // Drop whole periods so the result lands in (-dur, 0].
  return begin - Math.ceil(begin / dur) * dur;
}

/**
 * The node's glow colour at a given share of the plant. A mix of the node's own
 * accent token, so it follows the palette instead of baking a colour in.
 */
export function nodeGlow(accent: string, share: number): string {
  const s = Number.isFinite(share) ? Math.min(1, Math.max(0, share)) : 0;
  return `color-mix(in oklab, ${accent} ${Math.round(20 + s * 60)}%, transparent)`;
}

/** What a charge remembers across a rebuild: the dur it was built for and its head's `begin`. */
export type ChainHead = { dur: number; head: number };

/**
 * The next chain's head, carried from the last one.
 *
 * The same dur hands back the same head untouched, so a re-run that changes
 * nothing moves nothing (and never asks the clock). A new dur reads the SVG's
 * clock once and re-phases the head so the comet stays where it is. No clock
 * (the host is not in a document yet) starts from the top of the path.
 */
export function carryHead(
  last: ChainHead | undefined,
  dur: number,
  clock: () => number | undefined,
): ChainHead {
  if (!last) return { dur, head: 0 };
  if (last.dur === dur) return last;
  const now = clock() ?? Number.NaN;
  return { dur, head: rephasedBegin(now, animationPhase(now, last.head, last.dur), dur) };
}
