/**
 * THE BUCKET REPLAY, rehearsed against the real addon-1.2.0 fixture.
 *
 * `packages/db/src/replay.ts` holds the arithmetic and
 * `apps/server/db-tests/replay.test.ts` proves the SQL against a real
 * TimescaleDB with a seeded four-day span. Neither answers the two questions the
 * production upgrade actually turns on:
 *
 *   1. does the replay reproduce the ENERGY the fixture's committed ground truth
 *      records, per metric and per day, across the whole ~2-month span, with the
 *      mid-day counter cliff inside it?
 *   2. HOW LONG does it take, on ~9.1 M buckets — a coffee break or an overnight
 *      job?
 *
 * So this script runs the module against the fixture, compares with the
 * fixture's own differs (`compareTier`, `compareEnergy`, `compareRestarts` in
 * `./fixture-1-2-0.ts` — never a second implementation of "identical"), and
 * prints the throughput.
 *
 * ## What it does, and what it deliberately is NOT
 *
 * It is NOT the in-place 1.2.0 -> 2.0.0 upgrade. That is a later wave, and it
 * owns the hard parts this script skips: renaming 1.2.0's aggregates out of the
 * way of 2.0.0's, re-keying the retained raw window, the journal transition, the
 * downgrade guard. What this script builds is a RIG:
 *
 *   1. a 2.0.0 database, migrated by the shipped runner;
 *   2. 1.2.0's materialized buckets copied into it as PLAIN TABLES
 *      (`legacy_minute_rollups`), which is also the shape `sunreye import` will
 *      hand the same module — one `COPY … BINARY` pipe inside the container, so
 *      9.1 M rows never touch this process;
 *   3. the dimension spine an operator supplies per install: a plant, a device
 *      whose `profile_id` is the 1.2.0 `inverter_id`, and the profile's metric
 *      keys registered through the real `ensureMetricKeys`;
 *   4. `runReplay`, then verification.
 *
 * ## Safety
 *
 * This script DROPs its target databases. Port 5432 on this host is the
 * developer's dev database, SHARED WITH A LIVE GRID-TIED INVERTER, and port 5433
 * is the fixture container, which is expensive to rebuild and must stay
 * read-only. Both are refused by {@link assertRehearsalTarget}, in the same
 * spirit as `fixture-1-2-0.ts` pinning its own target and
 * `apps/server/db-tests/harness.ts` refusing any name but `sunreye_dbtest`.
 *
 * Run `bun scripts/replay-rehearsal.ts --help`.
 */
process.env.SKIP_ENV_VALIDATION ??= "1";

import { $, SQL } from "bun";
import { join } from "node:path";

import { type CounterRow, energyOf } from "../packages/db/src/counter-energy";
import { type BucketTier, bucketToInterval } from "../packages/db/src/replay";
import { bunSqlClient } from "../packages/db/src/replay-run";
import {
  type EnergyRow,
  type GroundTruth,
  type RestartRow,
  type TierName,
  compareEnergy,
  compareRestarts,
  compareTier,
  groundTruthPath,
} from "./fixture-1-2-0";

// ---------------------------------------------------------------------------
// Target pinning
// ---------------------------------------------------------------------------

/** The developer's dev database, shared with a live grid-tied inverter. */
export const DEV_DB_PORT = 5432;

/** The addon-1.2.0 fixture container. Expensive to rebuild; read-only. */
export const FIXTURE_PORT = 5433;

/** Ports this script may drop databases on. Nothing else. */
export const ALLOWED_PORTS = [5434, 5435, 5436, 5437] as const;

/**
 * Refuse any target that is not a throwaway rehearsal port.
 *
 * The dev database is named in its own message rather than lumped in with "not
 * allowed": that is the one mistake with consequences a rebuild cannot undo.
 */
export function assertRehearsalTarget(url: string): void {
  const port = Number(new URL(url).port);
  if (port === DEV_DB_PORT) {
    throw new Error(
      `Refusing to touch port ${DEV_DB_PORT}: that is the dev database, shared with a live ` +
        `inverter, and this script DROPs its target databases.`,
    );
  }
  if (port === FIXTURE_PORT) {
    throw new Error(
      `Refusing to touch port ${FIXTURE_PORT}: that is the addon-1.2.0 fixture container, ` +
        `which is READ-ONLY here — restore its dump into a rehearsal container instead.`,
    );
  }
  if (!ALLOWED_PORTS.includes(port as (typeof ALLOWED_PORTS)[number])) {
    throw new Error(
      `Refusing to touch port ${port || "(implicit)"} — the rehearsal may only run on ` +
        `${ALLOWED_PORTS.join(", ")}, so no ambient DATABASE_URL can ever be the target.`,
    );
  }
  const name = new URL(url).pathname.replace(/^\//, "");
  if (!name.startsWith("sunreye_replay")) {
    throw new Error(
      `Refusing to touch "${name || "(no database)"}" — the rehearsal only builds databases ` +
        `named sunreye_replay*.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type RehearsalMode = "fast" | "full";

/** The tiers a 1.2.0 database can be replayed from. */
export type SourceTier = "minute" | "hourly" | "daily";

export interface RehearsalOptions {
  container: string;
  port: number;
  password: string;
  /** The restored 1.2.0 fixture: the SOURCE of the buckets. Never written to. */
  sourceDb: string;
  /** The 2.0.0 database the replay writes into. Dropped and rebuilt. */
  targetDb: string;
  /** Which committed ground truth to compare against. */
  mode: RehearsalMode;
  /** Which tier to replay from. `minute` is the production answer. */
  tier: SourceTier;
  /** Skip the (slow) hourly/daily materialization and its assertions. */
  skipAggregates: boolean;
  help: boolean;
}

export const DEFAULT_OPTIONS: RehearsalOptions = {
  container: "sunreye-replay-5436",
  port: 5436,
  password: "fixture",
  sourceDb: "sunreye_replay_120",
  targetDb: "sunreye_replay_200",
  mode: "full",
  tier: "minute",
  skipAggregates: false,
  help: false,
};

export const HELP = `replay-rehearsal.ts — run the bucket replay against the real 1.2.0 fixture

  bun scripts/replay-rehearsal.ts [--port=5436] [--container=NAME] [--fast]
                                  [--tier=minute|hourly|daily] [--skip-aggregates]

Expects a THROWAWAY TimescaleDB container (ghcr.io/sunreye/timescaledb:pg17-ts2.28.2,
--network host) already holding a RESTORED addon-1.2.0 fixture in --source-db. Build
one with:

  docker run -d --name sunreye-replay-5436 --network host -e POSTGRES_PASSWORD=fixture \\
    -e PGPORT=5436 ghcr.io/sunreye/timescaledb:pg17-ts2.28.2 -c port=5436
  docker exec sunreye-fixture-120 cat /var/lib/postgresql/fixture-1-2-0.dump > /tmp/f.dump
  docker cp /tmp/f.dump sunreye-replay-5436:/tmp/f.dump
  # create the db, CREATE EXTENSION timescaledb, timescaledb_pre_restore(),
  # pg_restore, timescaledb_post_restore()

Port ${DEV_DB_PORT} (the dev database, shared with a live inverter) and port ${FIXTURE_PORT}
(the fixture container itself) are refused.

What it proves
  * the copied legacy buckets are bit-identical to the committed ground truth
    (same md5 digest, same window, same count) — so the replay reads the real data;
  * per-metric per-day energy after replay equals the ground truth's, compared by
    the fixture's own differ;
  * every counter restart survives, including the mid-day lifetime cliff whose
    naive max-minus-min is 1532x wrong;
  * config registers land in metrics_config_log and NOT in metrics_raw (#150);
  * how fast it goes, in rows/sec and wall clock.
`;

const KNOWN_FLAGS = new Map<string, (o: RehearsalOptions) => void>([
  ["--fast", (o) => (o.mode = "fast")],
  ["--full", (o) => (o.mode = "full")],
  ["--skip-aggregates", (o) => (o.skipAggregates = true)],
  ["--help", (o) => (o.help = true)],
  ["-h", (o) => (o.help = true)],
]);

const VALUE_FLAGS = new Map<string, (o: RehearsalOptions, value: string) => void>([
  ["--container", (o, v) => (o.container = v)],
  ["--port", (o, v) => (o.port = Number(v))],
  ["--password", (o, v) => (o.password = v)],
  ["--source-db", (o, v) => (o.sourceDb = v)],
  ["--target-db", (o, v) => (o.targetDb = v)],
  ["--tier", (o, v) => (o.tier = asTier(v))],
]);

function asTier(value: string): SourceTier {
  if (value === "minute" || value === "hourly" || value === "daily") return value;
  throw new Error(`--tier: ${value} is not one of minute, hourly, daily`);
}

/** Unknown flags are rejected: a typo'd `--fas` must not silently mean full. */
export function parseArgs(argv: readonly string[]): RehearsalOptions {
  const options = { ...DEFAULT_OPTIONS };
  for (const arg of argv) {
    const eq = arg.indexOf("=");
    if (eq > 0) {
      const apply = VALUE_FLAGS.get(arg.slice(0, eq));
      if (!apply) throw new Error(`unknown argument: ${arg}\n\n${HELP}`);
      apply(options, arg.slice(eq + 1));
      continue;
    }
    const flag = KNOWN_FLAGS.get(arg);
    if (!flag) throw new Error(`unknown argument: ${arg}\n\n${HELP}`);
    flag(options);
  }
  if (!Number.isInteger(options.port)) throw new Error(`--port: not an integer`);
  return options;
}

/**
 * The one thing this script needs from a database connection.
 *
 * Structural rather than bun's `SQL`, so the verification steps below — which are
 * arithmetic wearing a query — can be driven by a double in
 * `./replay-rehearsal.test.ts`. The parts that genuinely need Docker (bringing a
 * container up, the `COPY … BINARY` pipe) are proved by running the script.
 */
export interface UnsafeSql {
  unsafe(query: string, values?: unknown[]): Promise<unknown>;
}

/** The 1.2.0 relation each tier's buckets are copied FROM, and copied INTO. */
export const LEGACY_RELATION: Record<SourceTier, string> = {
  minute: "legacy_minute_rollups",
  hourly: "legacy_hourly_rollups",
  daily: "legacy_daily_rollups",
};

export const TIER_OF: Record<SourceTier, TierName> = {
  minute: "minute_rollups",
  hourly: "hourly_rollups",
  daily: "daily_rollups",
};

/**
 * The metric-day with the largest naive error, i.e. the counter reset that hurts
 * most. `undefined` when the ground truth records no reset at all, which is
 * itself a finding: the headline case would be unseeded.
 */
export function worstNaiveError(rows: readonly EnergyRow[]): EnergyRow | undefined {
  return rows
    .filter((row) => row.resets > 0 && row.energy > 0)
    .sort((a, b) => b.naive / b.energy - a.naive / a.energy)[0];
}

/** What a day bucket measured after replay, for the reset day. */
export interface DayMeasurement {
  /** `max_value - min_value`: what a bucket of avg/max/min can express. */
  naive: number;
  /** `delta(counter_agg)`: what the 2.0.0 tier answers. */
  ctrDelta: number;
  resets: number;
}

/**
 * Everything wrong with a replayed reset day, or nothing.
 *
 * Three separate claims, and they fail for different reasons:
 *
 *  * the NAIVE number must be reproduced EXACTLY. It is the fingerprint of the
 *    original series: if a replay smoothed, clamped or re-based a counter, this
 *    is where it shows, and it would show nowhere else.
 *  * `delta(counter_agg)` must land within ONE SAMPLE of the truth. Not within an
 *    epsilon: a day bucket's `delta` cannot see the increment earned between
 *    23:59 and 00:00, which the ground truth attributes to the LATER day. That is
 *    an attribution difference at the boundary, not a loss — {@link spanProblems}
 *    is the exact check.
 *  * the reset must still be COUNTED. A replay that dropped the cliff would look
 *    perfect on both numbers above and have destroyed the one fact the release
 *    exists to preserve.
 */
export function hazardProblems(truth: EnergyRow, measured: DayMeasurement): string[] {
  const problems: string[] = [];
  const label = `${truth.metric} ${truth.day}`;
  if (Math.abs(measured.naive - truth.naive) > 1e-6 * Math.max(1, Math.abs(truth.naive))) {
    problems.push(
      `${label}: naive max-min ${measured.naive} after replay, ${truth.naive} in the ` +
        `ground truth — the replayed series is not the fixture's`,
    );
  }
  const oneStep = Math.abs(truth.energy) / 1440;
  if (Math.abs(measured.ctrDelta - truth.energy) > oneStep * 1.5) {
    problems.push(
      `${label}: delta(counter_agg) ${measured.ctrDelta} against truth ${truth.energy} — ` +
        `further than one sample step apart`,
    );
  }
  if (measured.resets !== truth.resets) {
    problems.push(`${label}: ${measured.resets} resets after replay, ${truth.resets} in truth`);
  }
  return problems;
}

/**
 * The whole-span energy check, and it is EXACT.
 *
 * `delta(rollup(ctr))` recombines every daily partial into one `counter_agg` over
 * every replayed sample, so the boundary attribution that makes a single day
 * approximate cancels out. If this drifts, energy was genuinely lost or invented.
 */
export function spanProblems(metric: string, measured: number, expected: number): string[] {
  if (Math.abs(measured - expected) <= 1e-6 * Math.max(1, Math.abs(expected))) return [];
  return [
    `${metric}: whole-span delta ${measured} against ${expected} — energy was lost or invented`,
  ];
}

/** A second run over a finished source must write nothing whatsoever. */
export function noOpProblems(again: { chunks: unknown[]; seriesRows: number }): string[] {
  if (again.chunks.length === 0 && again.seriesRows === 0) return [];
  return [`re-run was not a no-op: ${again.chunks.length} chunks, ${again.seriesRows} rows`];
}

/**
 * Config registers must not have reached the hypertable — the by-product that
 * closes issue #150, and the one that a prefix-matching implementation would get
 * subtly wrong on the next vendor's profile.
 */
export function configProblems(rowsInRaw: number): string[] {
  if (rowsInRaw === 0) return [];
  return [`${rowsInRaw} config rows reached metrics_raw — they belong in metrics_config_log`];
}

/** One source bucket beside the row the replay wrote for it. */
export interface SamplePair {
  bucket: Date | string;
  avgValue: number | null;
  time: Date | string;
  value: number;
  durMs: number | null;
}

/**
 * Does each replayed row say exactly what the bucket->interval mapping says it
 * should?
 *
 * This is the one check that compares the SQL against the ARITHMETIC rather than
 * against another query: `bucketToInterval` is the reference implementation of
 * the mapping (`packages/db/src/replay.ts`), unit-tested without a database, and
 * here it is run over real fixture buckets and the real rows the
 * `INSERT … SELECT` produced from them. A `time_bucket` off-by-one-width, a
 * `dur_ms` carrying the wrong tier's width or a column swapped for `max_value`
 * would all pass every energy check above and fail here.
 */
export function sampleProblems(tier: BucketTier, pairs: readonly SamplePair[]): string[] {
  if (pairs.length === 0) return ["sample check: no bucket/row pairs to compare"];
  const problems: string[] = [];
  for (const pair of pairs) {
    const expected = bucketToInterval(tier, { bucket: pair.bucket, avgValue: pair.avgValue });
    if (!expected) {
      problems.push(`sample ${String(pair.bucket)}: the bucket carries no mean, yet a row exists`);
      continue;
    }
    const time = new Date(pair.time).getTime();
    if (time !== expected.time.getTime()) {
      problems.push(
        `sample ${String(pair.bucket)}: row stamped ${new Date(time).toISOString()}, ` +
          `the mapping says ${expected.time.toISOString()}`,
      );
    }
    if (pair.value !== expected.value) {
      problems.push(
        `sample ${String(pair.bucket)}: row value ${pair.value}, the mapping says ${expected.value}`,
      );
    }
    if (pair.durMs !== expected.durMs) {
      problems.push(
        `sample ${String(pair.bucket)}: dur_ms ${pair.durMs}, the mapping says ${expected.durMs}`,
      );
    }
  }
  return problems;
}

/**
 * Rows per second, or `null` when no time passed — a metric a later wave sizes
 * its chunking from, so it is computed in one place and never eyeballed from a
 * log line.
 */
export function throughput(rows: number, elapsedMs: number): number | null {
  if (elapsedMs <= 0) return null;
  return Math.round((rows / elapsedMs) * 1000);
}

// ---------------------------------------------------------------------------
// Runtime. Everything below talks to Docker or Postgres, so it is proved by
// running it; every piece of arithmetic it leans on is tested above this line or
// in packages/db.
// ---------------------------------------------------------------------------

const REPO_ROOT = join(import.meta.dir, "..");
const PROFILE_FILE = "packages/profile-sdk/src/__fixtures__/sample-profile.json";

/**
 * Progress lines, silent under the test runner.
 *
 * The verification steps below are driven by a double in
 * `./replay-rehearsal.test.ts`, and a script whose progress log is the operator's
 * only feedback would otherwise put forty lines of it into `bun run test`.
 */
const log = (message: string) => {
  if (process.env.NODE_ENV !== "test") console.log(`[rehearsal] ${message}`);
};

const urlFor = (o: RehearsalOptions, database: string) =>
  `postgres://postgres:${o.password}@localhost:${o.port}/${database}`;

/**
 * The 1.2.0 bucket columns, in order, written ONCE.
 *
 * The order is load-bearing and the single list is the reason: `COPY … BINARY`
 * matches columns by POSITION, never by name. A column added to the `CREATE
 * TABLE` and not to the `COPY (select …)` — or reordered in one of them — would
 * not fail the copy. It would write `min_value` into `max_value`, and every
 * energy check downstream would still pass, because the mean is the only column
 * the replay reads.
 */
export const LEGACY_COLUMNS = [
  { name: "bucket", type: "timestamptz not null" },
  { name: "inverter_id", type: "text not null" },
  { name: "metric", type: "text not null" },
  { name: "avg_value", type: "double precision" },
  { name: "max_value", type: "double precision" },
  { name: "min_value", type: "double precision" },
] as const;

/** The plain table one tier's buckets are copied into. */
export function legacyTableDdl(tier: SourceTier): string {
  const columns = LEGACY_COLUMNS.map((c) => `      ${c.name} ${c.type}`).join(",\n");
  return `create table ${LEGACY_RELATION[tier]} (\n${columns}\n    )`;
}

/**
 * The two halves of the tier copy's binary pipe.
 *
 * `COPY … TO STDOUT BINARY` out of the 1.2.0 aggregate, `COPY … FROM STDIN
 * BINARY` into the plain relation — the direction is the decision, and swapping
 * it would overwrite the fixture. Kept out here, as text, so it is provable
 * without Docker.
 */
export function copyStatements(tier: SourceTier): { from: string; to: string } {
  const names = LEGACY_COLUMNS.map((c) => c.name).join(", ");
  return {
    from: `COPY (select ${names} from ${TIER_OF[tier]}) TO STDOUT BINARY`,
    to: `COPY ${LEGACY_RELATION[tier]} FROM STDIN BINARY`,
  };
}

/** One tier copy: the container it runs in, and the two statements it pipes. */
export interface DockerCopy {
  container: string;
  /** The port BOTH databases listen on — one container, two databases. */
  port: number;
  from: { db: string; statement: string };
  to: { db: string; statement: string };
}

/**
 * The rig's side effects, injected — with the production wiring as the default,
 * so every caller passes nothing and the script behaves exactly as before.
 *
 * The same shape as the `FixtureIo` seam in `./fixture-1-2-0.ts` and the
 * `FloorIo` one in `./coverage-floor.ts`, and for the same reason: what a
 * `docker exec` DOES cannot be proved by a unit test — only by running the
 * rehearsal against the real fixture, which is how it was proved. Which
 * statement runs WHEN, in what order, and against which database is a decision,
 * and every one of those is proved against a double.
 */
export interface RehearsalIo {
  /** A pool for the target, held open across the whole verification pass. */
  connect(url: string): UnsafeSql & { end(): Promise<void> };
  /**
   * A pool for a handful of statements, closed immediately. Separate from
   * {@link connect} because it must NOT disable the idle timeout: these are the
   * maintenance connection that drops the target and the two bookends of the
   * copy, and an idle one of those is what makes the next run's DROP hang.
   */
  connectBriefly(url: string): UnsafeSql & { end(): Promise<void> };
  /** Apply the 2.0.0 schema with the shipped migration runner. */
  migrate(url: string): Promise<void>;
  /** The one shell command the rehearsal runs. */
  copyBinary(command: DockerCopy): Promise<void>;
  /** The committed ground truth for `mode`. */
  readGroundTruth(mode: RehearsalMode): Promise<GroundTruth>;
  log(message: string): void;
  error(message: string): void;
}

/**
 * The real wiring. The single shell command in this script lives here and
 * nowhere else, exactly as it was written: both `psql` processes run INSIDE the
 * container, so 9.1 M rows never cross this process and no float ever
 * round-trips through text.
 */
export const productionIo: RehearsalIo = {
  connect: (url) => new SQL(url, { max: 1, idleTimeout: 0 }),
  connectBriefly: (url) => new SQL(url, { max: 1 }),
  migrate: async (url) => {
    const { runMigrations } = await import("../packages/db/src/migrate");
    await runMigrations(url);
  },
  async copyBinary({ container, port, from, to }) {
    const psql = (db: string, statement: string) =>
      `psql -X -q -U postgres -p ${port} -d ${db} -c ${JSON.stringify(statement)}`;
    await $`docker exec ${container} sh -c ${
      `${psql(from.db, from.statement)}` + ` | ${psql(to.db, to.statement)}`
    }`.quiet();
  },
  readGroundTruth: (mode) => Bun.file(groundTruthPath(mode)).json() as Promise<GroundTruth>,
  log,
  error: (message) => console.error(message),
};

/** Recreate the 2.0.0 target. This is what makes a re-run a reset. */
export async function recreateTarget(
  o: RehearsalOptions,
  io: RehearsalIo = productionIo,
): Promise<string> {
  const url = urlFor(o, o.targetDb);
  assertRehearsalTarget(url);
  const admin = io.connectBriefly(urlFor(o, "postgres"));
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${o.targetDb} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${o.targetDb}`);
  } finally {
    await admin.end();
  }
  io.log(`recreated ${o.targetDb} (2.0.0 target)`);
  return url;
}

/**
 * Copy one tier's materialized buckets from the 1.2.0 database into a plain table
 * in the 2.0.0 database.
 *
 * `COPY … TO STDOUT BINARY` piped into `COPY … FROM STDIN BINARY`, both inside the
 * container: 9.1 M rows stay on the server, and no float ever round-trips through
 * text. A `CREATE TABLE AS` cannot be used because the two databases are
 * different databases, which is also exactly the shape an import has.
 */
export async function copyLegacyTier(
  o: RehearsalOptions,
  tier: SourceTier,
  io: RehearsalIo = productionIo,
): Promise<number> {
  const relation = LEGACY_RELATION[tier];
  const target = io.connectBriefly(urlFor(o, o.targetDb));
  try {
    await target.unsafe(`drop table if exists ${relation}`);
    await target.unsafe(legacyTableDdl(tier));
  } finally {
    await target.end();
  }
  const source = TIER_OF[tier];
  const began = Date.now();
  const statements = copyStatements(tier);
  await io.copyBinary({
    container: o.container,
    port: o.port,
    from: { db: o.sourceDb, statement: statements.from },
    to: { db: o.targetDb, statement: statements.to },
  });
  const check = io.connectBriefly(urlFor(o, o.targetDb));
  try {
    const rows = (await check.unsafe(`select count(*)::bigint as n from ${relation}`)) as {
      n: string;
    }[];
    const copied = Number(rows[0]?.n ?? 0);
    io.log(
      `copied ${copied.toLocaleString("en-US")} ${source} buckets into ${relation} in ` +
        `${((Date.now() - began) / 1000).toFixed(1)}s`,
    );
    // Indexed AFTER the copy, and it matters: the replay reads one day of one
    // inverter at a time, and a sequential scan of 9.1 M rows per chunk would
    // dominate every measurement this script exists to take.
    await check.unsafe(`create index on ${relation} (inverter_id, bucket)`);
    return copied;
  } finally {
    await check.end();
  }
}

interface ProfileMetricDef {
  key: string;
  unit?: string | null;
  kind?: string;
  storage?: string;
  access?: string;
  role?: string;
}

/**
 * The profile's own answer to "where does this metric go" and "is it a counter".
 *
 * `resolveStorage` and `statedKind`, never a `settings.%` prefix match — the one
 * design constraint issue #150 names, because a prefix list is one vendor's
 * naming and silently stops applying on the next.
 */
export async function classifyProfile(): Promise<{
  metrics: { key: string; isCounter: boolean }[];
  configKeys: string[];
  inverterId: string;
}> {
  const { resolveStorage, statedKind } = await import("@SunReye/inverter-core");
  const profile = (await Bun.file(join(REPO_ROOT, PROFILE_FILE)).json()) as {
    id: string;
    metrics: ProfileMetricDef[];
  };
  const metrics = profile.metrics.map((m) => ({
    key: m.key,
    isCounter: statedKind(m as never) === "cumulative",
  }));
  const configKeys = profile.metrics
    .filter((m) => resolveStorage(m as never) === "config")
    .map((m) => m.key);
  return { metrics, configKeys, inverterId: profile.id };
}

/**
 * The dimension spine an operator supplies per install: a plant, one device whose
 * `profile_id` is the 1.2.0 `inverter_id`, and every metric key registered.
 *
 * Registration goes through the shipped `ensureMetricKeys` — reached from this
 * script's own connection via `metricKeyWriter` — because its
 * `ON CONFLICT (key) DO UPDATE` is the only thing that guarantees a reinstall
 * REUSES ids rather than renumbering them.
 *
 * `scripts/` is not a workspace, so the packages are imported by path: the root
 * `node_modules` links only what the ROOT depends on, and neither
 * `@SunReye/db` nor `drizzle-orm` resolves from here.
 */
export async function seedDimensions(
  db: UnsafeSql,
  inverterId: string,
  metrics: { key: string; isCounter: boolean }[],
): Promise<number> {
  const { ensureMetricKeys } = await import("../packages/db/src/metric-keys");
  const { metricKeyWriter } = await import("../packages/db/src/replay-run");
  await db.unsafe(
    `insert into plants (name, slug, time_zone) values ('Rehearsal', 'rehearsal', 'Europe/Berlin')`,
  );
  const device = (await db.unsafe(
    `insert into devices (plant_id, connection_id, unit_id, slug, name, profile_id, role)
     select id, null, 1, 'rehearsal-inverter', 'Rehearsal inverter', $1, 'inverter'
     from plants where slug = 'rehearsal' returning id`,
    [inverterId],
  )) as { id: number }[];
  const deviceId = Number(device[0]?.id);
  const ids = await ensureMetricKeys(metricKeyWriter(bunSqlClient(db)), metrics);
  log(`seeded 1 plant, 1 device (id ${deviceId}) and ${ids.size} metric keys`);
  return deviceId;
}

/**
 * Per-metric per-day energy of the REPLAYED series, one metric at a time.
 *
 * One query per counter rather than one for all of them: the fixture's counters
 * are 13 x 86 400 rows, and streaming them per metric keeps the peak in this
 * process bounded — the same reason `fixture-1-2-0.ts` reads them that way.
 *
 * `deviceId` of `null` means EVERY device, which is what an archive round trip
 * needs: it imports into an empty database whose device ids it did not choose.
 * The rehearsal always names one, because its target also holds the rows the
 * blocking upgrade carried across and mixing the two would compare a sum against
 * one of its terms.
 *
 * Shared with `./archive-round-trip.ts` rather than copied: a second
 * implementation would be comparing a migration against a copy of its own bug,
 * which is the same reason `energyOf` itself is imported rather than rewritten.
 */
export async function replayedEnergy(
  db: UnsafeSql,
  deviceId: number | null,
  counters: readonly string[],
): Promise<{ energy: EnergyRow[]; restarts: RestartRow[] }> {
  const energy: EnergyRow[] = [];
  const restarts: RestartRow[] = [];
  const scope = deviceId === null ? "" : "and r.device_id = $2";
  for (const metric of counters) {
    const rows = (await db.unsafe(
      `select r.time, r.value from metrics_raw r
       join metric_keys mk on mk.id = r.metric_id
       where mk.key = $1 ${scope} order by r.time`,
      deviceId === null ? [metric] : [metric, deviceId],
    )) as CounterRow[];
    const analysed = energyOf(metric, rows);
    energy.push(...analysed.energy);
    restarts.push(...analysed.restarts);
  }
  return { energy, restarts };
}

/** Everything the verification steps need, once the replay has run. */
export interface Replayed {
  target: UnsafeSql;
  options: RehearsalOptions;
  truth: GroundTruth;
  deviceId: number;
  inverterId: string;
  configKeys: readonly string[];
}

/** Is the source we are about to replay the real fixture's data, bit for bit? */
export async function verifySource(
  target: UnsafeSql,
  options: RehearsalOptions,
  truth: GroundTruth,
): Promise<string[]> {
  // The digest query that produced the committed number, so "identical" has one
  // definition rather than two.
  const { readTier } = await import("./fixture-1-2-0");
  const tierName = TIER_OF[options.tier];
  // `readTier` is typed against bun's concrete `SQL`; it only ever calls
  // `unsafe`, which is what {@link UnsafeSql} promises.
  const copied = await readTier(target as never, tierName, LEGACY_RELATION[options.tier]);
  const problems = compareTier(tierName, truth.tiers[tierName], copied);
  log(
    problems.length === 0
      ? `source verified: ${copied.count.toLocaleString("en-US")} buckets, digest ${copied.digest}`
      : "SOURCE MISMATCH — the copy is not the fixture's data",
  );
  return problems;
}

/** Config registers left the hypertable, and landed in the change-log (#150). */
export async function verifyConfigRouting(replayed: Replayed): Promise<string[]> {
  const { target, configKeys } = replayed;
  // Placeholders rather than `= any($1::text[])`: bun's `SQL.unsafe` binds a JS
  // array as a scalar, and Postgres answers `malformed array literal`.
  const keyList = configKeys.map((_, i) => `$${i + 1}`).join(", ");
  const inRaw = (await target.unsafe(
    `select count(*)::bigint as n from metrics_raw r join metric_keys mk on mk.id = r.metric_id
     where mk.key in (${keyList})`,
    [...configKeys],
  )) as { n: string }[];
  const logged = (await target.unsafe(`select count(*)::bigint as n from metrics_config_log`)) as {
    n: string;
  }[];
  const reached = Number(inRaw[0]?.n ?? 0);
  log(
    `config: ${Number(logged[0]?.n ?? 0)} change-log rows, ${reached} in metrics_raw (must be 0)`,
  );
  return configProblems(reached);
}

/** THE ACCEPTANCE BAR: the energy, compared by the fixture's own differ. */
export async function verifyEnergy(replayed: Replayed): Promise<string[]> {
  const { target, truth, deviceId } = replayed;
  const counters = [...new Set(truth.perMetricPerDayEnergy.map((row) => row.metric))].sort();
  const began = Date.now();
  const measured = await replayedEnergy(target, deviceId, counters);
  log(
    `energy compared: ${measured.energy.length} metric-days, ${measured.restarts.length} ` +
      `restarts, in ${((Date.now() - began) / 1000).toFixed(1)}s`,
  );
  return [
    ...compareEnergy(truth.perMetricPerDayEnergy, measured.energy),
    ...compareRestarts(truth.restarts, measured.restarts),
  ];
}

/** Real buckets against the reference bucket->interval mapping. */
export async function verifySampledRows(replayed: Replayed): Promise<string[]> {
  const { target, options, truth, deviceId, inverterId } = replayed;
  const metric = [...new Set(truth.perMetricPerDayEnergy.map((row) => row.metric))].sort()[0] ?? "";
  const pairs = (await target.unsafe(
    `select b.bucket, b.avg_value as "avgValue", r.time, r.value, r.dur_ms as "durMs"
     from ${LEGACY_RELATION[options.tier]} b
     join metric_keys mk on mk.key = b.metric
     join metrics_raw r on r.device_id = $1 and r.metric_id = mk.id and r.time = b.bucket
     where b.inverter_id = $2 and b.metric = $3
     order by b.bucket
     limit 500`,
    [deviceId, inverterId, metric],
  )) as SamplePair[];
  log(`sampled ${pairs.length} bucket/row pairs of ${metric} against the mapping`);
  return sampleProblems(options.tier, pairs);
}

/** The replay, with a progress line per chunk and the throughput at the end. */
export async function replay(
  client: ReturnType<typeof bunSqlClient>,
  options: RehearsalOptions,
  identity: { sourceId: string; deviceId: number },
  configKeys: readonly string[],
): Promise<string[]> {
  const { runReplay } = await import("../packages/db/src/replay-run");
  const req = {
    source: `legacy-1.2.0-${options.tier}`,
    relations: { [options.tier]: LEGACY_RELATION[options.tier] },
    identity,
    configKeys,
  };
  const began = Date.now();
  const result = await runReplay(client, req, {
    onChunk: (chunk, index, total) =>
      log(
        `chunk ${index + 1}/${total} ${chunk.start.toISOString().slice(0, 10)} ` +
          `${chunk.tier}: ${chunk.seriesRows.toLocaleString("en-US")} series + ` +
          `${chunk.configRows} config in ${(chunk.elapsedMs / 1000).toFixed(1)}s ` +
          `(${throughput(chunk.seriesRows, chunk.elapsedMs)?.toLocaleString("en-US")} rows/s)`,
      ),
  });
  const wall = Date.now() - began;
  log(
    `REPLAY DONE: ${result.seriesRows.toLocaleString("en-US")} series rows + ` +
      `${result.configRows} config rows across ${result.chunks.length} chunks in ` +
      `${(wall / 1000).toFixed(1)}s = ` +
      `${throughput(result.seriesRows, wall)?.toLocaleString("en-US")} rows/s`,
  );

  // A second run over a finished source must write nothing whatsoever.
  const again = await runReplay(client, req);
  log(`re-run replayed ${again.seriesRows} rows and skipped ${again.skipped} completed chunks`);

  return [
    ...(result.gaps.length > 0 ? [`${result.gaps.length} day(s) no tier could answer`] : []),
    ...noOpProblems(again),
  ];
}

/** The rig, then the replay, then every verification. Returns the findings. */
export async function rehearse(
  options: RehearsalOptions,
  io: RehearsalIo = productionIo,
): Promise<string[]> {
  const truth = await io.readGroundTruth(options.mode);
  io.log(
    `ground truth: ${options.mode} fixture, ${truth.fixture.spanDays} days x ` +
      `${truth.fixture.metricCount} metrics, ${truth.restarts.length} counter restarts`,
  );

  const targetUrl = await recreateTarget(options, io);
  await io.migrate(targetUrl);
  io.log("applied the 2.0.0 schema with the shipped migration runner");
  await copyLegacyTier(options, options.tier, io);

  const target = io.connect(targetUrl);
  try {
    const problems = await verifySource(target, options, truth);
    const { metrics, configKeys, inverterId } = await classifyProfile();
    const deviceId = await seedDimensions(target, inverterId, metrics);
    io.log(`${configKeys.length} of ${metrics.length} metrics are configuration by profile`);

    problems.push(
      ...(await replay(
        bunSqlClient(target),
        options,
        { sourceId: inverterId, deviceId },
        configKeys,
      )),
    );

    const replayed: Replayed = { target, options, truth, deviceId, inverterId, configKeys };
    problems.push(...(await verifyConfigRouting(replayed)));
    problems.push(...(await verifyEnergy(replayed)));
    problems.push(...(await verifySampledRows(replayed)));
    if (!options.skipAggregates) {
      problems.push(...(await checkAggregates(target, truth, deviceId)));
    }
    return problems;
  } finally {
    await target.end();
  }
}

/** Report the findings, and return the exit code they imply. */
export function report(problems: readonly string[], io: RehearsalIo = productionIo): number {
  if (problems.length === 0) {
    io.log("rehearsal PASSED: the replay reproduces the fixture's energy, per metric and per day.");
    return 0;
  }
  for (const problem of problems.slice(0, 40)) io.error(`  - ${problem}`);
  if (problems.length > 40) io.error(`  … and ${problems.length - 40} more`);
  io.log(`FAILED with ${problems.length} problem(s)`);
  return 1;
}

/** Parse, run, report. Throws; turning that into an exit code is {@link cli}. */
export async function main(
  argv: readonly string[],
  io: RehearsalIo = productionIo,
): Promise<number> {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(HELP);
    return 0;
  }
  return report(await rehearse(options, io), io);
}

/**
 * The entry point's body, extracted so the failure path is provable: a bad flag
 * or a refused target must exit 1 with its own message, never a stack trace.
 */
export async function cli(
  argv: readonly string[],
  io: RehearsalIo = productionIo,
): Promise<number> {
  try {
    return await main(argv, io);
  } catch (error) {
    io.error((error as Error).message);
    return 1;
  }
}

/**
 * Materialize 2.0.0's own tiers over the replayed rows and check the one number
 * the whole release turns on.
 *
 * Parent before child, and BOUNDED: `refresh_continuous_aggregate(x, NULL, NULL)`
 * advances the watermark past everything and makes a real-time-aggregation bug
 * unable to fail.
 */
export async function checkAggregates(
  db: UnsafeSql,
  truth: GroundTruth,
  deviceId: number,
): Promise<string[]> {
  const problems: string[] = [];
  const from = truth.tiers.minute_rollups.minBucket;
  const to = truth.tiers.minute_rollups.maxBucket;
  if (!from || !to) return ["ground truth has no minute-tier window"];
  const began = Date.now();
  for (const tier of ["hourly_rollups", "daily_rollups"] as const) {
    const each = Date.now();
    await db.unsafe(
      `call refresh_continuous_aggregate('${tier}', $1::timestamptz - interval '1 day',
                                          $2::timestamptz + interval '1 day')`,
      [from, to],
    );
    log(
      `materialized ${tier} over the replayed span in ${((Date.now() - each) / 1000).toFixed(1)}s`,
    );
  }
  log(`aggregates materialized in ${((Date.now() - began) / 1000).toFixed(1)}s total`);

  // The worst naive error the fixture records — the mid-day lifetime cliff.
  const worst = worstNaiveError(truth.perMetricPerDayEnergy);
  if (!worst) return ["ground truth records no counter reset — nothing to check"];
  const rows = (await db.unsafe(
    `select d.max_value - d.min_value as naive, delta(d.ctr) as ctr_delta,
            num_resets(d.ctr)::int as resets
     from daily_rollups d join metric_keys mk on mk.id = d.metric_id
     where d.device_id = $1 and mk.key = $2 and d.bucket = $3::timestamptz`,
    [deviceId, worst.metric, `${worst.day}T00:00:00Z`],
  )) as { naive: number; ctr_delta: number; resets: number }[];
  const row = rows[0];
  if (!row) return [`no daily bucket for ${worst.metric} on ${worst.day} after replay`];
  log(
    `${worst.metric} ${worst.day}: truth ${worst.energy.toFixed(3)} kWh, ` +
      `delta(counter_agg) ${row.ctr_delta.toFixed(3)} kWh, naive max-min ${row.naive.toFixed(3)} kWh ` +
      `(${(row.naive / worst.energy).toFixed(0)}x wrong), ${row.resets} reset(s)`,
  );
  problems.push(
    ...hazardProblems(worst, { naive: row.naive, ctrDelta: row.ctr_delta, resets: row.resets }),
  );

  const span = (await db.unsafe(
    `select delta(rollup(d.ctr)) as ctr_delta from daily_rollups d
     join metric_keys mk on mk.id = d.metric_id
     where d.device_id = $1 and mk.key = $2
       and d.bucket >= $3::timestamptz and d.bucket <= $4::timestamptz`,
    [deviceId, worst.metric, from, to],
  )) as { ctr_delta: number }[];
  const total = truth.perMetricPerDayEnergy
    .filter((r) => r.metric === worst.metric)
    .reduce((sum, r) => sum + r.energy, 0);
  const measured = span[0]?.ctr_delta ?? 0;
  log(
    `${worst.metric} whole span: delta(rollup(ctr)) ${measured.toFixed(3)} kWh against truth ` +
      `${total.toFixed(3)} kWh`,
  );
  problems.push(...spanProblems(worst.metric, measured, total));
  return problems;
}

if (import.meta.main) process.exit(await cli(process.argv.slice(2)));
