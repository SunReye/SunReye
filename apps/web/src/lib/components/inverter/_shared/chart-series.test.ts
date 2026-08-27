/**
 * The bar-layout props the statistics charts share.
 *
 * Two charts now draw grouped bars over a period axis — the year-over-year
 * comparison and the energy flows — and the numbers below are d3 BAND
 * FRACTIONS, not pixels. `groupPadding: 1` is the degenerate maximum and
 * collapses every pair to zero width, which is a chart that renders nothing
 * with no error anywhere. So the values live in one function with a test on it
 * rather than as literals in each chart.
 */

import { describe, expect, test } from "bun:test";
import { MARK_STYLE } from "$lib/charts/house-style";
import { groupedBarProps, stackedBarProps } from "./chart-series";

describe("grouped bars over a period axis", () => {
  test("a one- or two-bucket window is not drawn as slabs", () => {
    // A month picked with two days of data otherwise renders two bars half the
    // viewport wide, which reads as a bug rather than as a short window.
    expect(groupedBarProps(2, 800).bandPadding).toBeGreaterThan(
      groupedBarProps(31, 800).bandPadding,
    );
  });

  test("the group padding is a fraction, and never the degenerate one", () => {
    const { groupPadding } = groupedBarProps(12, 800);
    expect(groupPadding).toBeGreaterThan(0);
    expect(groupPadding).toBeLessThan(1);
  });

  test("the gutters follow the measured plot, so a phone gets a phone's gutter", () => {
    const phone = groupedBarProps(31, 390);
    const desktop = groupedBarProps(31, 1200);
    expect(phone.padding.left).toBeLessThan(desktop.padding.left);
    // And the axis thins its labels on the narrow one rather than overlapping.
    expect(phone.props.xAxis.tickSpacing).toBeLessThan(desktop.props.xAxis.tickSpacing);
  });

  test("grouped bars carry no outline", () => {
    // LayerChart draws every bar with a 1px stroke by default, and it is drawn
    // in the FOREGROUND colour. On twelve wide bands that reads as a deliberate
    // edge; on six series over thirty-one days each bar is under two pixels
    // wide, the strokes of adjacent bars meet, and the whole plot renders as a
    // black comb with the six hues invisible behind it. Measured at 390px:
    // 186 bars across ~330px of plot.
    expect(groupedBarProps(31, 390).props.bars.strokeWidth).toBe(MARK_STYLE.energy.strokeWidth);
    expect(MARK_STYLE.energy.strokeWidth).toBe(0);
    // And the colour, which is the half that actually stops it: `ctx.lineWidth
    // = 0` is a no-op in the 2D context, so a canvas bar keeps whatever width
    // was last set and draws the outline anyway. Measured — the width alone
    // left the phone plot a black comb.
    expect(groupedBarProps(31, 390).props.bars.stroke).toBe("none");
  });

  test("grouped bars carry no stack gap — there is no stack", () => {
    // `stackPadding` on a grouped layout eats bar width for a gap between
    // segments that do not exist.
    expect("stackPadding" in groupedBarProps(12, 800)).toBe(false);
    expect("stackPadding" in stackedBarProps(12, 800)).toBe(true);
  });
});
