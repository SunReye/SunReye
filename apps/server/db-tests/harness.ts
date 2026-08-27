/**
 * A real TimescaleDB to run real queries against.
 *
 * Why this layer exists: every test in `src/shared/history.test.ts` asserts on
 * the SQL *text* a query builder emits, which cannot tell you whether Postgres
 * will accept it. Two bugs shipped behind a fully green suite because of that —
 * an ambiguous `time_bucket` overload and an `ORDER BY` that bound to a UNION
 * instead of its arm — and both were 500s on every dashboard load. A text
 * assertion is not proof for SQL; executing it is.
 *
 * Deliberately outside every `src/` tree, so `bun run test` — which globs only
 * the per-app and per-package sources — stays
 * database-free and fast. Run with `bun run test:db`.
 */
import { SQL } from "bun";

/**
 * The ONLY database this layer may touch. Hardcoded, not configurable: the
 * developer's `DATABASE_URL` points at a database shared with a live inverter,
 * and this harness DROPs its target on every run.
 */
const TEST_DB = "sunreye_dbtest";

/** Maintenance database used to create and drop {@link TEST_DB}. */
const ADMIN_DB = "postgres";

/** Swap the database name in a connection URL, keeping credentials and host. */
export function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

/**
 * Refuse any URL that does not name {@link TEST_DB}.
 *
 * The guard is the point of this module: a copy-paste that let these tests
 * (which `DROP DATABASE` and `TRUNCATE`) run against the dev database would
 * destroy live inverter history, and nothing else in the repo would stop it.
 */
export function assertTestDatabase(url: string): void {
  const name = new URL(url).pathname.replace(/^\//, "");
  if (name !== TEST_DB) {
    throw new Error(
      `Refusing to run database tests against ${name || "(no database)"} — only ${TEST_DB} is allowed`,
    );
  }
}

/**
 * Base URL these tests derive their target from, or null when unset.
 *
 * An EMPTY variable counts as unset. `??` alone accepts `""`, which made
 * `DB_TEST_URL= bun run test:db` throw out of `new URL("")` instead of skipping
 * — a footgun on the one layer whose whole safety story is "skip when the
 * database is unreachable". CI still cannot lose the layer silently: it fails
 * hard when `CI` is set.
 */
function baseUrl(): string | null {
  return process.env.DB_TEST_URL || process.env.DATABASE_URL || null;
}

/** Connection URL for the test database, or null when no base URL is configured. */
export function testDatabaseUrl(): string | null {
  const base = baseUrl();
  return base === null ? null : withDatabase(base, TEST_DB);
}

/** Whether a Postgres accepting connections is reachable at all. */
export async function databaseReachable(): Promise<boolean> {
  const base = baseUrl();
  if (base === null) return false;
  const admin = new SQL(withDatabase(base, ADMIN_DB));
  try {
    await admin`select 1`;
    return true;
  } catch {
    return false;
  } finally {
    await admin.end();
  }
}

/**
 * Memoized so the database is built exactly ONCE per process.
 *
 * Every spec file in this directory needs a migrated database, and bun runs them
 * in one process. Without this, the second file's `DROP DATABASE ... WITH
 * (FORCE)` terminates the connections the first file's pool still holds — the
 * pool is never closed, because a spec has no reason to close it — and whichever
 * query lands next fails for reasons that have nothing to do with the code under
 * test. Sharing one database also halves the setup cost.
 *
 * The trade: specs share state, so each must scope its rows (an `inverterId` of
 * its own) rather than assume an empty table.
 */
let building: Promise<string> | null = null;

/**
 * Drop and recreate {@link TEST_DB}, then bring it to the shipped schema with
 * the same runner production uses — drizzle migrations followed by the journaled
 * TimescaleDB pipeline. Recreating rather than truncating is what makes the
 * aggregates and policies part of what is under test.
 *
 * Safe to call from every spec file: the work happens once and later callers
 * await the same promise.
 */
export function resetTestDatabase(): Promise<string> {
  building ??= buildTestDatabase();
  return building;
}

async function buildTestDatabase(): Promise<string> {
  const base = baseUrl();
  if (base === null) throw new Error("no DB_TEST_URL or DATABASE_URL configured");
  const url = withDatabase(base, TEST_DB);
  assertTestDatabase(url);

  const admin = new SQL(withDatabase(base, ADMIN_DB));
  try {
    // Identifier interpolation is safe here and only here: TEST_DB is a
    // hardcoded constant this module owns, never input. Neither statement may
    // run inside a transaction, so both go through `unsafe`.
    await admin.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${TEST_DB}`);
  } finally {
    await admin.end();
  }

  const { runMigrations } = await import("@SunReye/db/migrate");
  await runMigrations(url);
  return url;
}
