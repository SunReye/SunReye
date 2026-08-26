/**
 * Parsers for the storage-tuning surfaces that live outside TypeScript: the
 * TimescaleDB policy SQL and the PostgreSQL settings the deployments hand the
 * server (the addon's generated include, the compose `-c` flags).
 *
 * Those files are configuration, not code, so nothing else asserts they agree —
 * `storage-tuning.test.ts` reads the real files through these parsers and pins
 * the tuned values.
 */

/** A compression (columnstore) policy declaration found in policy SQL. */
export interface CompressionPolicy {
  /** Hypertable or continuous aggregate the policy is attached to. */
  target: string;
  /** The `compress_after` interval, verbatim as written (e.g. `2 hours`). */
  after: string;
}

const STATEMENT_BREAKPOINT = "--> statement-breakpoint";

/** Statements of a policy/migration file, comment-only chunks dropped. */
function statements(sql: string): string[] {
  return sql
    .split(STATEMENT_BREAKPOINT)
    .map((chunk) =>
      chunk
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join(" ")
        .trim(),
    )
    .filter((chunk) => chunk.length > 0);
}

const ADD_COMPRESSION =
  /(?:add_compression_policy|add_columnstore_policy)\s*\(\s*'([^']+)'\s*,\s*(?:after\s*=>\s*)?INTERVAL\s*'([^']+)'/i;
const REMOVE_COMPRESSION =
  /(?:remove_compression_policy|remove_columnstore_policy)\s*\(\s*'([^']+)'/i;
const ADD_REFRESH = /add_continuous_aggregate_policy\s*\(\s*'([^']+)'/i;
const ADD_RETENTION =
  /add_retention_policy\s*\(\s*'([^']+)'\s*,\s*(?:drop_after\s*=>\s*)?INTERVAL\s*'([^']+)'/i;
const REMOVE_RETENTION = /remove_retention_policy\s*\(\s*'([^']+)'/i;

/** `daily_rollups`' refresh `start_offset` — the widest window any policy uses. */
const WIDEST_REFRESH_DAYS = 3;

const SET_COMPRESS = /ALTER\s+(?:MATERIALIZED\s+VIEW|TABLE)\s+(\w+)\s+SET\s*\(([^)]*)\)/i;
const SEGMENTBY = /compress_segmentby\s*=\s*'([^']*)'/i;

/**
 * The compression policies a policy file leaves behind, in declaration order.
 * A `remove_*` drops the earlier declaration for that target, so re-running the
 * file (or reading it twice) converges on the same set — that convergence is
 * what makes the remove+add pattern authoritative where `if_not_exists` alone
 * would silently keep an already-configured deployment's old interval.
 */
export function compressionPolicies(sql: string): CompressionPolicy[] {
  const byTarget = new Map<string, CompressionPolicy>();
  for (const statement of statements(sql)) {
    const removed = REMOVE_COMPRESSION.exec(statement);
    if (removed?.[1]) byTarget.delete(removed[1]);
    const added = ADD_COMPRESSION.exec(statement);
    if (added?.[1] && added[2]) byTarget.set(added[1], { target: added[1], after: added[2] });
  }
  return [...byTarget.values()];
}

/**
 * The `compress_segmentby` each target ends up with, per the file.
 *
 * The empty string is a *finding*, not an absence: compression enabled with no
 * segmentby is exactly the pre-#134 state of `minute_rollups`, where the
 * materialized rows are grouped by bucket so a per-metric query decompresses
 * batches it does not need. A caller has to be able to tell "never configured"
 * from "configured to segment by nothing".
 */
export function compressSegmentBy(sql: string): Record<string, string> {
  const byTarget: Record<string, string> = {};
  for (const statement of statements(sql)) {
    const set = SET_COMPRESS.exec(statement);
    if (!set?.[1] || set[2] === undefined) continue;
    if (!/timescaledb\.compress/i.test(set[2])) continue;
    byTarget[set[1]] = SEGMENTBY.exec(set[2])?.[1] ?? "";
  }
  return byTarget;
}

/**
 * The retention each target ends up with, in days. `Infinity` is never returned:
 * a target with no policy simply has no entry, which is what "kept forever"
 * means here.
 */
export function retentionDays(sql: string): Record<string, number> {
  const byTarget: Record<string, number> = {};
  for (const statement of statements(sql)) {
    const removed = REMOVE_RETENTION.exec(statement);
    if (removed?.[1]) delete byTarget[removed[1]];
    const added = ADD_RETENTION.exec(statement);
    if (added?.[1] && added[2]) byTarget[added[1]] = intervalDays(added[2]);
  }
  return byTarget;
}

/** `'90 days'`, `'2 hours'`, `'3 mons'` as days. NaN for anything unrecognised. */
export function intervalDays(interval: string): number {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(\w+)/.exec(interval);
  if (!match?.[1] || !match[2]) return Number.NaN;
  const n = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (unit.startsWith("day")) return n;
  if (unit.startsWith("hour")) return n / 24;
  if (unit.startsWith("min")) return n / 1440;
  if (unit.startsWith("week")) return n * 7;
  if (unit.startsWith("mon")) return n * 30;
  if (unit.startsWith("year")) return n * 365;
  return Number.NaN;
}

/** Continuous aggregates the file arms a refresh policy for, in order. */
export function refreshPolicies(sql: string): string[] {
  return statements(sql).flatMap((statement) => {
    const match = ADD_REFRESH.exec(statement);
    return match?.[1] ? [match[1]] : [];
  });
}

/** True when the file removes the target's policy before (re)adding it. */
export function removesBeforeAdding(sql: string, target: string): boolean {
  return removeThenAdd(sql, target, REMOVE_COMPRESSION, ADD_COMPRESSION);
}

/**
 * The same question for a retention policy, and it is not academic:
 * `add_retention_policy(…, if_not_exists => TRUE)` is a no-op on an
 * already-configured deployment, so a file that only adds keeps the OLD interval
 * forever. Measured on an upgraded database: the hourly tier stayed at 730 days
 * while this file said 3650.
 */
export function removesRetentionBeforeAdding(sql: string, target: string): boolean {
  return removeThenAdd(sql, target, REMOVE_RETENTION, ADD_RETENTION);
}

function removeThenAdd(sql: string, target: string, remove: RegExp, add: RegExp): boolean {
  const order = statements(sql).flatMap((statement) => {
    const removed = remove.exec(statement);
    if (removed?.[1] === target) return ["remove"];
    const added = add.exec(statement);
    return added?.[1] === target ? ["add"] : [];
  });
  const removedAt = order.indexOf("remove");
  const addedAt = order.indexOf("add");
  return removedAt >= 0 && addedAt >= 0 && removedAt < addedAt;
}

/**
 * Statements that would destroy an existing continuous aggregate. Dropping one
 * is never allowed in a migration: metrics_raw has 7-day retention, so a
 * recreate can only re-materialize the last 7 days (see 0000_bootstrap.sql).
 */
export function continuousAggregateDrops(sql: string): string[] {
  return statements(sql).filter((statement) =>
    /DROP\s+MATERIALIZED\s+VIEW|drop_continuous_aggregate|DROP\s+VIEW/i.test(statement),
  );
}

/**
 * PostgreSQL `key = value` settings of a conf file. Comments are ignored and
 * the last assignment wins, the way postgres itself reads the file.
 */
export function parsePgConf(conf: string): Record<string, string> {
  const settings: Record<string, string> = {};
  for (const line of conf.split("\n")) {
    const match = /^\s*([a-z_.]+)\s*=\s*([^#]*)/.exec(line);
    if (!match?.[1] || match[2] === undefined) continue;
    settings[match[1]] = match[2].trim().replace(/^'(.*)'$/, "$1");
  }
  return settings;
}

/**
 * PostgreSQL settings a compose file passes as `-c key=value` flags. Later
 * flags win, matching the postgres command line.
 */
export function parseComposePgFlags(yaml: string): Record<string, string> {
  const settings: Record<string, string> = {};
  for (const line of yaml.split("\n")) {
    const match = /^\s*-\s*([a-z_.]+)=(.+?)\s*$/.exec(line);
    if (!match?.[1] || !match[2]) continue;
    settings[match[1]] = match[2];
  }
  return settings;
}

/**
 * The tuned values themselves, asserted as a gate.
 *
 * The parsers above exist so `storage-tuning.test.ts` can pin these, but a unit
 * test only fails for whoever runs the suite. These settings live in four
 * separate files that nothing links together — the policy SQL, the addon's
 * generated conf, and two compose files — so the failure mode is one of them
 * quietly drifting. Running the same assertions as a script makes that a CI
 * gate. See #110 and #111.
 */
const REQUIRED_COMPRESS_AFTER = "2 hours";
const REQUIRED_PG_SETTINGS: Record<string, string> = {
  checkpoint_timeout: "2h",
  wal_compression: "zstd",
};

export interface CheckIO {
  read: (path: string) => string;
  log: (line: string) => void;
  error: (line: string) => void;
}

const ADDON_CONF = "sunreye/rootfs/etc/s6-overlay/s6-rc.d/init-postgres/run";
const POLICY_SQL = "packages/db/src/timescale/policies.sql";

/**
 * #134. Rollup rows are materialized grouped by *bucket*, so without a
 * segmentby a per-metric range scan touches essentially every page in the
 * range — measured, 1 row per 8 KB block against ~143 rows/block in
 * metrics_raw. Every tier must therefore mirror metrics_raw's segmentby AND
 * carry a compression policy, because a segmentby with no policy never
 * compresses and a policy with no segmentby compresses into the wrong shape.
 * Neither half is any use alone, which is exactly how the original defect
 * survived: minute_rollups had the policy, hourly and daily had neither.
 */
const ROLLUP_TIERS = [
  "minute_rollups",
  "hourly_rollups",
  "daily_rollups",
  "weighted_minute_rollups",
  "weighted_hourly_rollups",
  "weighted_daily_rollups",
] as const;
const REQUIRED_SEGMENTBY = "metric, inverter_id";
/** The numbered structural files that declare the rollups' storage layout. */
const ROLLUP_STRUCTURAL_SQL = [
  "packages/db/src/timescale/0002_weighted_rollups.sql",
  "packages/db/src/timescale/0003_rollup_compression_segmentby.sql",
];

/** #110: the compression policy, and the remove+add discipline that makes it stick. */
function policyProblems(io: CheckIO): string[] {
  const sql = io.read(POLICY_SQL);
  const problems: string[] = [];
  const raw = compressionPolicies(sql).find((p) => p.target === "metrics_raw");
  if (!raw) {
    problems.push("policies.sql declares no compression policy for metrics_raw.");
  } else if (raw.after !== REQUIRED_COMPRESS_AFTER) {
    problems.push(
      `metrics_raw compress_after is '${raw.after}', expected '${REQUIRED_COMPRESS_AFTER}' (#110).`,
    );
  }
  if (!removesBeforeAdding(sql, "metrics_raw")) {
    problems.push(
      "policies.sql must remove metrics_raw's policy before re-adding it, or an already-configured deployment silently keeps its old interval.",
    );
  }
  problems.push(
    ...continuousAggregateDrops(sql).map(
      (drop) => `policies.sql would destroy a continuous aggregate: ${drop}`,
    ),
  );
  return problems;
}

/** #111: the same settings on every surface that starts a postgres. */
function settingsProblems(where: string, settings: Record<string, string>): string[] {
  const problems = Object.entries(REQUIRED_PG_SETTINGS)
    .filter(([key, want]) => settings[key] !== want)
    .map(
      ([key, want]) =>
        `${where}: ${key} is '${settings[key] ?? "unset"}', expected '${want}' (#111).`,
    );
  // full_page_writes must stay on: SD gives no atomic-write guarantee.
  if (settings.full_page_writes === "off") {
    problems.push(
      `${where}: full_page_writes is off — SD offers no atomic-write guarantee (#111).`,
    );
  }
  return problems;
}

/** #134: the segmentby, the policy that makes it take effect, and the refresh. */
/**
 * The retention invariant the backup default rests on.
 *
 * `dump.sh` excludes raw chunk data by default because raw is fully materialized
 * into the rollups. That is true exactly while raw's retention does not exceed
 * the shortest aggregate retention — past that, a time range exists that only
 * raw covers. The script derives the same rule from the live database, but a
 * policy edit that breaks it should fail CI rather than wait to be noticed as a
 * one-line warning in a backup log.
 *
 * Also checked: raw must comfortably exceed the widest refresh window
 * (daily_rollups' 3-day `start_offset`), or a refresh reaches for a chunk
 * retention has dropped.
 */
function retentionProblems(io: CheckIO): string[] {
  const days = retentionDays(io.read(POLICY_SQL));
  const raw = days["metrics_raw"];
  const problems: string[] = [];
  if (raw === undefined) {
    // Not a failure: raw kept forever is a deliberate shape. But the backup
    // default then has to include raw, which dump.sh handles.
    return problems;
  }
  if (!Number.isFinite(raw)) {
    problems.push("metrics_raw retention interval is unparseable in policies.sql.");
    return problems;
  }
  if (raw <= WIDEST_REFRESH_DAYS) {
    problems.push(
      `metrics_raw retention is ${raw} day(s), inside the widest continuous-aggregate refresh window (${WIDEST_REFRESH_DAYS} days) — a refresh would reach a chunk retention has dropped.`,
    );
  }
  for (const [target, retention] of Object.entries(days)) {
    if (target !== "metrics_raw" && retention < raw) {
      problems.push(
        `metrics_raw is kept ${raw} day(s) but ${target} only ${retention} — raw then covers a range the rollups do not, and the addon's default backup excludes raw (#121, #133).`,
      );
    }
  }
  for (const target of Object.keys(days)) {
    if (!removesRetentionBeforeAdding(io.read(POLICY_SQL), target)) {
      problems.push(
        `policies.sql adds a retention policy for ${target} without removing it first — \`if_not_exists => TRUE\` is a no-op on a configured deployment, so an interval change would never reach an existing database.`,
      );
    }
  }
  return problems;
}

function rollupProblems(io: CheckIO): string[] {
  const structural = ROLLUP_STRUCTURAL_SQL.map((path) => ({ path, sql: io.read(path) }));
  const segmentby = Object.assign({}, ...structural.map((f) => compressSegmentBy(f.sql))) as Record<
    string,
    string
  >;
  const policySql = io.read(POLICY_SQL);
  const compressed = compressionPolicies(policySql).map((p) => p.target);
  const refreshed = refreshPolicies(policySql);

  const problems: string[] = [];
  for (const tier of ROLLUP_TIERS) {
    const declared = segmentby[tier];
    if (declared === undefined) {
      problems.push(`${tier} declares no compression settings in any numbered file (#134).`);
    } else if (declared !== REQUIRED_SEGMENTBY) {
      problems.push(
        `${tier} compress_segmentby is '${declared}', expected '${REQUIRED_SEGMENTBY}' — a rollup that does not mirror metrics_raw decompresses batches it does not need (#134).`,
      );
    }
    if (!compressed.includes(tier)) {
      problems.push(
        `policies.sql declares no compression policy for ${tier}, so it can never compress (#134).`,
      );
    }
    if (!refreshed.includes(tier)) {
      problems.push(
        `policies.sql arms no refresh policy for ${tier}; an aggregate nothing refreshes is an aggregate nothing can read (#116).`,
      );
    }
  }
  problems.push(
    ...structural.flatMap((f) =>
      continuousAggregateDrops(f.sql).map(
        (drop) => `${f.path} would destroy a continuous aggregate: ${drop}`,
      ),
    ),
  );
  return problems;
}

export function checkStorageTuning(io: CheckIO): number {
  const problems = [
    ...policyProblems(io),
    ...rollupProblems(io),
    ...retentionProblems(io),
    ...settingsProblems(ADDON_CONF, parsePgConf(io.read(ADDON_CONF))),
    ...settingsProblems("docker-compose.yml", parseComposePgFlags(io.read("docker-compose.yml"))),
    ...settingsProblems(
      "docker/docker-compose.yml",
      parseComposePgFlags(io.read("docker/docker-compose.yml")),
    ),
  ];

  for (const problem of problems) io.error(`✗ ${problem}`);
  if (problems.length > 0) return 1;
  io.log("✓ storage tuning: compress_after 2 hours, checkpoint_timeout 2h, wal_compression zstd.");
  io.log(
    `✓ rollup compression: ${ROLLUP_TIERS.length} tiers segmented by '${REQUIRED_SEGMENTBY}', each with a compression and a refresh policy.`,
  );
  return 0;
}

if (import.meta.main) {
  const { readFileSync } = await import("node:fs");
  process.exit(
    checkStorageTuning({
      read: (path) => readFileSync(path, "utf8"),
      log: (line) => console.log(line),
      error: (line) => console.error(line),
    }),
  );
}
