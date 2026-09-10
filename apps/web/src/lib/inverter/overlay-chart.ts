/**
 * Everything between "a list of metric keys" and "the props an overlay plot
 * takes": resolving keys against the live manifest, colouring, and merging the
 * per-metric point lists into one row per timestamp.
 *
 * Pulled out of `custom-chart-card.svelte`, where it sat inline in the
 * `<script>` and was therefore reachable only by a saved chart with an id. A
 * *draft* — metrics the user is trying out full-screen, that no server has ever
 * seen — needs exactly the same steps, and `CustomChartPlot` already takes
 * nothing but plain data. So the difference between a saved chart and a draft
 * is now only where the key list comes from.
 */

import { colorVar, isSeriesColor, paletteColor } from "./chart-palette";
import { dueRefresh, liveTailPoints, rollupPoints } from "./live-tail";
import type { AxisSeries, Datum } from "./chart-axes";
import type { LiveWindow, RollupRow } from "./live-tail";
import type { LivePoint, ManifestMetric } from "./types";

/** One metric's points, as either feed hands them over. */
export interface MetricPoints {
  key: string;
  points: readonly LivePoint[];
}

/** Which of the requested keys the active profile actually has. */
export interface ResolvedMetrics {
  resolved: ManifestMetric[];
  /** Requested keys with no metric behind them — a profile changed under a
   *  saved chart, or a draft outlived the metric it started from. */
  missing: string[];
}

/** Resolve keys against the catalogue, keeping the caller's order. */
export function resolveMetrics(
  catalog: readonly ManifestMetric[],
  keys: readonly string[],
): ResolvedMetrics {
  const byKey = new Map(catalog.map((metric) => [metric.key, metric]));
  const resolved: ManifestMetric[] = [];
  const missing: string[] = [];
  for (const key of keys) {
    const metric = byKey.get(key);
    if (metric) resolved.push(metric);
    else missing.push(key);
  }
  return { resolved, missing };
}

/**
 * The plot's series list.
 *
 * Colour is the one the user pinned for that metric, or — for the metrics they
 * did not — the palette entry for its position among the RESOLVED metrics, so
 * a chart whose second key is unavailable does not leave a hole in the palette.
 *
 * A pinned value that is not a palette id is ignored rather than trusted: it
 * ends up in a `style` attribute, and the record comes back from a server that
 * validates on write but not on read of an older blob.
 */
export function overlaySeries(
  metrics: readonly ManifestMetric[],
  colors: Readonly<Record<string, string>> = {},
): AxisSeries[] {
  return metrics.map((metric, index) => {
    const pinned = colors[metric.key];
    return {
      key: metric.key,
      label: metric.label,
      color: isSeriesColor(pinned) ? colorVar(pinned) : paletteColor(index),
      unit: metric.unit ?? "",
      value: (d: Datum) => (d[metric.key] as number | undefined) ?? null,
    };
  });
}

/**
 * Merge per-metric point lists into one row per timestamp, ascending.
 *
 * Rows are sparse on purpose: a metric with no sample at some timestamp simply
 * has no key on that row, and the series accessor answers `null` there, which
 * is how layerchart draws a gap rather than a line to zero.
 */
// fallow-ignore-next-line unused-export -- the merge is the unit under test (`overlay-chart.test.ts`); its only caller is `overlayDatums` in this file
export function mergePoints(perMetric: readonly MetricPoints[]): Datum[] {
  const byTime = new Map<number, Datum>();
  for (const { key, points } of perMetric) {
    for (const point of points) {
      let row = byTime.get(point.t);
      if (!row) {
        row = { date: new Date(point.t) };
        byTime.set(point.t, row);
      }
      row[key] = point.v;
    }
  }
  return [...byTime.values()].sort(
    (a, b) => (a.date as Date).getTime() - (b.date as Date).getTime(),
  );
}

// ── Windows whose right edge is the future ───────────────────────────────────
// The multi-metric half of #216. `entity-history-card` grows a single metric's
// day through `$lib/inverter/live-tail`; an overlay is the same two mechanisms
// over N keys, and what it adds is that the keys can disagree — so the delta is
// one window sized for the LAGGING key, and the splice is per key.

/** One overlaid metric: the rows fetched for it, and its live frames. */
export interface OverlayFeed {
  key: string;
  rows: readonly RollupRow[];
  live: readonly LivePoint[];
}

/**
 * The window an overlay still needs, or null when it needs none.
 *
 * One query per tick rather than one per key: the keys were fetched together
 * and so normally hold the same buckets, and refetching the widest of their
 * deltas for all of them costs the same round trip as refetching the narrowest.
 * Sizing it from the leading key instead would leave a lagging key's hole
 * unfilled for the rest of the day, because the next tick would ask from the
 * leader again.
 */
export function overlayDelta(
  feeds: readonly OverlayFeed[],
  window: LiveWindow,
  tickMs: number,
  syncedTickMs: number,
): { from: Date; to: Date } | null {
  let earliest: { from: Date; to: Date } | null = null;
  for (const feed of feeds) {
    const delta = dueRefresh(feed.rows, window, tickMs, syncedTickMs);
    if (!delta) continue;
    if (!earliest || delta.from.getTime() < earliest.from.getTime()) earliest = delta;
  }
  return earliest;
}

/**
 * Every feed's rollup rows plus its own closed live buckets, as plot rows.
 *
 * Per key, not once over the union: a key whose rollup reaches 10:01 and a key
 * whose rollup stops at 10:00 need different splice points, and splicing on the
 * union's would write one key's live frames over the other's fetched answer for
 * that minute.
 */
export function overlayDatums(feeds: readonly OverlayFeed[], window: LiveWindow): Datum[] {
  return mergePoints(
    feeds.map(({ key, rows, live }) => ({
      key,
      points: [...rollupPoints(rows), ...liveTailPoints(live, rows, window)].map((point) => ({
        t: point.date.getTime(),
        v: point.avg,
      })),
    })),
  );
}
