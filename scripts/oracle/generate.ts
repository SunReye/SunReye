#!/usr/bin/env bun
// fallow-ignore-file unused-export -- exported so generate.test.ts can drive it; test files are not traced as consumers
/**
 * Rebuild the oracle corpus (`fixtures/oracle/`) from the 2.x code.
 *
 * Transport framing, profile decode and the forecast need no database and are written from here. Rollups,
 * statistics and archives need TimescaleDB, so they run as `apps/server/db-tests/oracle.test.ts`
 * with `ORACLE_WRITE=1`, on the harness's own `sunreye_dbtest` and nowhere else.
 *
 * Usage: `bun scripts/oracle/generate.ts [--database-url <url>]`
 *   `SUNREYE_PROFILES_DIR`  the SunReye-Official-Profiles checkout (default: beside the main checkout)
 *   `DB_TEST_URL`           the Postgres server for the database groups, as for `bun run test:db`
 */
import { type CorpusFiles, CORPUS_DIR, writeCorpus } from "./corpus";
import { buildForecastCorpus } from "./forecast";
import { buildProfileDecodeCorpus, officialProfilesDir } from "./profile-decode";
import { buildTransportCorpus } from "./transport";

const ORACLE_DATABASE = "sunreye_dbtest";

/**
 * The database URL the caller named, refused unless it names `sunreye_dbtest`; null when the caller
 * named none, in which case the test harness derives `sunreye_dbtest` from `DB_TEST_URL`.
 */
export function oracleDatabaseUrl(
  argv: readonly string[],
  env: Record<string, string | undefined>,
): string | null {
  const at = argv.indexOf("--database-url");
  const url = (at === -1 ? undefined : argv[at + 1]) ?? env.ORACLE_DATABASE_URL;
  if (url === undefined) return null;
  const name = new URL(url).pathname.replace(/^\//, "");
  if (name !== ORACLE_DATABASE) {
    throw new Error(
      `Refusing to generate against ${name || "(no database)"}: only ${ORACLE_DATABASE} is allowed`,
    );
  }
  return url;
}

export interface GenerateDeps {
  out: string;
  profilesDir: () => string | null;
  transport: () => Promise<CorpusFiles>;
  profiles: (dir: string) => Promise<CorpusFiles>;
  forecast: () => Promise<CorpusFiles>;
  databaseGroups: (url: string | null) => Promise<number>;
  log: (message: string) => void;
}

const REPO = new URL("../..", import.meta.url).pathname;

const DATABASE_COMMAND = [
  "bun",
  "test",
  "--timeout",
  "120000",
  "apps/server/db-tests/oracle.test.ts",
];

/** Run the database groups in write mode; resolves to the process's exit code. */
export async function runDatabaseGroups(
  url: string | null,
  command: readonly string[] = DATABASE_COMMAND,
  env: Record<string, string | undefined> = process.env,
): Promise<number> {
  const child = Bun.spawn([...command], {
    cwd: REPO,
    env: {
      ...env,
      ORACLE_WRITE: "1",
      SKIP_ENV_VALIDATION: "1",
      ...(url === null ? {} : { DB_TEST_URL: url }),
    },
    stdout: "inherit",
    stderr: "inherit",
  });
  return child.exited;
}

/** Write every group; resolves to the exit code of the database groups. */
export async function generate(
  argv: readonly string[],
  env: Record<string, string | undefined>,
  deps: GenerateDeps,
): Promise<number> {
  const url = oracleDatabaseUrl(argv, env);
  const profiles = deps.profilesDir();
  if (profiles === null) {
    throw new Error(
      "no profile repository: set SUNREYE_PROFILES_DIR to a SunReye-Official-Profiles checkout",
    );
  }
  await writeCorpus(await deps.transport(), deps.out);
  deps.log("transport framing written");
  await writeCorpus(await deps.profiles(profiles), deps.out);
  deps.log("profile decode written");
  await writeCorpus(await deps.forecast(), deps.out);
  deps.log("forecast written");
  return deps.databaseGroups(url);
}

if (import.meta.main) {
  const code = await generate(process.argv.slice(2), process.env, {
    out: CORPUS_DIR,
    profilesDir: () => officialProfilesDir(),
    transport: buildTransportCorpus,
    profiles: buildProfileDecodeCorpus,
    forecast: buildForecastCorpus,
    databaseGroups: runDatabaseGroups,
    log: (message) => console.log(message),
  });
  process.exit(code);
}
