/**
 * The house style is a decision about DATA, not about files.
 *
 * The dashboard had three smoothings and four fills across nineteen plots —
 * `curveCatmullRom` on the live and history areas, `curveMonotoneX` on the
 * decision plots, no curve at all (so `curveLinear`) on the statistics lines;
 * fills at 0.9 gradient, 0.3 flat, 0.2 flat and none. Nobody chose that: each
 * chart chose for itself, so "some are smoothed, some are jagged, some have
 * fill and some don't" is exactly what shipped.
 *
 * So the choice moved into a table keyed by what the data IS, and this file is
 * the gate on that table. Two claims it has to keep:
 *
 *  - TOTALITY. Every kind has an entry in every table. `Record<ChartKind, …>`
 *    makes that a compile error, and `KINDS` below makes it a test failure too
 *    — a table built with a spread or a loop type-checks while missing a key.
 *  - NO OVERSHOOT. `curveCatmullRom` is banned from every kind. It is the
 *    reason this pass exists and not a matter of taste: the spline overshoots
 *    its control points, so a PV area drawn through the day's samples bulges
 *    ABOVE the measured peak, and the chart reports a watt figure the plant
 *    never produced.
 */

import { describe, expect, test } from "bun:test";
import { curveCatmullRom, curveLinear, curveMonotoneX, curveStepAfter } from "d3-shape";
import { CURVE, MARK_STYLE, houseLine, type ChartKind } from "./house-style";

/**
 * The kinds, written out here rather than imported.
 *
 * The module's own tuple is private (it exists to type the tables), so this is
 * the independent list: a kind quietly deleted from the tuple — and with it from
 * every `Record` the tuple types — cannot take its own gate with it. The
 * `satisfies` makes adding a kind a COMPILE error here until it is written down;
 * the totality cases below would otherwise keep passing over a shorter list.
 */
const KINDS = [
  "power",
  "flow",
  "overlay",
  "stack",
  "energy",
  "setpoint",
  "heat",
] as const satisfies readonly ChartKind[];

/** Exhaustive the other way: a NEW kind fails to compile until it is listed. */
const _everyKindIsListed: Record<ChartKind, true> = Object.fromEntries(
  KINDS.map((k) => [k, true]),
) as Record<ChartKind, true>;

describe("the table is total", () => {
  test("the tables hold exactly these kinds — no more, no fewer", () => {
    // Both directions. A kind missing from a table is a runtime `undefined`
    // curve on a real chart; a kind in a table that nothing here knows about is
    // a treatment nobody reviewed.
    expect(Object.keys(CURVE).sort()).toEqual([...KINDS].sort());
    expect(Object.keys(MARK_STYLE).sort()).toEqual([...KINDS].sort());
  });

  test.each([...KINDS])("%s has a curve", (kind) => {
    expect(typeof CURVE[kind]).toBe("function");
  });

  test.each([...KINDS])("%s has a mark style", (kind) => {
    expect(MARK_STYLE[kind]).toBeDefined();
  });
});

describe("no kind overshoots its own data", () => {
  // The whole reason for the pass. A Catmull-Rom spline through the samples of
  // a sunny day draws a peak nobody measured.
  test.each([...KINDS])("%s is not drawn with curveCatmullRom", (kind) => {
    expect(CURVE[kind]).not.toBe(curveCatmullRom);
  });

  test("and the one smoothing in the house is the monotone one", () => {
    // Monotone-x is the smoothing that CANNOT overshoot: between two samples it
    // stays inside [a, b]. Any kind that smooths at all uses this one.
    const smoothed = KINDS.filter((k) => CURVE[k] === curveMonotoneX);
    expect(smoothed.sort()).toEqual(["flow", "overlay", "power", "stack"]);
  });

  test("a setpoint is a step, because a register holds its value until it is written again", () => {
    expect(CURVE.setpoint).toBe(curveStepAfter);
  });

  test("the marks that interpolate nothing say so, rather than being absent", () => {
    // A bar's top and a cell's colour ARE the value; there is no "between two
    // samples" to draw. The entries exist so the table can be read as a whole.
    expect(CURVE.energy).toBe(curveLinear);
    expect(CURVE.heat).toBe(curveLinear);
  });
});

describe("what each kind is drawn as", () => {
  test("a quantity that belongs to a bucket is bars, never a line", () => {
    // kWh accrued over an hour is not a rate between two instants. A line
    // through bucket totals invents the slope it draws.
    expect(MARK_STYLE.energy.mark).toBe("bars");
  });

  test("an instantaneous measure is a filled area", () => {
    expect(MARK_STYLE.power.mark).toBe("area");
    expect(MARK_STYLE.power.fill).toBe("gradient");
    expect(MARK_STYLE.flow.mark).toBe("area");
    // Signed: the fill is split at zero, so its two halves carry the sign.
    expect(MARK_STYLE.flow.fill).toBe("sign");
  });

  test("series compared on one plot are unfilled lines", () => {
    // Two translucent fills over each other mix into a third colour that
    // belongs to neither series — the plot then has a hue nobody assigned.
    expect(MARK_STYLE.overlay.mark).toBe("line");
    expect(MARK_STYLE.overlay.fill).toBe("none");
    expect(MARK_STYLE.overlay.fillOpacity).toBe(0);
  });

  test("a decomposition of one total is a stack of filled bands", () => {
    expect(MARK_STYLE.stack.mark).toBe("area");
    expect(MARK_STYLE.stack.fill).toBe("flat");
    expect(MARK_STYLE.stack.fillOpacity).toBeGreaterThan(0.5);
  });

  test("a matrix of buckets is cells", () => {
    expect(MARK_STYLE.heat.mark).toBe("cells");
  });
});

describe("one stroke weight for the whole app", () => {
  test.each(KINDS.filter((k) => MARK_STYLE[k].mark !== "bars" && MARK_STYLE[k].mark !== "cells"))(
    "%s strokes at the house weight",
    (kind) => {
      // The plots ran 1.5 and 2 side by side, which reads as emphasis nobody
      // meant. One weight, so a heavier line means something when it appears.
      expect(MARK_STYLE[kind].strokeWidth).toBe(MARK_STYLE.power.strokeWidth);
    },
  );

  test("a bar and a cell carry no outline", () => {
    expect(MARK_STYLE.energy.strokeWidth).toBe(0);
    expect(MARK_STYLE.heat.strokeWidth).toBe(0);
  });
});

describe("houseLine hands a chart the whole treatment at once", () => {
  test("the curve, the weight and the dash, in the shape layerchart reads", () => {
    const style = houseLine("power");
    expect(style.curve).toBe(CURVE.power);
    expect(style.line["stroke-width"]).toBe(MARK_STYLE.power.strokeWidth);
    // A solid line still states it: layerchart merges these onto the path, and
    // "none" is what clears an inherited dash rather than leaving it.
    expect(style.line["stroke-dasharray"]).toBe("none");
  });

  test("a caller can spend a dash without inventing the pattern", () => {
    const style = houseLine("overlay", { dash: "secondary" });
    expect(style.line["stroke-dasharray"]).not.toBe("none");
    // Two patterns, two meanings, and the same two everywhere: a line that is
    // not the primary measurement, and a line that is a limit rather than a
    // measurement at all. Four literals across three files was the drift.
    expect(houseLine("overlay", { dash: "reference" }).line["stroke-dasharray"]).not.toBe(
      style.line["stroke-dasharray"],
    );
  });

  test("a stroke colour rides along, so a caller never rebuilds the line object", () => {
    // The sparkline and the history area paint their own accent; merging that
    // into the returned `line` by hand is where a component's own literal
    // stroke-width crept back in twice.
    const style = houseLine("power", { stroke: "var(--chart-2)" });
    expect(style.line.stroke).toBe("var(--chart-2)");
    expect(style.line["stroke-width"]).toBe(MARK_STYLE.power.strokeWidth);
  });

  test("a caller may override the weight to zero — a stacked band has no outline", () => {
    // `?? ` and not `||`: 0 is a width, and an outline on every band of a
    // decomposition turns one chart into four.
    expect(houseLine("stack", { strokeWidth: 0 }).line["stroke-width"]).toBe(0);
  });

  test("the fill opacity comes from the kind, not from the caller", () => {
    expect(houseLine("overlay").fillOpacity).toBe(0);
    expect(houseLine("power").fillOpacity).toBe(MARK_STYLE.power.fillOpacity);
  });
});
