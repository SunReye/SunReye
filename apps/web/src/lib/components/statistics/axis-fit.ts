// How much room an axis LABEL needs, decided from the label rather than from a
// breakpoint.
//
// `$lib/charts/plot-padding` already fits a chart's gutters to its MEASURED plot
// width: below 480px the horizontal ones are capped, because the designed 60px
// left gutter was a fifth of a phone plot. That clamp is a constant, and a
// constant cannot know what the axis is about to draw into it — measured in
// Chromium at 360px, the energy-flows axis drew "30 kWh" 36px wide into a 34px
// gutter and the leading digit landed outside the canvas. The mirror failure is
// the x-axis: the phone's 48px tick spacing fits "05:00" and not "17.09.2026",
// so the battery-health trend's dates run into each other.
//
// Both are the same missing input — the width of the widest label the axis will
// actually draw — so both are decided here, once, for every statistics chart.
//
// Deliberately an ESTIMATE rather than `measureText`: the padding is a prop of
// the chart and has to exist before the canvas does, and a measurement taken
// after the first draw would rebuild every scale on the frame after it. The
// estimate is calibrated against what the browser measured (see the unit test)
// and is deliberately generous — the cost of over-estimating is a few pixels of
// plot, the cost of under-estimating is the clipped label this exists to fix.

import type { ChartPadding } from "$lib/charts/plot-padding";

/**
 * Width of one character of an axis label, in CSS px.
 *
 * Measured in Chromium at the house axis size (`text-xs`, 12px Geist Mono —
 * pinned for canvas charts in `app.css`): 7.0px per character ("10" 14px,
 * "09-27 00:00" 77px). An earlier 6.0px was layerchart's 10px default, which a
 * canvas drew only when the first chart to mount sat outside a
 * `Chart.Container`. Held at 0.6em, a monospace advance, just above that.
 */
// fallow-ignore-next-line unused-export -- the calibration IS the contract: stated once here and pinned against the browser's own measurement by axis-fit.test.ts
export const AXIS_CHAR_PX = 7.2;

/** Room between a y-axis label and the axis it labels (measured: 4px). One
 *  pixel over, now the glyph estimate is taken at the size actually drawn. */
// fallow-ignore-next-line unused-export -- as above: the gap the fit reserves is asserted against a measured one rather than restated
export const AXIS_TICK_GAP_PX = 5;

/**
 * A tick sits at a round number at or above the data's maximum, so an axis over
 * a 98 kWh day is labelled "100 kWh" — one character the data never contained.
 */
const AXIS_ROUNDUP_SLACK_CHARS = 1;

/** The most of a plot a single gutter may ever take. */
// fallow-ignore-next-line unused-export -- the ceiling is a stated boundary, checked in axis-fit.test.ts against an absurd label
export const MAX_GUTTER_SHARE = 0.28;

/** Daylight between two x-axis labels, so they read as two. */
const MIN_X_LABEL_GAP_PX = 10;

/** How an axis' own domain changes what its labels may grow into. */
export interface AxisFitOptions {
  /**
   * May a tick land past the data's own maximum? True for a chart whose domain
   * follows its data (a kWh axis over 98 draws a "100" tick); false when the
   * caller PINNED the domain, as the ratio charts pin [0, 1] — there the
   * extremes the data carries are the extremes the axis draws, and reserving a
   * character for a round-up that cannot happen takes plot for nothing.
   */
  rounded?: boolean;
}

/** What `text` will take to draw on an axis. */
// fallow-ignore-next-line unused-export -- the estimate the whole module rests on; every case in axis-fit.test.ts is written against it rather than against pixel literals
export function labelWidthPx(text: string): number {
  return text.length * AXIS_CHAR_PX;
}

/** The widest of `labels`; 0 when there are none. */
// fallow-ignore-next-line unused-export -- same: the "widest wins" rule is tested directly, not only through the two fits that spend it
export function widestLabelPx(labels: Iterable<string>): number {
  let widest = 0;
  for (const label of labels) widest = Math.max(widest, labelWidthPx(label));
  return widest;
}

/**
 * `base` with a left gutter that fits `yLabels`.
 *
 * Only ever GROWS the gutter, and only up to {@link MAX_GUTTER_SHARE} of the
 * plot: a chart whose labels fit the fitted clamp keeps the clamp's value, so
 * the ratio chart does not pay for the kWh chart's unit. An unmeasured plot
 * (`bind:clientWidth` before the element is in the document) and an axis with
 * nothing to label both leave `base` exactly as it is — the same reading of
 * "unmeasured" the clamp itself uses.
 */
export function fittedAxisPadding(
  base: ChartPadding,
  plotWidth: number,
  yLabels: readonly string[],
  { rounded = true }: AxisFitOptions = {},
): ChartPadding {
  if (!(plotWidth > 0) || yLabels.length === 0) return base;
  const slack = rounded ? AXIS_ROUNDUP_SLACK_CHARS * AXIS_CHAR_PX : 0;
  const widest = widestLabelPx(yLabels) + slack;
  const wanted = Math.ceil(widest + AXIS_TICK_GAP_PX);
  const ceiling = plotWidth * MAX_GUTTER_SHARE;
  return { ...base, left: Math.min(Math.max(base.left, wanted), Math.max(base.left, ceiling)) };
}

/**
 * `base` with a left gutter that holds half of `leadingLabel`.
 *
 * A band axis centres each label on its band and always draws the first one,
 * so that label hangs half its width left of the plot. A gutter sized for the
 * y labels alone clips a first x label wider than twice itself — the price
 * curve's day-start `MM-DD HH:mm`. Same growth rules as {@link fittedAxisPadding}.
 */
export function fittedLeadingLabel(
  base: ChartPadding,
  plotWidth: number,
  leadingLabel: string | undefined,
): ChartPadding {
  if (!(plotWidth > 0) || !leadingLabel) return base;
  const wanted = Math.ceil(labelWidthPx(leadingLabel) / 2);
  const ceiling = plotWidth * MAX_GUTTER_SHARE;
  return { ...base, left: Math.min(Math.max(base.left, wanted), Math.max(base.left, ceiling)) };
}

/**
 * `base` tick spacing, widened until `xLabels` cannot collide.
 *
 * LayerChart thins a band domain to the spacing it is given, so this is the
 * tick COUNT decision: a label that needs more room gets fewer ticks rather
 * than a rotation. Hovering still exposes every period — the axis only carries
 * anchors.
 */
export function fittedTickSpacing(base: number, xLabels: readonly string[]): number {
  if (xLabels.length === 0) return base;
  return Math.max(base, Math.ceil(widestLabelPx(xLabels) + MIN_X_LABEL_GAP_PX));
}

/** A series as this module needs to read it: a row key, or an accessor. */
export interface ValueSeries<Row> {
  key: string;
  value?: (row: Row) => number | null | undefined;
}

/**
 * Every value the series will plot, in row order.
 *
 * Read the same way LayerChart reads them: through the accessor when the series
 * has one, off the named field otherwise.
 */
export function seriesValues<Row extends object>(
  rows: readonly Row[],
  series: readonly ValueSeries<Row>[],
): (number | null | undefined)[] {
  const values: (number | null | undefined)[] = [];
  for (const one of series) {
    for (const row of rows) {
      values.push(
        one.value ? one.value(row) : (row as Record<string, number | null | undefined>)[one.key],
      );
    }
  }
  return values;
}

/**
 * The extremes of `values`, formatted the way the axis will format them — the
 * two labels whose width decides the gutter. Empty when nothing is measurable:
 * a chart still loading has no axis to fit.
 */
export function axisValueLabels(
  values: Iterable<number | null | undefined>,
  format: (value: number) => string,
): string[] {
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    low = Math.min(low, value);
    high = Math.max(high, value);
  }
  if (!Number.isFinite(low)) return [];
  return [format(low), format(high)];
}

/**
 * What an untouched numeric axis draws for `value`.
 *
 * The year-over-year chart hands its money/kWh formatter to the TOOLTIP and
 * leaves the axis plain, so sizing its gutter with that formatter would reserve
 * room for a unit the axis never draws.
 */
export function defaultAxisLabel(value: number): string {
  return String(Math.round(value * 10) / 10);
}

/** A bar chart's layout spread, as the shared props builders return it. */
export interface BarLayout {
  padding: ChartPadding;
  props: { xAxis: { tickSpacing: number } } & Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * A layout spread (`groupedBarProps`, `stackedBarProps`) with both axes fitted
 * to the labels they will draw. Everything else the props builder decided is
 * passed through untouched: this adds room, it does not take the layout over.
 */
export function withFittedAxes<Layout extends BarLayout>(
  layout: Layout,
  plotWidth: number,
  labels: { yLabels: readonly string[]; xLabels: readonly string[] } & AxisFitOptions,
): Layout {
  return {
    ...layout,
    padding: fittedAxisPadding(layout.padding, plotWidth, labels.yLabels, {
      rounded: labels.rounded,
    }),
    props: {
      ...layout.props,
      xAxis: {
        ...layout.props.xAxis,
        tickSpacing: fittedTickSpacing(layout.props.xAxis.tickSpacing, labels.xLabels),
      },
    },
  };
}
