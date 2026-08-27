// Multi-unit axis support for custom charts. When a chart overlays series with
// different units (e.g. Inverter Efficiency in % against Battery Power in W), a
// single shared y-scale drowns the small-magnitude series. This splits the series
// into a left (primary unit) and right (everything else) axis group, each with its
// own real scale, and plots every series against a normalized [0,1] coordinate so
// the two axes can render independent, real-valued tick labels that stay aligned.
import { scaleLinear } from "d3-scale";

export type Datum = Record<string, number | Date>;

/** A chart series, with the unit used to decide which axis it belongs to. */
export interface AxisSeries {
  key: string;
  label: string;
  color: string;
  unit: string;
  value: (d: Datum) => number | null;
}

export interface AxisGrouping {
  /** Series on the left axis (the primary unit). */
  left: AxisSeries[];
  /** Series on the right axis (all other units); empty when single-unit. */
  right: AxisSeries[];
  /** Unit label for the left axis. */
  leftUnit: string;
  /** Unit label for the right axis, or '' when the right group mixes units. */
  rightUnit: string;
  /** True when a second axis is needed (the series span more than one unit). */
  dualAxis: boolean;
}

/**
 * Split series by unit. The primary unit (left axis) is the one shared by the most
 * series; ties resolve to the first series' unit. Every other unit lands on the
 * right axis, which shares one scale (a chart mixing three+ units is rare — the
 * right axis just spans their combined range).
 */
export function groupSeriesByUnit(series: AxisSeries[]): AxisGrouping {
  const counts = new Map<string, number>();
  for (const s of series) counts.set(s.unit, (counts.get(s.unit) ?? 0) + 1);

  let primary = series[0]?.unit ?? "";
  let best = -1;
  for (const s of series) {
    const c = counts.get(s.unit) ?? 0;
    if (c > best) {
      best = c;
      primary = s.unit;
    }
  }

  const left = series.filter((s) => s.unit === primary);
  const right = series.filter((s) => s.unit !== primary);
  const rightUnits = new Set(right.map((s) => s.unit));

  return {
    left,
    right,
    leftUnit: primary,
    rightUnit: rightUnits.size === 1 ? [...rightUnits][0] : "",
    dualAxis: right.length > 0,
  };
}

/** Every plottable reading the group produces across `data`; gaps are dropped. */
function finiteValues(data: Datum[], group: AxisSeries[]): number[] {
  return data
    .flatMap((d) => group.map((s) => s.value(d)))
    .filter((v): v is number => v != null && Number.isFinite(v));
}

/** [min, max] of a non-empty list, without spreading it onto the call stack. */
function extent(values: number[]): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return [min, max];
}

/**
 * Domain for a group whose readings are all the same value: give it a band from
 * zero so a flat line renders mid-plot rather than on the axis itself.
 */
function flatDomain(v: number): [number, number] {
  if (v === 0) return [0, 1];
  return v > 0 ? [0, v * 1.1] : [v * 1.1, 0];
}

/**
 * Nice'd [min, max] domain across a series group's values in `data`. Unlike the
 * single-axis chart this does NOT include zero — each axis hugs its own data so a
 * tight-range metric (efficiency 82–84%) fills the plot instead of being squashed.
 */
export function domainFor(data: Datum[], group: AxisSeries[]): [number, number] {
  const values = finiteValues(data, group);
  if (values.length === 0) return [0, 1];
  const [min, max] = extent(values);
  if (min === max) return flatDomain(min);
  return scaleLinear().domain([min, max]).nice().domain() as [number, number];
}

/** A d3 linear scale for an axis group, mapping its domain to the plot height. */
export function axisScale(domain: [number, number], height: number) {
  return scaleLinear().domain(domain).range([height, 0]);
}

/**
 * Wrap each series so its `value` returns a normalized [0,1] position within its
 * group's `domain`, so both axis groups plot on the same native [0,1] scale while
 * their real values live on the independent left/right axes. The `key`/`label`/
 * `color`/`unit` are preserved; the raw values stay in the datum for the tooltip.
 */
export function normalizeSeries(group: AxisSeries[], domain: [number, number]): AxisSeries[] {
  const [lo, hi] = domain;
  const span = hi - lo;
  return group.map((s) => ({
    ...s,
    value: (d: Datum) => {
      const v = s.value(d);
      if (v == null || !Number.isFinite(v)) return null;
      return span === 0 ? 0.5 : (v - lo) / span;
    },
  }));
}
