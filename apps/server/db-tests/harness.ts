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
import dotenv from "dotenv";

/**
 * Load `apps/server/.env` BEFORE anything reads {@link baseUrl}.
 *
 * Without this, whether the database layer runs at all depended on whether some
 * *other* module in the file set happened to pull `dotenv/config` in first — the
 * server env package does, `bun:test` and `drizzle-orm` do not. The symptom was
 * silent and asymmetric: `bun run test:db` reported "124 pass, 61 skip, 0 fail"
 * with `toolkit-constructs.test.ts` and `archive.test.ts` skipped in full, and
 * `bun test <a single db-test file>` — the normal way to iterate on one — skipped
 * EVERY time. A skip is not a failure, so every gate stayed green while the 61
 * specs that pin the toolkit results the rollup design rests on ran nowhere.
 *
 * The path is explicit rather than `dotenv/config` because that resolves `.env`
 * from the process cwd, which is the repo root for `bun run test:db` and the
 * package directory otherwise — the same order-dependence in another costume.
 *
 * `override: false` is the default and is load-bearing: a `DB_TEST_URL` or
 * `DATABASE_URL` exported by CI, or by an operator pointing this at a throwaway
 * container, must always win over the checked-out file.
 */
dotenv.config({ path: new URL("../.env", import.meta.url).pathname, quiet: true });

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

/**
 * The ONLY other database this layer may touch: a scratch one built to look like
 * an addon-1.2.0 install, so the in-place 1.2.0 -> 2.0.0 upgrade can be run for
 * real.
 *
 * A SECOND database rather than a second shape of the first, because the upgrade
 * is a migration of a whole database: it renames relations, applies the baseline
 * selectively and stamps a journal, none of which can share a database with specs
 * that expect a migrated 2.0.0 schema. Its own name means those specs cannot be
 * affected by it and it needs no row scoping.
 */
const LEGACY_TEST_DB = "sunreye_dbtest_120";

/** Refuse any URL that does not name {@link LEGACY_TEST_DB}. Same rule, same reason. */
export function assertLegacyTestDatabase(url: string): void {
  const name = new URL(url).pathname.replace(/^\//, "");
  if (name !== LEGACY_TEST_DB) {
    throw new Error(
      `Refusing to build the 1.2.0 upgrade fixture in ${name || "(no database)"} — only ` +
        `${LEGACY_TEST_DB} is allowed`,
    );
  }
}

/** Connection URL for {@link LEGACY_TEST_DB}, or null when nothing is configured. */
export function legacyTestDatabaseUrl(): string | null {
  const base = baseUrl();
  return base === null ? null : withDatabase(base, LEGACY_TEST_DB);
}

/**
 * Drop and recreate {@link LEGACY_TEST_DB}, EMPTY apart from the TimescaleDB
 * extension.
 *
 * Deliberately NOT memoized, unlike {@link resetTestDatabase}: the upgrade is a
 * one-way transformation of a database, so a spec that wants to run it again —
 * or to run it from a different starting state — needs a fresh one, and sharing
 * would make the second assertion depend on the first having happened.
 */
export async function resetLegacyDatabase(): Promise<string> {
  const base = baseUrl();
  if (base === null) throw new Error("no DB_TEST_URL or DATABASE_URL configured");
  const url = withDatabase(base, LEGACY_TEST_DB);
  assertLegacyTestDatabase(url);

  const admin = new SQL(withDatabase(base, ADMIN_DB));
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${LEGACY_TEST_DB} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${LEGACY_TEST_DB}`);
  } finally {
    await admin.end();
  }
  const db = new SQL(url, { max: 1 });
  try {
    await db.unsafe("CREATE EXTENSION IF NOT EXISTS timescaledb");
  } finally {
    await db.end();
  }
  return url;
}

/**
 * The archive layer's OWN database.
 *
 * `resetTestDatabase` is memoized: it drops and recreates once per process, so
 * every spec file after the first SHARES that database and scopes its rows by
 * its own slugs. That works for every layer except this one. The portable
 * archive is a WHOLE-DATABASE transport — `exportArchive` walks the plant and
 * counts what it finds — so its central assertion ("the manifest names exactly
 * the rows I seeded") is really an assertion about the whole database, and it
 * silently becomes an assertion about whatever ran first.
 *
 * That is not hypothetical. `bun test` orders files by directory read, which
 * differs between filesystems: locally `archive.test.ts` ran first and saw its
 * own 17,280 rows, while CI ran seven files before it and the same export
 * reported 52,146. The spec was correct and the isolation was not.
 *
 * Not memoized, for the same reason {@link resetLegacyDatabase} is not: a spec
 * that exports, imports and re-imports needs to say where it starts from.
 */
const ARCHIVE_TEST_DB = "sunreye_dbtest_archive";

/** Refuse any URL that does not name {@link ARCHIVE_TEST_DB}. Same rule, same reason. */
export function assertArchiveTestDatabase(url: string): void {
  const name = new URL(url).pathname.replace(/^\//, "");
  if (name !== ARCHIVE_TEST_DB) {
    throw new Error(
      `Refusing to build the archive fixture in ${name || "(no database)"} — only ` +
        `${ARCHIVE_TEST_DB} is allowed`,
    );
  }
}

/** A migrated 2.0.0 database of the archive layer's own, dropped and rebuilt. */
export async function resetArchiveDatabase(): Promise<string> {
  const base = baseUrl();
  if (base === null) throw new Error("no DB_TEST_URL or DATABASE_URL configured");
  const url = withDatabase(base, ARCHIVE_TEST_DB);
  assertArchiveTestDatabase(url);

  const admin = new SQL(withDatabase(base, ADMIN_DB));
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${ARCHIVE_TEST_DB} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${ARCHIVE_TEST_DB}`);
  } finally {
    await admin.end();
  }

  const { runMigrations } = await import("@SunReye/db/migrate");
  await runMigrations(url);
  return url;
}

/**
 * `git show addon-v1.2.0:<path>` — the 1.2.0 schema, RECOVERED rather than
 * transcribed.
 *
 * `scripts/fixture-1-2-0.ts` already does this and would be the natural thing to
 * call, but `apps/server` cannot import from `scripts/` — it is outside tsc's
 * `rootDir`, and `tsc -b` silently emits `scripts/*.d.ts` when you try. Reading
 * the same tag through the same command is the next best thing: if the tag says
 * `metrics_raw` has four columns, that is what this builds, and a future reader
 * can diff the tag instead of trusting a copy.
 */
export async function showAtLegacyTag(path: string): Promise<string> {
  const proc = Bun.spawn(["git", "show", `addon-v1.2.0:${path}`], {
    cwd: new URL("../../../", import.meta.url).pathname,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  if ((await proc.exited) !== 0) {
    throw new Error(`git show addon-v1.2.0:${path} failed: ${err.trim()}`);
  }
  return out;
}
