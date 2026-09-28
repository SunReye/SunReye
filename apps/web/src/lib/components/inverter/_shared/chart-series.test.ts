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
import type { AxisSeries } from "$lib/inverter/chart-axes";
import { groupedBarProps, resolveAxes, seriesConfig, stackedBarProps } from "./chart-series";

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

describe("series plumbing", () => {
  test("the chart config keys each series' label and colour by its key", () => {
    expect(
      seriesConfig([
        { key: "pv", label: "Solar", color: "gold" },
        { key: "grid", label: "Grid", color: "grey" },
      ]),
    ).toEqual({ pv: { label: "Solar", color: "gold" }, grid: { label: "Grid", color: "grey" } });
  });

  const series = (key: string, unit: string): AxisSeries => ({
    key,
    label: key,
    color: "red",
    unit,
    value: (d) => (typeof d[key] === "number" ? (d[key] as number) : null),
  });
  const rows = [
    { pv: 0, load: 2000, soc: 20 },
    { pv: 4000, load: 1000, soc: 80 },
  ];

  test("one unit passes the series through untouched, with no right axis", () => {
    const input = [series("pv", "W"), series("load", "W")];
    const axes = resolveAxes(rows, input);
    expect(axes.rightDomain).toBeNull();
    expect(axes.plotSeries).toBe(input);
    expect(axes.leftDomain[0]).toBeLessThanOrEqual(0);
    expect(axes.leftDomain[1]).toBeGreaterThanOrEqual(4000);
  });

  test("a second unit gets its own domain, and every series is normalised onto [0,1]", () => {
    const axes = resolveAxes(rows, [series("pv", "W"), series("load", "W"), series("soc", "%")]);
    expect(axes.grouping.dualAxis).toBe(true);
    expect(axes.rightDomain).not.toBeNull();
    const [, , soc] = axes.plotSeries;
    expect(soc?.key).toBe("soc");
    for (const s of axes.plotSeries) {
      for (const row of rows) {
        const v = s.value(row);
        expect(v).not.toBeNull();
        expect(v as number).toBeGreaterThanOrEqual(0);
        expect(v as number).toBeLessThanOrEqual(1);
      }
    }
  });
});
