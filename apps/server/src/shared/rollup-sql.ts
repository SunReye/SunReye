/**
 * Which relation answers a bucket, and how a bucket's average is computed.
 *
 * WHAT THIS FILE USED TO BE
 *
 * 1.x carried TWO generations of aggregates per tier — `avg(value)` (an
 * unweighted mean, wrong over a change-only series) and `weighted_*` (materialized
 * `sum(value * dur_ms)` / `sum(dur_ms)`) — because an aggregate's SELECT list
 * cannot be corrected in place and recreating one would have destroyed every
 * bucket older than raw retention. Both had to be refreshed forever, and this
 * module was the rule that stopped them double-counting: a
 * `DISTINCT ON (bucket) … ORDER BY bucket, pref` over the UNION of a tier's
 * sources, with raw as a third arm for the frozen minute tier.
 *
 * All of that is GONE. 2.0.0 spends its one clean break on three aggregates that
 * are right from birth, so a tier has exactly one source and there is nothing to
 * prefer. The arms, the preference ranks and the union are deleted rather than
 * ported — a second source appearing again would mean a second generation, which
 * is the debt this release paid off.
 *
 * WHY THE AVERAGE IS INTERPOLATED
 *
 * `tw` is a `timescaledb_toolkit` TimeWeightSummary — an aggregate PARTIAL, not
 * a finished number — and `average(tw)` over a bucket holding a SINGLE sample is
 * NULL, because a point has no duration. A change-only writer leaves most
 * buckets holding one sample or none, so a plain `average(tw)` would blank most
 * of the chart.
 *
 * `interpolated_average(tw, bucket, width, lag(tw) over w, lead(tw) over w)` is
 * the fix, and it is also the CORRECTNESS the `dur_ms` pair could not express: a
 * value held from 23:50 to 00:10 is attributed to both hours in proportion
 * (100 held from 23:50 then 200 from 00:10 reads 100 for the 23:00 hour and
 * (100·10 + 200·50)/60 = 183.333… for the 00:00 hour), where `dur_ms` weighting
 * billed the whole hold to the hour the ROW was stamped in. Getting this wrong
 * reintroduces, silently, the bug the release exists to fix.
 *
 * That is why the window is read one bucket wider than it is returned: `lag` and
 * `lead` can only see rows the inner query produced, so trimming first would
 * leave the first bucket with no predecessor and the last with no successor —
 * exactly the two buckets a chart's edges are made of.
 *
 * Names in, ids out: the caller names a metric and a source, and
 * `./identity-sql.ts` turns them into the int2 predicate. See that module for why
 * the translation is a SQL expression rather than an awaited number.
 *
 * Pure: it composes SQL and touches no database, so every branch is unit-tested
 * (`rollup-sql.test.ts`).
 */

import { type SQL, getViewName, sql } from "drizzle-orm";
import { dailyRollups, hourlyRollups, minuteRollups } from "@SunReye/db/schema/rollups";

import { deviceIdOf, metricIdOf } from "./identity-sql";

/**
 * Every rollup granularity. `minute` is a live API option; all three are read
 * paths. The list is the source of truth and {@link RollupBucket} is derived
 * from it, so a fourth tier cannot be added to one without the other — and
 * `rollup-sql.test.ts` iterates it, so a fourth tier cannot be added with an
 * untested source either.
 */
// fallow-ignore-next-line unused-export -- the tier list is the module's exhaustiveness seam: rollup-sql.test.ts iterates it so a fourth tier cannot be added untested. The API's typebox literals cannot consume it without a type-level widening this change does not need.
export const ROLLUP_BUCKETS = ["minute", "hour", "day"] as const;

/** Rollup granularity. */
export type RollupBucket = (typeof ROLLUP_BUCKETS)[number];

/** The one source of a tier's buckets, and what it can answer. */
export interface RollupTier {
  /** The continuous aggregate this tier reads. */
  view: string;
  /** The `time_bucket` width, as the interval literal the aggregate used. */
  width: string;
  /** The same width in milliseconds — what the widened scan bounds are built from. */
  ms: number;
  /**
   * Whether the tier carries a `CounterSummary` (`ctr`), i.e. whether an energy
   * total can be read from it at all.
   *
   * False for `minute`, and that is a storage decision: a CounterSummary is
   * 184 B, so a minute bucket per metric per device costs ~28 MB per device-day
   * uncompressed — the hot window this release exists to shrink. A counter read
   * at minute resolution must go to `metrics_raw`, which still holds every
   * sample.
   */
  counters: boolean;
}

/** The window one tier's read is bounded by. `to` absent = open-ended. */
export interface RollupWindow {
  /** Metric KEY — a name, resolved to `metric_id` at the boundary. */
  metric: string;
  /** Device slug (or, transitionally, the profile id) — see `./identity-sql.ts`. */
  inverterId: string;
  from: Date;
  to?: Date;
}

/**
 * `bucket` → its tier.
 *
 * Relation names come from the drizzle declarations rather than literals: those
 * declarations are checked against the live relations by
 * `apps/server/db-tests/schema-parity.test.ts`, so a rename in
 * `packages/db/src/timescale/*.sql` cannot leave this module addressing a
 * relation that no longer exists — which a string literal silently would.
 */
const TIERS: Record<RollupBucket, RollupTier> = {
  minute: { view: getViewName(minuteRollups), width: "1 minute", ms: 60_000, counters: false },
  hour: { view: getViewName(hourlyRollups), width: "1 hour", ms: 3_600_000, counters: true },
  day: { view: getViewName(dailyRollups), width: "1 day", ms: 86_400_000, counters: true },
};

/** The source and shape of one tier. Exported so it is an assertable fact. */
// fallow-ignore-next-line unused-export -- exported so the tier table is assertable rather than an implementation detail of rollupSeries; rollup-sql.test.ts is the consumer, and test files are not traced as consumers.
export function rollupTier(bucket: RollupBucket): RollupTier {
  return TIERS[bucket];
}

/**
 * The interpolated time-weighted mean of a bucket.
 *
 * One expression shared by every tier — it must be, or a bucket's value would
 * depend on which tier answered it. `interpolated_average` needs the bucket's own
 * start, the tier's width and the two neighbouring partials; the neighbours come
 * from `WINDOW w AS (ORDER BY bucket)`, declared by {@link rollupSeries}.
 */
function interpolatedAverage(width: string): SQL {
  return sql`interpolated_average(tw, bucket, ${sql.raw(`'${width}'`)}::interval,
                                  lag(tw) over w, lead(tw) over w)`;
}

/**
 * A derived table of one row per bucket — `(bucket, avg_value, max_value,
 * min_value)` — for the given tier and window.
 *
 * Two levels, and both are load-bearing. The inner query reads the tier one
 * bucket WIDER than the caller asked for, because the window functions can only
 * interpolate from rows it returned; the outer one trims back to the exact
 * window, so the caller gets the buckets it asked for and no more.
 */
export function rollupSeries(bucket: RollupBucket, w: RollupWindow): SQL {
  const tier = TIERS[bucket];
  // The identity predicate: ids in SQL, names bound as parameters.
  const identity = sql`device_id = ${deviceIdOf(w.inverterId)} and metric_id = ${metricIdOf(w.metric)}`;
  const scan = [sql`bucket >= ${new Date(w.from.getTime() - tier.ms)}`];
  const exact = [sql`bucket >= ${w.from}`];
  if (w.to) {
    scan.push(sql`bucket < ${new Date(w.to.getTime() + tier.ms)}`);
    exact.push(sql`bucket < ${w.to}`);
  }
  return sql`(
    select bucket, avg_value, max_value, min_value
    from (
      select bucket,
             ${interpolatedAverage(tier.width)} as avg_value,
             max_value,
             min_value
      from ${sql.raw(tier.view)}
      where ${identity} and ${sql.join(scan, sql.raw(" and "))}
      window w as (order by bucket)
    ) s
    where ${sql.join(exact, sql.raw(" and "))}
  )`;
}
