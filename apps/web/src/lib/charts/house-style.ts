/**
 * One house style for chart marks, keyed by what the data IS.
 *
 * Nineteen plots each chose their own treatment, and the result was three
 * smoothings and four fills on one dashboard: `curveCatmullRom` on the live and
 * history areas, `curveMonotoneX` on the decision plots, nothing (so
 * `curveLinear`) on the statistics lines; fills at 0.9 gradient, 0.3 flat, 0.2
 * flat and none; strokes at 1.5 and 2. Read together they say a difference
 * exists where none does.
 *
 * The fix is not "make them all the same" — a bar and a live sparkline should
 * not look alike. It is that the choice belongs to the MEASURE, so a chart's
 * appearance follows from what it plots rather than from which file it grew in.
 * A component states its kind; the table decides the rest.
 *
 * ## The kinds
 *
 * | kind       | the data                                                        | mark  |
 * | ---------- | --------------------------------------------------------------- | ----- |
 * | `power`    | one instantaneous measure sampled over time (W, A, %)           | area  |
 * | `flow`     | the same, SIGNED around zero (battery/grid power)               | area  |
 * | `overlay`  | several measures compared on one plot                           | line  |
 * | `stack`    | a decomposition of one total into its parts                    | area  |
 * | `energy`   | a quantity belonging to a BUCKET (kWh, money, the price)        | bars  |
 * | `setpoint` | a decided value, held until it is written again                 | line  |
 * | `heat`     | a matrix of buckets, read by colour                            | cells |
 *
 * ## Why no kind smooths with Catmull-Rom
 *
 * The reason this module exists at all, and not a matter of taste: a
 * Catmull-Rom spline overshoots its control points. Drawn through the samples of
 * a sunny day the PV area bulges ABOVE the measured peak, so the chart shows a
 * watt figure the plant never produced — and the tooltip beside it disagrees.
 * `curveMonotoneX` is the smoothing that cannot do that: between two samples it
 * stays inside their range. It is the only smoothing in the house.
 *
 * Two kinds interpolate nothing at all, and say so with `curveLinear` rather
 * than by being absent from the table: a bar's top and a cell's colour ARE the
 * value, there is no "between two samples" to draw.
 */

import { curveLinear, curveMonotoneX, curveStepAfter, type CurveFactory } from "d3-shape";

/**
 * Every kind, in the order the tables read.
 *
 * Deliberately NOT exported: nothing outside this file iterates the kinds, and
 * an export whose only consumers are tests is dead code by this repo's reckoning
 * (there are none elsewhere). What it does here is type the tables below, so
 * `Record<ChartKind, …>` is a compile-time totality check; ./house-style.test.ts
 * carries its own copy of the list and compares it to the tables' keys, which is
 * the same gate from outside and cannot be taken down with the tuple.
 */
const CHART_KINDS = ["power", "flow", "overlay", "stack", "energy", "setpoint", "heat"] as const;

export type ChartKind = (typeof CHART_KINDS)[number];

/** How a kind's data is drawn. */
export type ChartMark = "area" | "line" | "bars" | "cells";

/**
 * How the ground under a mark is painted.
 *
 *  - `gradient` — the accent fading to transparent downward. Says "this is one
 *    measure and this is its magnitude" without claiming the area means a total.
 *  - `sign` — split at zero, the sign tokens above and below. The fill IS the
 *    sign, which is the whole point of plotting a signed flow.
 *  - `flat` — one opacity throughout, for bands that are read against each other.
 *  - `none` — a stroke only.
 */
export type ChartFill = "gradient" | "sign" | "flat" | "none";

export type MarkStyle = {
  mark: ChartMark;
  fill: ChartFill;
  /** Opacity of the fill; 0 whenever `fill` is `none`. */
  fillOpacity: number;
  /** Stroke weight in CSS px; 0 for a mark with no outline. */
  strokeWidth: number;
};

/**
 * The one stroke weight in the app. Two weights side by side read as emphasis,
 * and none of the plots meant any — so a heavier line is available to mean
 * something if a chart ever needs it to.
 */
const STROKE = 1.5;

/**
 * The two dash patterns, and the only two.
 *
 *  - `secondary` — a line that is not the primary measurement: a projection, a
 *    register readback, a context series.
 *  - `reference` — a line that is not a measurement at all: a limit, a plateau,
 *    a target the others are steered toward.
 *
 * They were four literals across three files (`'5 4'` meaning three different
 * things, `'2 3'` meaning a fourth), which is how a reader stops trusting that
 * a dash means anything.
 */
export const DASH = {
  secondary: "5 4",
  reference: "2 3",
} as const;

export type DashKind = keyof typeof DASH;

/**
 * The curve each kind is drawn with. Never `curveCatmullRom` — see the header.
 */
export const CURVE: Record<ChartKind, CurveFactory> = {
  power: curveMonotoneX,
  flow: curveMonotoneX,
  overlay: curveMonotoneX,
  stack: curveMonotoneX,
  // Bars and cells interpolate nothing. Present rather than absent so the table
  // answers "what curve does this kind use" with "none, and here is what that
  // means" instead of `undefined`.
  energy: curveLinear,
  heat: curveLinear,
  // A ceiling written to a register holds its value until the next write. The
  // step is the truth; a slope between two writes is a fiction.
  setpoint: curveStepAfter,
};

/** What each kind is drawn as, and how its ground is painted. */
export const MARK_STYLE: Record<ChartKind, MarkStyle> = {
  power: { mark: "area", fill: "gradient", fillOpacity: 0.9, strokeWidth: STROKE },
  flow: { mark: "area", fill: "sign", fillOpacity: 0.25, strokeWidth: STROKE },
  // No fill: two translucent fills over each other mix into a third colour that
  // belongs to neither series, so the plot grows a hue nobody assigned. A chart
  // that wants one series filled as CONTEXT says so per series (see
  // decision-chart's `PlotSeries.fill`); the default is a stroke.
  overlay: { mark: "line", fill: "none", fillOpacity: 0, strokeWidth: STROKE },
  // A stack's bands are read against each other, so they are solid enough to
  // separate and translucent enough to keep the grid readable behind them.
  stack: { mark: "area", fill: "flat", fillOpacity: 0.75, strokeWidth: STROKE },
  energy: { mark: "bars", fill: "flat", fillOpacity: 1, strokeWidth: 0 },
  setpoint: { mark: "line", fill: "none", fillOpacity: 0, strokeWidth: STROKE },
  heat: { mark: "cells", fill: "flat", fillOpacity: 1, strokeWidth: 0 },
};

export type HouseLineOptions = {
  /** Dash this line, by meaning rather than by pattern. */
  dash?: DashKind;
  /**
   * Paint the stroke this colour. Rides along so a caller never rebuilds the
   * `line` object by hand — which is how a component's own `'stroke-width'`
   * literal crept back in twice.
   */
  stroke?: string;
  /**
   * Override the stroke weight. For a stacked band drawn with no outline at all
   * — the band edges are the boundaries, and an outline on each one turns a
   * decomposition into four separate charts.
   */
  strokeWidth?: number;
  /** Override the fill opacity, for a series filled as context inside an overlay. */
  fillOpacity?: number;
};

/**
 * Everything a LayerChart `<Area>` / `<Spline>` needs for a kind, in one spread.
 *
 * `stroke-dasharray: 'none'` is stated rather than omitted: these objects are
 * merged onto the path, and leaving the key out keeps whatever a previous render
 * put there.
 */
export function houseLine(kind: ChartKind, options: HouseLineOptions = {}) {
  const style = MARK_STYLE[kind];
  return {
    curve: CURVE[kind],
    fillOpacity: options.fillOpacity ?? style.fillOpacity,
    line: {
      ...(options.stroke === undefined ? {} : { stroke: options.stroke }),
      "stroke-width": options.strokeWidth ?? style.strokeWidth,
      "stroke-dasharray": options.dash ? DASH[options.dash] : "none",
    },
  };
}

/**
 * The cell geometry both heat matrices draw with: a hairline inset so adjacent
 * buckets read as separate cells, and a radius small enough to stay a grid
 * rather than becoming a row of pills.
 */
export function houseCell() {
  return { insets: { all: 1 }, rx: 2 } as const;
}
