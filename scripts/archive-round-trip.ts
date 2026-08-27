/**
 * THE ROUND TRIP, against the real addon-1.2.0 fixture.
 *
 * `packages/db/src/archive*.test.ts` prove the format and every decision that can
 * be made without a database. None of that proves the thing this feature is
 * actually judged on:
 *
 *   a 1.2.0 database, exported to a file, imported into an EMPTY 2.0.0
 *   database, still reports the same kWh per metric per day as the committed
 *   ground truth — including on the day a lifetime counter loses its total
 *   mid-afternoon, where the naive max-minus-min figure is wrong by 1532x.
 *
 * So this script does exactly that, end to end, and reports the numbers that
 * decide whether the feature is usable on a 2 GB Home Assistant box: the archive
 * size for the real ~2-month span, the export and import wall clock, and the
 * compression ratio.
 *
 * ## What is reused rather than reimplemented
 *
 *  * the per-day energy arithmetic: `packages/db/src/counter-energy.ts`'s
 *    `energyOf`, the same unit-tested function that wrote the committed ground
 *    truth. A second implementation here would be comparing a migration against
 *    a copy of its own bug.
 *  * the comparison: `compareEnergy` / `compareRestarts` / `compareTier` from
 *    `./fixture-1-2-0.ts` and `compareStreamCounts` from `./db-parity.ts`.
 *  * the fixture's own notion of which metrics are counters: `assignShapes`.
 *
 * ## Target pinning
 *
 * Port 5432 is the developer's dev database, SHARED WITH A LIVE GRID-TIED
 * INVERTER. Port 5433 is the shared 1.2.0 fixture container, which is expensive
 * to rebuild and must stay read-only. Both are refused, in the same spirit as
 * `fixture-1-2-0.ts` and `replay-rehearsal.ts` pinning theirs.
 *
 * ## The IO seam
 *
 * Every database connection, every file and every line of output goes through
 * {@link RoundTripIo}, defaulted to {@link productionIo} as a parameter so no
 * call site changes — the same shape `./replay-rehearsal.ts` (`RehearsalIo`) and
 * `./fixture-1-2-0.ts` (`FixtureIo`) already use. What the seam buys is that the
 * ORDER of the phases, the refusals, the arithmetic in the report and the exit
 * code are provable without a Postgres, while what a real `COPY` or a real
 * `counter_agg` does stays provable only by running it — which is what this
 * script is for.
 *
 * Run `bun scripts/archive-round-trip.ts --help`.
 */
process.env.SKIP_ENV_VALIDATION ??= "1";

import { SQL } from "bun";
import { mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type ExportRequest,
  type ExportResult,
  exportArchive,
} from "../packages/db/src/archive-export";
import {
  type ImportRequest,
  type ImportResult,
  importArchive,
} from "../packages/db/src/archive-import";
import { type OpenArchive, openArchive } from "../packages/db/src/archive-file";
import { type ReplayClient, bunSqlClient } from "../packages/db/src/replay-run";
import { totalReadings } from "../packages/db/src/archive";
import { compareStreamCounts } from "./db-parity";
import { replayedEnergy } from "./replay-rehearsal";
import {
  type EnergyRow,
  type FixtureMode,
  type RestartRow,
  assignShapes,
  compareEnergy,
  compareRestarts,
  groundTruthPath,
} from "./fixture-1-2-0";

/** The developer's dev database, shared with a live grid-tied inverter. */
export const DEV_DB_PORT = 5432;

/** The shared addon-1.2.0 fixture container. Expensive to rebuild; read-only. */
export const SHARED_FIXTURE_PORT = 5433;

/**
 * Refuse a target this script must never create or drop a database on.
 *
 * Pinned by exclusion rather than by allow-list because the port is an operator
 * choice here (a parallel worktree gets its own container), while the two
 * databases that must never be touched are fixed facts about this machine.
 */
export function assertRoundTripTarget(url: string): void {
  const parsed = new URL(url);
  const port = Number(parsed.port);
  if (port === DEV_DB_PORT) {
    throw new Error(
      `Refusing to run against port ${DEV_DB_PORT}: that is the developer's dev database, ` +
        `shared with a live grid-tied inverter.`,
    );
  }
  if (port === SHARED_FIXTURE_PORT) {
    throw new Error(
      `Refusing to run against port ${SHARED_FIXTURE_PORT}: that is the shared addon-1.2.0 ` +
        `fixture, which is read-only. Restore the snapshot into your own container instead.`,
    );
  }
}

export interface Options {
  port: number;
  password: string;
  /** The restored 1.2.0 database to export FROM. Never written to. */
  sourceDb: string;
  /** The 2.0.0 database to import INTO. Dropped and recreated on every run. */
  targetDb: string;
  mode: FixtureMode;
  /** Where the archive is written. Defaults to a temp directory. */
  out: string | null;
  /** Keep the archive after the run, for inspection. */
  keep: boolean;
}

export const DEFAULTS: Options = {
  port: 5441,
  password: "postgres",
  sourceDb: "sunreye_fixture_120",
  targetDb: "sunreye_archive_target",
  mode: "full",
  out: null,
  keep: false,
};

export const HELP = `archive-round-trip.ts — export a 1.2.0 fixture, import it into 2.0.0, compare

Reads a RESTORED addon-1.2.0 database, writes a portable archive, applies the
2.0.0 baseline to an empty database, imports the archive, and compares the
per-metric per-day energy and the counter restarts against the committed ground
truth in scripts/fixtures/.

Options:
  --port <n>        Postgres port (default ${DEFAULTS.port}). Never ${DEV_DB_PORT} or ${SHARED_FIXTURE_PORT}.
  --source <db>     1.2.0 database to export from (default ${DEFAULTS.sourceDb})
  --target <db>     2.0.0 database to import into, RECREATED (default ${DEFAULTS.targetDb})
  --mode fast|full  which committed ground truth to compare against (default full)
  --out <path>      write the archive here instead of a temp directory
  --keep            keep the archive after the run
  --help
`;

/**
 * Table-driven, so adding an option cannot change how any other one is read.
 * Unknown flags are tolerated here (unlike the real CLI) because this is a
 * developer harness and `--help` is the documentation.
 */
const OPTION_SETTERS: Record<string, (options: Options, value: string) => void> = {
  "--port": (options, value) => {
    options.port = Number(value);
  },
  "--source": (options, value) => {
    options.sourceDb = value;
  },
  "--target": (options, value) => {
    options.targetDb = value;
  },
  "--mode": (options, value) => {
    options.mode = value === "fast" ? "fast" : "full";
  },
  "--out": (options, value) => {
    options.out = value;
  },
};

export function parseArgs(argv: readonly string[]): Options {
  const options = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "--keep") {
      options.keep = true;
      continue;
    }
    OPTION_SETTERS[arg]?.(options, argv[++i] ?? "");
  }
  return options;
}

/** Bytes, as a human reads them. */
export function humanBytes(bytes: number): string {
  const units = ["B", "kB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 && unit > 0 ? 2 : 0)} ${units[unit]}`;
}

/** Rows per second, or null when the elapsed time is too small to divide by. */
export function throughput(rows: number, elapsedMs: number): number | null {
  return elapsedMs <= 0 ? null : Math.round((rows / elapsedMs) * 1000);
}

const urlFor = (o: Options, database: string) =>
  `postgres://postgres:${o.password}@localhost:${o.port}/${database}`;

/** What the fixture's profile declares, as this script reads it. */
export interface ProfileDoc {
  id: string;
  metrics: { key: string; unit?: string | null }[];
}

/** The metric vocabulary of the fixture's profile, with its counter class. */
export interface Vocabulary {
  profileId: string;
  metricKeys: { key: string; isCounter: boolean }[];
  counters: string[];
}

/** The committed ground truth this run compares against. */
export interface GroundTruth {
  tiers: Record<string, { count: number }>;
  perMetricPerDayEnergy: EnergyRow[];
  restarts: RestartRow[];
}

/** A pool this script can run one statement at a time on. */
export interface UnsafeSql {
  unsafe(query: string, values?: unknown[]): Promise<unknown>;
}

/**
 * Everything this script touches that is not arithmetic.
 *
 * Named methods rather than a driver handle so a double can answer them: what a
 * real `counter_agg` or a real `COPY` does cannot be proved by a unit test — only
 * by running this script against the real fixture, which is how it was proved.
 * Which phase runs WHEN, what it refuses, and what it reports are decisions, and
 * every one of those is proved against a double.
 */
export interface RoundTripIo {
  /** A pool for one database. Closed by the caller. */
  connect(url: string): UnsafeSql & { end(): Promise<void> };
  /** Apply the 2.0.0 schema with the shipped migration runner. */
  migrate(url: string): Promise<void>;
  /** The committed ground truth for `mode`. */
  readGroundTruth(mode: FixtureMode): Promise<GroundTruth>;
  /** The profile whose metrics the fixture was seeded from. */
  readProfile(): Promise<ProfileDoc>;
  exportArchive(client: ReplayClient, request: ExportRequest): Promise<ExportResult>;
  importArchive(client: ReplayClient, request: ImportRequest): Promise<ImportResult>;
  openArchive(path: string, workDir: string): Promise<OpenArchive>;
  mkdir(path: string): Promise<void>;
  remove(path: string): Promise<void>;
  /** Size of a finished file, for the line that reports where it was kept. */
  sizeOf(path: string): Promise<number>;
  log(message: string): void;
  /** `--help` on stdout, unprefixed and unsuppressed. It is the documentation. */
  help(text: string): void;
  error(message: string): void;
}

const log = (message: string) => {
  if (process.env.NODE_ENV !== "test") console.log(`[round-trip] ${message}`);
};

/** The real wiring. Every driver and every filesystem call lives here. */
export const productionIo: RoundTripIo = {
  connect: (url) => new SQL(url, { max: 1 }),
  migrate: async (url) => {
    const { runMigrations } = await import("../packages/db/src/migrate");
    await runMigrations(url);
  },
  readGroundTruth: (mode) => Bun.file(groundTruthPath(mode)).json() as Promise<GroundTruth>,
  readProfile: () =>
    Bun.file(
      join(import.meta.dir, "..", "packages/profile-sdk/src/__fixtures__/sample-profile.json"),
    ).json() as Promise<ProfileDoc>,
  exportArchive,
  importArchive,
  openArchive,
  mkdir: async (path) => {
    await mkdir(path, { recursive: true });
  },
  remove: async (path) => {
    await rm(path, { recursive: true, force: true });
  },
  sizeOf: async (path) => (await stat(path)).size,
  log,
  help: (text) => console.log(text),
  error: (message) => console.error(message),
};

/**
 * The metric vocabulary of the fixture's profile, with its counter class.
 *
 * From `assignShapes` — the fixture's OWN answer to which metrics are counters,
 * the same one that decided what the seeded curves look like and therefore what
 * the committed truth says. Deriving it any other way here would let the export
 * and the truth disagree about which series `counter_agg` belongs on, which is
 * the 1532x error wearing a different hat.
 */
export async function profileVocabulary(
  mode: FixtureMode,
  io: RoundTripIo = productionIo,
): Promise<Vocabulary> {
  const profile = await io.readProfile();
  const shaped = assignShapes(profile.metrics as never, mode === "fast" ? 10 : 60);
  return {
    profileId: profile.id,
    metricKeys: shaped.map((m) => ({ key: m.key, isCounter: m.shape.kind === "counter" })),
    counters: shaped.filter((m) => m.shape.kind === "counter").map((m) => m.key),
  };
}

/** Recreate the 2.0.0 target and bring it to the shipped schema. */
export async function recreateTarget(o: Options, io: RoundTripIo = productionIo): Promise<string> {
  const url = urlFor(o, o.targetDb);
  assertRoundTripTarget(url);
  const admin = io.connect(urlFor(o, "postgres"));
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${o.targetDb} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${o.targetDb}`);
  } finally {
    await admin.end();
  }
  await io.migrate(url);
  io.log(`recreated ${o.targetDb} and applied the 2.0.0 baseline`);
  return url;
}

/**
 * Per-metric per-day energy of the IMPORTED series, one counter at a time.
 *
 * `replayedEnergy` with no device narrowing — the ONE implementation, shared with
 * the rehearsal. A second copy here would be comparing this migration against a
 * copy of its own bug, which is the same reason `energyOf` is imported rather
 * than rewritten.
 */
export const importedEnergy = (
  db: UnsafeSql,
  counters: readonly string[],
): Promise<{ energy: EnergyRow[]; restarts: RestartRow[] }> => replayedEnergy(db, null, counters);

/**
 * Rows the 1.2.0 source holds for each tier, over exactly the days the export
 * plan gave that tier.
 *
 * The other half of the coverage check: the manifest says what the archive
 * carries, and this says what it should have carried. Per chunk rather than per
 * tier because the plan splits the span between tiers, and a whole-tier count
 * would be comparing against days another tier answered.
 */
export async function countSourceRows(
  options: Options,
  chunks: readonly { tier: string; start: Date; end: Date }[],
  io: RoundTripIo = productionIo,
): Promise<Record<string, number>> {
  const relation: Record<string, { table: string; column: string }> = {
    raw: { table: "metrics_raw", column: "time" },
    minute: { table: "minute_rollups", column: "bucket" },
    hourly: { table: "hourly_rollups", column: "bucket" },
    daily: { table: "daily_rollups", column: "bucket" },
  };
  const totals: Record<string, number> = {};
  const source = io.connect(urlFor(options, options.sourceDb));
  try {
    for (const chunk of chunks) {
      const target = relation[chunk.tier];
      if (!target) continue;
      const rows = (await source.unsafe(
        `select count(*)::bigint as n from ${target.table}
         where ${target.column} >= $1 and ${target.column} < $2`,
        [chunk.start.toISOString(), chunk.end.toISOString()],
      )) as { n: string }[];
      totals[chunk.tier] = (totals[chunk.tier] ?? 0) + Number(rows[0]?.n ?? 0);
    }
  } finally {
    await source.end();
  }
  return totals;
}

/** What the round trip carries between its phases. */
export interface Run {
  options: Options;
  workRoot: string;
  archivePath: string;
  truth: GroundTruth;
  vocabulary: Vocabulary;
}

/** PHASE 1: read the 1.2.0 fixture into an archive, and report the file. */
export async function exportPhase(
  run: Run,
  io: RoundTripIo = productionIo,
): Promise<{
  problems: string[];
  plan: { tier: string; start: Date; end: Date }[];
  streams: Record<string, number>;
}> {
  const problems: string[] = [];
  const source = io.connect(urlFor(run.options, run.options.sourceDb));
  let exported: ExportResult;
  try {
    io.log(`exporting ${run.options.sourceDb} (1.2.0) -> ${run.archivePath}`);
    exported = await io.exportArchive(bunSqlClient(source), {
      source: "legacy",
      out: run.archivePath,
      workDir: run.workRoot,
      profileId: run.vocabulary.profileId,
      metricKeys: run.vocabulary.metricKeys,
      appVersion: "1.2.0-legacy",
      onProgress: ({ tier, window, total }) =>
        io.log(
          `  ${tier} ${window.start.toISOString().slice(0, 10)}..` +
            `${window.end.toISOString().slice(0, 10)}: ${total.toLocaleString("en-US")} rows so far`,
        ),
    });
  } finally {
    await source.end();
  }

  const readings = totalReadings(exported.manifest.streams);
  const ratio = exported.uncompressedBytes / Math.max(1, exported.bytes);
  io.log(
    `EXPORT: ${readings.toLocaleString("en-US")} readings + ` +
      `${exported.manifest.streams.configLog.toLocaleString("en-US")} config changes in ` +
      `${(exported.elapsedMs / 1000).toFixed(1)}s ` +
      `(${throughput(readings, exported.elapsedMs)?.toLocaleString("en-US")} rows/s)`,
  );
  io.log(
    `EXPORT SIZE: ${humanBytes(exported.bytes)} on disk, ` +
      `${humanBytes(exported.uncompressedBytes)} of NDJSON — ${ratio.toFixed(1)}x compression`,
  );
  io.log(
    `EXPORT PLAN: ${exported.plan.chunks.length} day-chunk(s), ${exported.plan.gaps.length} gap(s)`,
  );
  const byTier = exported.plan.chunks.reduce<Record<string, number>>((acc, chunk) => {
    acc[chunk.tier] = (acc[chunk.tier] ?? 0) + 1;
    return acc;
  }, {});
  io.log(`EXPORT TIERS: ${JSON.stringify(byTier)}`);
  io.log(`EXPORT STREAMS: ${JSON.stringify(exported.manifest.streams)}`);

  for (const chunk of exported.barren) {
    // A planned day that produced nothing is a finding, not a log line: it is the
    // exact shape of the bug that silently dropped a whole day of a native export.
    problems.push(`${chunk.start.toISOString().slice(0, 10)}: ${chunk.reason}`);
  }

  // The archive must be readable as a FILE by something that did not write it.
  const reopened = await io.openArchive(run.archivePath, join(run.workRoot, "verify"));
  try {
    if (reopened.manifest.rows !== exported.manifest.rows) {
      problems.push(
        `manifest read back from the file claims ${reopened.manifest.rows} rows, the export ` +
          `reported ${exported.manifest.rows}`,
      );
    }
  } finally {
    await reopened.close();
  }

  return {
    problems,
    plan: exported.plan.chunks,
    streams: {
      raw: exported.manifest.streams.raw,
      minute: exported.manifest.streams.minute,
      hourly: exported.manifest.streams.hourly,
      daily: exported.manifest.streams.daily,
    },
  };
}

/** PHASE 2: apply the 2.0.0 baseline to an empty database and import. */
export async function importPhase(
  run: Run,
  target: UnsafeSql,
  io: RoundTripIo = productionIo,
): Promise<string[]> {
  io.log(`importing into ${run.options.targetDb} (2.0.0)`);
  const result = await io.importArchive(bunSqlClient(target), {
    file: run.archivePath,
    workDir: join(run.workRoot, "import"),
    onProgress: ({ stage, rows }) =>
      io.log(`  ${stage}${rows > 0 ? `: ${rows.toLocaleString("en-US")} rows` : ""}`),
  });
  const importedRows = totalReadings(result.inserted);
  io.log(
    `IMPORT: ${importedRows.toLocaleString("en-US")} readings staged/inserted in ` +
      `${(result.elapsedMs / 1000).toFixed(1)}s ` +
      `(${throughput(importedRows, result.elapsedMs)?.toLocaleString("en-US")} rows/s)`,
  );
  io.log(`IMPORT STREAMS: ${JSON.stringify(result.inserted)}`);
  for (const replay of result.replays) {
    io.log(
      `  replay: ${replay.chunks.length} chunk(s), ${replay.seriesRows.toLocaleString("en-US")} ` +
        `series rows, ${replay.configRows} config rows, ${replay.skipped} skipped`,
    );
  }
  for (const problem of result.problems) io.log(`  note: ${problem}`);
  // Deliberately empty: an import's own `problems` are NOTES (a retention
  // warning, a config oddity), not differences. The verdict is the energy
  // comparison in PHASE 3, and letting a note fail the run would make the script
  // red for something that is not a data difference.
  return [];
}

/** What the target holds after the import — the numbers a human wants to see. */
export async function reportTarget(
  target: UnsafeSql,
  io: RoundTripIo = productionIo,
): Promise<void> {
  const count = async (relation: string) =>
    Number(
      ((await target.unsafe(`select count(*)::bigint as n from ${relation}`)) as { n: string }[])[0]
        ?.n ?? 0,
    );
  io.log(`TARGET metrics_raw: ${(await count("metrics_raw")).toLocaleString("en-US")} rows`);
  for (const view of ["minute_rollups", "hourly_rollups", "daily_rollups"]) {
    io.log(`TARGET ${view}: ${(await count(view)).toLocaleString("en-US")} buckets`);
  }
}

/**
 * PHASE 3: THE COMPARISON THAT MATTERS.
 *
 * Per-metric per-day energy of the imported series against the committed ground
 * truth, through the same unit-tested `energyOf` the truth was written with.
 */
export async function comparePhase(
  run: Run,
  target: UnsafeSql,
  io: RoundTripIo = productionIo,
): Promise<string[]> {
  io.log(`comparing per-metric per-day energy against ${groundTruthPath(run.options.mode)}`);
  const measured = await importedEnergy(target, run.vocabulary.counters);
  const problems = [
    ...compareEnergy(run.truth.perMetricPerDayEnergy, measured.energy),
    ...compareRestarts(run.truth.restarts, measured.restarts),
  ];

  const worst = run.truth.perMetricPerDayEnergy
    .map((row) => ({ row, error: Math.abs(row.naive - row.energy) }))
    .sort((a, b) => b.error - a.error)[0];
  if (worst && worst.error > 1) {
    const check = measured.energy.find(
      (row) => row.metric === worst.row.metric && row.day === worst.row.day,
    );
    io.log(
      `RESET HAZARD: ${worst.row.metric} on ${worst.row.day} — truth ` +
        `${worst.row.energy.toFixed(3)} kWh, naive max-minus-min ${worst.row.naive.toFixed(3)} kWh ` +
        `(${(worst.row.naive / worst.row.energy).toFixed(0)}x), round trip reports ` +
        `${check ? check.energy.toFixed(3) : "NOTHING"} kWh`,
    );
  }
  return problems;
}

/** How many problems the report spells out before it summarises the rest. */
export const PROBLEMS_SHOWN = 40;

export async function main(
  argv: readonly string[],
  io: RoundTripIo = productionIo,
): Promise<number> {
  if (argv.includes("--help")) {
    io.help(HELP);
    return 0;
  }
  const options = parseArgs(argv);
  assertRoundTripTarget(urlFor(options, options.sourceDb));

  const workRoot = options.out
    ? `${options.out}.work`
    : join(tmpdir(), `sunreye-round-trip-${process.pid}`);
  await io.mkdir(workRoot);

  const run: Run = {
    options,
    workRoot,
    archivePath: options.out ?? join(workRoot, "sunreye-export.tar.gz"),
    truth: await io.readGroundTruth(options.mode),
    vocabulary: await profileVocabulary(options.mode, io),
  };

  const exported = await exportPhase(run, io);
  const problems = [...exported.problems];

  // Did every row the SOURCE held for the days the plan assigned to a tier make it
  // into the file? Counted from the source per chunk rather than against the
  // tier's whole bucket count: the plan deliberately gives the last days to `raw`,
  // so the minute tier's 9.07 M buckets are NOT all exported, and comparing
  // against them would fail for the right reason with the wrong message.
  const expectedStreams = await countSourceRows(options, exported.plan, io);
  io.log(`SOURCE ROWS for the planned days: ${JSON.stringify(expectedStreams)}`);
  problems.push(...compareStreamCounts(expectedStreams, exported.streams));

  const targetUrl = await recreateTarget(options, io);
  const target = io.connect(targetUrl);
  try {
    problems.push(...(await importPhase(run, target, io)));
    await reportTarget(target, io);
    problems.push(...(await comparePhase(run, target, io)));
  } finally {
    await target.end();
  }

  if (!options.keep && !options.out) await io.remove(workRoot);
  else
    io.log(`archive kept at ${run.archivePath} (${humanBytes(await io.sizeOf(run.archivePath))})`);

  if (problems.length === 0) {
    io.log("ROUND TRIP: no differences — the archive preserves the history it claims to");
    return 0;
  }
  io.error(`round trip: ${problems.length} problem(s)`);
  for (const problem of problems.slice(0, PROBLEMS_SHOWN)) io.error(`  - ${problem}`);
  if (problems.length > PROBLEMS_SHOWN) {
    io.error(`  ... and ${problems.length - PROBLEMS_SHOWN} more`);
  }
  return 1;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
