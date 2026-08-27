/**
 * THE IN-PLACE 1.2.0 -> 2.0.0 UPGRADE, rehearsed end to end against the real
 * addon-1.2.0 fixture.
 *
 * There is ONE production instance, it holds ~2 months of real history, the
 * upgrade gets ONE attempt, and no user-performed export exists beforehand. The
 * fixture is therefore the only proof available, and this script is how the proof
 * is taken: it restores a schema-exact 1.2.0 database and runs the SHIPPED code
 * over it — `runMigrations` for the blocking step, `runBackfill` for the data,
 * `verifyMigration` for the gate, `dropLegacyStatements` for the end — measuring
 * each and comparing the result with the fixture's COMMITTED ground truth using
 * the fixture's own differs.
 *
 * ## Why it is phased, and why the state lives in the database
 *
 * `--phase` runs one step and stops. That is not a convenience: the upgrade's
 * whole resumability story is that the state is IN THE DATABASE (the migration
 * record and `replay_progress`), so the only honest way to prove a killed run
 * resumes is to kill the process and start a new one. A single long-lived script
 * that "simulated" a kill by throwing would keep its own memory and prove
 * nothing. So:
 *
 *   bun scripts/upgrade-rehearsal.ts --phase=restore
 *   bun scripts/upgrade-rehearsal.ts --phase=blocking
 *   bun scripts/upgrade-rehearsal.ts --phase=provision
 *   bun scripts/upgrade-rehearsal.ts --phase=backfill --stop-after=8   # then SIGKILL
 *   bun scripts/upgrade-rehearsal.ts --phase=backfill                  # resumes
 *   bun scripts/upgrade-rehearsal.ts --phase=verify
 *   bun scripts/upgrade-rehearsal.ts --phase=drop
 *
 * `--phase=all` runs the lot.
 *
 * ## What it proves that the database tests do not
 *
 * `apps/server/db-tests/upgrade.test.ts` proves the statements against a seeded
 * span in seconds. This proves the two things only the real fixture can answer:
 * that the numbers come out right across the whole ~2-month span with the mid-day
 * counter cliff inside it, and HOW LONG the thing takes — which is what decided
 * that the backfill cannot live in the addon's boot chain.
 *
 * ## Safety
 *
 * This script DROPs its target database. Port 5432 on this host is the
 * developer's dev database, SHARED WITH A LIVE GRID-TIED INVERTER, and port 5433
 * is the addon-1.2.0 fixture container, which is expensive to rebuild and must
 * stay READ-ONLY. Both are refused by {@link assertUpgradeTarget}, in the same
 * spirit as `fixture-1-2-0.ts` and `apps/server/db-tests/harness.ts` pinning
 * theirs.
 *
 * Run `bun scripts/upgrade-rehearsal.ts --help`.
 */
process.env.SKIP_ENV_VALIDATION ??= "1";

import { $, SQL } from "bun";

import { type CounterRow, energyOf } from "../packages/db/src/counter-energy";
import {
  type EnergyRow,
  type GroundTruth,
  type RestartRow,
  type TierName,
  compareEnergy,
  compareRestarts,
  compareTier,
  groundTruthPath,
  readTier,
} from "./fixture-1-2-0";
import {
  classifyProfile,
  hazardProblems,
  spanProblems,
  throughput,
  worstNaiveError,
} from "./replay-rehearsal";

// ---------------------------------------------------------------------------
// Target pinning
// ---------------------------------------------------------------------------

/** The developer's dev database, shared with a live grid-tied inverter. */
export const DEV_DB_PORT = 5432;

/** The addon-1.2.0 fixture container. Expensive to rebuild; READ-ONLY here. */
export const FIXTURE_PORT = 5433;

/** Ports this script may drop databases on. Nothing else. */
export const ALLOWED_PORTS = [5438, 5439, 5440, 5441] as const;

/**
 * Refuse any target that is not a throwaway upgrade-rehearsal port.
 *
 * The dev database gets its own message rather than being lumped in with "not
 * allowed": it is the one mistake here whose consequences a rebuild cannot undo.
 */
export function assertUpgradeTarget(url: string): void {
  const parsed = new URL(url);
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
export function parseArgs(argv: readonly string[]): Options {
  const options = { ...DEFAULT_OPTIONS };
  for (const arg of argv) {
    const eq = arg.indexOf("=");
    if (eq > 0) {
      const apply = VALUES.get(arg.slice(0, eq));
      if (!apply) throw new Error(`unknown argument: ${arg}\n\n${HELP}`);
      apply(options, arg.slice(eq + 1));
      continue;
    }
    const flag = FLAGS.get(arg);
    if (!flag) throw new Error(`unknown argument: ${arg}\n\n${HELP}`);
    flag(options);
  }
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
export function servingProblems(state: ServingState): string[] {
  const problems: string[] = [];
  for (const column of ["device_id", "metric_id", "dur_ms"]) {
    if (!state.rawColumns.includes(column)) {
      problems.push(`metrics_raw has no ${column} column — it is not the 2.0.0 table`);
    }
  }
  if (state.rawColumns.includes("inverter_id")) {
    problems.push("metrics_raw still has inverter_id — the rename did not happen");
  }
  for (const view of ["minute_rollups", "hourly_rollups", "daily_rollups"]) {
    if (!state.aggregates.includes(view)) problems.push(`${view} was not created`);
    if (!state.aggregates.includes(`legacy_${view}`)) {
      problems.push(`legacy_${view} is missing — the 1.2.0 buckets are gone`);
    }
  }
  for (const job of state.jobs) {
    if (/legacy_|metrics_raw_legacy/.test(job)) {
      problems.push(`${job} still runs against a legacy relation — it will eat the history`);
    }
  }
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

// ---------------------------------------------------------------------------
// Runtime. Everything below talks to Docker or Postgres.
// ---------------------------------------------------------------------------

const log = (message: string): void => {
  if (process.env.NODE_ENV !== "test") console.log(`[upgrade] ${message}`);
};

const urlFor = (o: Options, database: string) =>
  `postgres://postgres:${o.password}@localhost:${o.port}/${database}`;

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/** The 1.2.0 dump, restored into a database this script is allowed to drop. */
async function restore(o: Options): Promise<void> {
  const url = urlFor(o, o.database);
  assertUpgradeTarget(url);
  const began = Date.now();
  const psql = (db: string, statement: string) =>
    $`docker exec ${o.container} psql -X -q -v ON_ERROR_STOP=1 -U postgres -p ${o.port} -d ${db} -c ${statement}`.quiet();
  await psql("postgres", `DROP DATABASE IF EXISTS ${o.database} WITH (FORCE)`);
  await psql("postgres", `CREATE DATABASE ${o.database}`);
  // The dump carries TimescaleDB objects, so the extension has to be there and
  // the catalog has to be unlocked around the restore — the documented sequence.
  await psql(o.database, "CREATE EXTENSION IF NOT EXISTS timescaledb");
  await psql(o.database, "SELECT timescaledb_pre_restore()");
  const restored =
    await $`docker exec ${o.container} pg_restore -U postgres -p ${o.port} -d ${o.database} --no-owner ${o.dump}`.nothrow();
  if (restored.exitCode !== 0) {
    throw new Error(`pg_restore failed with exit code ${restored.exitCode}`);
  }
  await psql(o.database, "SELECT timescaledb_post_restore()");
  log(`restored the addon-1.2.0 fixture into ${o.database} in ${seconds(Date.now() - began)}`);
}

/** The catalog, as {@link servingProblems} needs it. */
async function readServingState(db: SQL): Promise<ServingState> {
  const rows = async <T>(query: string): Promise<T[]> => (await db.unsafe(query)) as T[];
  const columns = await rows<{ column_name: string }>(
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'metrics_raw'`,
  );
  const aggregates = await rows<{ view_name: string }>(
    `select view_name from timescaledb_information.continuous_aggregates`,
  );
  const jobs = await rows<{ label: string }>(
    `select proc_name || ':' || coalesce(hypertable_name, '-') as label
       from timescaledb_information.jobs where job_id >= 1000`,
  );
  const relations = await rows<{ name: string }>(
    `select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'm', 'v') and c.relname like '%legacy%'`,
  );
  return {
    rawColumns: columns.map((r) => r.column_name),
    aggregates: aggregates.map((r) => r.view_name),
    jobs: jobs.map((r) => r.label),
    legacyRelations: relations.map((r) => r.name),
  };
}

/** THE BLOCKING STEP, through the shipped migration runner, timed. */
async function blocking(o: Options, truth: GroundTruth): Promise<string[]> {
  const url = urlFor(o, o.database);
  assertUpgradeTarget(url);
  const { runMigrations } = await import("../packages/db/src/migrate");
  const began = Date.now();
  await runMigrations(url);
  const elapsed = Date.now() - began;
  log(`BLOCKING STEP: the whole migration runner took ${seconds(elapsed)}`);
  if (elapsed > 120_000) {
    log(`WARNING: that is over the addon's 120 s Supervisor timeout`);
  }

  const db = new SQL(url, { max: 1, idleTimeout: 0 });
  try {
    const problems = servingProblems(await readServingState(db));
    for (const tier of ["minute_rollups", "hourly_rollups", "daily_rollups"] as const) {
      const after = await readTier(db, tier, `legacy_${tier}`);
      problems.push(...renamePreservedProblems(tier, truth.tiers[tier], after));
      log(`legacy_${tier}: ${after.count.toLocaleString("en-US")} buckets, digest ${after.digest}`);
    }
    const record = await db.unsafe(`select value from app_settings where key = 'migration.v2'`);
    log(`migration record: ${JSON.stringify((record as { value: unknown }[])[0]?.value)}`);
    return problems;
  } finally {
    await db.end();
  }
}

/**
 * The dimension spine an operator supplies per install.
 *
 * Through the shipped `ensurePlant` / `ensureDevice` / `ensureMetricKeys` rather
 * than raw inserts: their upserts are the only thing that guarantees a second
 * boot ADOPTS rather than re-inserting, and `devices.id` is written into every one
 * of five years of readings. The app-layer policy on top of them
 * (`apps/server/src/inverter/provision.ts`, which mines the 1.x `app_settings`
 * blobs for the plant's name, coordinates and battery) cannot be imported from
 * `scripts/` — `scripts` is not a workspace — and is covered by
 * `apps/server/db-tests/upgrade.test.ts`.
 */
async function provision(o: Options): Promise<string[]> {
  const url = urlFor(o, o.database);
  assertUpgradeTarget(url);
  const { createDbAt } = await import("../packages/db/src/index");
  const { ensureDevice, ensurePlant } = await import("../packages/db/src/plant-repo");
  const { ensureMetricKeys } = await import("../packages/db/src/metric-keys");
  const { readMigrationRecord } = await import("../packages/db/src/upgrade-120-run");

  const db = createDbAt(url);
  const store = { execute: (query: Parameters<typeof db.execute>[0]) => db.execute(query) };
  const raw = new SQL(url, { max: 1, idleTimeout: 0 });
  try {
    const record = await readMigrationRecord({
      query: async (text, values) => ({
        rows: (await raw.unsafe(text, values ? [...values] : [])) as unknown[],
      }),
    });
    if (record.sourceId === null) return ["the migration record carries no source id"];

    const { metrics, configKeys } = await classifyProfile();
    const plant = await ensurePlant(store, {
      name: "Rehearsal plant",
      slug: "rehearsal-plant",
      timeZone: "Europe/Berlin",
    });
    const device = await ensureDevice(store, {
      plantId: plant.id,
      connectionId: null,
      unitId: 1,
      // Derived from the ROLE, not the profile id: a profile-derived slug would
      // move the whole MQTT namespace on a profile swap.
      slug: "inverter",
      name: "Rehearsal inverter",
      profileId: record.sourceId,
      role: "inverter",
    });
    const ids = await ensureMetricKeys(store, metrics);
    log(
      `provisioned plant ${plant.id}, device ${device.id} (profile_id ${record.sourceId}), ` +
        `${ids.size} metric keys, ${configKeys.length} of them configuration`,
    );
    return [];
  } finally {
    await raw.end();
  }
}

/** The device the legacy history belongs to, and the profile's classification. */
async function backfillInputs(o: Options, db: SQL) {
  const { readLegacyCadenceMs, readMigrationRecord } =
    await import("../packages/db/src/upgrade-120-run");
  const client = {
    query: async (text: string, values?: readonly unknown[]) => ({
      rows: (await db.unsafe(text, values ? [...values] : [])) as unknown[],
    }),
  };
  const record = await readMigrationRecord(client);
  const rows = (await db.unsafe(
    `select id from devices where profile_id = $1 order by id limit 1`,
    [record.sourceId],
  )) as { id: number }[];
  const deviceId = Number(rows[0]?.id);
  if (!Number.isInteger(deviceId)) {
    throw new Error(`no device names profile ${record.sourceId} — run --phase=provision first`);
  }
  const { configKeys } = await classifyProfile();
  const cadence = await readLegacyCadenceMs(client);
  log(`device ${deviceId}, measured legacy poll cadence ${cadence ?? "unknown"} ms`);
  return { client, record, deviceId, configKeys, cadence };
}

/** THE BACKFILL, resumable, with a real mid-run exit when `--stop-after` says so. */
async function backfill(o: Options): Promise<string[]> {
  const url = urlFor(o, o.database);
  assertUpgradeTarget(url);
  const { chunkLine, runBackfill } = await import("../packages/db/src/backfill");
  const db = new SQL(url, { max: 1, idleTimeout: 0 });
  try {
    const { client, deviceId, configKeys, cadence } = await backfillInputs(o, db);
    let written = 0;
    const began = Date.now();
    const result = await runBackfill(
      client,
      {
        deviceId,
        configKeys,
        rawDurMs: cadence,
        refreshChunkDays: o.refreshChunkDays,
        logger: { log },
      },
      {
        onChunk: (chunk, index, total) => {
          written += 1;
          if (written % 5 === 0 || written === total) log(chunkLine(chunk, index, total));
          if (o.stopAfter > 0 && written >= o.stopAfter) {
            // A REAL exit in the middle of the run, with the connection open and
            // the next chunk unstarted — what a Supervisor timeout or a power cut
            // leaves behind. Nothing is flushed, nothing is tidied.
            log(`--stop-after=${o.stopAfter} reached: exiting mid-run, code 9`);
            process.exit(9);
          }
        },
      },
    );
    if (result === null) {
      log("nothing to backfill: the migration record says it is already done");
      return [];
    }
    const total = result.replayed?.seriesRows ?? 0;
    log(
      `BACKFILL DONE in ${seconds(Date.now() - began)}: ` +
        `${(result.carried?.seriesRows ?? 0).toLocaleString("en-US")} carried raw rows + ` +
        `${total.toLocaleString("en-US")} replayed bucket rows ` +
        `(${throughput(total, result.replayed?.elapsedMs ?? 0)?.toLocaleString("en-US")} rows/s) ` +
        `+ ${result.refreshed} refresh window(s)`,
    );
    return result.replayed && result.replayed.gaps.length > 0
      ? [`${result.replayed.gaps.length} day(s) no legacy tier could answer`]
      : [];
  } finally {
    await db.end();
  }
}

/**
 * Per-metric per-day energy of the REPLAYED series, one counter at a time.
 *
 * One query per counter rather than one for all of them: the fixture's counters
 * are 13 x 86 400 rows and streaming them per metric keeps the peak bounded —
 * the same reason `fixture-1-2-0.ts` reads them that way.
 */
async function replayedEnergy(
  db: SQL,
  deviceId: number,
  counters: readonly string[],
): Promise<{ energy: EnergyRow[]; restarts: RestartRow[] }> {
  const energy: EnergyRow[] = [];
  const restarts: RestartRow[] = [];
  for (const metric of counters) {
    const rows = (await db.unsafe(
      `select r.time, r.value from metrics_raw r
         join metric_keys mk on mk.id = r.metric_id
        where r.device_id = $1 and mk.key = $2 order by r.time`,
      [deviceId, metric],
    )) as CounterRow[];
    const analysed = energyOf(metric, rows);
    energy.push(...analysed.energy);
    restarts.push(...analysed.restarts);
  }
  return { energy, restarts };
}

/** VERIFICATION: the in-database gate, then the committed ground truth. */
async function verify(o: Options, truth: GroundTruth): Promise<string[]> {
  const url = urlFor(o, o.database);
  assertUpgradeTarget(url);
  const { verifyMigration } = await import("../packages/db/src/backfill");
  const db = new SQL(url, { max: 1, idleTimeout: 0 });
  try {
    const { client, deviceId, configKeys } = await backfillInputs(o, db);
    const problems: string[] = [];

    // 1. The gate the runtime uses: every legacy bucket has a new bucket with the
    //    same mean. This is what lets the rollback be deleted.
    const began = Date.now();
    const gate = await verifyMigration(client, deviceId, configKeys, { log });
    log(
      `in-database verification compared ${gate.compared} metric-days in ${seconds(Date.now() - began)}`,
    );
    problems.push(...gate.problems);

    // 2. The change-log is not EMPTY. `verifyMigration` already asserts that no
    //    configuration register leaked into the hypertable; the complement —
    //    that they went somewhere — is only checkable where the profile is known.
    const logged = (await db.unsafe(`select count(*)::bigint as n from metrics_config_log`)) as {
      n: string;
    }[];
    const changes = Number(logged[0]?.n ?? 0);
    log(`config: ${changes.toLocaleString("en-US")} change-log rows for ${configKeys.length} keys`);
    if (configKeys.length > 0 && changes === 0) {
      problems.push("no config change-log rows at all — the config arm wrote nothing");
    }

    // 3. THE ACCEPTANCE BAR: the fixture's own energy differ over the whole span.
    const counters = [...new Set(truth.perMetricPerDayEnergy.map((r) => r.metric))].sort();
    const energyBegan = Date.now();
    const measured = await replayedEnergy(db, deviceId, counters);
    log(
      `energy: ${measured.energy.length} metric-days, ${measured.restarts.length} restarts, ` +
        `read in ${seconds(Date.now() - energyBegan)}`,
    );
    problems.push(...compareEnergy(truth.perMetricPerDayEnergy, measured.energy));
    problems.push(...compareRestarts(truth.restarts, measured.restarts));

    // 4. THE READ PATH reproduces the legacy mean, on a sample.
    problems.push(...(await checkInterpolatedMean(db, deviceId)));

    // 5. The mid-day counter cliff, through the NEW tiers. Naive max-minus-min is
    //    1532x wrong on this day; `delta(counter_agg)` is not.
    problems.push(...(await checkCliff(db, truth, deviceId)));
    return problems;
  } finally {
    await db.end();
  }
}

/**
 * Does the TIME-WEIGHTED read reproduce the legacy bucket's mean?
 *
 * This is the claim `packages/db/src/replay.ts` actually makes — that
 * `time_weight('LOCF', …)` over a replayed interval row reproduces the bucket's
 * mean to the bit — and it is NOT what the in-database gate checks. The gate
 * compares `max_value`, because `average(tw)` over a bucket holding one sample is
 * NULL (a point has no duration) and a replayed bucket holds exactly one row by
 * construction, so a gate built on it would report the mean as missing on a
 * perfectly correct migration. The read path therefore has to use
 * `interpolated_average`, which needs the NEIGHBOURING partials — a window
 * function, which over 5.7 M buckets is a sort nobody wants inside a verification
 * an operator is waiting on.
 *
 * So it is sampled, and it is sampled HERE rather than in the gate: this script
 * has the whole fixture and no time budget.
 */
async function checkInterpolatedMean(db: SQL, deviceId: number): Promise<string[]> {
  const rows = (await db.unsafe(
    `with sample as (
       select m.bucket, m.metric_id, m.max_value,
              interpolated_average(m.tw, m.bucket, interval '1 minute',
                lag(m.tw) over w, lead(m.tw) over w) as interpolated,
              mk.key as metric, b.avg_value as legacy
       from minute_rollups m
       join metric_keys mk on mk.id = m.metric_id
       join legacy_minute_rollups b
         on b.metric = mk.key and b.bucket = m.bucket and b.inverter_id = $2
       where m.device_id = $1
         and m.bucket >= $3::timestamptz and m.bucket < $3::timestamptz + interval '2 hours'
       window w as (partition by m.device_id, m.metric_id order by m.bucket)
     )
     select metric, bucket::text as bucket, interpolated, legacy from sample
     where interpolated is null
        or abs(interpolated - legacy) > 1e-9 * greatest(1, abs(legacy))
     limit 20`,
    [deviceId, "deye-sg05lp3", "2026-07-15T00:00:00Z"],
  )) as { metric: string; bucket: string; interpolated: number | null; legacy: number }[];
  const counted = (await db.unsafe(
    `select count(*)::bigint as n from minute_rollups
      where device_id = $1 and bucket >= $2::timestamptz
        and bucket < $2::timestamptz + interval '2 hours'`,
    [deviceId, "2026-07-15T00:00:00Z"],
  )) as { n: string }[];
  const sampled = Number(counted[0]?.n ?? 0);
  log(
    `interpolated_average reproduced the legacy mean on ${sampled.toLocaleString("en-US")} ` +
      `sampled buckets with ${rows.length} disagreement(s)`,
  );
  if (sampled === 0) return ["the interpolated-mean sample covered no buckets at all"];
  return rows.map(
    (row) =>
      `${row.metric} ${row.bucket}: interpolated_average ${row.interpolated}, ` +
      `legacy mean ${row.legacy}`,
  );
}

/** The reset day and the whole-span rollup, read from the new daily tier. */
async function checkCliff(db: SQL, truth: GroundTruth, deviceId: number): Promise<string[]> {
  const worst = worstNaiveError(truth.perMetricPerDayEnergy);
  if (!worst) return ["the ground truth records no counter reset — the headline case is unseeded"];
  const rows = (await db.unsafe(
    `select d.max_value - d.min_value as naive, delta(d.ctr) as ctr_delta,
            num_resets(d.ctr)::int as resets
       from daily_rollups d join metric_keys mk on mk.id = d.metric_id
      where d.device_id = $1 and mk.key = $2 and d.bucket = $3::timestamptz`,
    [deviceId, worst.metric, `${worst.day}T00:00:00Z`],
  )) as { naive: number; ctr_delta: number; resets: number }[];
  const row = rows[0];
  if (!row) return [`no daily bucket for ${worst.metric} on ${worst.day} after the upgrade`];
  log(
    `${worst.metric} ${worst.day}: truth ${worst.energy.toFixed(3)} kWh, ` +
      `delta(counter_agg) ${row.ctr_delta.toFixed(3)} kWh, naive max-min ${row.naive.toFixed(3)} kWh ` +
      `(${(row.naive / worst.energy).toFixed(0)}x wrong), ${row.resets} reset(s)`,
  );
  const problems = hazardProblems(worst, {
    naive: row.naive,
    ctrDelta: row.ctr_delta,
    resets: row.resets,
  });
  const span = (await db.unsafe(
    `select delta(rollup(d.ctr)) as ctr_delta from daily_rollups d
       join metric_keys mk on mk.id = d.metric_id
      where d.device_id = $1 and mk.key = $2`,
    [deviceId, worst.metric],
  )) as { ctr_delta: number }[];
  const expected = truth.perMetricPerDayEnergy
    .filter((r) => r.metric === worst.metric)
    .reduce((sum, r) => sum + r.energy, 0);
  const measured = span[0]?.ctr_delta ?? 0;
  log(
    `${worst.metric} whole span: delta(rollup(ctr)) ${measured.toFixed(3)} kWh against truth ` +
      `${expected.toFixed(3)} kWh`,
  );
  return [...problems, ...spanProblems(worst.metric, measured, expected)];
}

/** THE DROP: only through a verified record, and the new tiers must still answer. */
async function drop(o: Options): Promise<string[]> {
  const url = urlFor(o, o.database);
  assertUpgradeTarget(url);
  const { mayDropLegacy } = await import("../packages/db/src/upgrade-state");
  const { dropLegacyStatements, readCatalog, readMigrationRecord, writeMigrationRecord } =
    await import("../packages/db/src/upgrade-120-run");
  const { migrationRecordSchema } = await import("../packages/db/src/upgrade-state");
  const db = new SQL(url, { max: 1, idleTimeout: 0 });
  try {
    const client = {
      query: async (text: string, values?: readonly unknown[]) => ({
        rows: (await db.unsafe(text, values ? [...values] : [])) as unknown[],
      }),
    };
    const record = await readMigrationRecord(client);
    if (!mayDropLegacy(record)) {
      return [`refusing to drop the legacy objects at stage "${record.stage}" — verify first`];
    }
    const sizeBefore = await totalSize(db);
    const began = Date.now();
    for (const statement of dropLegacyStatements(await readCatalog(client))) {
      await db.unsafe(statement);
      log(statement);
    }
    await writeMigrationRecord(
      client,
      migrationRecordSchema.parse({ ...record, stage: "dropped" }),
    );
    const sizeAfter = await totalSize(db);
    log(
      `dropped the 1.2.0 objects in ${seconds(Date.now() - began)}: ` +
        `${sizeBefore} -> ${sizeAfter}`,
    );

    // The tiers must still answer AFTER the drop: a hierarchical aggregate over a
    // dropped parent, or a cascade that took more than it was asked to, would
    // show up nowhere else.
    const answered = (await db.unsafe(
      `select count(*)::bigint as n from daily_rollups where ctr is not null`,
    )) as { n: string }[];
    log(`daily_rollups still answers ${Number(answered[0]?.n ?? 0)} buckets after the drop`);
    return Number(answered[0]?.n ?? 0) > 0
      ? []
      : ["daily_rollups answers nothing after the drop — the drop took the new tiers with it"];
  } finally {
    await db.end();
  }
}

const totalSize = async (db: SQL): Promise<string> => {
  const rows = (await db.unsafe(
    `select pg_size_pretty(pg_database_size(current_database())) as size`,
  )) as { size: string }[];
  return rows[0]?.size ?? "?";
};

/** Report the findings, and the exit code they imply. */
export function report(problems: readonly string[]): number {
  if (problems.length === 0) {
    log("PASSED");
    return 0;
  }
  for (const problem of problems.slice(0, 40)) console.error(`  - ${problem}`);
  if (problems.length > 40) console.error(`  … and ${problems.length - 40} more`);
  log(`FAILED with ${problems.length} problem(s)`);
  return 1;
}

export async function main(argv: readonly string[]): Promise<number> {
  let options: Options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error((error as Error).message);
    return 1;
  }
  if (options.help) {
    console.log(HELP);
    return 0;
  }
  try {
    const truth = (await Bun.file(groundTruthPath(options.mode)).json()) as GroundTruth;
    log(
      `ground truth: ${options.mode} fixture, ${truth.fixture.spanDays} days x ` +
        `${truth.fixture.metricCount} metrics at ${truth.fixture.cadenceSeconds}s, ` +
        `${truth.restarts.length} counter restarts`,
    );
    const problems: string[] = [];
    for (const phase of phasesToRun(options.phase)) {
      log(`--- phase: ${phase} ---`);
      if (phase === "restore") await restore(options);
      else if (phase === "blocking") problems.push(...(await blocking(options, truth)));
      else if (phase === "provision") problems.push(...(await provision(options)));
      else if (phase === "backfill") problems.push(...(await backfill(options)));
      else if (phase === "verify") problems.push(...(await verify(options, truth)));
      else if (phase === "drop") problems.push(...(await drop(options)));
      if (problems.length > 0) break;
    }
    return report(problems);
  } catch (error) {
    console.error(error);
    return 1;
  }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
