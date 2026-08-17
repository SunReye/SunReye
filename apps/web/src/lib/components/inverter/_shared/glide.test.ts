/**
 * The glide duration policy — the ONE home of the floor and the overshoot.
 *
 * It used to have two: `MIN_GLIDE_MS`/`GLIDE_OVERSHOOT` in `animated-number.ts`
 * for the readouts and `MIN_DURATION_MS`/`OVERSHOOT` in `live-window.ts` for the
 * charts, holding the same numbers with nothing pinning them together. The
 * numbers are not a coincidence: the readouts and the plot drift side by side on
 * the same page against the same feed, so a tweak to one that missed the other
 * would desynchronise them visibly. `live-glide-wiring.test.ts` asserts that
 * neither module defines them any more.
 */

import { describe, expect, test } from "bun:test";
import { glideDurationMs } from "./glide";

describe("glideDurationMs", () => {
  test("stretches the glide 1.15x past the gap so the motion is still running when the next sample lands", () => {
    // The overshoot is the point: arriving early and freezing until the feed
    // ticks again is what made a slow feed look like it stopped, then jumped.
    expect(glideDurationMs(1000, false)).toBe(1150);
    expect(glideDurationMs(2000, false)).toBe(2300);
    expect(glideDurationMs(5000, false)).toBe(5750);
  });

  test("floors a fast gap at 300ms — a burst must still animate, not flicker", () => {
    expect(glideDurationMs(300, false)).toBe(345);
    expect(glideDurationMs(260, false)).toBe(300);
    expect(glideDurationMs(100, false)).toBe(300);
  });

  test("zero, negative and non-finite gaps take the floor rather than a 0ms snap", () => {
    // The charts pre-clamp their interval, but the readouts take a cadence
    // straight off the bus: a first frame, a counter restart or a stalled feed
    // can all hand this 0, a negative, or NaN. None of them may collapse the
    // glide to nothing while motion is still allowed.
    for (const gap of [0, -5, -10_000, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(glideDurationMs(gap, false)).toBe(300);
    }
  });

  test("reduced motion is 0 for every gap — the value still updates, it just steps", () => {
    // The drift is a motion affordance, not information. At 0 the Tween snaps on
    // each sample and the 60Hz rAF loop never starts.
    for (const gap of [0, -5, 100, 250, 1000, 5000, Number.NaN]) {
      expect(glideDurationMs(gap, true)).toBe(0);
    }
  });

  test("is monotonic above the floor, so a slower feed never glides faster", () => {
    let previous = 0;
    for (const gap of [250, 500, 1000, 2500, 5000]) {
      const duration = glideDurationMs(gap, false);
      expect(duration).toBeGreaterThanOrEqual(previous);
      previous = duration;
    }
  });
});
