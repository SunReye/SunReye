/**
 * THE UPGRADE REHEARSAL'S PURE HALF: every decision it makes without touching a
 * database.
 *
 * Its own module for two reasons, and the first one is safety. The rehearsal DROPs
 * its target database, and the rules about which target is allowed
 * ({@link assertUpgradeTarget}) are the only thing standing between a copy-pasted
 * `DATABASE_URL` and port 5432 — the developer's dev database, SHARED WITH A LIVE
 * GRID-TIED INVERTER. That rule deserves a unit test, and a unit test should not
 * have to import a module whose job is to shell out to `docker`.
 *
 * The second is that this is where the upgrade's ACCEPTANCE CRITERIA live: what
 * makes a post-rename schema "serving" ({@link servingProblems}), and whether the
 * rename preserved every bucket ({@link renamePreservedProblems}). Those are the
 * claims the whole release rests on, so they are written as pure functions over a
 * described state rather than as assertions buried in a driver.
 *
 * Nothing here imports `./upgrade-phases.ts`, and it must stay that way: both that
 * module and `./upgrade-rehearsal.ts` import THIS one, so a dependency in the
 * other direction would be a cycle.
 */
import { type GroundTruth, type TierName, compareTier } from "./fixture-1-2-0";

// ---------------------------------------------------------------------------
// Target pinning
// ---------------------------------------------------------------------------

/** The developer's dev database, shared with a live grid-tied inverter. */
// fallow-ignore-next-line unused-export -- the dev database's port, asserted by ./upgrade-plan.test.ts so the refusal is pinned to a number rather than a message; assertUpgradeTarget below and HELP are its in-file readers.
export const DEV_DB_PORT = 5432;

/** The addon-1.2.0 fixture container. Expensive to rebuild; READ-ONLY here. */
// fallow-ignore-next-line unused-export -- as above, for the read-only addon-1.2.0 fixture container.
export const FIXTURE_PORT = 5433;

/** Ports this script may drop databases on. Nothing else. */
// fallow-ignore-next-line unused-export -- the allowlist ./upgrade-plan.test.ts walks to prove every permitted port is permitted and nothing else is.
export const ALLOWED_PORTS = [5438, 5439, 5440, 5441] as const;

/**
 * Refuse any target that is not a throwaway upgrade-rehearsal port.
 *
 * The dev database gets its own message rather than being lumped in with "not
 * allowed": it is the one mistake here whose consequences a rebuild cannot undo.
 */
export function assertUpgradeTarget(url: string): void {
  const parsed = new URL(url);
  // fallow-ignore-next-line code-duplication -- dup:7ac136ed — the target pinning. Each script needs its OWN allowlist and its own database-name rule (this one also requires a sunreye_upgrade* name), so only the three throw-blocks' shape is shared. This is the most safety-critical duplication in the repo and must not be merged carelessly: it is what stops port 5432, the dev database shared with a live grid-tied inverter, from being dropped. The real fix is a shared scripts/ module, deliberately deferred: scripts/replay-rehearsal.ts is owned by a concurrent agent this wave and editing it would conflict. Extract once both scripts are settled.
  const port = Number(parsed.port);
  if (port === DEV_DB_PORT) {
    throw new Error(
      `Refusing to touch port ${DEV_DB_PORT}: that is the dev database, shared with a live ` +
        `inverter, and this script DROPs its target.`,
    );
  }
  if (port === FIXTURE_PORT) {
    throw new Error(
      `Refusing to touch port ${FIXTURE_PORT}: that is the addon-1.2.0 fixture container, which ` +
        `is READ-ONLY here — restore its dump into a rehearsal container instead.`,
    );
  }
  if (!ALLOWED_PORTS.includes(port as (typeof ALLOWED_PORTS)[number])) {
    throw new Error(
      `Refusing to touch port ${parsed.port || "(implicit)"} — the upgrade rehearsal may only ` +
        `run on ${ALLOWED_PORTS.join(", ")}, so no ambient DATABASE_URL can ever be the target.`,
    );
  }
  const name = parsed.pathname.replace(/^\//, "");
  if (!name.startsWith("sunreye_upgrade")) {
    throw new Error(
      `Refusing to touch "${name || "(no database)"}" — the rehearsal only builds databases ` +
        `named sunreye_upgrade*.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

// fallow-ignore-next-line unused-export -- the phase list ./upgrade-plan.test.ts walks so a new phase cannot be added without parseArgs accepting it; asPhase and phasesToRun below are its in-file readers.
export const PHASES = [
  "restore",
  "blocking",
  "provision",
  "backfill",
  "verify",
  "drop",
  "all",
] as const;

export type Phase = (typeof PHASES)[number];

export interface Options {
  container: string;
  port: number;
  password: string;
  database: string;
  /** The 1.2.0 dump, INSIDE the container. */
  dump: string;
  mode: "fast" | "full";
  phase: Phase;
  /**
   * Exit(9) after this many replayed chunks — the hook the kill-and-resume proof
   * hangs on. `0` means run to completion.
   */
  stopAfter: number;
  refreshChunkDays: number;
  help: boolean;
}

// fallow-ignore-next-line unused-export -- the documented defaults, compared whole by ./upgrade-plan.test.ts so a changed default cannot pass unnoticed; parseArgs below is its in-file reader.
export const DEFAULT_OPTIONS: Options = {
  container: "sunreye-upgrade-5440",
  port: 5440,
  password: "fixture",
  database: "sunreye_upgrade_200",
  dump: "/tmp/f.dump",
  mode: "full",
  phase: "all",
  stopAfter: 0,
  refreshChunkDays: 7,
  help: false,
};

export const HELP = `upgrade-rehearsal.ts — run the 1.2.0 -> 2.0.0 in-place upgrade for real

  bun scripts/upgrade-rehearsal.ts [--phase=restore|blocking|provision|backfill|verify|drop|all]
                                   [--port=5440] [--container=NAME] [--database=sunreye_upgrade_200]
                                   [--dump=/tmp/f.dump] [--fast|--full] [--stop-after=N]
                                   [--refresh-chunk-days=7]

Expects a THROWAWAY TimescaleDB container (ghcr.io/sunreye/timescaledb:pg17-ts2.28.2,
--network host) already holding the addon-1.2.0 fixture DUMP at --dump. Stage one with:

  docker run -d --name sunreye-upgrade-5440 --network host -e POSTGRES_PASSWORD=fixture \\
    -e PGPORT=5440 ghcr.io/sunreye/timescaledb:pg17-ts2.28.2 -c port=5440
  docker exec sunreye-fixture-120 cat /var/lib/postgresql/fixture-1-2-0.dump > /tmp/f.dump
  docker cp /tmp/f.dump sunreye-upgrade-5440:/tmp/f.dump

Port ${DEV_DB_PORT} (the dev database, shared with a live inverter) and port ${FIXTURE_PORT}
(the fixture container itself) are refused.

--stop-after=N exits with code 9 after N replayed chunks, mid-run, leaving the
database exactly as a SIGKILL would. Re-running --phase=backfill must then finish
the job with no double insert and no gap.
`;

const FLAGS = new Map<string, (o: Options) => void>([
  ["--fast", (o) => (o.mode = "fast")],
  ["--full", (o) => (o.mode = "full")],
  ["--help", (o) => (o.help = true)],
  ["-h", (o) => (o.help = true)],
]);

// fallow-ignore-next-line code-duplication -- dup:cf96b909 — the argument table's first rows coincide with replay-rehearsal.ts's; the option SETS differ, so merging them would couple two CLIs that take different flags. The real fix is a shared scripts/ module, deliberately deferred: scripts/replay-rehearsal.ts is owned by a concurrent agent this wave and editing it would conflict. Extract once both scripts are settled.
const VALUES = new Map<string, (o: Options, v: string) => void>([
  ["--container", (o, v) => (o.container = v)],
  ["--port", (o, v) => (o.port = Number(v))],
  ["--password", (o, v) => (o.password = v)],
  ["--database", (o, v) => (o.database = v)],
  ["--dump", (o, v) => (o.dump = v)],
  ["--phase", (o, v) => (o.phase = asPhase(v))],
  ["--stop-after", (o, v) => (o.stopAfter = Number(v))],
  ["--refresh-chunk-days", (o, v) => (o.refreshChunkDays = Number(v))],
]);

function asPhase(value: string): Phase {
  if ((PHASES as readonly string[]).includes(value)) return value as Phase;
  throw new Error(`--phase: ${value} is not one of ${PHASES.join(", ")}`);
}

/** Unknown flags are rejected: a typo'd `--phas=verify` must not mean `all`. */
/** Apply one argument, or throw naming it. `--name=value` first, then bare flags. */
function applyArg(options: Options, arg: string): void {
  const eq = arg.indexOf("=");
  if (eq > 0) {
    const apply = VALUES.get(arg.slice(0, eq));
    if (!apply) throw new Error(`unknown argument: ${arg}\n\n${HELP}`);
    apply(options, arg.slice(eq + 1));
    return;
  }
  const flag = FLAGS.get(arg);
  if (!flag) throw new Error(`unknown argument: ${arg}\n\n${HELP}`);
  flag(options);
}

export function parseArgs(argv: readonly string[]): Options {
  const options = { ...DEFAULT_OPTIONS };
  for (const arg of argv) applyArg(options, arg);
  if (!Number.isInteger(options.port)) throw new Error("--port: not an integer");
  if (!Number.isInteger(options.stopAfter) || options.stopAfter < 0) {
    throw new Error("--stop-after: not a non-negative integer");
  }
  return options;
}

/** The phases `--phase=all` runs, in order. */
export function phasesToRun(phase: Phase): Exclude<Phase, "all">[] {
  return phase === "all"
    ? ["restore", "blocking", "provision", "backfill", "verify", "drop"]
    : [phase];
}

// ---------------------------------------------------------------------------
// Assertions on the state the blocking step must leave behind
// ---------------------------------------------------------------------------

/** The catalog facts `verify the schema serves` turns on. */
export interface ServingState {
  /** Columns of the live `metrics_raw`. */
  rawColumns: string[];
  /** Continuous aggregate view names. */
  aggregates: string[];
  /** Names of every policy job, as `proc_name:hypertable_name`. */
  jobs: string[];
  /** Whether the legacy relations are still there. */
  legacyRelations: string[];
}

/**
 * Everything wrong with the schema the blocking step left, or nothing.
 *
 * Four separate claims, and each one fails for its own reason:
 *
 *  * the live `metrics_raw` must be the NEW one. A rename that half-happened
 *    leaves a table that every query can address and no query can answer.
 *  * the new aggregate generation must exist under the plain names, and the
 *    legacy generation under the `legacy_` ones — the whole point of the rename.
 *  * NO job may name a legacy relation. This is the decisive one: the old minute
 *    tier's 90-day retention is what would keep eating the history while the
 *    operator decides, and it is invisible until a chunk is gone.
 *  * the legacy relations must still BE there. They are the rollback.
 */
/** The tiers, whose new generation and legacy generation must both exist. */
const TIERS = ["minute_rollups", "hourly_rollups", "daily_rollups"] as const;

/** The live `metrics_raw` must be the NEW one, by its columns. */
function rawColumnProblems(rawColumns: readonly string[]): string[] {
  const problems = ["device_id", "metric_id", "dur_ms"]
    .filter((column) => !rawColumns.includes(column))
    .map((column) => `metrics_raw has no ${column} column — it is not the 2.0.0 table`);
  if (rawColumns.includes("inverter_id")) {
    problems.push("metrics_raw still has inverter_id — the rename did not happen");
  }
  return problems;
}

/** Both generations must be present: the new one serves, the legacy one is the rollback. */
function aggregateProblems(aggregates: readonly string[]): string[] {
  return TIERS.flatMap((view) => [
    ...(aggregates.includes(view) ? [] : [`${view} was not created`]),
    ...(aggregates.includes(`legacy_${view}`)
      ? []
      : [`legacy_${view} is missing — the 1.2.0 buckets are gone`]),
  ]);
}

/**
 * No policy job may name a legacy relation.
 *
 * The decisive claim. The old minute tier's 90-day retention is what would keep
 * eating the history while the operator decides whether to migrate, and it is
 * invisible until a chunk is already gone.
 */
function jobProblems(jobs: readonly string[]): string[] {
  return jobs
    .filter((job) => /legacy_|metrics_raw_legacy/.test(job))
    .map((job) => `${job} still runs against a legacy relation — it will eat the history`);
}

export function servingProblems(state: ServingState): string[] {
  const problems = [
    ...rawColumnProblems(state.rawColumns),
    ...aggregateProblems(state.aggregates),
    ...jobProblems(state.jobs),
  ];
  if (!state.legacyRelations.includes("metrics_raw_legacy")) {
    problems.push("metrics_raw_legacy is missing — there is no rollback");
  }
  return problems;
}

/** The legacy tiers must be BIT-IDENTICAL to what the fixture committed. */
export function renamePreservedProblems(
  tier: TierName,
  committed: GroundTruth["tiers"][TierName],
  afterRename: GroundTruth["tiers"][TierName],
): string[] {
  return compareTier(tier, committed, afterRename).map(
    (problem) => `${problem} (the rename must preserve every bucket, bit for bit)`,
  );
}

/**
 * The rehearsal's own log prefix. Silent under `NODE_ENV=test` so a unit test of
 * the pure half does not narrate a run that is not happening.
 */
export const log = (message: string): void => {
  if (process.env.NODE_ENV !== "test") console.log(`[upgrade] ${message}`);
};
/** Report the findings, and the exit code they imply. */
export function report(problems: readonly string[]): number {
  if (problems.length === 0) {
    // fallow-ignore-next-line code-duplication -- dup:0d831b7e — the problem-printing tail is the same shape as replay-rehearsal.ts's report(), but the PASSED line differs because the two scripts prove different claims. The real fix is a shared scripts/ module, deliberately deferred: scripts/replay-rehearsal.ts is owned by a concurrent agent this wave and editing it would conflict. Extract once both scripts are settled.
    log("PASSED");
    return 0;
  }
  for (const problem of problems.slice(0, 40)) console.error(`  - ${problem}`);
  if (problems.length > 40) console.error(`  … and ${problems.length - 40} more`);
  log(`FAILED with ${problems.length} problem(s)`);
  return 1;
}
