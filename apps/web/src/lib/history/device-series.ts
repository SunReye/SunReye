/**
 * ONE WAY TO READ A DEVICE'S SERIES — the generic read path, as a function.
 *
 * `GET /api/history/rollup` answers for any `(metric, device)` pair: an
 * inverter's PV power, a loadpoint's charge power, the optimizer's charge-current
 * ceiling. This is the client half of that, so a feature that wants a series
 * writes down WHICH series it wants and nothing else.
 *
 * It exists because the automations feature had grown a second, private chart
 * stack: the engine's decisions arrived over a bespoke WebSocket topic as a
 * bespoke wire type, and were turned into rows by builders that no other part of
 * the app could use — while `measured-day.ts`, a few files away, was already
 * fetching the very same rollups for the very same charts. Two paths to two
 * shapes of the same picture, and only one of them survived a restart.
 *
 * WHY MINUTE BUCKETS ARE THE JOIN KEY
 *
 * Series from different devices are recorded at different cadences: the poll
 * loop samples every few seconds, the optimizer decides every 30 s, and both are
 * change-encoded, so their raw timestamps never line up. Bucketing both to the
 * minute tier gives them the SAME keys, which is what makes a row assembled from
 * several devices' series honest rather than approximately aligned.
 *
 * The types and the two pure operations are in `./series.ts` — a builder that
 * only assembles rows imports those and never reaches this file, which is what
 * keeps it unit-testable (`$lib/api` reaches `$app/environment`).
 */

import { api } from "$lib/api";
import { payloadOrNull } from "$lib/api-payload";
import type { MetricSeries, SeriesRef, SeriesWindow } from "./series";

/**
 * Row cap per series. A day of minute buckets is 1 440, so this admits a full
 * day and refuses a request that would silently return a truncated one.
 */
const SERIES_LIMIT = 1441;

/**
 * Fetch one series. An empty map on any failure — a chart draws nothing, loudly.
 *
 * Not exported: every caller wants several series over one window, and reaching
 * for this directly is how a page ends up issuing them in sequence.
 */
async function fetchMetricSeries(ref: SeriesRef, window: SeriesWindow): Promise<MetricSeries> {
  const { data } = await api.api.history.rollup.get({
    query: {
      metric: ref.metric,
      ...(ref.inverterId ? { inverterId: ref.inverterId } : {}),
      bucket: window.bucket ?? "minute",
      from: window.from.toISOString(),
      to: window.to.toISOString(),
      limit: SERIES_LIMIT,
    },
  });
  const points = payloadOrNull<{ time: string; avg: number }[]>(data) ?? [];
  return new Map(points.map((p) => [Date.parse(p.time), p.avg]));
}

/**
 * Fetch several series at once, keyed by the caller's own alias.
 *
 * In parallel, because they are independent reads of one window and the page
 * paints when the slowest lands either way. A `null` ref is a series this plant
 * does not have — a profile that maps no house load, an optimizer that has never
 * run — and answers with an empty map rather than being left out, so a caller
 * never has to tell "absent" from "not asked for".
 */
export async function fetchSeriesSet<K extends string>(
  refs: Record<K, SeriesRef | null>,
  window: SeriesWindow,
): Promise<Record<K, MetricSeries>> {
  const names = Object.keys(refs) as K[];
  const series = await Promise.all(
    names.map((name) => {
      const ref = refs[name];
      return ref ? fetchMetricSeries(ref, window) : Promise.resolve(new Map<number, number>());
    }),
  );
  return Object.fromEntries(names.map((name, i) => [name, series[i]!])) as Record<K, MetricSeries>;
}
