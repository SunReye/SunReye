/**
 * Two fingers zoom a chart. One finger belongs to the page. Always, with
 * nothing to arm.
 *
 * ## Why this file exists rather than a LayerChart prop
 *
 * The library cannot express this arrangement, and it is worth writing down
 * exactly where it stops, because the obvious reading of its API says otherwise:
 *
 *  - `states/transform.svelte.js`, `onPointerDown` returns early when
 *    `disablePointer` is set. Pinch and one-finger pan enter through that same
 *    door, so there is no combination of `disablePointer` and `pinch` that
 *    yields "two fingers yes, one finger no".
 *  - with `disablePointer: false`, `TransformContext.svelte` writes an inline
 *    `touch-action: none` and calls `preventDefault()` on EVERY touchmove,
 *    single pointer included. That is precisely what took page scrolling away
 *    and why pinch had to be opt-in behind a chip: on /history, ~100 full-width
 *    charts deep, a chart that eats a vertical swipe cannot be read.
 *
 * So the chart keeps `disablePointer: true` forever — LayerChart then sets no
 * inline rule and preventDefaults nothing — and this module decides, per
 * pointer event, whether the gesture is ours. When it is, the caller drives
 * `transform.scaleTo()` / `setTranslate()` on the captured chart context and
 * calls `preventDefault()` itself. When it is not, the browser has never been
 * interfered with and the page scrolls exactly as it would over plain text.
 *
 * Pure for the usual reason: what breaks here is arithmetic over pointer
 * positions, and it is cheap to drive frame by frame in a test. Whether the
 * compositor agrees is `e2e/chart-gesture-lock.spec.ts`, which injects real
 * touch points through CDP because `page.touchscreen` only taps.
 */

import type { Point } from "./pointer-slop";

export type { Point };

/** A live pointer, kept in arrival order. */
export type Finger = { id: number; at: Point };

/**
 * The two fingers a pinch is anchored to, and the frame it was last measured in.
 *
 * Re-measured on every move rather than held from the start of the gesture, so
 * the factor handed to `scaleTo` is per-frame and multiplicative. Anchoring to
 * the gesture's start would mean either an absolute scale (which LayerChart's
 * `scaleTo` does not take — it multiplies) or a running division that
 * accumulates float error over a long pinch.
 */
export type PinchAnchor = { ids: [number, number]; span: number; mid: Point };

export type TouchState = { fingers: readonly Finger[]; anchor: PinchAnchor | null };

export type TouchEvent =
  | { kind: "down"; id: number; at: Point }
  | { kind: "move"; id: number; at: Point }
  /** `pointerup` and `pointercancel` alike — both mean the finger is gone. */
  | { kind: "lift"; id: number };

export type TouchAction =
  /** Not ours. Do not preventDefault; the page owns this pointer. */
  | { kind: "release" }
  /**
   * Ours. Multiply the domain scale by `factor` about `mid`, then pan by `pan`.
   * The caller preventDefaults, because it has now taken the gesture.
   */
  | { kind: "transform"; factor: number; mid: Point; pan: Point };

export type TouchOutcome = { state: TouchState; action: TouchAction };

/**
 * Which axis the span is measured on.
 *
 * Every chart in this app transforms in `domain` mode on `x` (see
 * ./gesture.ts), so a pinch's vertical component is noise: two fingers placed
 * one above the other would otherwise report a large span and a tiny horizontal
 * one, and the zoom would jump when they rotated. `"both"` is here for a chart
 * that ever transforms in two dimensions.
 */
export type PinchAxis = "x" | "both";

/**
 * The span below which a pinch reports no change, in CSS pixels.
 *
 * Two fingers that land on the same spot have a span near zero, and a factor of
 * `span / almost-zero` is an instant zoom to the scale ceiling. Below this the
 * anchor still tracks — so the gesture is live the moment they separate — but
 * the factor stays 1.
 *
 * Not exported: nothing outside needs the number, only the behaviour. Its own
 * test restates the 12 rather than importing it, so a change to either has to be
 * argued against the other.
 */
const MIN_PINCH_SPAN_PX = 12;

const RELEASE: TouchAction = { kind: "release" };

function spanOf(a: Point, b: Point, axis: PinchAxis): number {
  const dx = Math.abs(a.x - b.x);
  if (axis === "x") return dx;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function midOf(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function find(fingers: readonly Finger[], id: number): Finger | undefined {
  return fingers.find((f) => f.id === id);
}

/**
 * The pinch pair: the two OLDEST fingers down.
 *
 * Oldest rather than nearest, and the same choice LayerChart makes internally.
 * A third finger landing mid-pinch must not re-anchor the gesture — a palm
 * brushing the screen would otherwise make the chart jump — so it is tracked
 * (it may become the pair when one of the first two lifts) and ignored.
 */
function pairOf(fingers: readonly Finger[]): [Finger, Finger] | null {
  return fingers.length >= 2 ? [fingers[0]!, fingers[1]!] : null;
}

function anchorFrom(fingers: readonly Finger[], axis: PinchAxis): PinchAnchor | null {
  const pair = pairOf(fingers);
  if (!pair) return null;
  const [a, b] = pair;
  return { ids: [a.id, b.id], span: spanOf(a.at, b.at, axis), mid: midOf(a.at, b.at) };
}

/** The state a chart starts and returns to. */
export function touchIdle(): TouchState {
  return { fingers: [], anchor: null };
}

/** Is the chart currently holding the gesture? Drives the caller's cursor and
 *  its decision to suspend the tooltip. */
export function isPinching(state: TouchState): boolean {
  return state.anchor !== null;
}

/** A pointer set with its anchor recomputed — the state after any change. */
function settled(fingers: readonly Finger[], axis: PinchAxis): TouchState {
  return { fingers, anchor: anchorFrom(fingers, axis) };
}

/** Is this the same pair of fingers as before? A third finger promoted into the
 *  pair has no meaningful factor for the frame it arrives in. */
function samePair(a: PinchAnchor, b: PinchAnchor): boolean {
  return a.ids[0] === b.ids[0] && a.ids[1] === b.ids[1];
}

/**
 * What a moved finger does, given where the pair was in the previous frame.
 *
 * Split out of {@link touchStep} because this is the only arm with real
 * arithmetic in it, and inline it made one function the complexity gate reads as
 * three.
 */
function pinchFrame(previous: PinchAnchor | null, anchor: PinchAnchor | null): TouchAction {
  // One finger, or a third finger moving while the pair holds still: not ours.
  // The pair comparison is what makes the palm case safe.
  if (!anchor || !previous || !samePair(anchor, previous)) return RELEASE;

  const tooClose = previous.span < MIN_PINCH_SPAN_PX || anchor.span < MIN_PINCH_SPAN_PX;
  return {
    kind: "transform",
    factor: tooClose ? 1 : anchor.span / previous.span,
    mid: anchor.mid,
    pan: { x: anchor.mid.x - previous.mid.x, y: anchor.mid.y - previous.mid.y },
  };
}

/**
 * One pointer event against one state.
 *
 * Every path that is not "two or more fingers are down and one of them moved"
 * returns `release`. That default is the whole safety property: a single finger
 * is never touched, so page scrolling cannot regress no matter what else
 * changes here.
 */
export function touchStep(state: TouchState, event: TouchEvent, axis: PinchAxis): TouchOutcome {
  if (event.kind === "down") {
    // Re-pressing a live id would otherwise appear twice and corrupt the pair.
    const others = state.fingers.filter((f) => f.id !== event.id);
    return { state: settled([...others, { id: event.id, at: event.at }], axis), action: RELEASE };
  }

  if (event.kind === "lift") {
    // Dropping from two to one re-anchors to nothing: the finger left behind
    // must not silently become a one-finger pan, which is the exact gesture the
    // page needs back.
    return {
      state: settled(
        state.fingers.filter((f) => f.id !== event.id),
        axis,
      ),
      action: RELEASE,
    };
  }

  if (!find(state.fingers, event.id)) return { state, action: RELEASE };
  const moved = state.fingers.map((f) => (f.id === event.id ? { id: f.id, at: event.at } : f));
  const next = settled(moved, axis);
  return { state: next, action: pinchFrame(state.anchor, next.anchor) };
}
