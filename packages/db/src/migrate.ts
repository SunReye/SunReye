import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";

import { pgUpgradeClient, runBlockingUpgrade, stampDrizzleBaseline } from "./upgrade-120-run";

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
 *  1a. The IN-PLACE 1.2.0 -> 2.0.0 upgrade (`./upgrade-120-run.ts`), which is a
 *     no-op on every database that is not a 1.x one. It has to run here, before
 *     anything is stamped and before drizzle's migrator: a 1.2.0 database HAS
 *     `drizzle.__drizzle_migrations`, so it classifies as journaled, takes
 *     neither stamp path, and dies inside drizzle's migrator with a bare
 *     `relation "user" already exists`. The upgrade renames 1.2.0's relations out
 *     of the way, applies the parts of the baseline the database is missing, and
 *     stamps the baseline itself — after which the steps below see an ordinary
 *     journaled 2.0.0 database.
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

export interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

/**
 * The migration journal this build ships.
 *
 * @internal Exported for `migrate.test.ts`: the guard below compares the
 * database against `entries.at(-1)`, so "the entries are ordered oldest first"
 * is load-bearing rather than incidental.
 */
export function readJournal(): JournalEntry[] {
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

/** Whether a public-schema table carries a column — the identity discriminator. */
async function columnExists(client: Client, table: string, column: string): Promise<boolean> {
  const res = await client.query(
    `SELECT true AS present FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [table, column],
  );
  return res.rows.length > 0;
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
async function guardDowngrade(
  client: Client,
  entries: JournalEntry[],
  runtime: MigrateRuntime,
): Promise<void> {
  const dbLatest = await latestJournaledInDb(client);
  const shippedLatest = entries.at(-1)?.when ?? 0;
  if (dbLatest <= shippedLatest) return;
  console.error(
    `Refusing to start: the database was migrated by a newer SunReye release ` +
      `(db journal ${new Date(dbLatest).toISOString()} > shipped ${new Date(shippedLatest).toISOString()}). ` +
      `Upgrade SunReye again, or restore the pre-upgrade backup to downgrade.`,
  );
  runtime.exit(1);
}

/**
 * Everything the 2.0.0 baseline creates that NO pre-2.0.0 database has.
 *
 * The dimension spine is the discriminator, and it has to be, because the two
 * relations a push-era database was recognised by — `metrics_raw` and `"user"`
 * — are also exactly what a 1.2.0 production database has. Recognising that
 * database as push-era stamps the baseline as applied without running it, and
 * leaves a database with no plants, connections, devices or metric_keys whose
 * journal reports success. That is silent, permanent data loss on the one
 * instance whose history cannot be regenerated.
 */
const BASELINE_DIMENSIONS = [
  "public.plants",
  "public.connections",
  "public.devices",
  "public.metric_keys",
] as const;

/** Which of the shapes `stampBaseline` has to tell apart. */
type DatabaseShape =
  /** The journal is there; drizzle's migrator owns it from here. */
  | "journaled"
  /** Nothing to adopt — the baseline executes normally. */
  | "fresh"
  /** Unjournaled but complete: safe to record the baseline without running it. */
  | "push-era"
  /** Unjournaled and INCOMPLETE — a 1.x database, or a half-migrated one. */
  | "pre-baseline";

/** Qualified names of the {@link BASELINE_DIMENSIONS} this database lacks. */
async function missingDimensions(client: Client): Promise<string[]> {
  const missing: string[] = [];
  for (const table of BASELINE_DIMENSIONS) {
    if (!(await tableExists(client, table))) missing.push(table);
  }
  return missing;
}

/**
 * Classify a database before anything is stamped over it.
 *
 * "Has the app schema but no journal" is not enough to mean push era: it must
 * hold the schema THIS build's baseline creates, dimension spine included.
 */
async function databaseShape(client: Client): Promise<DatabaseShape> {
  const hasApp =
    (await tableExists(client, "public.metrics_raw")) && (await tableExists(client, "public.user"));
  const incomplete = hasApp && (await missingDimensions(client)).length > 0;
  if (await tableExists(client, "drizzle.__drizzle_migrations")) {
    // A JOURNALED database missing the dimension spine is refused rather than
    // handed to drizzle's migrator. This is the gap a previous wave left open on
    // purpose: a real 1.2.0 database has a journal, so it took neither stamp path
    // and died inside the migrator with a bare `relation "user" already exists` —
    // loud, but naming nothing an operator could act on. It is safe to refuse
    // here now because the only database that legitimately arrives in this shape
    // is a 1.x one, and `runBlockingUpgrade` has already run by the time this is
    // reached: it creates the dimension spine, so the upgrade path this refusal
    // would otherwise block goes through untouched. What is left to refuse is a
    // database this build cannot recognise at all — a half-migrated one, a 1.1.x
    // one, a hand-edited one — and for those, stopping with the tables named
    // beats a migrator error that names none of them.
    return incomplete ? "pre-baseline" : "journaled";
  }
  if (!hasApp) return "fresh";
  return incomplete ? "pre-baseline" : "push-era";
}

/**
 * Pre-journal databases (created via `drizzle-kit push`) already contain the
 * baseline schema. Record the baseline migration as applied — same table DDL,
 * hash, and timestamp drizzle-orm's migrator writes — without executing it.
 *
 * Only the baseline entry (journal index 0) is stamped: anything after it is a
 * real change the push-era database may not have, and must execute normally.
 *
 * @internal Exported for `migrate.test.ts`, which proves the refusals below
 * against a fake catalog. Production callers go through {@link runMigrations}.
 */
export async function stampBaseline(client: Client, entries: JournalEntry[]) {
  const shape = await databaseShape(client);
  if (shape === "pre-baseline") {
    // Loudly, rather than guessing. Both guesses are bad: stamping loses the
    // dimension spine silently, and running the baseline over an existing
    // `"user"` table fails with an error that names none of this. The in-place
    // upgrade from 1.x is its own migration path, not something a stamp can do.
    throw new Error(
      `Refusing to migrate: this database has the SunReye app schema but is missing the ` +
        `2.0.0 dimension tables (${(await missingDimensions(client)).join(", ")}), and has no ` +
        `migration journal. It is a pre-2.0.0 (or half-migrated) database — stamping the ` +
        `baseline here would record success over a database that never got those tables. ` +
        `Restore a backup and run the documented 1.x → 2.0.0 upgrade.`,
    );
  }
  if (shape !== "push-era") return; // fresh or already journaled

  const baseline = entries[0];
  if (!baseline) throw new Error("migration journal is empty");
  const content = readFileSync(join(MIGRATIONS_DIR, `${baseline.tag}.sql`), "utf8");

  // The same insert the in-place upgrade uses, so there is one implementation of
  // "record a migration as applied without executing it" rather than two that
  // could disagree about the hash or the table's DDL.
  await stampDrizzleBaseline(pgUpgradeClient(client), {
    when: baseline.when,
    hash: sha256(content),
  });
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
 * The columns 2.0.0 re-keyed every reading onto. A 1.x `metrics_raw` carries a
 * text `inverter_id` (which was really the PROFILE id) and a text `metric`
 * instead, and its rollups are plain averages over those — so their mere
 * EXISTENCE says nothing about whether this baseline's aggregates were created.
 */
const BASELINE_READING_COLUMNS = ["device_id", "metric_id"] as const;

/**
 * Pre-journal databases already ran the bootstrap (as the old timescale.sql):
 * stamp it instead of re-executing when the rollup views exist.
 *
 * Same rule as {@link stampBaseline}, one layer down, and reachable on its own
 * through `setup-timescale.ts`: an existing `minute_rollups` is only this
 * baseline's `minute_rollups` if the timeseries has this baseline's identity.
 * Stamped over a 1.x generation, the run records success for continuous
 * aggregates that were never created — and unlike a missing table, an aggregate
 * that quietly is not there shows up as a chart that is merely wrong.
 *
 * @internal Exported for `migrate.test.ts`; production callers reach it through
 * {@link applyTimescale}.
 */
export async function stampTimescaleBootstrap(
  client: Client,
  bootstrap: string,
  applied: Set<string>,
) {
  if (applied.size > 0) return;
  if (!(await tableExists(client, "public.minute_rollups"))) return;
  const missing: string[] = [];
  for (const column of BASELINE_READING_COLUMNS) {
    if (!(await columnExists(client, "metrics_raw", column))) missing.push(column);
  }
  if (missing.length > 0) {
    throw new Error(
      `Refusing to migrate: metrics_raw is missing ${missing.join(", ")}, so the rollups this ` +
        `database already has are not the ones ${bootstrap} creates (a pre-2.0.0 generation, or ` +
        `a half-migrated one). Stamping it would record success for continuous aggregates that ` +
        `do not exist. Restore a backup and run the documented 1.x → 2.0.0 upgrade.`,
    );
  }
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

/**
 * Everything `runMigrations` reaches the outside world through.
 *
 * Injected — with the production wiring as the default, so callers pass nothing
 * — because the decisions worth proving are the ORDER of the steps, that the
 * downgrade guard refuses before anything is applied, and that the connection is
 * always released. None of those are things Postgres has an opinion about, and
 * reaching them by stubbing `pg` itself is not available here: `mock.module` is
 * process-global and permanent, and `packages/db/src/index.ts` pulls `pg` in
 * transitively for many later files in the serial coverage run.
 *
 * The statements themselves are proved against a real database in
 * `apps/server/db-tests`, which calls {@link runMigrations} with this default.
 */
export interface MigrateRuntime {
  /** A client for `databaseUrl`, not yet connected. */
  createClient(databaseUrl: string): Client;
  /** Apply the journaled drizzle migrations through an open client. */
  applyDrizzle(client: Client, migrationsFolder: string): Promise<void>;
  /** Abandon the process. Separated so the downgrade refusal is observable. */
  exit(code: number): never;
}

/** The real wiring: a `pg.Client`, drizzle's migrator, and `process.exit`. */
export const productionRuntime: MigrateRuntime = {
  createClient: (databaseUrl) => new Client({ connectionString: databaseUrl }),
  applyDrizzle: (client, migrationsFolder) => migrate(drizzle(client), { migrationsFolder }),
  // A direct reference, not a wrapper: there is no decision to make here, and a
  // wrapper would be a function nothing can ever call without ending the run.
  exit: process.exit.bind(process) as (code: number) => never,
};

/**
 * The 1.2.0 -> 2.0.0 in-place upgrade, handed the baseline this build ships.
 *
 * A no-op on anything that is not a 1.x database — the recognition lives in
 * `./upgrade-120.ts` and is a pure function of the catalog, so it is unit-tested
 * rather than being a condition here. The baseline SQL is read and split HERE
 * because this module already owns `MIGRATIONS_DIR` and the breakpoint format;
 * `./upgrade-120-run.ts` stays free of the filesystem and is therefore drivable
 * from a database test with a statement list of its own.
 */
async function upgradeInPlace(client: Client, entries: JournalEntry[]): Promise<void> {
  const baseline = entries[0];
  if (!baseline) throw new Error("migration journal is empty");
  const content = readFileSync(join(MIGRATIONS_DIR, `${baseline.tag}.sql`), "utf8");
  await runBlockingUpgrade(pgUpgradeClient(client), {
    baselineStatements: splitStatements(content),
    baseline: { when: baseline.when, hash: sha256(content) },
    logger: { log: (message) => console.log(message) },
  });
}

export async function runMigrations(
  databaseUrl: string,
  runtime: MigrateRuntime = productionRuntime,
) {
  if (!existsSync(MIGRATIONS_DIR)) throw new Error(`migrations dir not found: ${MIGRATIONS_DIR}`);
  const entries = readJournal();

  const client = runtime.createClient(databaseUrl);
  await client.connect();
  try {
    await guardDowngrade(client, entries, runtime);
    await upgradeInPlace(client, entries);
    await stampBaseline(client, entries);
    await runtime.applyDrizzle(client, MIGRATIONS_DIR);
    console.log(`Schema is at ${entries.at(-1)?.tag} (${entries.length} migration(s)).`);
    await applyTimescale(client);
  } finally {
    await client.end();
  }
}

/**
 * The entry point's body, extracted so the failure path is provable: a migration
 * that throws must stop the server rather than let it start on a half-migrated
 * schema.
 */
export async function cli(
  databaseUrl: string = env.DATABASE_URL,
  runtime: MigrateRuntime = productionRuntime,
): Promise<number> {
  try {
    await runMigrations(databaseUrl, runtime);
    return 0;
  } catch (error) {
    console.error("Migration failed — the server will not start:", error);
    return 1;
  }
}

if (import.meta.main) process.exit(await cli());
