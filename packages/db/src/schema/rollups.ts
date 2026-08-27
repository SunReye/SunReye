/**
 * The TimescaleDB continuous aggregates, declared so reads against them are
 * typed.
 *
 * Every one is created by `../timescale/0000_baseline.sql`, never by drizzle: a
 * continuous aggregate needs `WITH (timescaledb.continuous)` and cannot be
 * created inside a transaction, neither of which drizzle-kit can express.
 * `.existing()` is what says so — drizzle may SELECT from these and must emit no
 * DDL for them. (`drizzle.config.ts` additionally filters `*_rollups` out of
 * introspection, because they surface as ordinary VIEWs and TimescaleDB rejects
 * the `DROP VIEW` that push/pull would emit. A name outside that pattern breaks
 * every push and pull, so the `_rollups` suffix is not decorative.)
 *
 * These declarations are a hand-maintained mirror of that SQL, which is exactly
 * why `apps/server/db-tests/schema-parity.test.ts` compares them against the
 * live relations — see `../schema-parity.ts`.
 *
 * Deliberately NOT re-exported from `./index.ts`. That barrel is what
 * `drizzle.config.ts` loads as the schema, and because the config points at the
 * whole directory, a re-export registers every view a second time — which
 * drizzle-kit refuses outright ("duplicated view name across public schema").
 * Import from this module directly, exactly as callers already do for
 * `./metrics`. Nothing is lost: `.existing()` views are not usable in relational
 * queries, and keeping them out of the schema object is one more reason drizzle
 * can never emit DDL for them.
 *
 * ONE GENERATION (2.0.0)
 *
 * 1.x carried TWO generations — `minute/hourly/daily_rollups` whose `avg(value)`
 * was an unweighted mean, and `weighted_*_rollups` materializing
 * `sum(value * dur_ms)` and `sum(dur_ms)` — because an aggregate's SELECT list
 * cannot be corrected in place and the never-DROP rule forbade recreating one.
 * Both had to be refreshed forever, and the read layer needed a per-bucket
 * source preference to decide which answered a bucket.
 *
 * 2.0.0 spends its one clean break collapsing that to three aggregates that are
 * right from birth. There is no preference rule any more: a tier has exactly one
 * source.
 *
 * WHAT THE COLUMNS ARE, AND WHY THEY ARE PARTIALS
 *
 * `tw` and `ctr` are `timescaledb_toolkit` AGGREGATE PARTIALS, not finished
 * numbers. A mean of means is not a mean, and a delta of deltas loses the
 * resets, so combining buckets requires the partial — which is what makes the
 * hierarchy (`daily` from `hourly`) exact rather than approximate, and what lets
 * a read span buckets with `rollup()`.
 *
 * It is also what makes the boundary right. `average(tw)` over a bucket holding
 * ONE sample is NULL — a point has no duration — and a change-only writer leaves
 * most buckets holding one sample or none. Reads must therefore use
 * `interpolated_average(tw, bucket, width, lag(tw), lead(tw))`, which brings in
 * the neighbouring partials and attributes a value held across midnight to both
 * buckets in proportion. That is the correctness the `dur_ms` pair could not
 * express, and it is only available because the partial is stored.
 */

import { customType, doublePrecision, pgMaterializedView, smallint, timestamp } from "drizzle-orm/pg-core";

/**
 * `timescaledb_toolkit`'s `TimeWeightSummary`, the partial `time_weight()`
 * produces. Measured at 49 B.
 *
 * Declared as an opaque custom type rather than mapped to a TS value: nothing in
 * the app should ever parse one. It is read through the toolkit's accessors
 * (`average`, `interpolated_average`) or combined with `rollup()`, always in
 * SQL. The declaration exists so the parity test can compare the column's type
 * against `format_type`, which spells it exactly `timeweightsummary`.
 */
const timeWeightSummary = customType<{ data: string; driverData: string }>({
  dataType: () => "timeweightsummary",
});

/**
 * `timescaledb_toolkit`'s `CounterSummary`, the partial `counter_agg()`
 * produces. Measured at 184 B — nearly 4x the TimeWeightSummary, which is why it
 * is on the hourly and daily tiers only (see below).
 */
const counterSummary = customType<{ data: string; driverData: string }>({
  dataType: () => "countersummary",
});

/** The identity and extrema every tier shares. */
const tierColumns = () => ({
  bucket: timestamp("bucket", { withTimezone: true }).notNull(),
  deviceId: smallint("device_id").notNull(),
  metricId: smallint("metric_id").notNull(),
  /** `time_weight('LOCF', time, value)`, or `rollup(tw)` on a derived tier. */
  tw: timeWeightSummary("tw"),
  /**
   * `max(value)` / `min(value)`.
   *
   * Kept as plain aggregates rather than folded into the summary: an extreme is
   * by definition a change, so a change-only series records every one of them,
   * and `max`/`min` were never affected by the weighting bug that produced the
   * second generation.
   */
  maxValue: doublePrecision("max_value"),
  minValue: doublePrecision("min_value"),
});

/**
 * The per-minute tier. Powers short-horizon history at fine resolution without
 * scanning raw.
 *
 * NO `ctr`, deliberately. A `CounterSummary` partial measures 184 B, so a minute
 * bucket per metric per device costs ~28 MB per device-day uncompressed
 * (1440 × ~108 × 184 B) — the hot window this release exists to shrink. Counter
 * reads at minute resolution go to raw, which still has every sample.
 */
export const minuteRollups = pgMaterializedView("minute_rollups", tierColumns()).existing();

/**
 * The hourly tier — the long-horizon record every wide chart reads.
 *
 * Built from `metrics_raw`, NOT from `minute_rollups`, and that is the one place
 * the hierarchy stops. `counter_agg(time, value)` needs the individual
 * `(time, value)` samples; a continuous aggregate over another continuous
 * aggregate has no `value` column to give it, and the alternative — a
 * `CounterSummary` on the minute tier so hourly could roll it up — is the 28 MB
 * per device-day above. So the minute tier and the hourly tier each scan raw
 * once, and `daily` rolls up from `hourly`. Two scans, not three, and the tier
 * that carries counters is the coarsest one that can.
 */
export const hourlyRollups = pgMaterializedView("hourly_rollups", {
  ...tierColumns(),
  /**
   * `counter_agg(time, value)` — the partial that answers "how much energy did
   * this hour add", including across a counter reset.
   *
   * Materialized from birth even before the read layer uses it, because adding
   * an aggregate column later means another GENERATION, which is exactly the
   * debt this release is paying off. Only meaningful where
   * `metric_keys.is_counter`; on an instantaneous metric it is harmless noise
   * that costs 184 B an hour.
   */
  ctr: counterSummary("ctr"),
}).existing();

/**
 * The daily tier, rolled up from `hourly_rollups` via the toolkit's `rollup()`.
 *
 * Hierarchical rather than a third independent scan of raw, and that is safe
 * because it is EXACT, not approximate: `rollup()` combines the partials, so
 * `average(rollup(tw))` over the hours of a day equals
 * `average(time_weight('LOCF', …))` over that day's raw rows to the last bit —
 * measured 531.5995 both ways on the reference series, and re-asserted as an
 * equality (not an epsilon) in `apps/server/db-tests/baseline.test.ts`.
 *
 * `rollup(ctr)` likewise recovers a reset that is invisible inside either hour:
 * 10→40 then 5→25 across a reset reads as `delta = 55, num_resets = 1` at day
 * scale, against two clean 30 and 20 hours.
 */
export const dailyRollups = pgMaterializedView("daily_rollups", {
  ...tierColumns(),
  /** `rollup(ctr)` of the hourly partials. */
  ctr: counterSummary("ctr"),
}).existing();
