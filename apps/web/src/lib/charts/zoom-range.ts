/**
 * What a zoom gesture means, as pure functions.
 *
 * A brush hands back two edges of a selection. On its own that only narrows the
 * axis of data already fetched — magnifying four hourly bars, which is the one
 * thing a zoom must not do. So every mapper here ends at the app's EXISTING
 * range state (a `HistoryRange`, a `ChartSpec`) with a granularity re-derived
 * from the selected span, which makes the gesture a refetch: twenty minutes out
 * of an hourly window comes back as minute rollups.
 *
 * Nothing here reads a store or a clock. Time zone and locale arrive as
 * arguments so the DST cases can be written as UTC instants against a named
 * zone instead of by moving the process into one.
 */

import { bucketForSpan, type HistoryRange, type RollupBucket } from "../inverter/ranges";
import type { ChartSpec, CostBucket } from "../cost/ranges";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Locale/zone the labels are rendered in; all optional, all explicit. */
export type LabelOptions = {
  locale?: string;
  /** IANA zone, or absent for the host's. */
  timeZone?: string;
  hour12?: boolean;
  /** Name only the calendar days — for windows whose bars ARE days or months. */
  dateOnly?: boolean;
};

/** Milliseconds the selection covers, or null when it isn't a window at all. */
function span(from: Date, to: Date): number | null {
  const a = from.getTime();
  const b = to.getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const width = Math.abs(b - a);
  return width > 0 ? width : null;
}

/** `[earlier, later]` — a right-to-left drag selects the same window. */
function ordered(from: Date, to: Date): [Date, Date] {
  return from.getTime() <= to.getTime() ? [from, to] : [to, from];
}

const fmt = (opts: LabelOptions, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(opts.locale, { ...options, timeZone: opts.timeZone });

const clock = (d: Date, opts: LabelOptions) =>
  fmt(opts, { hour: "2-digit", minute: "2-digit", hour12: opts.hour12 }).format(d);

const calendarDay = (d: Date, opts: LabelOptions) =>
  fmt(opts, { month: "short", day: "numeric" }).format(d);

/** Do both instants fall on the same civil day in the labelling zone? */
function sameCivilDay(a: Date, b: Date, opts: LabelOptions): boolean {
  const f = fmt(opts, { year: "numeric", month: "2-digit", day: "2-digit" });
  return f.format(a) === f.format(b);
}

/**
 * What the viewer is looking at, in words — derived from the VISIBLE span, not
 * from the window the data was fetched over. Zooming into twenty minutes of a
 * 24-hour fetch has to read "10:05 – 10:25"; naming the fetch would print the
 * whole day back at them.
 *
 * Three shapes, because a span answers a different question at each size: inside
 * one civil day the clock is the whole content, across a night the day has to
 * come along to disambiguate the hours, and past that the hours are noise.
 * `dateOnly` short-circuits all of it for band windows, whose bars are days or
 * months and whose `to` the caller has already made inclusive.
 */
// fallow-ignore-next-line unused-export -- the label rule is the unit under test; both in-module callers reach it through a branch that also fixes the end and the `dateOnly` flag, so it is pinned here rather than through them
export function zoomSpanLabel(from: Date, to: Date, opts: LabelOptions = {}): string {
  const [start, end] = ordered(from, to);
  if (opts.dateOnly) {
    const a = calendarDay(start, opts);
    const b = calendarDay(end, opts);
    return a === b ? a : `${a} – ${b}`;
  }
  if (sameCivilDay(start, end, opts)) return `${clock(start, opts)} – ${clock(end, opts)}`;
  if (end.getTime() - start.getTime() <= 1.5 * DAY) {
    return `${calendarDay(start, opts)}, ${clock(start, opts)} – ${calendarDay(end, opts)}, ${clock(end, opts)}`;
  }
  return `${calendarDay(start, opts)} – ${calendarDay(end, opts)}`;
}

/**
 * A brushed window as the history page's own range state.
 *
 * The bucket comes from {@link bucketForSpan} rather than from the range the
 * selection was drawn on, which is what turns the gesture into a refetch at a
 * finer rollup. Returns null for anything that isn't a window — a tap lands here
 * as a zero-width selection, and zooming to an empty range would blank every
 * chart on the page.
 */
// fallow-ignore-next-line unused-export -- the window rule, tested directly; charts reach it through zoomedHistoryRangeFrom, which only adds the brush-payload parse
export function zoomedHistoryRange(
  from: Date,
  to: Date,
  opts: LabelOptions = {},
): HistoryRange | null {
  const width = span(from, to);
  if (width === null) return null;
  const [start, end] = ordered(from, to);
  return {
    id: "zoom",
    label: zoomSpanLabel(start, end, opts),
    live: false,
    from: start,
    to: end,
    bucket: bucketForSpan(width),
  };
}

/**
 * The same window, straight off a brush.
 *
 * LayerChart hands back whatever the x domain holds — epoch numbers on a time
 * scale, sometimes Dates — so the parse happens here rather than in each of the
 * charts. Anything that is not two instants is not a zoom: a band value would
 * otherwise parse to an Invalid Date and blank every card on the page.
 */
export function zoomedHistoryRangeFrom(
  selection: readonly (number | Date | string | null | undefined)[],
  opts: LabelOptions = {},
): HistoryRange | null {
  if (selection.length < 2) return null;
  const [a, b] = selection;
  if (typeof a === "string" || typeof b === "string" || a == null || b == null) return null;
  return zoomedHistoryRange(new Date(a), new Date(b), opts);
}

/** The display preferences the labels need, as the store holds them. */
export type DisplayLike = { timeZone: string; hourCycle: "auto" | "12h" | "24h" };

/**
 * Label options from the UI locale and the viewer's display preferences.
 *
 * Both settings carry an `auto` that means "whatever the browser does", and for
 * `Intl` that is the ABSENCE of the option — handing it the string "auto"
 * throws a RangeError on the first tooltip.
 */
export function labelOptionsFrom(locale: string, display: DisplayLike): LabelOptions {
  return {
    locale,
    timeZone: display.timeZone === "auto" ? undefined : display.timeZone,
    hour12: display.hourCycle === "auto" ? undefined : display.hourCycle === "12h",
  };
}

/** A section's zoom, kept with the spec it was drawn on. */
export type SpecZoom = { from: ChartSpec; to: ChartSpec };

/**
 * A zoom, anchored to the window it was taken from — or nothing.
 *
 * `chartSpecFor` hands back the range's own `detail`/`chart` object, so the
 * anchor's IDENTITY is the expiry: pick another range or scope and the base no
 * longer matches, and {@link activeSpec} drops the zoom without anyone having to
 * remember to. A gesture that outlived its window would otherwise keep a section
 * pinned to a week of last month after the viewer moved to this one.
 */
export function zoomAnchor(base: ChartSpec, next: ChartSpec | null): SpecZoom | null {
  return next ? { from: base, to: next } : null;
}

/** The spec a section plots: a zoom still anchored to `base`, else `base`. */
export function activeSpec(base: ChartSpec, zoom: SpecZoom | null): ChartSpec {
  return zoom !== null && zoom.from === base ? zoom.to : base;
}

/**
 * Narrowest selection that counts as a zoom on a continuous scale, in domain
 * milliseconds — two buckets. One bucket is narrower than a fingertip on a
 * phone, so anything below this is a mis-tap, and a mis-tap that reloads the
 * page's data is worse than no gesture at all.
 */
export function minExtentFor(bucket: RollupBucket): number {
  const width: Record<RollupBucket, number> = { minute: MINUTE, hour: HOUR, day: DAY };
  return 2 * width[bucket];
}

/**
 * The same floor for a band or point scale, where LayerChart measures
 * `minExtent` in CATEGORIES rather than domain units — so it is a count, and the
 * bucket behind the bands doesn't enter into it.
 */
export const MIN_BAND_EXTENT = 2;

/**
 * Where a band selection lands in the plotted rows.
 *
 * A band brush hands back the two x VALUES it covers, and on a statistics chart
 * those are axis labels ("Aug", "00:00"), which repeat across a 24-month window.
 * Positions do not, so everything downstream works in positions and the caller
 * pairs them with the period keys the rows were built from.
 */
export function bandIndexRange(
  values: readonly string[],
  selection: readonly (string | number | Date | null | undefined)[],
): [number, number] | null {
  if (values.length === 0 || selection.length < 2) return null;
  const [a, b] = selection;
  // Only a band or point domain holds strings. Anything else means the brush
  // came off a scale this mapper does not describe.
  if (typeof a !== "string" || typeof b !== "string") return null;
  const first = values.indexOf(a);
  const last = values.indexOf(b);
  if (first < 0 || last < 0) return null;
  return first <= last ? [first, last] : [last, first];
}

/** Server period key shapes, as `$lib/cost/ranges` writes them. */
const KEY_SHAPE: Record<CostBucket, RegExp> = {
  hour: /^\d{4}-\d{2}-\d{2}T\d{2}$/,
  day: /^\d{4}-\d{2}-\d{2}$/,
  month: /^\d{4}-\d{2}$/,
};

/**
 * `[start, next)` of the period a key names, in local wall-clock — the same
 * frame `resolveCostPreset` builds its windows in. Built from date PARTS rather
 * than by adding a fixed span, so a DST-shortened day still ends at the next
 * civil midnight. Null when the key doesn't match the bucket it arrived with,
 * which is the stale-refetch case `periodLabel` guards the same way.
 */
function periodBounds(key: string, bucket: CostBucket): [Date, Date] | null {
  if (!KEY_SHAPE[bucket].test(key)) return null;
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7)) - 1;
  if (bucket === "month") return [new Date(year, month, 1), new Date(year, month + 1, 1)];
  const day = Number(key.slice(8, 10));
  if (bucket === "day") return [new Date(year, month, day), new Date(year, month, day + 1)];
  const hour = Number(key.slice(11, 13));
  return [new Date(year, month, day, hour), new Date(year, month, day, hour + 1)];
}

/** One level finer, or itself where the series endpoints stop. */
const FINER: Record<CostBucket, CostBucket> = { month: "day", day: "hour", hour: "hour" };

/** Nominal width of a bucket, for estimating how many bars a refetch would draw. */
const BUCKET_MS: Record<CostBucket, number> = { hour: HOUR, day: DAY, month: 30.44 * DAY };

/**
 * Most bars a zoom will refetch. Past this the finer series stops being a chart
 * and becomes a grey block — a month by hour is ~744 bars on a 390px phone — so
 * a wide selection keeps the granularity it already had and only narrows the
 * window. 192 is the quarter-hour day-ahead curve, the widest bar chart the app
 * already renders legibly.
 */
const MAX_ZOOM_BARS = 192;

/** The granularity a zoom to `[from, to)` should refetch at. */
function refined(bucket: CostBucket, width: number): CostBucket {
  const finer = FINER[bucket];
  if (finer === bucket) return bucket;
  return Math.ceil(width / BUCKET_MS[finer]) <= MAX_ZOOM_BARS ? finer : bucket;
}

/**
 * A band selection as the statistics section's own {@link ChartSpec}.
 *
 * Positions clamp to the period list rather than failing: a selection can arrive
 * after a refetch has shortened the rows underneath it, and a clamped zoom is a
 * narrower window while an unclamped one is an invalid date the axis throws on.
 */
export function zoomedChartSpec(
  spec: ChartSpec,
  keys: readonly string[],
  indices: readonly [number, number] | null,
  opts: LabelOptions = {},
): ChartSpec | null {
  if (indices === null || keys.length === 0) return null;
  const last = keys.length - 1;
  const first = Math.min(Math.max(indices[0], 0), last);
  const end = Math.min(Math.max(indices[1], 0), last);
  const startBounds = periodBounds(keys[Math.min(first, end)], spec.bucket);
  const endBounds = periodBounds(keys[Math.max(first, end)], spec.bucket);
  if (!startBounds || !endBounds) return null;
  const from = startBounds[0];
  const to = endBounds[1];
  const width = to.getTime() - from.getTime();
  return {
    from,
    to,
    bucket: refined(spec.bucket, width),
    // Under a day the clock is the content; at a day or more the bars ARE days,
    // and the caption names the last one DRAWN rather than the exclusive edge.
    caption:
      width < DAY
        ? zoomSpanLabel(from, to, opts)
        : zoomSpanLabel(from, new Date(to.getTime() - 1), { ...opts, dateOnly: true }),
  };
}
