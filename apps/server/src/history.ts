/**
 * Shared time-series reads for one entity, used by both the web-facing history
 * endpoints (`index.ts`) and the generated `/api/v1` entity history route
 * (`entities.ts`) so the SQL + row shaping live in one place.
 */

import { db } from "@SunReye/db";
import { metricsRaw } from "@SunReye/db/schema/metrics";
import { and, desc, eq, gte } from "drizzle-orm";
import { sql } from "drizzle-orm";

/** Rollup granularity → its TimescaleDB continuous aggregate view. */
export type RollupBucket = "minute" | "hour" | "day";

const viewFor = (bucket: RollupBucket): string =>
  bucket === "day" ? "daily_rollups" : bucket === "minute" ? "minute_rollups" : "hourly_rollups";

interface HistoryQuery {
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
  const view = sql.raw(viewFor(q.bucket));
  const window =
    q.from && q.to
      ? sql`bucket >= ${q.from} and bucket < ${q.to}`
      : sql`bucket >= ${q.since ?? new Date(0)}`;
  const result = await db.execute<{
    bucket: string | Date;
    avg_value: number;
    max_value: number;
    min_value: number;
  }>(sql`
    select bucket, avg_value, max_value, min_value
    from ${view}
    where metric = ${q.metric}
      and inverter_id = ${q.inverterId}
      and ${window}
    order by bucket asc
    limit ${q.limit}
  `);
  return result.rows.map((r) => ({
    time: new Date(r.bucket).toISOString(),
    avg: Number(r.avg_value),
    max: Number(r.max_value),
    min: Number(r.min_value),
  }));
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
  const result = await db.execute<{ median: number | null }>(sql`
    select percentile_cont(0.5) within group (order by avg_value) as median
    from hourly_rollups
    where metric = ${metric}
      and inverter_id = ${inverterId}
      and bucket >= ${since}
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
  const result = await db.execute<{ bucket: string; avg_value: number }>(sql`
    select bucket, avg_value
    from hourly_rollups
    where metric = ${metric}
      and inverter_id = ${inverterId}
      and bucket >= ${from}
      and bucket < ${to}
    order by bucket asc
  `);
  return result.rows.map((r) => ({
    bucketMs: new Date(r.bucket).getTime(),
    avg: Number(r.avg_value),
  }));
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
