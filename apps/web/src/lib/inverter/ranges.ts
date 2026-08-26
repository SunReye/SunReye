// Time-range model shared by the history page and its period navigator. A
// `HistoryRange` is either the realtime `live` buffer or a concrete `[from, to)`
// window. A named window states its own rollup bucket — a calendar grain through
// `GRAIN_BUCKET`, the `6mo` preset in its own entry — and an arbitrary span gets
// one from `bucketForSpan`, so a 12-month chart stays cheap while an hour chart
// stays detailed.
import { browserTimeZone } from "$lib/time/browser-zone";
import { containsNow, periodLabel, periodWindow, type Grain, type Period } from "$lib/time/period";
import type { ManifestMetric } from "./types";

export type RollupBucket = "minute" | "hour" | "day";

/** A resolved window the charts render against. */
export type HistoryRange = {
  id: string;
  label: string;
  /** true = realtime live-buffer mode (no rollup fetch, gliding chart). */
  live: boolean;
  from: Date;
  to: Date;
  bucket: RollupBucket;
};

/**
 * A selectable entry in {@link PRESETS}; `live` and `hours` are mutually
 * exclusive.
 *
 * `bucket` PINS the rollup granularity for the ones whose resolution is part of
 * what the preset means, instead of letting {@link bucketForSpan} re-derive it
 * from the width. See the `6mo` entry.
 */
export type Preset = {
  id: string;
  label: string;
  live?: boolean;
  hours?: number;
  bucket?: RollupBucket;
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * Selectable presets, in display order. `live` is the default and is NOT one of
 * them — see {@link KEPT_PRESETS}.
 *
 * The period navigator's four tabs are the calendar windows now, so the presets
 * that named one are gone: `24h` is the Day tab, `7d` the Week tab, `30d` the
 * Month tab, `12mo` the Year tab. Only the rolling windows a calendar cannot
 * express are kept.
 */
const PRESETS: readonly Preset[] = [
  { id: "live", label: "Live", live: true },
  { id: "1h", label: "1 hour", hours: 1 },
  { id: "6h", label: "6 hours", hours: 6 },
  { id: "14d", label: "Last 14 days", hours: 24 * 14 },
  // HOURLY, pinned. 182 days is past `bucketForSpan`'s two-month ceiling, which
  // exists for the Year GRAIN (~100 metric cards over 8760 hourly points each).
  // This preset is one window a reader asked for by name, it has always been
  // ~4368 hourly bars, and "kept" has to mean it still shows what it showed —
  // so it states its granularity rather than inheriting the grain's.
  { id: "6mo", label: "Last 6 months", hours: 24 * 182, bucket: "hour" },
];

/**
 * The presets the navigator offers behind its calendar button.
 *
 * Derived from {@link PRESETS} rather than written out again: the live buffer is
 * not a pickable window any more (standing on the current day IS live — see
 * {@link historyPeriodRange}), and a second hand-kept list is how the popover
 * and the resolver drift apart.
 */
export const KEPT_PRESETS: readonly Preset[] = PRESETS.filter((p) => p.live !== true);

/**
 * Pick a rollup granularity for an ARBITRARY span — a custom range, a zoom
 * selection. Minute resolution up to and including the last-week (7-day)
 * window, hourly up to two months, daily beyond that. A 7-day minute series is
 * ~10k points, so callers must request a limit that covers it (see
 * entity-history-card).
 *
 * The daily arm is what makes a wide window affordable. The history page mounts
 * a chart per metric card — around a hundred on a Deye — and a year of hourly
 * rollups is 8760 points EACH: megabytes of JSON to draw ~24 points per rendered
 * pixel, none of which the reader can see. Daily is ~365.
 *
 * NOT the answer for a calendar period ({@link GRAIN_BUCKET}) or for a preset
 * that pins its own (`6mo`). Both of those are named windows whose resolution is
 * part of what the name means, and deriving them from the raw width re-cuts
 * their data whenever a threshold here moves.
 *
 * Exported for the zoom mapper (`$lib/charts/zoom-range`): a zoom that kept the
 * bucket it was fetched at would only magnify the bars already on screen, so it
 * has to re-derive the granularity from the SELECTED span — through this, not
 * through a second table that could drift from it.
 */
export function bucketForSpan(ms: number): RollupBucket {
  if (ms <= 7 * DAY) return "minute";
  if (ms <= 60 * DAY) return "hour";
  return "day";
}

/** Trailing window the live sparkline buffer covers (matches the store). */
const LIVE_WINDOW_MS = 5 * 60 * 1000;

/** Resolve a preset id into a concrete range anchored at `now`. */
export function resolvePreset(id: string, now: Date = new Date()): HistoryRange {
  const p = PRESETS.find((x) => x.id === id) ?? PRESETS[0];
  if (p.live) {
    return {
      id: p.id,
      label: p.label,
      live: true,
      from: new Date(now.getTime() - LIVE_WINDOW_MS),
      to: now,
      bucket: "minute",
    };
  }
  const from = new Date(now.getTime() - (p.hours ?? 24) * HOUR);
  return {
    id: p.id,
    label: p.label,
    live: false,
    from,
    to: now,
    bucket: p.bucket ?? bucketForSpan(now.getTime() - from.getTime()),
  };
}

const dateFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

/**
 * Build a custom range from two inclusive calendar days. The label shows the
 * days the user picked, while the query window extends `to` to the exclusive
 * next-day boundary so the last day's data is included in `[from, to)`.
 *
 * That boundary is the next civil midnight, not `+ 86_400_000`: across a
 * spring-forward the day is 23 hours (adding a flat day overshoots into the
 * next one) and across a fall-back 25 (it drops the last hour). `timeZone`
 * defaults to the browser's, which is the zone the picker's days were read in.
 */
export function customRange(
  from: Date,
  toInclusive: Date,
  timeZone: string = browserTimeZone(),
): HistoryRange {
  const to = periodWindow(toInclusive, "day", { timeZone }).end;
  return {
    id: "custom",
    label: `${dateFmt.format(from)} – ${dateFmt.format(toInclusive)}`,
    live: false,
    from,
    to,
    bucket: bucketForSpan(to.getTime() - from.getTime()),
  };
}

/**
 * Rollup granularity of each calendar GRAIN — the finest resolution its point
 * count affords, decided by the grain and not by the raw width of the window.
 *
 * A civil week is 168 hours, except the one containing an autumn fall-back,
 * which is 169. Run through {@link bucketForSpan} that single week lands past
 * the ≤7-day minute budget and the Week tab quietly draws hourly data one week a
 * year while its neighbours draw minutes — a coarser chart, from the same tab,
 * for no reason the reader can see. A grain is a named window, so it names its
 * own bucket: the DST hour is not a granularity decision.
 *
 * Year is daily for the reason {@link bucketForSpan}'s own daily arm exists:
 * ~100 metric cards over 8760 hourly points each is megabytes of JSON drawn at
 * ~24 points per rendered pixel.
 */
const GRAIN_BUCKET: Record<Grain, RollupBucket> = {
  day: "minute",
  week: "minute",
  month: "hour",
  year: "day",
};

/**
 * A calendar period as a history window — the period navigator's adapter.
 *
 * Additive: `resolvePreset` and `customRange` are untouched and this is a third
 * door into the same model. The range is identified by its GRAIN, so the page
 * can tell a week from a month without re-deriving one from the timestamps.
 *
 * Never `live`. The live buffer is a five-minute trailing sparkline, not a
 * calendar period — standing on the current period is a rollup window whose
 * right edge happens to be the future, which is what lets the same chart carry
 * a day that is still filling in.
 *
 * The label is baked in English for the reason `resolvePreset`'s are (see
 * `$lib/cost/labels`): the model stays free of the message catalogue, and the
 * navigator renders `periodTitle` instead.
 */
// fallow-ignore-next-line unused-export -- the period-to-window rule is the unit under test; its only in-module caller reaches it through `historyPeriodRange`'s live branch, which cannot exercise the day case at all
export function historyRangeFor(
  period: Period,
  timeZone: string = browserTimeZone(),
): HistoryRange {
  return {
    id: period.grain,
    label: periodLabel(period, { timeZone }),
    live: false,
    from: period.start,
    to: period.end,
    bucket: GRAIN_BUCKET[period.grain],
  };
}

/**
 * The window /history renders for a calendar period — what the navigator's tabs
 * and arrows resolve to.
 *
 * The current DAY is the live view. The design has no "Live" tab because
 * standing on the current period IS live, and at day granularity that has to
 * mean the same gliding chart the deleted `live` preset used to reach: this is
 * the only thing left that sets `range.live`, which four components fork their
 * whole render path on (`entity-history-card`, `overlay-chart-view`,
 * `metric-card-plot`, `chart-format#xTick`).
 *
 * Above day grain it never is. A five-minute trailing sparkline is not what
 * "this month" means, so the current week, month and year are rollup windows
 * whose right edge is in the future — which is what lets one chart carry a
 * period that is still filling in. The navigator still prints the live pill and
 * kills the forward arrow there; that signal is `containsNow` and it is a
 * different question from which renderer draws the card.
 *
 * Composed from {@link resolvePreset} and {@link historyRangeFor} rather than
 * building a third window, so "how long is the live buffer" and "how is a period
 * bucketed" each keep exactly one answer.
 */
export function historyPeriodRange(
  period: Period,
  now: Date = new Date(),
  timeZone: string = browserTimeZone(),
): HistoryRange {
  return period.grain === "day" && containsNow(period, now)
    ? resolvePreset("live", now)
    : historyRangeFor(period, timeZone);
}

/**
 * A metric worth offering a custom chart over: it must be numeric *and*
 * persisted as a series. The kind answers the first half — a status enum and a
 * control are not curves — and `storage` answers the second: a `config` metric
 * lives in the change-log and a `none` metric is never written at all, so a chart
 * over either plots an empty axis. Before `storage` existed the second half was
 * unanswerable and the empty plot was reachable from the UI.
 */
export function isChartable(metric: ManifestMetric): boolean {
  if (metric.storage !== "series") return false;
  // A state is not a curve: an enum plotted as a line is a meaningless ramp
  // between arbitrary codes, whether it is reported (`status`) or written
  // (a `setting` like the work mode). `enumLabels` is the tell either way.
  if (metric.kind === "status" || metric.enumLabels) return false;
  return true;
}

const ROLE_CATEGORY: Record<string, string> = {
  pv: "Solar",
  production: "Solar",
  battery: "Battery",
  grid: "Grid",
  load: "Backup / Load",
  consumption: "Consumption",
  generator: "Generator",
  inverter: "Inverter",
};

/** Human category a metric belongs to — by canonical role prefix, else its group. */
function categoryOf(metric: ManifestMetric): string {
  const prefix = metric.role?.split(".")[0];
  if (prefix && ROLE_CATEGORY[prefix]) return ROLE_CATEGORY[prefix];
  const g = metric.group || "Other";
  return g.charAt(0).toUpperCase() + g.slice(1);
}

/** Filter metrics by a free-text query over label and key (empty → unchanged). */
export function filterMetrics(metrics: ManifestMetric[], query: string): ManifestMetric[] {
  const q = query.trim().toLowerCase();
  if (!q) return metrics;
  return metrics.filter(
    (m) => m.label.toLowerCase().includes(q) || m.key.toLowerCase().includes(q),
  );
}

/** Group metrics by category, sorted alphabetically; metrics keep their order. */
export function groupByCategory(metrics: ManifestMetric[]): [string, ManifestMetric[]][] {
  const map = new Map<string, ManifestMetric[]>();
  for (const m of metrics) {
    const cat = categoryOf(m);
    const arr = map.get(cat) ?? [];
    arr.push(m);
    map.set(cat, arr);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}
