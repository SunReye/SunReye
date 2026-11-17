// What a series draws as (ADR 22), apart from where it is read from: samples over time, how they
// are joined, and the value axis they need. Pure, and shared by the modes' charts.

/** The tier the samples come in: raw intervals, buckets of them, or hourly or daily rollups. */
export type Tier = "raw" | "bucket" | "hour" | "day";

/** A line of values, a step line of held ones, bars of deltas or a band of states. */
export type Draw = "line" | "step" | "bars" | "states";

/** A value over [t0, t1) in epoch ms; `lo` and `hi` are a statistic's extremes. */
export interface Sample {
  readonly t0: number;
  readonly t1: number;
  readonly v: number;
  readonly lo?: number;
  readonly hi?: number;
}

export interface Curve {
  readonly draw: Draw;
  readonly tier: Tier;
  /** A `bucket`'s width in seconds. */
  readonly width?: number | undefined;
  /** In time order, never overlapping; a gap has no sample. */
  readonly samples: readonly Sample[];
}

/** The samples as unbroken runs: a gap breaks the line. */
export function runs(samples: readonly Sample[]): (readonly Sample[])[] {
  const out: Sample[][] = [];

  for (const s of samples) {
    const run = out.at(-1);

    if (run && run.at(-1)!.t1 >= s.t0) run.push(s);
    else out.push([s]);
  }

  return out;
}

/** The sample that holds instant `t`; null in a gap and outside the curve. */
export function sampleAt(curve: Curve, t: number): Sample | null {
  const { samples } = curve;
  let [lo, hi] = [0, samples.length - 1];

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = samples[mid]!;

    if (t < s.t0) hi = mid - 1;
    else if (t >= s.t1) lo = mid + 1;
    else return s;
  }

  return null;
}

/** A sample and an instant it is drawn at. */
export interface Anchor {
  readonly t: number;
  readonly s: Sample;
}

/**
 * Where a line or step line is drawn, per run. A raw interval holds its value until the next
 * change; a mean stands at its span's middle, and one alone spans it.
 */
export function anchors(curve: Curve): (readonly Anchor[])[] {
  const held = curve.draw === "step" || curve.tier === "raw";

  return runs(curve.samples).map((run) =>
    run.flatMap((s): Anchor[] =>
      held || run.length === 1
        ? [
            { t: s.t0, s },
            { t: s.t1, s },
          ]
        : [{ t: (s.t0 + s.t1) / 2, s }],
    ),
  );
}

export type Vertex = readonly [t: number, v: number];

/** A line's or step line's vertices per run. */
export function vertices(curve: Curve): Vertex[][] {
  return anchors(curve).map((run) => run.map((a): Vertex => [a.t, a.s.v]));
}

export interface Axis {
  readonly min: number;
  readonly max: number;
  /** Round figures inside the axis, `step` apart. */
  readonly ticks: readonly number[];
  readonly step: number;
}

/** The decimals a tick of `axis` is written with. */
export const tickDigits = (axis: Axis): number => Math.max(0, -Math.floor(Math.log10(axis.step)));

/** The decimals a value read off `axis` is written with: half a step still shows. */
export const valueDigits = (axis: Axis): number =>
  Math.max(0, -Math.floor(Math.log10(axis.step / 2)));

/** 1, 2 or 5 times a power of ten, at least `x`. */
function round(x: number): number {
  const pow = 10 ** Math.floor(Math.log10(x));
  const f = x / pow;

  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
}

function extent(curves: readonly Curve[]): [number, number] | null {
  let [min, max] = [Infinity, -Infinity];

  for (const curve of curves) {
    for (const s of curve.samples) {
      min = Math.min(min, s.lo ?? s.v, s.v);
      max = Math.max(max, s.hi ?? s.v, s.v);
    }

    // A bar's length is its value, so it stands on zero.
    if (curve.draw === "bars" && curve.samples.length > 0) {
      min = Math.min(min, 0);
      max = Math.max(max, 0);
    }
  }

  return min <= max ? [min, max] : null;
}

/** The extent as an axis reads it, never flat. */
function bounds([low, high]: readonly [number, number]): [number, number] {
  let [min, max] = [low, high];

  // Values that reach near zero read against it; values far from it, such as a voltage, do not.
  if (min > 0 && min <= max / 2) min = 0;

  if (max < 0 && max >= min / 2) max = 0;

  if (min < max) return [min, max];

  const half = (Math.abs(min) || 1) / 2;

  return [min - half, max + half];
}

/** The value axis the curves share: null with nothing to draw. */
export function axisOf(curves: readonly Curve[]): Axis | null {
  const found = extent(curves);

  if (!found) return null;

  const [min, max] = bounds(found);
  const step = round((max - min) / 3);
  // Room above and below, but zero stays the edge.
  const pad = (v: number) => (v === 0 ? 0 : (max - min) * 0.05);
  const [lo, hi] = [min - pad(min), max + pad(max)];
  const first = Math.ceil(lo / step);

  const ticks = Array.from(
    { length: Math.floor(hi / step) - first + 1 },
    (_, i) => (first + i) * step,
  );

  return { min: lo, max: hi, ticks, step };
}
