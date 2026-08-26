/**
 * Shared time-series reads for one entity, used by both the web-facing history
 * endpoints (`index.ts`) and the generated `/api/v1` entity history route
 * (`entities.ts`) so the SQL + row shaping live in one place.
 */

import { db } from "@SunReye/db";
import { metricsRaw } from "@SunReye/db/schema/metrics";
import { and, desc, eq, gte } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { type RollupBucket, preferredRollup } from "./rollup-sql";

export type { RollupBucket } from "./rollup-sql";

/** The window one entity's time-series read is bounded by. */
export interface HistoryQuery {
  metric: string;
  inverterId: string;
  since: Date;
  limit: number;
}

/**
 * Downsampled rollup series (ascending), from a continuous aggregate view.
 * Pass either `since` (open-ended `[since, now)`) or an explicit `[from, to)`
 * window — the latter is what the custom date-range picker needs, since a range
 * ending in the past can't be expressed as an hours-ago offset.
 */
export async function queryRollup(
  q: Omit<HistoryQuery, "since"> & {
    bucket: RollupBucket;
    since?: Date;
    from?: Date;
    to?: Date;
  },
): Promise<Array<{ time: string; avg: number; max: number; min: number }>> {
  const window =
    q.from && q.to
      ? sql`bucket >= ${q.from} and bucket < ${q.to}`
      : sql`bucket >= ${q.since ?? new Date(0)}`;
  const source = preferredRollup(
    q.bucket,
    sql`metric = ${q.metric} and inverter_id = ${q.inverterId} and ${window}`,
  );
  const result = await db.execute<{
    bucket: string | Date;
    avg_value: number | null;
    max_value: number;
    min_value: number;
  }>(sql`
    select bucket, avg_value, max_value, min_value
    from ${source} r
    order by bucket asc
    limit ${q.limit}
  `);
  return result.rows.filter(hasAverage).map((r) => ({
    time: new Date(r.bucket).toISOString(),
    avg: Number(r.avg_value),
    max: Number(r.max_value),
    min: Number(r.min_value),
  }));
}

/**
 * Whether a bucket has an average at all.
 *
 * The weighted aggregates divide two materialized sums, guarded by
 * `nullif(weight, 0)`, so a degenerate bucket — one whose recorded hold times
 * sum to zero — yields NULL rather than an error or a fabricated number. It must
 * not reach a caller: `Number(null)` is `0`, which would draw a flat line
 * through a gap and read as a measurement. A real `0` is a reading (0 kW of PV
 * at night) and survives.
 */
function hasAverage<T extends { avg_value: number | null }>(
  row: T,
): row is T & { avg_value: number } {
  return row.avg_value !== null;
}

/**
 * Median of an hourly rollup's average values for one metric over the last
 * `days`, or `null` when there is no data. Used to infer a representative house
 * load for the solar-forecast clipping model — the median shrugs off EV-charge
 * spikes and idle nights that a mean would smear.
 */
export async function queryMedianHourlyAvg(
  metric: string,
  inverterId: string,
  days: number,
): Promise<number | null> {
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);
  const source = preferredRollup(
    "hour",
    sql`metric = ${metric} and inverter_id = ${inverterId} and bucket >= ${since}`,
  );
  // `percentile_cont` is an ordered-set aggregate: it ignores NULL inputs, so a
  // degenerate zero-weight bucket drops out of the ordering rather than skewing
  // the median toward zero.
  const result = await db.execute<{ median: number | null }>(sql`
    select percentile_cont(0.5) within group (order by avg_value) as median
    from ${source} r
  `);
  const median = result.rows[0]?.median;
  return median == null ? null : Number(median);
}

/**
 * Hourly average of one metric over `[from, to)`, as `{ bucketMs, avg }` sorted
 * ascending — the measured-actual side of the forecast correction's learning.
 * `bucketMs` is the UTC epoch ms of each hour bucket, so the caller can match it
 * to the reanalysis series by instant regardless of local offset.
 */
export async function queryHourlyAvgRange(
  metric: string,
  inverterId: string,
  from: Date,
  to: Date,
): Promise<Array<{ bucketMs: number; avg: number }>> {
  const source = preferredRollup(
    "hour",
    sql`metric = ${metric} and inverter_id = ${inverterId} and bucket >= ${from} and bucket < ${to}`,
  );
  const result = await db.execute<{ bucket: string; avg_value: number | null }>(sql`
    select bucket, avg_value
    from ${source} r
    order by bucket asc
  `);
  // A NULL average is dropped, not coerced: this series is the measured-actual
  // side of the forecast correction's learning, and a fabricated 0 would teach
  // the model that the sun did not shine.
  return result.rows.filter(hasAverage).map((r) => ({
    bucketMs: new Date(r.bucket).getTime(),
    avg: Number(r.avg_value),
  }));
}

/** One metric's compact series: `o` = offsets in steps from `t0`, `v` = values. */
export interface RecentSeries {
  o: number[];
  v: number[];
}

/**
 * The compact backfill payload. Timestamps are not repeated per sample: every
 * point is `t0 + o[i] * step * 1000` ms, and the metric name is paid once per
 * series instead of once per row. That is the whole point — the long form was
 * ~75 B/sample of which ~55 B was a repeated ISO string and metric name, and
 * this server has no HTTP compression to hide it.
 */
export interface RecentBackfill {
  t0: number;
  step: number;
  metrics: Record<string, RecentSeries>;
}

/**
 * Belt for the structural bound. The row count is already
 * `metricCount × (ceil(seconds / step) + 1)` because of the GROUP BY, so this only
 * catches an absurd metric explosion. It is DERIVED here and never accepted
 * from the client: a client-supplied global `limit` over a `desc` order is
 * exactly the bug this endpoint used to have — it truncated the OLDEST samples
 * of every metric at once, which is why the caller had to send 200000.
 */
const MAX_METRICS_GUARD = 512;

/** Clamp to a whole number inside `[lo, hi]` — these reach the SQL as literals. */
const clampInt = (n: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, Math.trunc(Number.isFinite(n) ? n : lo)));

/** Shape `(metric, bucket, value)` rows into the compact wire form. */
function shapeRecentBuckets(
  rows: ReadonlyArray<{ metric: string; bucket: string | number; value: number | string }>,
  step: number,
): RecentBackfill {
  let t0 = Number.POSITIVE_INFINITY;
  const parsed: Array<{ metric: string; ms: number; value: number }> = [];
  for (const r of rows) {
    const ms = Number(r.bucket) * 1000;
    if (!Number.isFinite(ms)) continue;
    if (ms < t0) t0 = ms;
    parsed.push({ metric: r.metric, ms, value: Number(r.value) });
  }
  // No rows: a finite `t0` so the client never derives NaN timestamps from it.
  if (parsed.length === 0) return { t0: 0, step, metrics: {} };
  const metrics: Record<string, RecentSeries> = {};
  const stepMs = step * 1000;
  for (const p of parsed) {
    const s = (metrics[p.metric] ??= { o: [], v: [] });
    s.o.push(Math.round((p.ms - t0) / stepMs));
    s.v.push(p.value);
  }
  return { t0, step, metrics };
}

/**
 * Recent samples across every metric of one inverter, bucketed server-side and
 * encoded compactly — the client's live sparkline backfill.
 *
 * `last(value, time)` per `time_bucket` reproduces exactly what the client used
 * to do locally ("keep the last sample in each bucket"), so visual density is
 * unchanged while a sub-second poll configuration no longer inflates the
 * payload. There is deliberately no caller-supplied row cap; see
 * {@link MAX_METRICS_GUARD}.
 */
export async function queryRecentBuckets(q: {
  inverterId: string;
  seconds: number;
  stepSeconds: number;
}): Promise<RecentBackfill> {
  const step = clampInt(q.stepSeconds, 1, 60);
  const seconds = clampInt(q.seconds, 1, 3600);
  const since = new Date(Date.now() - seconds * 1000);
  // Both are validated integers rendered as literals, never client text.
  const width = sql.raw(String(step));
  // `+ 1`: `time_bucket` is EPOCH-aligned, not `since`-aligned, so an N-second
  // window starting mid-bucket spans ceil(N / step) + 1 buckets. Without it the
  // cap is one row per metric short — and since the order is `metric, bucket`,
  // truncation does not shave edges evenly, it drops the alphabetically LAST
  // metrics ENTIRELY, which a full-width `seedBackfill` then reads as "dead" and
  // clears. The guard is a belt over a structural bound; it must never bite
  // first.
  const buckets = Math.ceil(seconds / step) + 1;
  const cap = sql.raw(String(buckets * MAX_METRICS_GUARD));
  const result = await db.execute<{
    metric: string;
    bucket: string | number;
    value: number | string;
  }>(sql`
    select metric,
           (extract(epoch from time_bucket(make_interval(secs => ${width}), time)))::bigint as bucket,
           last(value, time) as value
    from metrics_raw
    where inverter_id = ${q.inverterId}
      and time >= ${since}
    group by metric, bucket
    order by metric, bucket asc
    limit ${cap}
  `);
  return shapeRecentBuckets(result.rows, step);
}

/** Raw samples for one metric, most-recent-first. */
export async function queryRawHistory(
  q: HistoryQuery,
): Promise<Array<{ time: string; value: number }>> {
  const rows = await db
    .select()
    .from(metricsRaw)
    .where(
      and(
        gte(metricsRaw.time, q.since),
        eq(metricsRaw.metric, q.metric),
        eq(metricsRaw.inverterId, q.inverterId),
      ),
    )
    .orderBy(desc(metricsRaw.time))
    .limit(q.limit);
  return rows.map((r) => ({ time: r.time.toISOString(), value: r.value }));
}
