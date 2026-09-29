/**
 * The statistics axis fit policy.
 *
 * The browser spec (`e2e/statistics-axis-fit.spec.ts`) is what proves a label is
 * actually inside its plot — it measures the `fillText` boxes the canvas
 * renderer draws. This file pins the DECISION those numbers come from, and the
 * boundaries a fixture backend never renders: a four-digit kWh axis, a label
 * longer than the gutter may ever be, a chart with no values at all.
 */

import { describe, expect, test } from "bun:test";
import { chartPaddingFor } from "$lib/cost/ranges";
import {
  AXIS_CHAR_PX,
  AXIS_TICK_GAP_PX,
  axisValueLabels,
  defaultAxisLabel,
  fittedAxisPadding,
  fittedLeadingLabel,
  fittedTickSpacing,
  labelWidthPx,
  MAX_GUTTER_SHARE,
  seriesValues,
  widestLabelPx,
  withFittedAxes,
} from "./axis-fit";

/** A 360px phone: shell gutter, section gutter, and what is left for the plot. */
const PHONE_PLOT = 302;
const LAPTOP_PLOT = 900;

describe("label width", () => {
  test("is proportional to the character count", () => {
    expect(labelWidthPx("")).toBe(0);
    expect(labelWidthPx("30 kWh")).toBeCloseTo(6 * AXIS_CHAR_PX, 5);
  });

  // The estimate stands in for `measureText`, which a rune component cannot
  // call before the canvas exists. Measured in Chromium at the house axis size
  // (`text-xs`, 12px Geist Mono): "10" 14px, "09-27 00:00" 77px — 7.0px a
  // glyph. The 6.0px once measured here was layerchart's 10px default, drawn
  // only when the first chart to mount sat outside a `Chart.Container`. The
  // estimate must sit ABOVE the real size or the gutter it sizes is a clip
  // waiting to happen.
  test("is never under what the browser actually measured", () => {
    expect(AXIS_CHAR_PX).toBeGreaterThan(7);
  });

  test("the widest of a list wins, and an empty list has no width", () => {
    expect(widestLabelPx(["0%", "100%", "50%"])).toBe(labelWidthPx("100%"));
    expect(widestLabelPx([])).toBe(0);
  });
});

describe("the left gutter fits the widest label the axis will draw", () => {
  const base = chartPaddingFor(PHONE_PLOT);

  test("a phone kWh axis gets room for its unit instead of clipping it", () => {
    // The reported defect, in numbers: the clamp's 34px against a "30 kWh"
    // label the browser draws 36px wide, right-aligned 4px off the axis.
    expect(base.left).toBeLessThan(labelWidthPx("30 kWh"));
    const fitted = fittedAxisPadding(base, PHONE_PLOT, ["0 kWh", "30 kWh"]);
    expect(fitted.left).toBeGreaterThanOrEqual(labelWidthPx("30 kWh") + AXIS_TICK_GAP_PX);
  });

  test("and keeps growing for a four-digit household", () => {
    const small = fittedAxisPadding(base, PHONE_PLOT, ["0 kWh", "30 kWh"]);
    const large = fittedAxisPadding(base, PHONE_PLOT, ["0 kWh", "1.240,5 kWh"]);
    expect(large.left).toBeGreaterThan(small.left);
    expect(large.left).toBeGreaterThanOrEqual(labelWidthPx("1.240,5 kWh") + AXIS_TICK_GAP_PX);
  });

  test("a narrow label gives the room back rather than keeping the base", () => {
    // "0%"/"100%" fit inside the clamp, so the ratio chart must not pay for the
    // kWh chart's gutter. Its domain is PINNED to [0, 1], so no tick can round
    // past it into another character either.
    expect(fittedAxisPadding(base, PHONE_PLOT, ["0%", "100%"], { rounded: false }).left).toBe(
      base.left,
    );
    expect(
      fittedAxisPadding(base, PHONE_PLOT, ["0%", "100%"], { rounded: false }).left,
    ).toBeLessThan(fittedAxisPadding(base, PHONE_PLOT, ["0 kWh", "30 kWh"]).left);
  });

  test("the gutter never eats the plot, however long the label", () => {
    const absurd = fittedAxisPadding(base, PHONE_PLOT, ["0 kWh", "123.456.789,0 kWh"]);
    expect(absurd.left).toBeLessThanOrEqual(PHONE_PLOT * MAX_GUTTER_SHARE);
  });

  test("nothing to fit, or nothing measured, leaves the base alone", () => {
    expect(fittedAxisPadding(base, PHONE_PLOT, [])).toEqual(base);
    // `bind:clientWidth` is 0 until the element is in the document — the same
    // reading of "unmeasured" the clamp itself uses.
    expect(fittedAxisPadding(base, 0, ["0 kWh", "30 kWh"])).toEqual(base);
  });

  test("a desktop plot keeps its designed gutter", () => {
    const wide = chartPaddingFor(LAPTOP_PLOT);
    expect(fittedAxisPadding(wide, LAPTOP_PLOT, ["0 kWh", "30 kWh"])).toEqual(wide);
  });

  test("the other three sides are never touched", () => {
    const fitted = fittedAxisPadding(base, PHONE_PLOT, ["1.240,5 kWh"]);
    expect({ top: fitted.top, right: fitted.right, bottom: fitted.bottom }).toEqual({
      top: base.top,
      right: base.right,
      bottom: base.bottom,
    });
  });
});

// A band axis centres each label on its band, so the FIRST label hangs half its
// width left of the first band — into the gutter, and past the canvas once it is
// wider than twice the gutter. The price curve's day-start "09-27 00:00" is the
// case: 77px drawn against a 34px phone gutter, 3px outside the canvas.
describe("the left gutter holds the first x label's overhang", () => {
  const base = chartPaddingFor(PHONE_PLOT);

  test("a long first label widens the gutter to half its width", () => {
    expect(base.left).toBeLessThan(labelWidthPx("09-27 00:00") / 2);
    const fitted = fittedLeadingLabel(base, PHONE_PLOT, "09-27 00:00");
    expect(fitted.left).toBeGreaterThanOrEqual(labelWidthPx("09-27 00:00") / 2);
  });

  test("a label that already fits keeps the gutter it had", () => {
    expect(fittedLeadingLabel(base, PHONE_PLOT, "00:00")).toEqual(base);
  });

  test("the gutter never eats the plot, however long the label", () => {
    const absurd = fittedLeadingLabel(base, PHONE_PLOT, "x".repeat(200));
    expect(absurd.left).toBeLessThanOrEqual(PHONE_PLOT * MAX_GUTTER_SHARE);
  });

  test("no label, or no measured plot, leaves the base alone", () => {
    expect(fittedLeadingLabel(base, PHONE_PLOT, undefined)).toEqual(base);
    expect(fittedLeadingLabel(base, PHONE_PLOT, "")).toEqual(base);
    expect(fittedLeadingLabel(base, 0, "09-27 00:00")).toEqual(base);
  });

  test("only the left side moves", () => {
    const fitted = fittedLeadingLabel(base, PHONE_PLOT, "09-27 00:00");
    expect({ ...fitted, left: base.left }).toEqual(base);
  });
});

describe("x tick spacing fits the widest label the axis will draw", () => {
  test("short labels keep the spacing the plot width chose", () => {
    expect(fittedTickSpacing(48, ["00:00", "05:00"])).toBe(48);
  });

  test("a long date label is what decides the spacing, not the breakpoint", () => {
    // The battery-health trend labels every measurement `dd.mm.yyyy`. At the
    // phone's 48px spacing those run into each other; nothing about the
    // viewport can know that, only the label.
    const spacing = fittedTickSpacing(48, ["17.09.2026", "03.08.2026"]);
    expect(spacing).toBeGreaterThan(labelWidthPx("17.09.2026"));
    expect(spacing).toBeGreaterThan(48);
  });

  test("no labels, no opinion", () => {
    expect(fittedTickSpacing(48, [])).toBe(48);
  });
});

describe("the values an axis will be asked to label", () => {
  const rows = [
    { label: "a", importKwh: 2, exportKwh: null },
    { label: "b", importKwh: 31.4, exportKwh: 7 },
  ];

  test("are read through the accessor when there is one, and the key otherwise", () => {
    expect(
      seriesValues(rows, [{ key: "importKwh" }, { key: "x", value: (r) => r.exportKwh }]),
    ).toEqual([2, 31.4, null, 7]);
  });

  test("become the two extremes, formatted the way the axis will format them", () => {
    const kwh = (v: unknown) => `${Number(v)} kWh`;
    expect(axisValueLabels([2, null, 31.4, Number.NaN], kwh)).toEqual(["2 kWh", "31.4 kWh"]);
  });

  test("a series of nothing labels nothing", () => {
    expect(axisValueLabels([null, undefined, Number.NaN], String)).toEqual([]);
  });

  // A tick sits at a round number AT OR ABOVE the data's own maximum: 28.6 kWh
  // is labelled "30 kWh" and 98 kWh is labelled "100 kWh" — one character the
  // data never contained. The fit has to carry that character.
  test("the fit allows for the tick rounding past the data's maximum", () => {
    const base = chartPaddingFor(PHONE_PLOT);
    const fitted = fittedAxisPadding(base, PHONE_PLOT, ["98 kWh"]);
    expect(fitted.left).toBeGreaterThanOrEqual(labelWidthPx("100 kWh") + AXIS_TICK_GAP_PX);
    // …and drops that allowance for an axis that CANNOT round past its data,
    // because the caller pinned the domain (the ratio charts' [0, 1]).
    expect(fittedAxisPadding(base, PHONE_PLOT, ["98 kWh"], { rounded: false }).left).toBeLessThan(
      fitted.left,
    );
  });

  test("the plain axis label rounds the way an untouched numeric axis reads", () => {
    expect(defaultAxisLabel(3.27)).toBe("3.3");
    expect(defaultAxisLabel(0)).toBe("0");
  });
});

describe("a bar chart's layout spread carries the same fit", () => {
  test("the fitted padding and spacing replace the ones the base props chose", () => {
    const layout = {
      bandPadding: 0.2,
      padding: chartPaddingFor(PHONE_PLOT),
      props: { xAxis: { tickSpacing: 48 }, bars: { stroke: "none" } },
    };
    const fitted = withFittedAxes(layout, PHONE_PLOT, {
      yLabels: ["0 kWh", "30 kWh"],
      xLabels: ["17.09.2026"],
    });

    expect(fitted.padding.left).toBeGreaterThan(layout.padding.left);
    expect(fitted.props.xAxis.tickSpacing).toBeGreaterThan(48);
    // Everything the caller's props builder decided is still there: the fit
    // adds room, it does not take the layout over.
    expect(fitted.bandPadding).toBe(0.2);
    expect(fitted.props.bars).toEqual({ stroke: "none" });
  });
});
