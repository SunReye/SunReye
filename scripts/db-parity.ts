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
  /**
   * The int2 device id, as text (json_agg renders it as a number, so the key
   * builder stringifies it).
   *
   * Was `inverterId`, a text PROFILE id, until 2.0.0 re-keyed every reading.
   * That matters more here than anywhere else: after this change the id is
   * meaningless without the `devices` row it resolves against, which is why
   * `devices`, `metric_keys` and the rest of the dimension spine were added to
   * {@link SIDE_TABLES}. A restore that brought back every bucket and lost
   * `devices` would pass a parity check keyed on ids alone while leaving a
   * database whose entire history names nothing.
   */
  deviceId: number;
  metricId: number;
  avg: number | null;
  max: number | null;
  min: number | null;
};

export type RollupName = "minute_rollups" | "hourly_rollups" | "daily_rollups";

export type Snapshot = {
  /** Every materialized bucket of every rollup, per device and metric. */
  rollups: Record<RollupName, RollupRow[]>;
  /**
   * Row counts of the irreplaceable side tables (settings, auth, profiles …).
   * `null` means the table does not exist in that database at all — a
   * pre-2.0.0 snapshot has no `spot_prices` — which is distinct from zero rows.
   */
  tables: Record<string, number | null>;
  /** Order-independent content digest per side table, so values are compared too. */
  digests: Record<string, string | null>;
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
   * Comparing a database to *itself* across a MIGRATION rather than across a
   * dump/restore: more compressed chunks than before is then the intended
   * outcome, not a loss.
   */
  acrossMigration?: boolean;
};

const ROLLUPS: readonly RollupName[] = ["minute_rollups", "hourly_rollups", "daily_rollups"];
const METRICS = ["avg", "max", "min"] as const;

/** Floating point round trip through pg_dump's text form is not bit-exact. */
const EPSILON = 1e-9;

export function rollupKey(row: RollupRow): string {
  return `${row.bucket}|${row.deviceId}|${row.metricId}`;
}

function sameNumber(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) <= EPSILON;
}

function compareRollup(name: RollupName, before: RollupRow[], after: RollupRow[]): string[] {
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

/**
 * Row counts and content digests per table — the "nothing was lost" check.
 *
 * A `null` on the BEFORE side means the table did not exist yet, so there is
 * nothing to have lost and the comparison is skipped: a 1.2.0 → 2.0.0 migration
 * is *supposed* to make `spot_prices` appear. A `null` on the AFTER side is the
 * loss this function exists to catch, and is reported as missing rather than as
 * a row-count change, because a dropped table and an emptied one are different
 * failures.
 */
function compareTables(before: Snapshot, after: Snapshot): string[] {
  return [
    ...compareTableField(before.tables, after.tables, "", (a, b) => `${a} rows before, ${b} after`),
    ...compareTableField(
      before.digests,
      after.digests,
      "content digest ",
      (a, b) => `content digest ${a} before, ${b} after`,
    ),
  ];
}

/**
 * One side-table field, counts or digests. A `null` BEFORE is skipped; a `null`
 * or absent AFTER is "missing", never a value change.
 */
function compareTableField<T extends number | string>(
  before: Record<string, T | null>,
  after: Record<string, T | null>,
  missingPrefix: string,
  changed: (a: T, b: T) => string,
): string[] {
  const problems: string[] = [];
  for (const [table, value] of Object.entries(before)) {
    if (value === null) continue;
    const restored = after[table];
    if (restored === undefined || restored === null) {
      problems.push(
        `${table}: ${missingPrefix}${missingPrefix ? "" : "table "}missing after restore`,
      );
    } else if (restored !== value) {
      problems.push(`${table}: ${changed(value, restored as T)}`);
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

export function compareSnapshots(
  before: Snapshot,
  after: Snapshot,
  options: CompareOptions,
): string[] {
  return [
    ...ROLLUPS.flatMap((name) =>
      compareRollup(name, before.rollups[name] ?? [], after.rollups[name] ?? []),
    ),
    ...compareTables(before, after),
    ...before.policies
      .filter((policy) => !after.policies.includes(policy))
      .map((policy) => `policy not re-armed: ${policy}`),
    ...compareRawWindow(
      before,
      after,
      options.expectRawLoss ?? false,
      options.acrossMigration ?? false,
    ),
    ...(options.requireData ? checkFixtureIsMeaningful(before) : []),
  ];
}

/**
 * One tier, reduced to a comparable shape.
 *
 * `average(tw)` rather than a stored `avg_value`: since 2.0.0 a tier materializes
 * a `timescaledb_toolkit` TimeWeightSummary, and there is no finished mean in the
 * relation to compare. NULL is a legitimate value here — `average()` of a bucket
 * holding one sample is NULL, because a point has no duration — and both sides
 * being NULL is parity, which `sameNumber` already treats correctly.
 *
 * Deliberately NOT `interpolated_average`: that reads a bucket's NEIGHBOURS, so
 * two databases holding identical rows could differ on a bucket at the edge of
 * the compared range. A parity check must compare each row against itself.
 */
const rollupSelect = (name: RollupName) => `
    '${name}', (SELECT coalesce(json_agg(r ORDER BY r.bucket, r."deviceId", r."metricId"), '[]'::json)
      FROM (SELECT bucket, device_id AS "deviceId", metric_id AS "metricId",
                   average(tw) AS avg, max_value AS max, min_value AS min
            FROM ${name}) r)`;

/** Tables whose loss is unrecoverable: settings, tariffs (settings-backed), auth, profiles. */
export const SIDE_TABLES = [
  // THE DIMENSION SPINE, first because it is the one thing whose loss cannot be
  // reconstructed from anything else. Every reading and every rollup bucket
  // names a device and a metric by int2; without these rows the whole history
  // resolves to nothing, and a parity check keyed on ids alone would not notice.
  "plants",
  "connections",
  "devices",
  "batteries",
  "metric_keys",
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

/**
 * A side-table probe that survives the table being absent.
 *
 * A missing relation is a *parse*
 * error, so a `to_regclass` CASE around a direct reference does not save the
 * query — the planner resolves both arms. `query_to_xml` takes its query as
 * text, so the name is resolved only once the guard has decided it is there.
 * Needed because the pre-migration side of a 1.2.0 → 2.0.0 comparison has no
 * `spot_prices` and no `forecast_correction_cells` at all, and that side is the
 * one snapshot that cannot be retaken.
 */
const optionalTable = (t: string, inner: string, cast: string) =>
  `'${t}', (SELECT CASE WHEN to_regclass('public."${t}"') IS NULL THEN NULL ELSE
      (xpath('/row/j/text()', query_to_xml('${inner}', false, true, '')))[1]::text${cast} END)`;

const tableCount = (t: string) => optionalTable(t, `select count(*) as j from "${t}"`, "::bigint");
const tableDigest = (t: string) =>
  optionalTable(
    t,
    `select md5(coalesce(string_agg(x, ''|'' ORDER BY x), '''')) as j from (select t::text as x from "${t}" t) s`,
    "",
  );

/**
 * One query, one JSON object: the snapshot both sides of a restore are compared
 * by.
 *
 * `includeRollups: false` drops the per-bucket arrays and leaves the tiers as
 * empty lists. They are unbounded — 60 days of per-minute buckets across 105
 * metrics is 9.07 M rows, and `json_agg`-ing that into a single value is an
 * out-of-memory error rather than a slow query. A caller that cannot afford them
 * (the addon-1.2.0 fixture, which carries a per-tier md5 digest instead) still
 * gets everything that is cheap at any scale: side-table counts and digests, the
 * raw row count, the compressed-chunk count and the policy list.
 */
export function buildSnapshotSql(options: { includeRollups?: boolean } = {}): string {
  const withRollups = options.includeRollups ?? true;
  const rollups = withRollups
    ? ROLLUPS.map(rollupSelect).join(",")
    : ROLLUPS.map((name) => `\n    '${name}', '[]'::json`).join(",");
  return `SELECT json_build_object(
  'rollups', json_build_object(${rollups}
  ),
  'tables', json_build_object(${SIDE_TABLES.map(tableCount).join(", ")}),
  'digests', json_build_object(${SIDE_TABLES.map(tableDigest).join(", ")}),
  'rawRows', (SELECT count(*) FROM metrics_raw),
  'compressedChunks', (SELECT count(*) FROM timescaledb_information.chunks WHERE is_compressed),
  'policies', (SELECT coalesce(json_agg(DISTINCT proc_name || ':' || coalesce(hypertable_name, '-')), '[]'::json)
               FROM timescaledb_information.jobs)
)`;
}

export const SNAPSHOT_SQL = buildSnapshotSql();

export function readSnapshot(path: string): Snapshot {
  return JSON.parse(readFileSync(path, "utf8")) as Snapshot;
}

/**
 * `db-parity.ts <before.json> <after.json> [--expect-raw-loss] [--require-data]
 *                [--across-migration]`
 */
export function main(argv: readonly string[]): number {
  const flags = argv.filter((a) => a.startsWith("--"));
  const [before, after] = argv.filter((a) => !a.startsWith("--"));
  if (!before || !after) {
    console.error("usage: db-parity.ts <before.json> <after.json> [--expect-raw-loss]");
    return 2;
  }
  // Read once, so a large snapshot is not parsed twice.
  const afterSnapshot = readSnapshot(after);
  const problems = [
    ...compareSnapshots(readSnapshot(before), afterSnapshot, {
      expectRawLoss: flags.includes("--expect-raw-loss"),
      requireData: flags.includes("--require-data"),
      acrossMigration: flags.includes("--across-migration"),
    }),
  ];
  if (problems.length === 0) {
    console.log("restore parity: identical");
    return 0;
  }
  console.error(`restore parity: ${problems.length} mismatch(es)`);
  for (const problem of problems) console.error(`  - ${problem}`);
  return 1;
}

/**
 * The entry point's whole body, extracted so it is reachable from a test: the
 * `--print-sql` escape hatch (how `db-restore.yml` gets the query it runs on
 * both sides) is a routing decision, and routing that only exists inside an
 * `import.meta.main` block is routing nothing can prove.
 */
export function cli(argv: readonly string[]): number {
  if (argv[0] === "--print-sql") {
    console.log(SNAPSHOT_SQL);
    return 0;
  }
  return main(argv);
}

if (import.meta.main) process.exit(cli(process.argv.slice(2)));
