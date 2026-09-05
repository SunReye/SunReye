import { readFileSync } from "node:fs";

/**
 * Restore parity: does the database that came out of `pg_restore` hold exactly
 * what the database that was dumped held?
 *
 * The comparison is deliberately pure — `SNAPSHOT_SQL` is run by psql on both
 * sides (see `.github/workflows/db-restore.yml`), each side is written to a
 * JSON file, and this module diffs the two. Nothing here talks to a database,
 * so every boundary (a drifted average, a rollup bucket that vanished, the raw
 * window that was *supposed* to vanish in `backup_full: false`, a compression
 * or refresh policy that did not come back) is covered by the suite.
 */

export type RollupRow = {
  bucket: string;
  inverterId: string;
  metric: string;
  avg: number | null;
  max: number | null;
  min: number | null;
};

export type RollupName = "minute_rollups" | "hourly_rollups" | "daily_rollups";

/**
 * The time-weighted aggregates (#116). Separate from {@link RollupName} because
 * they can legitimately be absent — a snapshot taken before the migration has no
 * such views at all — and because a migration is *expected* to make them appear,
 * which a restore never is.
 */
export type WeightedRollupName =
  | "weighted_minute_rollups"
  | "weighted_hourly_rollups"
  | "weighted_daily_rollups";

/** The legacy aggregate each weighted one shadows, bucket for bucket. */
const SHADOWS: Record<WeightedRollupName, RollupName> = {
  weighted_minute_rollups: "minute_rollups",
  weighted_hourly_rollups: "hourly_rollups",
  weighted_daily_rollups: "daily_rollups",
};

export type Snapshot = {
  /** Every materialized bucket of every rollup, per inverter and metric. */
  rollups: Record<RollupName, RollupRow[]>;
  /**
   * The same, for the weighted aggregates — with `avg` already reduced to
   * `weighted_sum / nullif(weight, 0)`, the quotient the read layer computes, so
   * the two sets are directly comparable.
   */
  weightedRollups: Record<WeightedRollupName, RollupRow[]>;
  /** Row counts of the irreplaceable side tables (settings, auth, profiles …). */
  tables: Record<string, number>;
  /** Order-independent content digest per side table, so values are compared too. */
  digests: Record<string, string>;
  /** Rows in the raw 1 Hz hypertable — expected to be 0 after a non-full dump. */
  rawRows: number;
  /** Compressed chunks across all hypertables: the case most likely to break. */
  compressedChunks: number;
  /** `<job kind>:<hypertable>` for every TimescaleDB background job. */
  policies: string[];
};

export type CompareOptions = {
  /**
   * `backup_full: false`. The raw window is excluded from the dump on purpose:
   * its absence is then required, and its presence is the failure (the
   * exclusion silently stopped working).
   */
  expectRawLoss: boolean;
  /**
   * Assert the fixture itself is meaty enough to be worth comparing — rollup
   * rows materialized and at least one compressed chunk. Without it a broken
   * seed step would make parity trivially true.
   */
  requireData?: boolean;
  /**
   * Comparing a database to *itself* across the weighted-rollup migration
   * (#116), rather than across a dump/restore.
   *
   * The migration creates three aggregates and materializes them over whatever
   * raw rows remain, so the weighted side appears from nothing — which is the
   * point, not a mismatch. Every legacy bucket, meanwhile, must be identical:
   * `metrics_raw` has 7-day retention, so a recreate could only re-materialize
   * the last 7 days and would silently destroy every older bucket.
   *
   * The weighted side is then required to be non-empty, so a migration that
   * created the views and materialized nothing fails loudly instead of passing
   * trivially.
   */
  expectWeightedBackfill?: boolean;
};

const ROLLUPS: readonly RollupName[] = ["minute_rollups", "hourly_rollups", "daily_rollups"];
const WEIGHTED_ROLLUPS: readonly WeightedRollupName[] = [
  "weighted_minute_rollups",
  "weighted_hourly_rollups",
  "weighted_daily_rollups",
];
const METRICS = ["avg", "max", "min"] as const;

/** Floating point round trip through pg_dump's text form is not bit-exact. */
const EPSILON = 1e-9;

export function rollupKey(row: RollupRow): string {
  return `${row.bucket}|${row.inverterId}|${row.metric}`;
}

function sameNumber(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) <= EPSILON;
}

function compareRollup(
  name: RollupName | WeightedRollupName,
  before: RollupRow[],
  after: RollupRow[],
): string[] {
  const problems: string[] = [];
  if (before.length !== after.length) {
    problems.push(`${name}: row count ${before.length} before, ${after.length} after`);
  }

  const afterByKey = new Map(after.map((r) => [rollupKey(r), r]));
  for (const row of before) {
    const key = rollupKey(row);
    const restored = afterByKey.get(key);
    if (!restored) {
      problems.push(`${name}: bucket missing after restore: ${key}`);
      continue;
    }
    for (const metric of METRICS) {
      if (!sameNumber(row[metric], restored[metric])) {
        problems.push(
          `${name}: ${key}: ${metric} ${row[metric]} before, ${restored[metric]} after`,
        );
      }
    }
    afterByKey.delete(key);
  }
  for (const key of afterByKey.keys()) {
    problems.push(`${name}: bucket appeared out of nowhere after restore: ${key}`);
  }
  return problems;
}

/** Row counts and content digests per table — the "nothing was lost" check. */
function compareTables(before: Snapshot, after: Snapshot): string[] {
  const problems: string[] = [];
  for (const [table, count] of Object.entries(before.tables)) {
    const restored = after.tables[table];
    if (restored === undefined) problems.push(`${table}: table missing after restore`);
    else if (restored !== count) problems.push(`${table}: ${count} rows before, ${restored} after`);
  }
  for (const [table, digest] of Object.entries(before.digests)) {
    const restored = after.digests[table];
    if (restored !== digest) {
      problems.push(`${table}: content digest ${digest} before, ${restored} after`);
    }
  }
  return problems;
}

/**
 * The raw window, which is the one thing a `backup_full: false` dump is allowed
 * to lose — and if it is allowed, its absence is *required*, so an unexpected
 * survivor is as much a finding as an unexpected loss.
 */
function compareRawWindow(
  before: Snapshot,
  after: Snapshot,
  expectRawLoss: boolean,
  allowMoreCompression = false,
): string[] {
  if (expectRawLoss) {
    return after.rawRows === 0
      ? []
      : [
          `backup_full: false expected the raw window to be empty after restore, found ${after.rawRows} rows`,
        ];
  }
  const problems: string[] = [];
  if (after.rawRows !== before.rawRows) {
    problems.push(`metrics_raw: ${before.rawRows} raw rows before, ${after.rawRows} after`);
  }
  // Across a migration, MORE compressed chunks is the intended outcome: #134
  // arms compression on aggregates that had none, so chunks that could never
  // compress before now do. Fewer is still a loss either way.
  const lost = allowMoreCompression
    ? after.compressedChunks < before.compressedChunks
    : after.compressedChunks !== before.compressedChunks;
  if (lost) {
    problems.push(
      `compressed chunks: ${before.compressedChunks} before, ${after.compressedChunks} after`,
    );
  }
  return problems;
}

/**
 * Guard against a green run over an empty fixture. Parity between two empty
 * databases holds trivially, so the fixture has to be shown to contain the cases
 * that can actually break — rollup rows, and at least one compressed chunk.
 */
function checkFixtureIsMeaningful(before: Snapshot): string[] {
  const problems: string[] = [];
  if (ROLLUPS.every((name) => (before.rollups[name] ?? []).length === 0)) {
    problems.push("fixture has no rollup rows — parity over nothing proves nothing");
  }
  if (before.compressedChunks === 0) {
    problems.push("fixture has no compressed chunk — the riskiest case is untested");
  }
  return problems;
}

/**
 * The weighted side of a migration comparison: it may appear from nothing, but
 * it may not stay empty. An empty weighted set means the aggregates were created
 * and never materialized, so nothing about the weighting was proved and the read
 * cutover would serve the legacy side forever.
 */
function checkWeightedBackfill(after: Snapshot): string[] {
  const total = WEIGHTED_ROLLUPS.reduce(
    (sum, name) => sum + (after.weightedRollups?.[name] ?? []).length,
    0,
  );
  return total > 0
    ? []
    : ["migration produced no weighted rollup buckets — the aggregates exist but hold nothing"];
}

/**
 * The safety property that makes this migration landable: while every `dur_ms`
 * is NULL the aggregates read `coalesce(dur_ms, 1000)`, so
 * `sum(value * 1) / sum(1)` is *exactly* `avg(value)`. Every bucket the weighted
 * side holds must therefore equal its legacy counterpart, over unweighted data.
 *
 * Checked per bucket rather than in aggregate, because a compensating pair of
 * errors would cancel out of a total. The reverse direction is deliberately not
 * symmetric: a legacy bucket with no weighted counterpart is correct (the
 * weighted view can only be materialized as far back as `metrics_raw` reaches),
 * but a weighted bucket with no legacy counterpart means one of the two refresh
 * policies has stopped running.
 */
export function weightedMatchesLegacy(snapshot: Snapshot): string[] {
  const problems: string[] = [];
  for (const name of WEIGHTED_ROLLUPS) {
    const legacy = new Map(
      (snapshot.rollups[SHADOWS[name]] ?? []).map((r) => [rollupKey(r), r] as const),
    );
    for (const row of snapshot.weightedRollups?.[name] ?? []) {
      const key = rollupKey(row);
      const plain = legacy.get(key);
      if (!plain) {
        problems.push(`${name}: ${key} has no counterpart in ${SHADOWS[name]}`);
      } else if (!sameNumber(row.avg, plain.avg)) {
        problems.push(
          `${name}: ${key}: weighted avg ${row.avg} != ${SHADOWS[name]} avg ${plain.avg}`,
        );
      }
    }
  }
  return problems;
}

export function compareSnapshots(
  before: Snapshot,
  after: Snapshot,
  options: CompareOptions,
): string[] {
  return [
    ...ROLLUPS.flatMap((name) =>
      compareRollup(name, before.rollups[name] ?? [], after.rollups[name] ?? []),
    ),
    ...(options.expectWeightedBackfill
      ? checkWeightedBackfill(after)
      : WEIGHTED_ROLLUPS.flatMap((name) =>
          compareRollup(
            name,
            before.weightedRollups?.[name] ?? [],
            after.weightedRollups?.[name] ?? [],
          ),
        )),
    ...compareTables(before, after),
    ...before.policies
      .filter((policy) => !after.policies.includes(policy))
      .map((policy) => `policy not re-armed: ${policy}`),
    ...compareRawWindow(
      before,
      after,
      options.expectRawLoss ?? false,
      options.expectWeightedBackfill ?? false,
    ),
    ...(options.requireData ? checkFixtureIsMeaningful(before) : []),
  ];
}

const rollupSelect = (name: RollupName) => `
    '${name}', (SELECT coalesce(json_agg(r ORDER BY r.bucket, r."inverterId", r.metric), '[]'::json)
      FROM (SELECT bucket, inverter_id AS "inverterId", metric,
                   avg_value AS avg, max_value AS max, min_value AS min
            FROM ${name}) r)`;

/**
 * The weighted aggregates, reduced to the same shape — `avg` is the quotient the
 * read layer computes, `nullif` and all, so a degenerate bucket surfaces as NULL
 * rather than raising inside the snapshot.
 *
 * Read through `query_to_xml` rather than referenced directly, because the
 * "before" side of a migration comparison is a database where these views do not
 * exist yet — and a missing relation is a *parse* error, so a `to_regclass` CASE
 * around a direct reference does not save it (the planner resolves both arms).
 * `query_to_xml` takes its query as text, so the name is only resolved when the
 * guard has already decided the view is there. A snapshot that cannot be taken
 * proves nothing, and the pre-migration snapshot is exactly the one that matters.
 */
const weightedRollupSelect = (name: WeightedRollupName) => {
  const inner = [
    `select coalesce(json_agg(r ORDER BY r.bucket, r."inverterId", r.metric), ''[]''::json) as j`,
    `from (select bucket, inverter_id AS "inverterId", metric,`,
    `             weighted_sum / nullif(weight, 0) AS avg,`,
    `             max_value AS max, min_value AS min`,
    `      from ${name}) r`,
  ].join(" ");
  return `
    '${name}', (SELECT CASE WHEN to_regclass('public.${name}') IS NULL THEN '[]'::json ELSE
        coalesce((xpath('/row/j/text()', query_to_xml('${inner}', false, true, '')))[1]::text::json,
                 '[]'::json) END)`;
};

/** Tables whose loss is unrecoverable: settings, tariffs (settings-backed), auth, profiles. */
export const SIDE_TABLES = [
  "app_settings",
  "installed_profiles",
  "custom_charts",
  "spot_prices",
  "forecast_correction_cells",
  "user",
  "account",
  "session",
  "apikey",
] as const;

const tableCount = (t: string) => `'${t}', (SELECT count(*) FROM "${t}")`;
const tableDigest = (t: string) =>
  `'${t}', (SELECT md5(coalesce(string_agg(x, '|' ORDER BY x), '')) FROM (SELECT t::text AS x FROM "${t}" t) s)`;

/** One query, one JSON object: the snapshot both sides of a restore are compared by. */
export const SNAPSHOT_SQL = `SELECT json_build_object(
  'rollups', json_build_object(${ROLLUPS.map(rollupSelect).join(",")}
  ),
  'weightedRollups', json_build_object(${WEIGHTED_ROLLUPS.map(weightedRollupSelect).join(",")}
  ),
  'tables', json_build_object(${SIDE_TABLES.map(tableCount).join(", ")}),
  'digests', json_build_object(${SIDE_TABLES.map(tableDigest).join(", ")}),
  'rawRows', (SELECT count(*) FROM metrics_raw),
  'compressedChunks', (SELECT count(*) FROM timescaledb_information.chunks WHERE is_compressed),
  'policies', (SELECT coalesce(json_agg(DISTINCT proc_name || ':' || coalesce(hypertable_name, '-')), '[]'::json)
               FROM timescaledb_information.jobs)
)`;

export function readSnapshot(path: string): Snapshot {
  return JSON.parse(readFileSync(path, "utf8")) as Snapshot;
}

/**
 * `db-parity.ts <before.json> <after.json> [--expect-raw-loss] [--require-data]
 *                [--expect-weighted-backfill] [--weighted-equals-legacy]`
 */
export function main(argv: readonly string[]): number {
  const flags = argv.filter((a) => a.startsWith("--"));
  const [before, after] = argv.filter((a) => !a.startsWith("--"));
  if (!before || !after) {
    console.error("usage: db-parity.ts <before.json> <after.json> [--expect-raw-loss]");
    return 2;
  }
  const afterSnapshot = readSnapshot(after);
  const problems = [
    ...compareSnapshots(readSnapshot(before), afterSnapshot, {
      expectRawLoss: flags.includes("--expect-raw-loss"),
      requireData: flags.includes("--require-data"),
      expectWeightedBackfill: flags.includes("--expect-weighted-backfill"),
    }),
    ...(flags.includes("--weighted-equals-legacy") ? weightedMatchesLegacy(afterSnapshot) : []),
  ];
  if (problems.length === 0) {
    console.log("restore parity: identical");
    return 0;
  }
  console.error(`restore parity: ${problems.length} mismatch(es)`);
  for (const problem of problems) console.error(`  - ${problem}`);
  return 1;
}

if (import.meta.main) {
  if (process.argv[2] === "--print-sql") console.log(SNAPSHOT_SQL);
  else process.exit(main(process.argv.slice(2)));
}
