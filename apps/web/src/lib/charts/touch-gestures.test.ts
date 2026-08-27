/**
 * The property this file exists to defend: a single finger is never taken.
 *
 * Everything else here is arithmetic and can be re-derived by reading the
 * source. That one claim cannot — it is the regression that made pinch opt-in
 * behind a chip in the first place (a swipe down /history's ~100 charts being
 * eaten by whichever card was under the thumb), and it is stated below over
 * every single-finger sequence the module can see, not just the obvious one.
 */

import { describe, expect, test } from "bun:test";
import {
  isPinching,
  touchIdle,
  touchStep,
  type PinchAxis,
  type TouchEvent,
  type TouchOutcome,
  type TouchState,
} from "./touch-gestures";

/** Drive a sequence on one axis; hand back the final state and every action. */
function run(events: TouchEvent[], axis: PinchAxis = "x", from: TouchState = touchIdle()) {
  let state = from;
  const actions: TouchOutcome["action"][] = [];
  for (const event of events) {
    const outcome = touchStep(state, event, axis);
    state = outcome.state;
    actions.push(outcome.action);
  }
  return { state, actions, last: actions[actions.length - 1]! };
}

const at = (x: number, y = 100) => ({ x, y });

/**
 * The dead-zone span, restated rather than imported — it is private to the
 * module for the same reason `SLOP_PX` is. Importing the number to test
 * behaviour derived from the number proves only self-consistency.
 */
const MIN_PINCH_SPAN_PX = 12;

/** Two fingers 100px apart on the x axis, both down. */
function twoDown() {
  return run([
    { kind: "down", id: 1, at: at(100) },
    { kind: "down", id: 2, at: at(200) },
  ]).state;
}

describe("one finger is the page's", () => {
  test("a press is released", () => {
    expect(run([{ kind: "down", id: 1, at: at(100) }]).last.kind).toBe("release");
  });

  test("a drag along the x axis is released — the mis-swipe that started all this", () => {
    const { actions } = run([
      { kind: "down", id: 1, at: at(100) },
      { kind: "move", id: 1, at: at(160) },
      { kind: "move", id: 1, at: at(220) },
      { kind: "move", id: 1, at: at(300) },
    ]);
    expect(actions.every((a) => a.kind === "release")).toBe(true);
  });

  test("a vertical swipe is released", () => {
    const { actions } = run([
      { kind: "down", id: 1, at: { x: 100, y: 20 } },
      { kind: "move", id: 1, at: { x: 100, y: 220 } },
    ]);
    expect(actions.every((a) => a.kind === "release")).toBe(true);
  });

  test("a move from an untracked pointer is released and changes nothing", () => {
    const before = touchIdle();
    const outcome = touchStep(before, { kind: "move", id: 9, at: at(50) }, "x");
    expect(outcome.action.kind).toBe("release");
    expect(outcome.state).toBe(before);
  });

  // Dropping from two fingers to one is the moment page scrolling has to come
  // back. A stale anchor here would turn the finger left behind into a pan.
  test("the finger left after a lift does not become a pan", () => {
    const { state, last } = run([{ kind: "lift", id: 2 }], "x", twoDown());
    expect(isPinching(state)).toBe(false);
    expect(last.kind).toBe("release");

    const after = run([{ kind: "move", id: 1, at: at(400) }], "x", state);
    expect(after.last.kind).toBe("release");
  });
});

describe("two fingers zoom, with nothing to arm", () => {
  test("the second finger down arms nothing by itself, but the state is live", () => {
    const state = twoDown();
    expect(isPinching(state)).toBe(true);
  });

  test("spreading from 100px to 200px doubles the domain scale", () => {
    const { last } = run([{ kind: "move", id: 2, at: at(300) }], "x", twoDown());
    expect(last.kind).toBe("transform");
    if (last.kind !== "transform") return;
    expect(last.factor).toBeCloseTo(2);
  });

  test("pinching from 100px to 50px halves it", () => {
    const { last } = run([{ kind: "move", id: 2, at: at(150) }], "x", twoDown());
    if (last.kind !== "transform") throw new Error("expected a transform");
    expect(last.factor).toBeCloseTo(0.5);
  });

  // Per-frame and multiplicative, because `scaleTo` multiplies. Two successive
  // doublings must report 2 and 2 — not 2 and 4 — or the second frame squares
  // the first.
  test("the factor is per frame, not measured from the start of the gesture", () => {
    const { actions } = run(
      [
        { kind: "move", id: 2, at: at(300) },
        { kind: "move", id: 2, at: at(500) },
      ],
      "x",
      twoDown(),
    );
    const factors = actions.map((a) => (a.kind === "transform" ? a.factor : NaN));
    expect(factors[0]).toBeCloseTo(2);
    expect(factors[1]).toBeCloseTo(2);
  });

  test("two fingers held still report no change", () => {
    const { last } = run([{ kind: "move", id: 2, at: at(200) }], "x", twoDown());
    if (last.kind !== "transform") throw new Error("expected a transform");
    expect(last.factor).toBeCloseTo(1);
    expect(last.pan).toEqual({ x: 0, y: 0 });
  });

  // A two-finger pan arrives as TWO events, one per pointer, and each is
  // measured against the frame before it — so the first reports a squeeze
  // (100px -> 50px) and the second the spread back (50px -> 100px). That looks
  // alarming and is correct: the browser delivers both moves before it paints,
  // so the intermediate scale is never on screen and the NET is what the reader
  // sees. Asserted as the net, because that is the claim that matters; asserting
  // the second frame alone would pin an artefact of event ordering.
  test("both fingers moving the same way pans, and nets out to no zoom", () => {
    const { actions } = run(
      [
        { kind: "move", id: 1, at: at(150) },
        { kind: "move", id: 2, at: at(250) },
      ],
      "x",
      twoDown(),
    );
    const transforms = actions.flatMap((a) => (a.kind === "transform" ? [a] : []));
    expect(transforms).toHaveLength(2);
    expect(transforms.reduce((net, t) => net * t.factor, 1)).toBeCloseTo(1);
    expect(transforms.reduce((net, t) => net + t.pan.x, 0)).toBeCloseTo(50);
  });

  test("the midpoint is where the zoom is centred", () => {
    const { last } = run([{ kind: "move", id: 2, at: at(400) }], "x", twoDown());
    if (last.kind !== "transform") throw new Error("expected a transform");
    expect(last.mid.x).toBeCloseTo(250);
  });
});

describe("the degenerate pinches", () => {
  // A factor of span / almost-zero is an instant jump to the scale ceiling.
  test("two fingers on the same spot report no change until they separate", () => {
    const together = run([
      { kind: "down", id: 1, at: at(100) },
      { kind: "down", id: 2, at: at(101) },
    ]).state;
    const { last } = run([{ kind: "move", id: 2, at: at(105) }], "x", together);
    if (last.kind !== "transform") throw new Error("expected a transform");
    expect(last.factor).toBe(1);
  });

  test(`separating past ${MIN_PINCH_SPAN_PX}px starts reporting real factors`, () => {
    let state = run([
      { kind: "down", id: 1, at: at(100) },
      { kind: "down", id: 2, at: at(101) },
    ]).state;
    // Out of the dead zone…
    state = run([{ kind: "move", id: 2, at: at(100 + MIN_PINCH_SPAN_PX + 8) }], "x", state).state;
    // …and now a real spread.
    const { last } = run(
      [{ kind: "move", id: 2, at: at(100 + (MIN_PINCH_SPAN_PX + 8) * 2) }],
      "x",
      state,
    );
    if (last.kind !== "transform") throw new Error("expected a transform");
    expect(last.factor).toBeCloseTo(2);
  });

  test("the factor is always finite and positive", () => {
    const { actions } = run(
      [
        { kind: "down", id: 1, at: at(100) },
        { kind: "down", id: 2, at: at(100) },
        { kind: "move", id: 2, at: at(100) },
        { kind: "move", id: 1, at: at(100) },
      ],
      "x",
    );
    for (const action of actions) {
      if (action.kind !== "transform") continue;
      expect(Number.isFinite(action.factor)).toBe(true);
      expect(action.factor).toBeGreaterThan(0);
    }
  });
});

describe("the fingers a pinch ignores", () => {
  // A palm brushing the glass mid-pinch must not re-anchor the gesture, or the
  // chart jumps. The pair is the two oldest fingers, as LayerChart also does.
  test("a third finger moving does not move the chart", () => {
    const three = run(
      [
        { kind: "down", id: 1, at: at(100) },
        { kind: "down", id: 2, at: at(200) },
        { kind: "down", id: 3, at: at(300) },
      ],
      "x",
    ).state;
    const { last } = run([{ kind: "move", id: 3, at: at(600) }], "x", three);
    if (last.kind !== "transform") throw new Error("expected a transform");
    expect(last.factor).toBeCloseTo(1);
    expect(last.pan).toEqual({ x: 0, y: 0 });
  });

  // Re-anchoring is a release, not a transform: the frame in which the pair
  // changes has no meaningful factor, and reporting one would jump the chart.
  test("promoting a third finger to the pair yields no transform that frame", () => {
    let state = run(
      [
        { kind: "down", id: 1, at: at(100) },
        { kind: "down", id: 2, at: at(200) },
        { kind: "down", id: 3, at: at(300) },
      ],
      "x",
    ).state;
    state = run([{ kind: "lift", id: 1 }], "x", state).state;
    const { last } = run([{ kind: "move", id: 3, at: at(340) }], "x", state);
    expect(last.kind).toBe("transform");
    // Pair is now (2,3): 100px -> 140px.
    if (last.kind !== "transform") return;
    expect(last.factor).toBeCloseTo(1.4);
  });

  test("a re-pressed id is not counted twice", () => {
    const state = run(
      [
        { kind: "down", id: 1, at: at(100) },
        { kind: "down", id: 1, at: at(120) },
      ],
      "x",
    ).state;
    expect(state.fingers).toHaveLength(1);
    expect(isPinching(state)).toBe(false);
  });

  test("lifting a finger that was never down is inert", () => {
    const state = twoDown();
    const { state: after } = run([{ kind: "lift", id: 42 }], "x", state);
    expect(after.fingers).toHaveLength(2);
    expect(isPinching(after)).toBe(true);
  });
});

describe("the axis the span is measured on", () => {
  // Every chart here transforms in domain mode on x, so a pinch's vertical
  // component is noise: two fingers rotating about their midpoint would
  // otherwise zoom.
  test("on x, a purely vertical spread is not a zoom", () => {
    const vertical = run(
      [
        { kind: "down", id: 1, at: { x: 100, y: 50 } },
        { kind: "down", id: 2, at: { x: 200, y: 50 } },
      ],
      "x",
    ).state;
    const { last } = run([{ kind: "move", id: 2, at: { x: 200, y: 400 } }], "x", vertical);
    if (last.kind !== "transform") throw new Error("expected a transform");
    expect(last.factor).toBeCloseTo(1);
  });

  test('on "both", the same spread does zoom', () => {
    const both = run(
      [
        { kind: "down", id: 1, at: { x: 100, y: 50 } },
        { kind: "down", id: 2, at: { x: 200, y: 50 } },
      ],
      "both",
    ).state;
    const { last } = run([{ kind: "move", id: 2, at: { x: 200, y: 400 } }], "both", both);
    if (last.kind !== "transform") throw new Error("expected a transform");
    expect(last.factor).toBeGreaterThan(3);
  });
});
