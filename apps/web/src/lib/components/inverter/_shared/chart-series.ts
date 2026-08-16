// Series plumbing shared by the dashboard charts: the `Chart.ChartConfig` every
// chart derives from its series list, and the dual-axis normalization the custom
// charts apply when their series span more than one unit.
import type { ChartConfig } from "$lib/components/ui/chart";
import { barBandPadding, chartPaddingFor, xTickSpacingFor } from "$lib/cost/ranges";
import {
  domainFor,
  groupSeriesByUnit,
  normalizeSeries,
  type AxisGrouping,
  type AxisSeries,
  type Datum,
} from "$lib/inverter/chart-axes";

/** The identity fields every chart series carries, whatever its value shape. */
export type LabelledSeries = { key: string; label: string; color: string };

/**
 * The layout props every stacked statistics bar chart passes: a band padding
 * that keeps a two-bucket window from rendering slabs, a 2px gap between stack
 * segments, and axes with room for their labels.
 *
 * `width` is the plot box's MEASURED width, not a breakpoint — the same chart
 * renders full-bleed on one page and two-up inside a grid on another, so only
 * the element knows how much room it got. Callers pass `bind:clientWidth`; 0
 * (not yet in the document) reads as the desktop case.
 */
export function stackedBarProps(bucketCount: number, width: number) {
  return {
    bandPadding: barBandPadding(bucketCount, 0.25),
    stackPadding: 2,
    padding: chartPaddingFor(width),
    props: { xAxis: { tickSpacing: xTickSpacingFor(width) } },
  };
}

/** `Chart.ChartConfig` for a series list — label + colour keyed by series key. */
export function seriesConfig(series: readonly LabelledSeries[]): ChartConfig {
  return Object.fromEntries(series.map((s) => [s.key, { label: s.label, color: s.color }]));
}

export type ResolvedAxes = {
  grouping: AxisGrouping;
  /** Real-valued domain of the left (primary unit) axis. */
  leftDomain: [number, number];
  /** Real-valued domain of the right axis, or `null` when single-unit. */
  rightDomain: [number, number] | null;
  /**
   * Series to hand LayerChart: normalized onto a shared [0,1] scale when a second
   * axis is present, otherwise the input series untouched.
   */
  plotSeries: AxisSeries[];
};

/**
 * Group `series` by unit and derive each axis' domain from `rows`. With a single
 * unit this is a pass-through; with two the series are normalized so both real
 * axes stay aligned (see chart-axes.ts).
 */
export function resolveAxes(rows: Datum[], series: AxisSeries[]): ResolvedAxes {
  const grouping = groupSeriesByUnit(series);
  const leftDomain = domainFor(rows, grouping.left);
  const rightDomain = grouping.dualAxis ? domainFor(rows, grouping.right) : null;
  const plotSeries = grouping.dualAxis
    ? [
        ...normalizeSeries(grouping.left, leftDomain),
        ...normalizeSeries(grouping.right, rightDomain ?? [0, 1]),
      ]
    : series;
  return { grouping, leftDomain, rightDomain, plotSeries };
}
