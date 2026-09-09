/**
 * Shared time-series reads for one entity, used by both the web-facing history
 * endpoints (`index.ts`) and the generated `/api/v1` entity history route
 * (`entities.ts`) so the SQL + row shaping live in one place.
 */

import { db } from "@SunReye/db";
import { metricsRaw } from "@SunReye/db/schema/metrics";
import { metricKeys } from "@SunReye/db/schema/plants";
import { bucketEpoch, interval, last } from "@SunReye/db/timescale-fns";
import { and, desc, eq, gte, lt } from "drizzle-orm";
import { type SQL, sql } from "drizzle-orm";
import type { PlantAggregate } from "@SunReye/inverter-core";
import { deviceIdOf, metricIdOf } from "./identity-sql";
import { type AggregateOf, foldRecentBackfills } from "./plant-fold";
import type { PlantMember } from "./plant-source";
import { type RollupBucket, plantRollupSeries, rollupSeries } from "./rollup-sql";

export type { RollupBucket } from "./rollup-sql";

/**
 * The window one entity's time-series read is bounded by.
 *
 * NAMES, both of them — a metric key and a device slug (or, transitionally, the
 * profile id). The int2 identity `metrics_raw` is keyed by never reaches a
 * caller: it is resolved at the boundary by `./identity-sql.ts` on the way in and
 * joined back to its key on the way out.
 */
/**
 * The plant arm of a read: fold this metric across `members` with the role's
 * aggregate. When present, `inverterId` is ignored — the members ARE the
 * identity. `per-device` never reaches here; the route refuses it first.
 */
export interface PlantFold {
  members: readonly PlantMember[];
  aggregate: Exclude<PlantAggregate, "per-device">;
}

export interface HistoryQuery {
  metric: string;
  inverterId: string;
  since: Date;
  limit: number;
  plant?: PlantFold;
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
  // A range needs BOTH ends: a half-specified one falls back to the open-ended
  // `since` branch rather than reading `from` as an open start, which would
  // silently widen a window the caller bounded.
  const range = q.from && q.to ? { from: q.from, to: q.to } : { from: q.since ?? new Date(0) };
  const source = q.plant
    ? plantRollupSeries(q.bucket, { metric: q.metric, ...q.plant, ...range })
    : rollupSeries(q.bucket, { metric: q.metric, inverterId: q.inverterId, ...range });
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
 * `interpolated_average` returns NULL for a bucket it cannot interpolate at all
 * — one holding no samples with no neighbour to carry a value in from, i.e. a
 * genuine hole in the recording. It must not reach a caller: `Number(null)` is
 * `0`, which would draw a flat line through the gap and read as a measurement. A
 * real `0` is a reading (0 kW of PV at night) and survives.
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
  const source = rollupSeries("hour", { metric, inverterId, from: since });
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
  const source = rollupSeries("hour", { metric, inverterId, from, to });
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

/**
 * How far back to look for the value a metric was *holding* when the window
 * opened.
 *
 * Under change-only storage a metric that did not change inside the window has
 * no row in it, and a payload that omits a metric is read by a full-width
 * backfill as "this metric is dead" — so a steady voltage would blank its own
 * sparkline. Carrying the held value in fixes that, and the bound is what keeps
 * it cheap: the writer closes every interval at its bucket boundary, so a metric
 * the device is still answering has a row within a minute. Five minutes is
 * generous against that and still a bounded scan, where an open-ended
 * `time < since` would walk the hypertable.
 *
 * A metric with nothing in the lookback is deliberately NOT seeded: "unchanged"
 * and "the device stopped answering" must not become the same thing, which is
 * the same boundary the decode layer keeps one level down.
 */
const SEED_LOOKBACK_S = 300;

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
  /**
   * The plant arm: one read per member, BY ID, folded on the common grid by
   * `./plant-fold.ts`. Members are read separately rather than in one statement
   * because the seed arm (`distinct on (metric)`) and the per-bucket `last()` are
   * both per device, and the carry-forward across buckets that makes a sum
   * honest is not expressible in the one query without a gap-fill per device.
   */
  plant?: { members: readonly PlantMember[]; aggregateOf: AggregateOf };
  /**
   * The instant the window ends, for tests that need to know where its buckets
   * fall. Callers leave it unset; the window is always "the last `seconds`".
   *
   * Without it a case cannot place a sample in the bucket the window OPENS in,
   * because `time_bucket` is epoch-aligned (see below) and `since` is derived
   * from a clock the case cannot read. Blanketing the boundary with samples
   * instead is not equivalent — it fails whenever `since` lands in the last
   * few milliseconds of a bucket, which is what made the db-test intermittent.
   */
  now?: Date;
}): Promise<RecentBackfill> {
  if (q.plant) {
    const now = q.now ?? new Date();
    const backfills = await Promise.all(
      q.plant.members.map(async (m) => ({
        weight: m.weight,
        backfill: await recentBucketsFor(sql`${m.id}`, { ...q, now }),
      })),
    );
    const folded = foldRecentBackfills(backfills, q.plant.aggregateOf);
    return { ...folded, step: clampInt(q.stepSeconds, 1, 60) };
  }
  return recentBucketsFor(deviceIdOf(q.inverterId), q);
}

/** {@link queryRecentBuckets} for one device, identified by an id expression. */
async function recentBucketsFor(
  device: SQL,
  q: { seconds: number; stepSeconds: number; now?: Date },
): Promise<RecentBackfill> {
  const step = clampInt(q.stepSeconds, 1, 60);
  const seconds = clampInt(q.seconds, 1, 3600);
  const since = new Date((q.now?.getTime() ?? Date.now()) - seconds * 1000);
  const width = interval(step);
  // `+ 1`: `time_bucket` is EPOCH-aligned, not `since`-aligned, so an N-second
  // window starting mid-bucket spans ceil(N / step) + 1 buckets. Without it the
  // cap is one row per metric short — and since the order is `metric, bucket`,
  // truncation does not shave edges evenly, it drops the alphabetically LAST
  // metrics ENTIRELY, which a full-width `seedBackfill` then reads as "dead" and
  // clears. The guard is a belt over a structural bound; it must never bite
  // first.
  const buckets = Math.ceil(seconds / step) + 1;

  // Samples inside the window, reduced to one row per (metric, bucket).
  // `metric_keys` is JOINED rather than mapped in process: this payload is KEYED
  // by metric name and that shape is an external contract, so the name has to be
  // in the row — and a join cannot go stale between the query and the mapping.
  // Aliased to `metric`, deliberately: without it the UNION's output column takes
  // the COLUMN's name (`key`), and every outer reference — the `distinct on`, the
  // ordering, the shaper's row field — would silently be about a column called
  // `key` while this module's row shape and the payload it feeds say `metric`.
  const metricName = sql<string>`${metricKeys.key}`.as("metric");
  const windowArm = db
    .select({
      metric: metricName,
      bucket: bucketEpoch(width, metricsRaw.time).as("bucket"),
      value: last(metricsRaw.value, metricsRaw.time).as("value"),
      pref: sql<number>`0`.as("pref"),
    })
    .from(metricsRaw)
    .innerJoin(metricKeys, eq(metricKeys.id, metricsRaw.metricId))
    .where(and(eq(metricsRaw.deviceId, device), gte(metricsRaw.time, since)))
    // The bucket alias, not a re-derivation: Postgres resolves an output name in
    // GROUP BY, and repeating the expression would be a second thing to keep in
    // step with `bucketOf`.
    .groupBy(metricKeys.key, sql`bucket`);

  // The value each metric was already holding when the window opened, so a
  // signal that has not changed recently still draws from the left edge rather
  // than appearing to start mid-chart. `distinct on (metric)` + this arm's own
  // ordering is what makes it the most RECENT such sample.
  const seedArm = db
    .selectDistinctOn([metricKeys.key], {
      metric: metricName,
      bucket: bucketEpoch(width, since).as("bucket"),
      value: metricsRaw.value,
      pref: sql<number>`1`.as("pref"),
    })
    .from(metricsRaw)
    .innerJoin(metricKeys, eq(metricKeys.id, metricsRaw.metricId))
    .where(
      and(
        eq(metricsRaw.deviceId, device),
        lt(metricsRaw.time, since),
        gte(metricsRaw.time, sql`${since}::timestamptz - ${interval(SEED_LOOKBACK_S)}`),
      ),
    )
    .orderBy(metricKeys.key, desc(metricsRaw.time));

  // `unionAll` parenthesises each arm, which is load-bearing rather than
  // cosmetic: an unparenthesised `order by` after the final arm binds to the
  // WHOLE union, where only the output columns are in scope, and the seed arm's
  // `order by ... time desc` then fails with `column "time" does not exist`.
  // Hand-written SQL had exactly that bug; the builder cannot express it.
  const u = windowArm.unionAll(seedArm).as("u");

  // `pref` orders the seed row after a real sample in the same bucket, so
  // `distinct on` keeps the measurement and drops the carried-forward value.
  const rows = await db
    .selectDistinctOn([u.metric, u.bucket], {
      metric: u.metric,
      bucket: u.bucket,
      value: u.value,
    })
    .from(u)
    .orderBy(u.metric, u.bucket, u.pref)
    .limit(buckets * MAX_METRICS_GUARD);

  return shapeRecentBuckets(rows, step);
}

/** Raw samples for one metric, most-recent-first. */
export async function queryRawHistory(
  q: HistoryQuery,
): Promise<Array<{ time: string; value: number }>> {
  if (q.plant) return plantRawHistory(q, q.plant);
  return rawHistoryFor(deviceIdOf(q.inverterId), q);
}

async function rawHistoryFor(
  device: SQL,
  q: Pick<HistoryQuery, "metric" | "since" | "limit">,
): Promise<Array<{ time: string; value: number }>> {
  // An explicit projection, never `select *`: the table's other columns are the
  // int2 identity, and a `select *` here would start returning INTEGERS to a
  // caller whose contract is names.
  const rows = await db
    .select({ time: metricsRaw.time, value: metricsRaw.value })
    .from(metricsRaw)
    .where(
      and(
        gte(metricsRaw.time, q.since),
        eq(metricsRaw.metricId, metricIdOf(q.metric)),
        eq(metricsRaw.deviceId, device),
      ),
    )
    .orderBy(desc(metricsRaw.time))
    .limit(q.limit);
  return rows.map((r) => ({ time: r.time.toISOString(), value: r.value }));
}

/**
 * Raw samples of the plant: each member's own samples, aligned on a one-second
 * grid with the last observation carried forward, then folded. Members are
 * never sampled at the same instant, so this is the finest grid on which a sum
 * of two machines means anything. Most-recent-first, like the device arm.
 */
async function plantRawHistory(
  q: HistoryQuery,
  plant: PlantFold,
): Promise<Array<{ time: string; value: number }>> {
  const perMember = await Promise.all(
    plant.members.map(async (m) => ({
      weight: m.weight,
      rows: await rawHistoryFor(sql`${m.id}`, q),
    })),
  );
  const t0 = Math.floor(q.since.getTime() / 1000) * 1000;
  const backfills = perMember.map((m) => {
    const series: RecentSeries = { o: [], v: [] };
    // Oldest first, one point per second (the newest sample in a second wins).
    const bySecond = new Map<number, number>();
    for (const r of [...m.rows].reverse()) {
      bySecond.set(Math.round((Date.parse(r.time) - t0) / 1000), r.value);
    }
    for (const [o, v] of [...bySecond.entries()].sort((a, b) => a[0] - b[0])) {
      series.o.push(o);
      series.v.push(v);
    }
    return {
      weight: m.weight,
      backfill: { t0, step: 1, metrics: series.o.length > 0 ? { [q.metric]: series } : {} },
    };
  });
  const folded = foldRecentBackfills(backfills, () => plant.aggregate).metrics[q.metric];
  if (!folded) return [];
  const out = folded.o.map((o, i) => ({
    time: new Date(t0 + o * 1000).toISOString(),
    value: folded.v[i] ?? 0,
  }));
  return out.reverse().slice(0, q.limit);
}
