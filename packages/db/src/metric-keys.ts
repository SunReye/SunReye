/**
 * The metric dimension's write side: turn metric KEYS into the int2 ids every
 * reading carries, registering any the database has never seen.
 *
 * WHY AN UPSERT AND NOT A LOOKUP
 *
 * A metric key is validated by `packages/inverter-core/src/schema.ts` as
 * `z.string().min(1)` and nothing more, and `installProfile` registers a profile
 * downloaded from a USER-SUPPLIED URL with no restart. So the set of metric keys
 * is open at runtime, by design, and any code path that assumes a key is already
 * registered will one day drop a reading — or, worse, fail the whole poll's
 * insert on a foreign key and lose the readings that WERE known.
 *
 * The plan's answer is two-sided and both sides matter:
 *
 *  1. EAGER, on profile activation. The natural hook is where the runtime builds
 *     its per-profile storage policy (`createStoragePolicy`), which already
 *     walks `profile.metrics` and is rebuilt on every profile swap. Registering
 *     there means the ids exist before the first poll, so the steady state is a
 *     plain lookup.
 *  2. LAZY, in the writer. A metric can appear that the activation hook never
 *     saw — a computed metric, a profile edited under a running server, a
 *     capture replayed from another install. The writer calls this too, and a
 *     key it has already registered costs one round trip and no write.
 *
 * WHY IDS ARE NEVER CHURNED
 *
 * `metric_keys.id` is int2, so the ceiling is 32767 against ~108 metrics per
 * profile. That is ample only while a reinstall REUSES rows: renumber on every
 * profile install and a long-lived instance walks the id space, while every
 * already-written reading silently re-points at a different metric. So the upsert
 * is `ON CONFLICT (key) DO UPDATE` — it never deletes, never re-inserts, and
 * `id` is `GENERATED ALWAYS AS IDENTITY`, which refuses to be assigned at all.
 *
 * The `DO UPDATE` (rather than `DO NOTHING`) is there for one reason: it makes
 * the statement return a row for every input key, so one round trip both
 * registers and resolves. It also lets a corrected `is_counter` reach an existing
 * row — a profile that mislabelled an energy total can be fixed without moving
 * its id.
 */

import { type SQL, sql } from "drizzle-orm";

import { metricKeys } from "./schema/plants";

/** One metric to register: its key, and the class the aggregates need. */
export interface MetricKeySpec {
  key: string;
  /** Whether the metric is a monotonic counter (an energy total). */
  isCounter: boolean;
}

/**
 * The subset of a drizzle client this module needs.
 *
 * Structural rather than the concrete client type so callers can pass either the
 * shared `db` or a `createDbAt` client (the database-backed test layer uses the
 * latter), and so this module does not import the client and drag
 * `@SunReye/env` into everything that touches it.
 */
export interface MetricKeyWriter {
  /**
   * `rows` is `unknown[]` rather than a generic: drizzle's own `execute` is
   * generic over a `QueryResultRow`, and restating that constraint here would
   * couple this interface to the driver's type gymnastics — the thing declaring
   * it structurally was meant to avoid. The single `as` below is the price, and
   * it is checked by the database test rather than by the compiler.
   */
  execute: (query: SQL) => Promise<{ rows: unknown[] }>;
}

/**
 * Register every spec that is new and return `key -> id` for all of them.
 *
 * One statement, whatever the input size: a per-key round trip would be ~108 of
 * them on every profile swap. An empty input returns an empty map WITHOUT
 * executing anything — a `VALUES` list with no rows is a syntax error, which is
 * the kind of failure that only shows up on the one install whose profile
 * declares no metrics.
 */
// fallow-ignore-next-line unused-export -- the metric dimension's write side; wave 3 calls it from the runtime's profile-activation hook and from the writer. Proved against a live database by apps/server/db-tests/baseline.test.ts.
export async function ensureMetricKeys(
  db: MetricKeyWriter,
  specs: readonly MetricKeySpec[],
): Promise<Map<string, number>> {
  const unique = new Map(specs.map((s) => [s.key, s]));
  if (unique.size === 0) return new Map();

  const values = sql.join(
    [...unique.values()].map((s) => sql`(${s.key}, ${s.isCounter})`),
    sql`, `,
  );

  // `excluded.is_counter` so a class correction lands, and the id stays put
  // because it is GENERATED ALWAYS AS IDENTITY and nothing here assigns it.
  const result = await db.execute(sql`
    insert into ${metricKeys} (key, is_counter)
    values ${values}
    on conflict (key) do update set is_counter = excluded.is_counter
    returning id, key`);

  const rows = result.rows as Array<{ id: number | string; key: string }>;
  // `Number(row.id)`: an int2 arrives as a number through this driver, but a
  // bigint-shaped id would arrive as a string, and a Map keyed by "3" vs 3 fails
  // silently at the call site rather than here.
  return new Map(rows.map((row) => [row.key, Number(row.id)]));
}
