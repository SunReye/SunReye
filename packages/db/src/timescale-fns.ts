/**
 * Typed wrappers for the TimescaleDB hyperfunctions this codebase reads through.
 *
 * Drizzle has no knowledge of TimescaleDB, so every hyperfunction call is a raw
 * fragment whose type is whatever its author asserted. Two things go wrong when
 * that assertion is left to each call site, and both have shipped:
 *
 *  - **An uncast instant.** Postgres overloads `time_bucket` on its second
 *    argument (timestamp / timestamptz / date). A bound parameter there arrives
 *    typed `unknown`, the planner cannot choose, and the whole statement is
 *    rejected with `function time_bucket(interval, unknown) is not unique`. A
 *    column is fine — it carries its own type — which is why the same call works
 *    over `time` and fails over a parameter.
 *  - **A `sql<number>` over a `bigint`.** Postgres renders bigint as TEXT, so the
 *    driver hands back a string while the compiler believes it is a number, and
 *    arithmetic silently concatenates. An annotation asserts; only a mapper
 *    converts.
 *
 * So the rules live here, once, and travel with the type: the cast is applied by
 * {@link timeBucket} whenever its argument is not a column, and the mapper is
 * attached by {@link bucketEpoch} and {@link last}. A caller cannot forget
 * either, which is what makes both bugs unrepresentable rather than merely
 * fixed.
 *
 * Pure — it composes SQL and touches no database, so every branch is unit-tested.
 * Whether the composed statement is one Postgres accepts is a different
 * question, answered by `apps/server/db-tests`.
 */

import { type SQL, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

/** An instant a bucket can be computed over. */
export type Instant = PgColumn | SQL | Date;

/**
 * A `make_interval` width in whole seconds, rendered as a literal.
 *
 * A literal rather than a bound parameter because a bucket width is a
 * server-derived constant, never client text — and because it keeps the emitted
 * SQL readable in a log. That is only safe while the value is proven to be a
 * positive integer, which is what the guard below is for: it is the one thing
 * standing between a literal and an injection.
 */
export function interval(seconds: number): SQL {
  if (!Number.isInteger(seconds) || seconds <= 0) {
    throw new Error(`bucket width must be a positive whole number of seconds, got ${seconds}`);
  }
  return sql.raw(`make_interval(secs => ${seconds})`);
}

/** Whether an instant already carries a Postgres type of its own. */
function isColumn(moment: Instant): moment is PgColumn {
  return typeof moment === "object" && moment !== null && "columnType" in moment;
}

/**
 * `time_bucket(width, moment)`.
 *
 * Anything that is not a column is cast to `timestamptz`, because only a column
 * arrives with a type the planner can resolve the overload against.
 */
// fallow-ignore-next-line unused-export -- the shared wrapper `bucketEpoch` composes, and the only seam where the "cast anything that is not a column" rule is testable (timescale-fns.test.ts). It lost its last direct caller when the 2.0.0 read path stopped bucketing raw rows itself; the rule it enforces did not go away with it.
export function timeBucket(width: SQL, moment: Instant): SQL {
  const typed = isColumn(moment) ? moment : sql`${moment}::timestamptz`;
  return sql`time_bucket(${width}, ${typed})`;
}

/**
 * Epoch seconds of the bucket `moment` falls in, as a number.
 *
 * `::bigint` means the driver sends text, so the mapper is not optional — see
 * the module note above.
 */
export function bucketEpoch(width: SQL, moment: Instant) {
  return sql`(extract(epoch from ${timeBucket(width, moment)}))::bigint`.mapWith(Number);
}

/**
 * `last(value, time)` — the value of `value` at the greatest `time` in the group.
 *
 * `double precision` already arrives as a number; the mapper is here so no
 * caller has to remember which Postgres types the driver renders as text.
 */
export function last(value: PgColumn, time: PgColumn) {
  return sql`last(${value}, ${time})`.mapWith(Number);
}
