import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";

// Load the server env file before importing the env schema, so this works when
// run via turbo (CWD = packages/db) the same way `drizzle.config.ts` does. In
// containers the path doesn't exist and dotenv silently no-ops.
dotenv.config({ path: fileURLToPath(new URL("../../../apps/server/.env", import.meta.url)) });
const { env } = await import("@SunReye/env/server");

/**
 * SunReye schema migration runner — the only supported way to bring a
 * production database to the current schema. Runs, in order:
 *
 *  1. Downgrade guard: refuses to touch a database that was migrated by a
 *     newer SunReye than this build.
 *  2. Baseline stamping: databases created in the pre-journal `db:push` era
 *     have the full schema but no `drizzle.__drizzle_migrations` table. The
 *     baseline migration (journal entry 0) is *recorded as applied* without
 *     executing it, exactly the way drizzle-orm's migrator would record it.
 *  3. drizzle-orm's programmatic migrator: applies pending journaled
 *     migrations transactionally.
 *  4. TimescaleDB pipeline: journaled structural files from `timescale/`
 *     (hypertable, continuous aggregates — applied once, never re-run, with
 *     the same baseline-stamping treatment), then `timescale/policies.sql`
 *     re-applied on every run so policy tuning stays authoritative.
 *
 * Directory resolution: `MIGRATIONS_DIR` / `TIMESCALE_DIR` env overrides,
 * defaulting to the paths next to this file. The overrides exist because
 * `bun build --compile` virtualizes import.meta paths — compiled binaries
 * (the Home Assistant addon) ship the SQL as plain files and point the env
 * vars at them.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR || join(HERE, "migrations");
const TIMESCALE_DIR = process.env.TIMESCALE_DIR || join(HERE, "timescale");

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

function readJournal(): JournalEntry[] {
  const journalPath = join(MIGRATIONS_DIR, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: JournalEntry[] };
  return journal.entries;
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/** Split a SQL file on drizzle's breakpoint marker, dropping comment-only chunks. */
function splitStatements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.split("\n").every((line) => line.trim().startsWith("--")));
}

async function tableExists(client: Client, qualified: string): Promise<boolean> {
  const res = await client.query<{ oid: string | null }>("SELECT to_regclass($1) AS oid", [
    qualified,
  ]);
  return res.rows[0]?.oid != null;
}

/** Newest journal timestamp recorded in the database, 0 when unjournaled. */
async function latestJournaledInDb(client: Client): Promise<number> {
  if (!(await tableExists(client, "drizzle.__drizzle_migrations"))) return 0;
  const res = await client.query<{ max: string | null }>(
    "SELECT max(created_at) AS max FROM drizzle.__drizzle_migrations",
  );
  return Number(res.rows[0]?.max ?? 0);
}

/**
 * Refuse to run when the database journal contains migrations newer than this
 * build ships — starting an older server against a newer schema is the one
 * upgrade direction that can corrupt data silently.
 */
async function guardDowngrade(client: Client, entries: JournalEntry[]) {
  const dbLatest = await latestJournaledInDb(client);
  const shippedLatest = entries.at(-1)?.when ?? 0;
  if (dbLatest <= shippedLatest) return;
  console.error(
    `Refusing to start: the database was migrated by a newer SunReye release ` +
      `(db journal ${new Date(dbLatest).toISOString()} > shipped ${new Date(shippedLatest).toISOString()}). ` +
      `Upgrade SunReye again, or restore the pre-upgrade backup to downgrade.`,
  );
  process.exit(1);
}

/** A pre-journal (`db:push`-era) database has the app schema but no journal. */
async function isPushEraDatabase(client: Client): Promise<boolean> {
  if (await tableExists(client, "drizzle.__drizzle_migrations")) return false;
  return (
    (await tableExists(client, "public.metrics_raw")) && (await tableExists(client, "public.user"))
  );
}

/**
 * Pre-journal databases (created via `drizzle-kit push`) already contain the
 * baseline schema. Record the baseline migration as applied — same table DDL,
 * hash, and timestamp drizzle-orm's migrator writes — without executing it.
 *
 * Only the baseline entry (journal index 0) is stamped: anything after it is a
 * real change the push-era database may not have, and must execute normally.
 */
async function stampBaseline(client: Client, entries: JournalEntry[]) {
  if (!(await isPushEraDatabase(client))) return; // fresh or already journaled

  const baseline = entries[0];
  if (!baseline) throw new Error("migration journal is empty");
  const content = readFileSync(join(MIGRATIONS_DIR, `${baseline.tag}.sql`), "utf8");

  await client.query("CREATE SCHEMA IF NOT EXISTS drizzle");
  await client.query(
    `CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )`,
  );
  await client.query(
    "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)",
    [sha256(content), baseline.when],
  );
  console.log(
    `Baselined pre-journal database: stamped ${baseline.tag} as applied without executing it.`,
  );
}

/** Structural timescale files (0000_*.sql …), ordered; throws when none ship. */
function timescaleFiles(): string[] {
  const files = readdirSync(TIMESCALE_DIR)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort();
  if (files.length === 0) throw new Error(`no timescale migrations found in ${TIMESCALE_DIR}`);
  return files;
}

async function appliedTimescaleFiles(client: Client): Promise<Set<string>> {
  await client.query(
    `CREATE TABLE IF NOT EXISTS public.timescale_migrations (
      name text PRIMARY KEY,
      hash text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`,
  );
  const rows = await client.query<{ name: string }>("SELECT name FROM public.timescale_migrations");
  return new Set(rows.rows.map((r) => r.name));
}

async function recordTimescaleFile(client: Client, file: string, content: string) {
  await client.query(
    "INSERT INTO public.timescale_migrations (name, hash) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [file, sha256(content)],
  );
}

/**
 * Pre-journal databases already ran the bootstrap (as the old timescale.sql):
 * stamp it instead of re-executing when the rollup views exist.
 */
async function stampTimescaleBootstrap(client: Client, bootstrap: string, applied: Set<string>) {
  if (applied.size > 0) return;
  if (!(await tableExists(client, "public.minute_rollups"))) return;
  await recordTimescaleFile(
    client,
    bootstrap,
    readFileSync(join(TIMESCALE_DIR, bootstrap), "utf8"),
  );
  applied.add(bootstrap);
  console.log(`Baselined TimescaleDB objects: stamped ${bootstrap} without executing it.`);
}

/**
 * Journaled TimescaleDB structural files. Statements run outside transactions
 * (continuous aggregates cannot be created inside one), so a mid-file failure
 * leaves the file unrecorded and it re-runs on the next start — every
 * statement in these files must stay idempotent as defense in depth.
 */
async function applyTimescaleStructural(client: Client) {
  const files = timescaleFiles();
  const applied = await appliedTimescaleFiles(client);
  await stampTimescaleBootstrap(client, files[0]!, applied);

  for (const file of files) {
    if (applied.has(file)) continue;
    const content = readFileSync(join(TIMESCALE_DIR, file), "utf8");
    for (const statement of splitStatements(content)) {
      await client.query(statement);
    }
    await recordTimescaleFile(client, file, content);
    console.log(`Applied timescale migration ${file}.`);
  }
}

/** Policies are settings, not history: re-applied every run so edits win. */
async function applyTimescalePolicies(client: Client) {
  const content = readFileSync(join(TIMESCALE_DIR, "policies.sql"), "utf8");
  const statements = splitStatements(content);
  for (const statement of statements) {
    await client.query(statement);
  }
  console.log(`Applied ${statements.length} TimescaleDB policy statement(s).`);
}

export async function applyTimescale(client: Client) {
  await applyTimescaleStructural(client);
  await applyTimescalePolicies(client);
}

export async function runMigrations(databaseUrl: string) {
  if (!existsSync(MIGRATIONS_DIR)) throw new Error(`migrations dir not found: ${MIGRATIONS_DIR}`);
  const entries = readJournal();

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await guardDowngrade(client, entries);
    await stampBaseline(client, entries);
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_DIR });
    console.log(`Schema is at ${entries.at(-1)?.tag} (${entries.length} migration(s)).`);
    await applyTimescale(client);
  } finally {
    await client.end();
  }
}

if (import.meta.main) {
  runMigrations(env.DATABASE_URL).catch((error) => {
    console.error("Migration failed — the server will not start:", error);
    process.exit(1);
  });
}
