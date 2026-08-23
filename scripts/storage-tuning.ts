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

/** True when the file removes the target's policy before (re)adding it. */
export function removesBeforeAdding(sql: string, target: string): boolean {
  const order = statements(sql).flatMap((statement) => {
    const removed = REMOVE_COMPRESSION.exec(statement);
    if (removed?.[1] === target) return ["remove"];
    const added = ADD_COMPRESSION.exec(statement);
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
    problems.push(`${where}: full_page_writes is off — SD offers no atomic-write guarantee (#111).`);
  }
  return problems;
}

export function checkStorageTuning(io: CheckIO): number {
  const problems = [
    ...policyProblems(io),
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
