/**
 * The width-aware chart fit: how much of a plot box is spent on gutters and how
 * densely the x-axis is labelled, decided from the plot's MEASURED width rather
 * than from a breakpoint.
 *
 * A breakpoint would be the wrong input. The same chart renders full-bleed on
 * the history page and inside a two-up grid on statistics, so the viewport says
 * nothing about how wide the plot actually is — at 412px the 60px left gutter
 * alone was 15% of the screen.
 *
 * The designed numbers themselves are module-private: the three functions below
 * are the whole surface, so a caller cannot reach past them for the fixed
 * desktop padding the way every chart used to. These cases are about the COST
 * family's bases; the clamp they all run through is $lib/charts/plot-padding.
 */

import { describe, expect, it } from "bun:test";
import { CHART_NARROW_PX } from "$lib/charts/plot-padding";
import { chartPaddingFor, heatPaddingFor, xTickSpacingFor } from "./ranges";

/** A width comfortably inside the narrow band — a 412px phone's plot box. */
const PHONE = 412;
/** A width comfortably outside it — a chart on a laptop. */
const DESKTOP = 1200;

describe("the narrow boundary", () => {
  it("is exclusive: the boundary width itself gets the designed gutters", () => {
    expect(chartPaddingFor(CHART_NARROW_PX)).toEqual(chartPaddingFor(DESKTOP));
    expect(chartPaddingFor(CHART_NARROW_PX - 1)).not.toEqual(chartPaddingFor(DESKTOP));
    expect(xTickSpacingFor(CHART_NARROW_PX)).toBe(xTickSpacingFor(DESKTOP));
    expect(xTickSpacingFor(CHART_NARROW_PX - 1)).not.toBe(xTickSpacingFor(DESKTOP));
  });

  it("treats an unmeasured plot as wide", () => {
    // `bind:clientWidth` is 0 until the element is in the document. Answering
    // "narrow" there would render every chart cramped for one frame on a
    // desktop, which is the more visible of the two wrong answers.
    expect(chartPaddingFor(0)).toEqual(chartPaddingFor(DESKTOP));
    expect(chartPaddingFor(Number.NaN)).toEqual(chartPaddingFor(DESKTOP));
    expect(xTickSpacingFor(0)).toBe(xTickSpacingFor(DESKTOP));
  });

  it("does not read a negative width as a very narrow plot", () => {
    expect(chartPaddingFor(-1)).toEqual(chartPaddingFor(DESKTOP));
  });
});

describe("chartPaddingFor", () => {
  it("keeps the designed gutters on a wide plot", () => {
    // The contract, stated once: a four-digit figure with its unit on the left,
    // the last tick label's overhang on the right.
    expect(chartPaddingFor(DESKTOP)).toEqual({ top: 8, right: 24, bottom: 20, left: 60 });
  });

  it("gives a phone most of that horizontal room back", () => {
    const wide = chartPaddingFor(DESKTOP);
    const narrow = chartPaddingFor(PHONE);
    expect(wide.left + wide.right - (narrow.left + narrow.right)).toBeGreaterThanOrEqual(40);
  });

  it("still leaves the y-axis room for a four-digit label", () => {
    // "1,000" at text-xs is ~30px; below that the figures clip, which is the
    // regression the 60px gutter was introduced to fix in the first place.
    expect(chartPaddingFor(PHONE).left).toBeGreaterThanOrEqual(30);
  });

  it("keeps the vertical gutters, which carry the x-axis labels", () => {
    // Those cost the same height at every width — trimming them would clip the
    // tick text rather than save space.
    const wide = chartPaddingFor(DESKTOP);
    const narrow = chartPaddingFor(PHONE);
    expect(narrow.top).toBe(wide.top);
    expect(narrow.bottom).toBe(wide.bottom);
  });
});

describe("heatPaddingFor", () => {
  it("has gutters of its own — a weekday label, not a kWh figure", () => {
    expect(heatPaddingFor(DESKTOP)).toEqual({ top: 4, right: 8, bottom: 24, left: 40 });
  });

  it("narrows the left gutter to the same cap as every other chart", () => {
    expect(heatPaddingFor(PHONE).left).toBe(chartPaddingFor(PHONE).left);
  });

  it("caps rather than sets, so a gutter already tighter than the cap survives", () => {
    // The heat grid's 8px right gutter is deliberate; a helper that SET the
    // narrow value would be spending space here instead of saving it.
    expect(heatPaddingFor(PHONE).right).toBe(heatPaddingFor(DESKTOP).right);
    expect(heatPaddingFor(PHONE).right).toBeLessThanOrEqual(chartPaddingFor(PHONE).right);
  });
});

describe("xTickSpacingFor", () => {
  it("packs the labels tighter on a narrow plot, without letting them collide", () => {
    const narrow = xTickSpacingFor(PHONE);
    expect(narrow).toBeLessThan(xTickSpacingFor(DESKTOP));
    // "00:00" at text-xs is ~34px; below that the labels run together, which is
    // the bug the spacing exists to prevent.
    expect(narrow).toBeGreaterThanOrEqual(40);
  });

  it("buys a 412px phone at least six x-axis anchors", () => {
    const pad = chartPaddingFor(PHONE);
    const plot = PHONE - pad.left - pad.right;
    expect(Math.floor(plot / xTickSpacingFor(PHONE))).toBeGreaterThanOrEqual(6);
    // …where the old fixed pair gave it four.
    const oldPad = chartPaddingFor(DESKTOP);
    const oldPlot = PHONE - oldPad.left - oldPad.right;
    expect(Math.floor(oldPlot / xTickSpacingFor(DESKTOP))).toBeLessThan(6);
  });
});
