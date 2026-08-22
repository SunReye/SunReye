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
import { glideDurationMs, readoutGlideMs } from "./glide";

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

/**
 * `readoutGlideMs` — the same policy, with an off-screen escape hatch.
 *
 * The live readout renders in the card's readout row, ABOVE the
 * `{#if !mounted}` gate that lazily builds the chart — as it did from the
 * Section's `actions` snippet before the row existed. So all 63 history cards
 * ran a readout Tween while only a handful of charts existed, and the glide
 * (1150ms at the measured 1s cadence) is LONGER than the feed interval — the
 * rAF loop never settles. Measured: 829 text mutations per 10s on /history
 * against 78 on /.
 *
 * The fix is a duration of 0, not an unmount. A 0-duration Tween SNAPS and
 * starts no rAF loop — exactly the mechanism reduced motion already uses — so
 * the off-screen readout still shows the correct latest value, and scrolling
 * back shows no em dash and no flash.
 */
describe("readoutGlideMs", () => {
  test("is byte-identical to glideDurationMs whenever the card is on screen", () => {
    // The on-screen readout must not change at all. If this ever diverges, the
    // fix has started costing the thing it was meant to leave alone.
    for (const gap of [0, -5, 100, 260, 300, 1000, 2000, 5000, Number.NaN]) {
      expect(readoutGlideMs(gap, false, true)).toBe(glideDurationMs(gap, false));
      expect(readoutGlideMs(gap, true, true)).toBe(glideDurationMs(gap, true));
    }
  });

  test("snaps to 0 for an off-screen card at every cadence", () => {
    for (const gap of [0, -5, -10_000, 100, 1000, 5000, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(readoutGlideMs(gap, false, false)).toBe(0);
    }
  });

  test("reduced motion still wins when the card is on screen", () => {
    expect(readoutGlideMs(1000, true, true)).toBe(0);
    expect(readoutGlideMs(1000, false, true)).toBe(1150);
  });

  test("neither flag can resurrect motion the other has switched off", () => {
    expect(readoutGlideMs(1000, true, false)).toBe(0);
  });
});
