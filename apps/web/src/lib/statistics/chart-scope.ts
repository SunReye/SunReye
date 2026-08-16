// Localized face of the per-chart view scope (`$lib/cost/ranges.ts`). The range
// builders bake English captions into every ChartSpec; this module maps the
// (preset id, scope) pair onto the message catalogue and produces the two
// labels the section headers' RangeSwitcher renders.

import type { ChartScope, CostRange } from "$lib/cost/ranges";
import * as m from "$lib/paraglide/messages";

/** Statistics sections whose default scope is a stored preference, read by
 *  `sectionScope()` in ./chart-scope.svelte.ts. */
export type ScopedSection = "cost" | "energy";

/** Caption per `${preset id}:${scope}`; anything missing falls back to the
 *  spec's own English caption. */
const CAPTIONS: Record<string, () => string> = {
  "today:detail": m.costs_caption_today,
  "today:context": m.costs_caption_this_month,
  "7d:detail": m.costs_caption_last_7d,
  "7d:context": m.costs_caption_this_month,
  "month:detail": m.costs_caption_this_month,
  "month:context": m.range_12mo,
  "lastMonth:detail": m.statistics_caption_last_month,
  "lastMonth:context": m.range_12mo,
  "year:detail": m.statistics_caption_this_year,
  "year:context": m.statistics_caption_24mo,
  "custom:detail": m.costs_caption_custom,
  "custom:context": m.range_12mo,
};

/** Localized caption for what a chart is currently plotting. */
export function chartCaption(range: CostRange, scope: ChartScope): string {
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
  today: m.range_this_month,
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
