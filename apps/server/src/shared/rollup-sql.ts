/**
 * The rollup read cutover (#116): which source answers a bucket.
 *
 * `avg(value)` in `minute_rollups` / `hourly_rollups` / `daily_rollups` is an
 * *unweighted* mean. Over a complete 3-second series that is implicitly
 * time-weighted; over the change-only series the storage rewrite produces
 * (#117) it is not, and the error is largest exactly where the data matters
 * most. The fix is a second set of aggregates that materialize
 * `sum(value * dur_ms)` and `sum(dur_ms)` — but an aggregate's SELECT list
 * cannot be corrected in place, because recreating it could only re-materialize
 * the last N days of raw and would silently destroy every older bucket
 * (`packages/db/src/timescale/0000_bootstrap.sql`).
 *
 * So both sets exist, and this module is the rule that keeps them from
 * double-counting: serve each bucket from exactly one source, preferring the
 * time-weighted one.
 *
 * **The minute tier has a third source: raw itself.** Once a raw row became an
 * interval, the minute aggregates stopped being cheaper than the rows they
 * summarize — measured at 361 MB/device-year for raw against 333 MB for the
 * minute pair — and they were also the ceiling on raw retention, since raw may
 * not outlive the shortest aggregate. So `policies.sql` stopped refreshing them:
 * they hold what was materialized before the freeze and age out under their own
 * retention, while raw answers every bucket from here on.
 *
 * That freeze is why this arm is composed here rather than left to the frozen
 * aggregate's own real-time union. A continuous aggregate unions its
 * materialized rows with a live aggregation of everything past its watermark,
 * and the predicate it pushes down is on `time_bucket(time)`, which does not
 * prune chunks. A watermark that never advances would therefore make every
 * minute read scan raw from the freeze forward, growing without bound. The arm
 * below bounds raw on `time` with plain timestamps, so the planner excludes
 * chunks.
 *
 * **No watermark, no cached boundary.** The preference is derived per query by a
 * `DISTINCT ON (bucket) … ORDER BY bucket, pref` over the union of a tier's
 * sources: raw wins where raw reaches, the weighted aggregate next, the legacy
 * aggregate answers what neither covers. That is self-healing — as raw retention
 * grows the raw arm reaches further back on its own — and no stored state
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

/** Where an arm's rows come from: the raw hypertable, or a continuous aggregate. */
export type RollupSource = "raw" | "view";

/**
 * One source of a bucket's row.
 *
 * Described as data rather than baked straight into a template so the
 * composition itself is assertable: which sources a tier reads, which of them
 * are time-weighted, and which one wins a tie.
 */
export interface RollupArm {
  /** The relation this arm reads — an aggregate's name, or `metrics_raw`. */
  view: string;
  /** SQL expression yielding the bucket's average from that arm's columns. */
  avgExpr: string;
  /**
   * Tie-break rank for `DISTINCT ON (bucket) … ORDER BY bucket, pref`; lower
   * wins. Must be unique across a tier's arms, or the surviving row is
   * arbitrary.
   */
  pref: number;
  /** Whether this arm's average is time-weighted (#116). */
  weighted: boolean;
  /** Whether the arm aggregates raw rows itself or reads materialized ones. */
  source: RollupSource;
}

/** The window one tier's read is bounded by. `to` absent = open-ended. */
export interface RollupWindow {
  metric: string;
  inverterId: string;
  from: Date;
  to?: Date;
}

/** `bucket` → the pair of aggregate names that tier is materialized into. */
const VIEWS: Record<RollupBucket, { weighted: string; legacy: string }> = {
  minute: { weighted: "weighted_minute_rollups", legacy: "minute_rollups" },
  hour: { weighted: "weighted_hourly_rollups", legacy: "hourly_rollups" },
  day: { weighted: "weighted_daily_rollups", legacy: "daily_rollups" },
};

/** `bucket` → the `time_bucket` width, as a literal and in milliseconds. */
const WIDTHS: Record<RollupBucket, { interval: string; ms: number }> = {
  minute: { interval: "1 minute", ms: 60_000 },
  hour: { interval: "1 hour", ms: 3_600_000 },
  day: { interval: "1 day", ms: 86_400_000 },
};

/**
 * Tiers whose buckets raw can answer directly.
 *
 * Only `minute`: the hour and day aggregates are the long-horizon record, kept
 * far past raw's retention, and re-deriving them from raw would be both slower
 * and — beyond raw's horizon — impossible.
 */
const RAW_TIERS: readonly RollupBucket[] = ["minute"];

/** The raw hypertable, as the raw arm's `view`. */
const RAW_RELATION = "metrics_raw";

/**
 * The weighted mean, computed at read time from the two sums.
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
 * `coalesce(dur_ms, 1000)`: a row written before #117 has no duration and must
 * read as one shipped poll interval, which is what makes the weighted mean equal
 * the legacy plain mean over a complete pre-rewrite series. The constant, and
 * the measurements behind it, are documented in
 * `packages/db/src/timescale/0002_weighted_rollups.sql` — it must stay identical
 * here, or a bucket changes value depending on which arm answered it.
 */
const RAW_WEIGHT = "coalesce(dur_ms, 1000)";

/**
 * The sources for one granularity, in preference order: most time-weighted and
 * furthest-reaching first.
 *
 * Exported so the ordering is a testable fact rather than an implementation
 * detail of the template below.
 */
// fallow-ignore-next-line unused-export -- exported so the composition is assertable rather than an implementation detail of preferredRollup; rollup-sql.test.ts is the consumer, and test files are not traced as consumers.
export function rollupArms(bucket: RollupBucket): RollupArm[] {
  const { weighted, legacy } = VIEWS[bucket];
  const arms: RollupArm[] = [];
  if (RAW_TIERS.includes(bucket)) {
    // Raw first: it is the only source still growing, and it carries the same
    // two sums the weighted aggregate materialized, so a bucket that moves from
    // the aggregate to raw cannot change value.
    arms.push({
      view: RAW_RELATION,
      avgExpr: WEIGHTED_AVG,
      pref: arms.length,
      weighted: true,
      source: "raw",
    });
  }
  arms.push({
    view: weighted,
    avgExpr: WEIGHTED_AVG,
    pref: arms.length,
    weighted: true,
    source: "view",
  });
  arms.push({
    view: legacy,
    avgExpr: "avg_value",
    pref: arms.length,
    weighted: false,
    source: "view",
  });
  return arms;
}

/** Floor an instant to the start of the bucket containing it. */
function floorTo(ms: number, at: Date): Date {
  return new Date(Math.floor(at.getTime() / ms) * ms);
}

/**
 * The exact bucket predicate — the same one an aggregate arm is filtered by, so
 * every arm returns the same set of buckets.
 */
function bucketWindow(w: RollupWindow): SQL {
  return w.to ? sql`bucket >= ${w.from} and bucket < ${w.to}` : sql`bucket >= ${w.from}`;
}

/**
 * An arm reading already-materialized buckets out of a continuous aggregate.
 *
 * The predicates are applied here rather than by the caller: an unfiltered arm
 * would scan the whole aggregate and then be discarded, and (worse) would let a
 * bucket outside the window win the preference for one inside it.
 */
function viewArm(arm: RollupArm, w: RollupWindow): SQL {
  return sql`
      select bucket, ${sql.raw(arm.avgExpr)} as avg_value, max_value, min_value, ${sql.raw(String(arm.pref))} as pref
      from ${sql.raw(arm.view)}
      where metric = ${w.metric} and inverter_id = ${w.inverterId} and ${bucketWindow(w)}`;
}

/**
 * An arm aggregating raw rows into buckets at read time.
 *
 * Two predicates, deliberately: the inner one bounds `time` so chunks are
 * excluded, and is generous by one bucket at each end so a window edge landing
 * mid-bucket still reads that bucket's whole set of rows — a truncated bucket
 * would report a `max`/`min` the minute never had. The outer one is the exact
 * bucket predicate every other arm uses, which trims the generosity back off.
 */
function rawArm(arm: RollupArm, bucket: RollupBucket, w: RollupWindow): SQL {
  const { interval, ms } = WIDTHS[bucket];
  const width = sql.raw(`'${interval}'::interval`);
  const scan = [sql`"time" >= ${floorTo(ms, w.from)}`];
  // One bucket past `to`, since the exact filter admits the bucket `to` lands in
  // whenever `to` is not itself bucket-aligned.
  if (w.to) scan.push(sql`"time" < ${new Date(floorTo(ms, w.to).getTime() + ms)}`);
  return sql`
      select bucket, ${sql.raw(arm.avgExpr)} as avg_value, max_value, min_value, ${sql.raw(String(arm.pref))} as pref
      from (
        select time_bucket(${width}, "time") as bucket,
               sum(value * ${sql.raw(RAW_WEIGHT)}) as weighted_sum,
               sum(${sql.raw(RAW_WEIGHT)}) as weight,
               max(value) as max_value,
               min(value) as min_value
        from ${sql.raw(RAW_RELATION)}
        where metric = ${w.metric} and inverter_id = ${w.inverterId}
          and ${sql.join(scan, sql.raw(" and "))}
        group by 1
      ) raw_buckets
      where ${bucketWindow(w)}`;
}

/**
 * A derived table of one row per bucket — `(bucket, avg_value, max_value,
 * min_value)` — for the given tier and window.
 *
 * `UNION ALL`, never a join: a join would drop every bucket only one side holds,
 * which is every bucket outside raw's retention window.
 */
export function preferredRollup(bucket: RollupBucket, w: RollupWindow): SQL {
  const arms = rollupArms(bucket).map((arm) =>
    arm.source === "raw" ? rawArm(arm, bucket, w) : viewArm(arm, w),
  );
  return sql`(
    select distinct on (bucket) bucket, avg_value, max_value, min_value
    from (${sql.join(arms, sql.raw(" union all "))}) u
    order by bucket, pref
  )`;
}
