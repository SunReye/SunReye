// How much of a plot box goes to gutters, decided from the plot's MEASURED
// width rather than from a breakpoint. The same component renders full-bleed on
// /history and two-up inside a statistics section, so the viewport says nothing
// about how much room this particular plot got.
//
// Deliberately NOT in $lib/cost: it started there with the statistics charts,
// but a live area chart and an automations decision chart carry gutters of their
// own tuning and should not import the cost model to learn how wide a phone axis
// label is. The cost family's own base paddings stay in $lib/cost/ranges; what
// is shared is the clamp.

/** Reserved space around a plot, in CSS px. */
export type ChartPadding = { top: number; right: number; bottom: number; left: number };

/**
 * Plot width at or above which a chart gets its designed gutters. Below it the
 * horizontal ones are capped — see {@link fittedPadding}.
 *
 * Deliberately a PLOT width, not a viewport breakpoint: 480 is the width at
 * which the statistics family's designed 84px of horizontal gutter drops back
 * under a fifth of the box.
 */
// fallow-ignore-next-line unused-export -- the boundary IS the contract: stated once here and pinned by plot-padding.test.ts rather than restated there
export const CHART_NARROW_PX = 480;

/** Left gutter cap on a narrow plot: room for "1,000" at text-xs, no more. */
const NARROW_LEFT_GUTTER = 34;

/** Right gutter cap on a narrow plot: enough for the last tick label's overhang. */
const NARROW_RIGHT_GUTTER = 8;

/**
 * Is this plot phone-width? An unmeasured (`0`, from `bind:clientWidth` before
 * the element is in the document), absent or nonsensical width answers "no":
 * a desktop flashing a cramped chart for one frame is the more visible of the
 * two wrong answers, and the measured value arrives on the next tick anyway.
 */
export function isNarrowPlot(width: number): boolean {
  return width > 0 && width < CHART_NARROW_PX;
}

/** What a gutter carries, where that changes how tightly it may be capped. */
export interface FitOptions {
  /**
   * The right gutter holds a second y-axis, not just a tick label's overhang.
   * Axis labels need the same room on either side, so it is capped to the left
   * gutter's value instead of the 8px overhang cap.
   */
  rightAxis?: boolean;
}

/**
 * `base` as a plot of `width` should spend it. The horizontal gutters are
 * CAPPED rather than replaced, so a chart that already asks for less than the
 * cap keeps its tighter value — this helper only ever gives space back to the
 * plot, never takes it. That is what makes it safe to point at a hand-tuned
 * chart: hand in the gutters the chart writes today and its wide rendering is
 * unchanged by construction.
 */
export function fittedPadding(
  base: ChartPadding,
  width: number,
  { rightAxis = false }: FitOptions = {},
): ChartPadding {
  if (!isNarrowPlot(width)) return base;
  return {
    ...base,
    left: Math.min(base.left, NARROW_LEFT_GUTTER),
    right: Math.min(base.right, rightAxis ? NARROW_LEFT_GUTTER : NARROW_RIGHT_GUTTER),
  };
}
