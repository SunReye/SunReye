// Localized face of the per-chart view scope (`$lib/cost/ranges.ts`). The range
// builders bake English captions into every ChartSpec; this module maps the
// (preset id, scope) pair onto the message catalogue and produces the two
// labels the section headers' RangeSwitcher renders.

import type { ChartScope, CostBucket, CostRange } from "$lib/cost/ranges";
import * as m from "$lib/paraglide/messages";
import { getLocale } from "$lib/paraglide/runtime";
import { browserTimeZone } from "$lib/time/browser-zone";
import { periodTitle, type Grain } from "$lib/time/period";

/** Statistics sections whose default scope is a stored preference, read by
 *  `sectionScope()` in ./chart-scope.svelte.ts. */
export type ScopedSection = "cost" | "energy";

/** Caption per `${preset id}:${scope}`; anything missing falls back to the
 *  spec's own English caption. */
const CAPTIONS: Record<string, () => string> = {
  "7d:detail": m.costs_caption_last_7d,
  "7d:context": m.costs_caption_this_month,
  "custom:detail": m.costs_caption_custom,
  "custom:context": m.range_12mo,
};

/**
 * The four calendar grains, which are also the ids `costRangeFor` stamps on a
 * period range. They cannot be table entries like the presets above: a table is
 * keyed on the id alone, and every day the reader steps back to is still `day`,
 * so "Today, by hour" would be the caption for last Tuesday.
 */
const GRAIN_IDS = new Set<string>(["day", "week", "month", "year"]);

/** `{period}, by hour` — the period NAMES itself, the bucket says how finely. */
const PERIOD_DETAIL_CAPTION: Record<CostBucket, (args: { period: string }) => string> = {
  hour: m.statistics_caption_period_hour,
  day: m.statistics_caption_period_day,
  month: m.statistics_caption_period_month,
};

/**
 * The window each grain's context chart zooms out to, in the same words
 * `$lib/cost/ranges` bakes into the spec — a day and a week read against the
 * month they sit in, a month against the trailing twelve, a year against 24.
 */
const PERIOD_CONTEXT_CAPTION: Record<Grain, () => string> = {
  day: m.costs_caption_this_month,
  week: m.costs_caption_this_month,
  month: m.range_12mo,
  year: m.statistics_caption_24mo,
};

/**
 * The caption for a calendar period, composed rather than looked up.
 *
 * `periodTitle` is the navigator's own header function, so the caption under a
 * chart and the title on the control above it name the period identically —
 * "Today" while it is today, "Aug 12" once the reader has stepped back, the
 * zone's own year rather than the instant's UTC one.
 */
function periodCaption(range: CostRange, scope: ChartScope): string {
  const grain = range.id as Grain;
  if (scope === "context") return PERIOD_CONTEXT_CAPTION[grain]();
  const period = periodTitle(
    { grain, start: range.from, end: range.to },
    { timeZone: browserTimeZone(), locale: getLocale() },
    { today: m.range_today, weekOf: m.range_week_of },
  );
  return PERIOD_DETAIL_CAPTION[range.detail.bucket]({ period });
}

/** Localized caption for what a chart is currently plotting. */
export function chartCaption(range: CostRange, scope: ChartScope): string {
  if (GRAIN_IDS.has(range.id)) return periodCaption(range, scope);
  const spec = scope === "detail" ? range.detail : range.chart;
  return CAPTIONS[`${range.id}:${scope}`]?.() ?? spec.caption;
}

/** Switcher label for the detail option — the granularity inside the window. */
const DETAIL_LABELS = {
  hour: m.statistics_scope_by_hour,
  day: m.statistics_scope_by_day,
  month: m.statistics_scope_by_month,
};

/** Switcher label for the context option — named by the wider window rather
 *  than its bucket, so a year ("24 months") never collides with its own
 *  by-month detail view. */
const CONTEXT_LABELS: Record<string, () => string> = {
  day: m.range_this_month,
  week: m.range_this_month,
  "7d": m.range_this_month,
  year: m.statistics_scope_24mo,
};

/** The two options a section header's RangeSwitcher renders for `range`. */
export function scopeOptions(range: CostRange): readonly { id: ChartScope; label: string }[] {
  return [
    { id: "detail", label: DETAIL_LABELS[range.detail.bucket]() },
    { id: "context", label: (CONTEXT_LABELS[range.id] ?? m.statistics_scope_12mo)() },
  ];
}

/**
 * A panel's summary figure describes the PICKED window, so it only belongs on a
 * chart plotting that window. Zoomed out to context (the trailing 12 or 24
 * months) the chart and the figure disagree, and the summary is dropped.
 * A panel with no scope of its own (the price curves) always keeps it.
 */
export const summaryForScope = <T>(scope: ChartScope | undefined, summary: T | undefined) =>
  scope === "context" ? undefined : summary;
