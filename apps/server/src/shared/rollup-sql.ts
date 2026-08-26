/**
 * The rollup read cutover (#116): which continuous aggregate answers a bucket.
 *
 * `avg(value)` in `minute_rollups` / `hourly_rollups` / `daily_rollups` is an
 * *unweighted* mean. Over a complete 3-second series that is implicitly
 * time-weighted; over the change-only series the storage rewrite produces
 * (#117) it is not, and the error is largest exactly where the data matters
 * most. The fix is a second set of aggregates that materialize
 * `sum(value * dur_ms)` and `sum(dur_ms)` — but an aggregate's SELECT list
 * cannot be corrected in place, because recreating it could only re-materialize
 * the last 7 days of raw and would silently destroy every older bucket
 * (`packages/db/src/timescale/0000_bootstrap.sql`).
 *
 * So both sets exist, and this module is the rule that keeps them from
 * double-counting: serve each bucket from exactly one source, preferring the
 * weighted one.
 *
 * **No watermark, no cached boundary.** The preference is derived per query by a
 * `DISTINCT ON (bucket) … ORDER BY bucket, pref` over the union of the two
 * sources: the weighted row wins wherever it exists, and the legacy row answers
 * where it does not. That is self-healing — as the raw retention window grows
 * (#121) the weighted side reaches further back on its own — and no stored state
 * records a boundary that could be wrong.
 *
 * Pure: it composes SQL and touches no database, so every branch is unit-tested
 * (`rollup-sql.test.ts`) instead of only reachable through a live query.
 */

import { type SQL, sql } from "drizzle-orm";

/**
 * Every rollup granularity. `minute` is a live API option; all three are read
 * paths. The list is the source of truth and {@link RollupBucket} is derived
 * from it, so a fourth tier cannot be added to one without the other.
 */
// fallow-ignore-next-line unused-export -- the tier list is the module's exhaustiveness seam: rollup-sql.test.ts iterates it so a fourth tier cannot be added with an untested arm. The API's typebox literals cannot consume it without a type-level widening this change does not need.
export const ROLLUP_BUCKETS = ["minute", "hour", "day"] as const;

/** Rollup granularity. */
export type RollupBucket = (typeof ROLLUP_BUCKETS)[number];

/**
 * One source of a bucket's row.
 *
 * Described as data rather than baked straight into a template so the
 * composition itself is assertable: which two views a tier reads, which of them
 * is time-weighted, and which one wins a tie.
 */
export interface RollupArm {
  /** The continuous aggregate this arm reads. */
  view: string;
  /** SQL expression yielding the bucket's average from that view's columns. */
  avgExpr: string;
  /**
   * Tie-break rank for `DISTINCT ON (bucket) … ORDER BY bucket, pref`; lower
   * wins. Must be unique across a tier's arms, or the surviving row is
   * arbitrary.
   */
  pref: number;
  /** Whether this arm's average is time-weighted (#116). */
  weighted: boolean;
}

/** `bucket` → the pair of aggregate names that tier is materialized into. */
const VIEWS: Record<RollupBucket, { weighted: string; legacy: string }> = {
  minute: { weighted: "weighted_minute_rollups", legacy: "minute_rollups" },
  hour: { weighted: "weighted_hourly_rollups", legacy: "hourly_rollups" },
  day: { weighted: "weighted_daily_rollups", legacy: "daily_rollups" },
};

/**
 * The weighted mean, computed at read time from the two materialized sums.
 *
 * `nullif(weight, 0)`: a bucket whose weights sum to zero is degenerate — it can
 * only happen if a writer records a zero-width hold — and the three things it
 * could produce are a division-by-zero error, a fabricated number, or NULL. NULL
 * is the only one that does not read as data, and the row is then dropped by the
 * caller rather than charted as a value nothing measured.
 *
 * Note what this does NOT do: it does not fall through to the legacy arm. The
 * weighted row still wins the preference for that bucket, so a degenerate bucket
 * becomes a gap rather than the legacy view's unweighted number. That is
 * deliberate — over a change-only series the unweighted number is not a better
 * answer than no answer — and it costs nothing, because `dur_ms = 0` is a
 * zero-width hold no writer may record.
 */
const WEIGHTED_AVG = "weighted_sum / nullif(weight, 0)";

/**
 * The sources for one granularity, in preference order: weighted first.
 *
 * Exported so the ordering is a testable fact rather than an implementation
 * detail of the template below.
 */
// fallow-ignore-next-line unused-export -- exported so the composition is assertable rather than an implementation detail of preferredRollup; rollup-sql.test.ts is the consumer, and test files are not traced as consumers.
export function rollupArms(bucket: RollupBucket): RollupArm[] {
  const { weighted, legacy } = VIEWS[bucket];
  return [
    { view: weighted, avgExpr: WEIGHTED_AVG, pref: 0, weighted: true },
    { view: legacy, avgExpr: "avg_value", pref: 1, weighted: false },
  ];
}

/**
 * A derived table of one row per bucket — `(bucket, avg_value, max_value,
 * min_value)` — for the given tier and predicates.
 *
 * `where` is applied to *both* arms: an unfiltered arm would scan the whole
 * aggregate and then be discarded, and (worse) would let a bucket outside the
 * window win the preference for one inside it.
 *
 * `UNION ALL`, never a join: a join would drop every bucket only one side holds,
 * which is every bucket older than the raw retention window.
 */
export function preferredRollup(bucket: RollupBucket, where: SQL): SQL {
  const arms = rollupArms(bucket).map(
    (arm) => sql`
      select bucket, ${sql.raw(arm.avgExpr)} as avg_value, max_value, min_value, ${sql.raw(String(arm.pref))} as pref
      from ${sql.raw(arm.view)}
      where ${where}`,
  );
  return sql`(
    select distinct on (bucket) bucket, avg_value, max_value, min_value
    from (${sql.join(arms, sql.raw(" union all "))}) u
    order by bucket, pref
  )`;
}
