/**
 * The TimescaleDB continuous aggregates, declared so reads against them are
 * typed.
 *
 * Every one is created by `../timescale/*.sql`, never by drizzle: a continuous
 * aggregate needs `WITH (timescaledb.continuous)` and cannot be created inside a
 * transaction, neither of which drizzle-kit can express. `.existing()` is what
 * says so — drizzle may SELECT from these and must emit no DDL for them, which
 * matters more here than usual: `metrics_raw` has 7-day retention, so dropping
 * and recreating an aggregate can only re-materialize the last week and silently
 * destroys all long-horizon history. (`drizzle.config.ts` additionally filters
 * `*_rollups` out of introspection, because they surface as ordinary VIEWs and
 * TimescaleDB rejects the `DROP VIEW` that push/pull would emit.)
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
 * Two families, both kept forever (#116):
 *  - the ORIGINAL aggregates, whose `avg(value)` is an *unweighted* mean;
 *  - the WEIGHTED aggregates, materializing `sum(value * dur_ms)` and
 *    `sum(dur_ms)` so the mean can be time-weighted at read time.
 * An aggregate's SELECT list cannot be corrected in place, so both exist and
 * `apps/server/src/shared/rollup-sql.ts` decides which answers a bucket.
 */

import { bigint, doublePrecision, pgMaterializedView, text, timestamp } from "drizzle-orm/pg-core";

/** Columns every aggregate in the original family shares. */
const legacyColumns = () => ({
  bucket: timestamp("bucket", { withTimezone: true }).notNull(),
  inverterId: text("inverter_id").notNull(),
  metric: text("metric").notNull(),
  /** Unweighted `avg(value)` — see the note above before reading this as a mean. */
  avgValue: doublePrecision("avg_value"),
  maxValue: doublePrecision("max_value"),
  minValue: doublePrecision("min_value"),
});

/**
 * Columns every aggregate in the weighted family shares.
 *
 * The two sums rather than a ratio: a mean of means is not a mean, so the
 * division has to happen at read time over the summed numerator and denominator.
 */
const weightedColumns = () => ({
  bucket: timestamp("bucket", { withTimezone: true }).notNull(),
  inverterId: text("inverter_id").notNull(),
  metric: text("metric").notNull(),
  /** `sum(value * coalesce(dur_ms, 1000))`. */
  weightedSum: doublePrecision("weighted_sum"),
  /**
   * `sum(coalesce(dur_ms, 1000))` — the denominator, in milliseconds.
   *
   * `bigint`, not `double precision`: `dur_ms` is an `integer` and Postgres
   * widens `sum(integer)` to bigint. The schema-parity test caught this
   * declaration claiming double precision, which is exactly what it is for.
   *
   * `mode: "number"` is safe here and is a per-column decision, not a global
   * bigint parser: this is a bucket's total hold time in milliseconds, so even a
   * year of continuous coverage is ~3.15e10 — three orders of magnitude below
   * `Number.MAX_SAFE_INTEGER`.
   */
  weight: bigint("weight", { mode: "number" }),
  maxValue: doublePrecision("max_value"),
  minValue: doublePrecision("min_value"),
});

export const minuteRollups = pgMaterializedView("minute_rollups", legacyColumns()).existing();
export const hourlyRollups = pgMaterializedView("hourly_rollups", legacyColumns()).existing();
export const dailyRollups = pgMaterializedView("daily_rollups", legacyColumns()).existing();

export const weightedMinuteRollups = pgMaterializedView(
  "weighted_minute_rollups",
  weightedColumns(),
).existing();
export const weightedHourlyRollups = pgMaterializedView(
  "weighted_hourly_rollups",
  weightedColumns(),
).existing();
export const weightedDailyRollups = pgMaterializedView(
  "weighted_daily_rollups",
  weightedColumns(),
).existing();
