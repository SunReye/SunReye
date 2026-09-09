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
import { source } from "$lib/source.svelte";
import { payloadOrNull } from "$lib/api-payload";
import type { MetricSeries, SeriesAggregate, SeriesRef, SeriesWindow } from "./series";

/**
 * Row cap per series. A day of minute buckets is 1 440, so this admits a full
 * day and refuses a request that would silently return a truncated one.
 */
const SERIES_LIMIT = 1441;

/** One bucket as the rollup answers it: every aggregate, in one row. */
type RollupPoint = { time: string; avg: number; min: number; max: number };

/**
 * Fetch one metric's buckets. An empty list on any failure — a chart draws
 * nothing, loudly.
 *
 * Not exported: every caller wants several series over one window, and reaching
 * for this directly is how a page ends up issuing them in sequence.
 */
async function fetchRollup(ref: SeriesRef, window: SeriesWindow): Promise<RollupPoint[]> {
  const { data } = await api.api.history.rollup.get({
    query: {
      metric: ref.metric,
      // A ref that names a device (the optimizer) is read by slug; every other
      // series follows the selected source — the plant, or the chosen device.
      ...(ref.inverterId ? { inverterId: ref.inverterId } : source.query),
      bucket: window.bucket ?? "minute",
      from: window.from.toISOString(),
      to: window.to.toISOString(),
      limit: SERIES_LIMIT,
    },
  });
  return payloadOrNull<RollupPoint[]>(data) ?? [];
}

/** One aggregate of one metric's buckets, as the series a builder joins on. */
function seriesOf(points: readonly RollupPoint[], agg: SeriesAggregate): MetricSeries {
  return new Map(points.map((p) => [Date.parse(p.time), p[agg]]));
}

/**
 * What identifies a REQUEST, as opposed to a series.
 *
 * The window is shared by every ref in one call, so the metric and the device
 * are the whole of it. Two aliases naming the same metric on the same device are
 * two views of ONE response — the run state read as both its `min` and its `max`
 * — and issuing that read twice would double a chart's refresh cost for numbers
 * the server already sent in the same row.
 */
const requestKey = (ref: SeriesRef): string => `${ref.inverterId ?? ""}|${ref.metric}`;

/**
 * One alias's series, out of what the requests answered.
 *
 * A `null` ref is a series this plant does not have and answers with an empty
 * map, so a caller never has to tell "absent" from "not asked for".
 */
function seriesFor(ref: SeriesRef | null, answered: ReadonlyMap<string, RollupPoint[]>) {
  if (!ref) return new Map<number, number>();
  return seriesOf(answered.get(requestKey(ref)) ?? [], ref.agg ?? "avg");
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
  // One request per (metric, device), however many aliases read it: the rollup
  // answers with all three aggregates in the same row, so two aliases over one
  // metric are two reads of one response rather than two round trips.
  const requests = new Map<string, Promise<RollupPoint[]>>();
  for (const name of names) {
    const ref = refs[name];
    if (!ref) continue;
    const key = requestKey(ref);
    if (!requests.has(key)) requests.set(key, fetchRollup(ref, window));
  }
  const answered = new Map(
    await Promise.all([...requests].map(async ([key, points]) => [key, await points] as const)),
  );
  return Object.fromEntries(names.map((name) => [name, seriesFor(refs[name], answered)])) as Record<
    K,
    MetricSeries
  >;
}
