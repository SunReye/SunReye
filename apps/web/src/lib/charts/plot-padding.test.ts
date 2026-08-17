/**
 * The narrow-plot clamp, on its own terms.
 *
 * `$lib/cost/ranges` grew this because the statistics charts needed it first,
 * but a /history area chart and an automations decision chart are not cost
 * charts and must not import a cost module to learn how wide a phone axis label
 * is. The clamp lives here; the cost family keeps its own BASES there.
 *
 * The rule that makes this safe to point at a hand-tuned chart: it only ever
 * gives room back. A chart hands in the gutters it already writes, so its
 * desktop appearance cannot change — only the phone narrows.
 */

import { describe, expect, it } from "bun:test";
import {
  CHART_NARROW_PX,
  fittedPadding,
  isNarrowPlot,
  shouldRenderPlot,
  type ChartPadding,
} from "./plot-padding";

/** A width comfortably inside the narrow band — a 412px phone's plot box. */
const PHONE = 412;
/** A width comfortably outside it — a chart on a laptop. */
const DESKTOP = 1200;

/** A hand-tuned base wider than either cap, so both clamps have work to do. */
const BASE: ChartPadding = { top: 8, right: 44, bottom: 28, left: 44 };

describe("isNarrowPlot", () => {
  it("is exclusive at the boundary", () => {
    expect(isNarrowPlot(CHART_NARROW_PX)).toBe(false);
    expect(isNarrowPlot(CHART_NARROW_PX - 1)).toBe(true);
  });

  it("reads an unmeasured or nonsensical width as wide", () => {
    // `bind:clientWidth` is 0 until the element is in the document; a cramped
    // desktop chart for one frame is the more visible of the two wrong answers.
    expect(isNarrowPlot(0)).toBe(false);
    expect(isNarrowPlot(Number.NaN)).toBe(false);
    expect(isNarrowPlot(-1)).toBe(false);
  });
});

describe("shouldRenderPlot", () => {
  // The measuring pass is why this exists. A chart whose padding follows
  // `bind:clientWidth` renders ONCE at width 0 — every scale, tick, grid line,
  // spline and area path — and then rebuilds all of it when the bind lands and
  // the padding changes. Holding the plot back for that one frame halves the
  // construction cost of every card the page mounts.

  it("holds the plot back until the wrapper has been measured", () => {
    expect(shouldRenderPlot(0)).toBe(false);
  });

  it("draws as soon as a real width arrives", () => {
    expect(shouldRenderPlot(320)).toBe(true);
    expect(shouldRenderPlot(1)).toBe(true);
    expect(shouldRenderPlot(1200)).toBe(true);
  });

  it("refuses a width that is not a usable number", () => {
    // A collapsed or detached wrapper must not produce a plot with NaN scales:
    // d3 turns those into `d="MNaN,NaN"` and the card renders empty for good.
    expect(shouldRenderPlot(Number.NaN)).toBe(false);
    expect(shouldRenderPlot(-1)).toBe(false);
    expect(shouldRenderPlot(Infinity)).toBe(false);
  });

  it("agrees with the clamp about what counts as measured", () => {
    // `isNarrowPlot` already reads 0/NaN/negative as "not measured yet, assume
    // wide". The gate must not admit a width the clamp would refuse to judge,
    // or the plot renders on exactly the widths the gate exists to skip.
    for (const width of [0, -1, Number.NaN]) {
      expect(shouldRenderPlot(width)).toBe(false);
      expect(fittedPadding(BASE, width)).toEqual(BASE);
    }
  });
});

describe("fittedPadding", () => {
  it("hands a wide plot exactly the base it was given", () => {
    expect(fittedPadding(BASE, DESKTOP)).toEqual(BASE);
    expect(fittedPadding(BASE, 0)).toEqual(BASE);
  });

  it("caps both horizontal gutters on a phone", () => {
    const narrow = fittedPadding(BASE, PHONE);
    expect(narrow.left).toBe(34);
    expect(narrow.right).toBe(8);
  });

  it("leaves the vertical gutters alone — they carry the x-axis labels", () => {
    const narrow = fittedPadding(BASE, PHONE);
    expect(narrow.top).toBe(BASE.top);
    expect(narrow.bottom).toBe(BASE.bottom);
  });

  it("caps rather than sets, so a base already tighter than the cap survives", () => {
    // The clamp must never SPEND room a chart did not ask for: 6px of right
    // gutter stays 6px, not the 8px cap.
    const tight: ChartPadding = { top: 6, right: 6, bottom: 6, left: 30 };
    expect(fittedPadding(tight, PHONE)).toEqual(tight);
  });

  it("keeps a right gutter that carries an axis legible", () => {
    // A dual-axis chart draws real tick labels in its right gutter. Clamped to
    // the 8px overhang cap those labels would have nowhere to go, so a gutter
    // declared as an axis gets the same room the left axis gets.
    const narrow = fittedPadding(BASE, PHONE, { rightAxis: true });
    expect(narrow.right).toBe(narrow.left);
    expect(narrow.right).toBeGreaterThanOrEqual(30);
  });

  it("still narrows an axis-bearing right gutter rather than exempting it", () => {
    expect(fittedPadding(BASE, PHONE, { rightAxis: true }).right).toBeLessThan(BASE.right);
  });

  it("never grows a gutter, whatever the base and whichever the width", () => {
    for (const width of [PHONE, DESKTOP, 0, CHART_NARROW_PX]) {
      for (const rightAxis of [false, true]) {
        const fitted = fittedPadding(BASE, width, { rightAxis });
        expect(fitted.left).toBeLessThanOrEqual(BASE.left);
        expect(fitted.right).toBeLessThanOrEqual(BASE.right);
      }
    }
  });
});
