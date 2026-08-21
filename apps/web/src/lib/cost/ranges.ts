// Time-range model for the statistics page. A `CostRange` carries the
// `[from, to)` the headline tiles are priced over plus TWO chart specs, because
// one picked range answers two different questions:
//
//   detail  — bucket INSIDE the picked window (today → by hour, a month → by day)
//   context — zoom one level out (a day → its month, a month → the trailing 12
//             months, a year → the trailing 24 months)
//
// Every chart-bearing section header carries a switcher between the two; pick
// one with {@link chartSpecFor}. `chart` stays an alias of the context spec so
// callers written before the switcher keep working unchanged.
//
// Kept separate from the History page's `ranges.ts`, which models the live
// buffer / rollup granularity for entity charts — different concern, different
// shape.

import { fittedPadding, isNarrowPlot, type ChartPadding } from "$lib/charts/plot-padding";
import { dayMonth, monthShort } from "$lib/format/date";
import { browserTimeZone } from "$lib/time/browser-zone";
import {
  periodLabel,
  periodWindow,
  startOfPeriod,
  type Grain,
  type Period,
} from "$lib/time/period";

const DAY = 86_400_000;

/** Bar granularity of a statistics chart. */
export type CostBucket = "hour" | "day" | "month";

/**
 * Which window a chart plots for the picked range: buckets inside it
 * (`detail`) or one level out around it (`context`).
 */
export type ChartScope = "detail" | "context";

/** Window + granularity one chart renders, with the caption tying it back to
 *  the picked range. */
export interface ChartSpec {
  from: Date;
  to: Date;
  bucket: CostBucket;
  /** Caption tying the chart back to the picked range, e.g. "This month, by day". */
  caption: string;
}

/** A resolved cost window: tiles `[from, to)` plus both chart specs. */
export interface CostRange {
  id: string;
  label: string;
  from: Date;
  to: Date;
  /** The `context` spec — kept under its original name for the callers that
   *  predate the per-chart scope switcher. */
  chart: ChartSpec;
  /** Buckets inside the picked window. */
  detail: ChartSpec;
}

/** The window one chart should plot for `range` at the requested scope. */
export function chartSpecFor(range: CostRange, scope: ChartScope): ChartSpec {
  return scope === "detail" ? range.detail : range.chart;
}

/** A chart spec as the query the series endpoints take (`/api/cost/series`,
 *  `/api/energy/series` — same three parameters). */
export function specQuery(spec: ChartSpec): { from: string; to: string; bucket: CostBucket } {
  return { from: spec.from.toISOString(), to: spec.to.toISOString(), bucket: spec.bucket };
}

/**
 * Selectable presets, in display order.
 *
 * One entry, and that is the point. The period navigator's four tabs ARE the
 * calendar windows: `today` is Day, `month` is Month, `lastMonth` is Month plus
 * one back-press, `year` is Year. A rolling seven days is the only window this
 * page offered that no calendar grain can express, so it is the only one kept —
 * the same rule that keeps 1h / 6h / 14d / 6mo on /history.
 */
export const COST_PRESETS = [{ id: "7d", label: "Last 7 days" }] as const;

/**
 * Max x-axis tick labels for a bucket, sized so labels don't collide on a
 * ~350px mobile chart (layerchart thins a band domain to every Nth entry).
 * Hover/tooltip still exposes every period; the axis only needs anchors.
 */
export const COST_X_TICKS: Record<CostBucket, number> = { hour: 6, day: 8, month: 6 };

/**
 * Minimum horizontal room an x-axis label gets, in pixels. LayerChart thins the
 * band domain to fit, so the tick count follows the chart's real width instead
 * of a guess — at 390px the hour labels used to run into one another
 * ("00:0003:0006:00").
 */
const COST_X_TICK_SPACING = 72;

/**
 * Chart padding. The left gutter fits a four-digit figure with its unit
 * ("1,000 kWh"), which the old 48px clipped to "000 kWh"; the right one keeps
 * the last tick label ("Aug 2") inside the plot instead of cutting it in half.
 */
const COST_CHART_PADDING = { top: 8, right: 24, bottom: 20, left: 60 };

/** The heat grid's own gutters: a weekday label on the left, hour labels below. */
const HEAT_CHART_PADDING = { top: 4, right: 8, bottom: 24, left: 40 };

/** {@link COST_CHART_PADDING}, fitted to a plot of `width`. */
export function chartPaddingFor(width: number): ChartPadding {
  return fittedPadding(COST_CHART_PADDING, width);
}

/** {@link HEAT_CHART_PADDING}, fitted to a plot of `width`. */
export function heatPaddingFor(width: number): ChartPadding {
  return fittedPadding(HEAT_CHART_PADDING, width);
}

/** Minimum room per x-axis label on a narrow plot — "00:00" plus a hair. */
const NARROW_X_TICK_SPACING = 48;

/**
 * {@link COST_X_TICK_SPACING}, fitted to a plot of `width`. At 72px a 412px
 * phone gets four hour labels across a whole day; at 48 it gets seven, which is
 * still short of the width where they touch.
 */
export function xTickSpacingFor(width: number): number {
  return isNarrowPlot(width) ? NARROW_X_TICK_SPACING : COST_X_TICK_SPACING;
}

/**
 * Band padding for a bar chart of `count` periods. A window with one or two
 * buckets otherwise renders bars half the viewport wide; past a handful of
 * bars the usual spacing reads better.
 */
export const barBandPadding = (count: number, base: number): number => (count <= 4 ? 0.6 : base);

/** The period-key shape each bucket produces, as the server writes them. */
const KEY_SHAPE: Record<CostBucket, RegExp> = {
  hour: /^\d{4}-\d{2}-\d{2}T\d{2}$/,
  day: /^\d{4}-\d{2}-\d{2}$/,
  month: /^\d{4}-\d{2}$/,
};

/**
 * Axis label for one period KEY at the given granularity.
 *
 * Named for its argument, not for what it returns: `$lib/time/period` exports a
 * `periodLabel` that names a whole `Period` for the navigator's header, and two
 * exports called `periodLabel` in one app is one import-completion away from the
 * wrong label on an axis. Neither is a barrel export and their arguments do not
 * overlap, so the collision was never a type error — which is exactly why it
 * needed a name rather than a suppression.
 *
 * A key that doesn't match the bucket falls back to itself rather than being
 * formatted: read as a month, a day key yields an invalid Date and `Intl` throws
 * on it, taking the page down over one tick. Callers must still pair periods
 * with the bucket they were fetched at — see the series state in
 * energy-section/cost-section — this only keeps the failure legible.
 */
export function periodKeyLabel(key: string, bucket: CostBucket): string {
  if (!KEY_SHAPE[bucket].test(key)) return key;
  if (bucket === "hour") return `${key.slice(11, 13)}:00`;
  return bucket === "day"
    ? dayMonth(new Date(`${key}T00:00:00`))
    : monthShort(new Date(`${key}-01T00:00:00`));
}

/**
 * Midnight starting the civil day `d` falls in, in the viewer's zone — the same
 * primitive {@link customCostRange} bounds its window with, rather than a second
 * local-midnight helper that could drift from it.
 *
 * NOTE: this does not rescue the `7d` preset, which asks for
 * `startOfDay(now - 6 * DAY)`. Across a spring-forward that subtraction lands on
 * the day before the one intended and the window covers eight days — the same
 * defect family, left alone here on purpose.
 */
const startOfDay = (d: Date): Date => startOfPeriod(d, "day", { timeZone: browserTimeZone() });
const startOfMonth = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), 1);

/**
 * The exclusive midnight ENDING the civil day `d` falls in — where a
 * now-inclusive window stops.
 *
 * Not `startOfDay(d) + DAY`: the same 23/25-hour argument {@link customCostRange}
 * spells out. Through `periodWindow`, so there is one implementation of "the
 * next civil midnight" in the app.
 */
const endOfDay = (d: Date): Date => periodWindow(d, "day", { timeZone: browserTimeZone() }).end;

/** Trailing N calendar months → monthly bars. The 12-month form matches
 *  monthlyEnergy's window. */
function trailingMonths(now: Date, months: number): ChartSpec {
  return {
    from: new Date(now.getFullYear(), now.getMonth() - (months - 1), 1),
    to: now,
    bucket: "month",
    caption: `Last ${months} months`,
  };
}

/** The calendar month `now` falls in, by day — the context one level out from a
 *  single day or a week. */
function thisMonthByDay(now: Date): ChartSpec {
  return { from: startOfMonth(now), to: now, bucket: "day", caption: "This month, by day" };
}

/** Bar granularity INSIDE each calendar period — one level finer than itself. */
const PERIOD_DETAIL_BUCKET: Record<Grain, CostBucket> = {
  day: "hour",
  week: "day",
  month: "day",
  year: "month",
};

/**
 * The context chart for each grain — the same zoom-one-level-out the presets
 * already make. A day and a week both read against the month they sit in; a
 * month against the trailing twelve; a year against the trailing 24, so this
 * year reads against the whole of the last one.
 */
const PERIOD_CONTEXT: Record<Grain, (now: Date) => ChartSpec> = {
  day: thisMonthByDay,
  week: thisMonthByDay,
  month: (now) => trailingMonths(now, 12),
  year: (now) => trailingMonths(now, 24),
};

/**
 * A calendar period as a statistics range — the period navigator's adapter.
 *
 * Additive: every preset builder and {@link customCostRange} keeps the exact
 * signature it had, `now` third and `timeZone` last.
 *
 * The window is the WHOLE period, not the part of it that has happened. `to:
 * now` is right for a preset that means "this month so far" and wrong here for
 * two reasons: `includesNow` (`$lib/statistics/live`) leases the live feed while
 * `range.to` is still ahead of the clock, so a window clamped at construction
 * stops being live one tick later and the tiles freeze; and the detail chart
 * wants a settled axis, with today's bar advancing across the month rather than
 * a chart that grows a column a day. Days still to come are genuinely empty —
 * the server prorates no standing charge past now.
 *
 * The label and caption are baked in English, as every builder in this file
 * does; `$lib/statistics/chart-scope` renders a localized one from the grain and
 * the period instead.
 */
export function costRangeFor(
  period: Period,
  now: Date = new Date(),
  timeZone: string = browserTimeZone(),
): CostRange {
  const label = periodLabel(period, { timeZone, now });
  const bucket = PERIOD_DETAIL_BUCKET[period.grain];
  return {
    id: period.grain,
    label,
    from: period.start,
    to: period.end,
    detail: {
      from: period.start,
      to: period.end,
      bucket,
      caption: `${label}, by ${bucket}`,
    },
    chart: PERIOD_CONTEXT[period.grain](now),
  };
}

/**
 * The rolling seven days: today plus the six prior days.
 *
 * `to` is the exclusive midnight ENDING today, not the instant the preset was
 * picked: `$lib/statistics/live#includesNow` is `containsNow` over `[from, to)`
 * with no id list beside it, and a window clamped at the pick instant stops
 * containing `now` one tick later — the lease drops and the tiles freeze, which
 * is what the id list existed to paper over.
 *
 * That boundary does NOT settle the comparison caption, and a comment here once
 * claimed it did. The comparison is priced over `pricedWindow`, which clamps
 * this window back to `now` — so "Last 7 days" reads as seven days only because
 * `$lib/statistics/compare#windowDays` counts CIVIL DAYS. Rounding the
 * millisecond span, which is what it used to do, answered six before noon and
 * seven after it, and the baseline moved over lunch.
 *
 * The server prorates no standing charge past `now`, so the hours of today still
 * to come are genuinely empty rather than cheap.
 */
function rollingWeek(now: Date): CostRange {
  const from = startOfDay(new Date(now.getTime() - 6 * DAY));
  const to = endOfDay(now);
  return {
    id: "7d",
    label: "Last 7 days",
    from,
    to,
    detail: { from, to, bucket: "day", caption: "Last 7 days, by day" },
    chart: thisMonthByDay(now),
  };
}

/** Selectable presets: id → concrete range anchored at `now`. */
const PRESET_BUILDERS: Record<string, (now: Date) => CostRange> = { "7d": rollingWeek };

/** Resolve a preset id into a concrete range anchored at `now`. */
export function resolveCostPreset(id: string, now: Date = new Date()): CostRange {
  return (PRESET_BUILDERS[id] ?? rollingWeek)(now);
}

/**
 * Build a custom range from two inclusive calendar days. The tiles window (and
 * the detail chart) extend `to` to the exclusive next-day boundary so the last
 * picked day is included; the detail chart shows daily bars across the picked
 * span, the context chart the trailing 12 months around `now`.
 *
 * That boundary is the next civil midnight, not `+ 86_400_000`: a
 * spring-forward day is 23 hours, so a flat day overshoots and prices an hour of
 * the next day, and a fall-back day is 25, so it drops the last hour of the day
 * the user picked. `timeZone` defaults to the browser's — the zone the picker's
 * days were read in — and is deliberately the LAST parameter: `now` still
 * anchors the trailing-12-month context chart.
 */
export function customCostRange(
  from: Date,
  toInclusive: Date,
  now: Date = new Date(),
  timeZone: string = browserTimeZone(),
): CostRange {
  const to = periodWindow(toInclusive, "day", { timeZone }).end;
  return {
    id: "custom",
    label: `${dayMonth(from)} – ${dayMonth(toInclusive)}`,
    from,
    to,
    detail: { from, to, bucket: "day", caption: "Custom range, by day" },
    chart: trailingMonths(now, 12),
  };
}
