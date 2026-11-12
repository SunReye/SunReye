// The comet charges of the 2D flow (ADR 21). Ported from v3 (dev 780b4e2, lib/inverter/flow-pulse.ts)
// by way of the prototype.
import { CEILING_FLOOR_W } from "./ceiling.ts";
import type { Flow } from "./schematic.ts";

/** Total power the plant is moving right now: what the ceiling is fed. */
export function throughputWatts(
  segments: readonly { readonly flow: Flow; readonly value?: number | undefined }[],
): number {
  return segments.reduce((t, s) => (s.flow === "in" ? t + Math.abs(s.value ?? 0) : t), 0);
}

/**
 * Magnitude relative to the remembered plant, quantized so a 1 Hz wobble
 * writes no styles at all. Sign is carried by colour and travel direction.
 */
export function pulseShare(watts: number | undefined, ceilingW: number): number {
  const a = Math.abs(watts ?? 0);
  const c = Number.isFinite(ceilingW) && ceilingW > 0 ? ceilingW : CEILING_FLOOR_W;

  // No measurement is no flow, not full throttle.
  if (Number.isNaN(a)) return 0;

  // Infinity reads as full, not 0.
  if (!Number.isFinite(a)) return 1;

  return Math.round(Math.min(1, a / c) * 20) / 20;
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
  readonly share: number;
  /** Crossing time (s) — the magnitude, quantized so most samples change it not at all. */
  readonly dur: number;
  /** Sprite scale — a busier rail flies a bigger charge. */
  readonly scale: number;
  /** Blur radius (px) softening the sprite's edge. */
  readonly blur: number;
  /** Near-glow spread (px); the far glow is 3x it. */
  readonly glow: number;
  /** Overlay stroke width (px) for the reduced-motion still. */
  readonly width: number;
};

/**
 * Share → crossing time. Inverted: more power is less time on the wire.
 */
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

/** A bead's size against the head's (1) and its opacity. */
export interface Bead {
  readonly radius: number;
  readonly opacity: number;
}

/**
 * Bead `k`'s look: 0 is the head. Radius falls off slower than opacity, so the
 * comet keeps a body before it closes to a point rather than fading to a stub.
 */
export function bead(k: number): Bead {
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
export function animationPhase(nowS: number, beginS: number, dur: number): number {
  if (![nowS, beginS, dur].every((n) => Number.isFinite(n)) || dur <= 0) return 0;
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
export function rephasedBegin(nowS: number, phase: number, dur: number): number {
  if (![nowS, phase, dur].every((n) => Number.isFinite(n)) || dur <= 0) return 0;
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
export type ChainHead = { readonly dur: number; readonly head: number };

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
