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

/**
 * Rollup tiers `metrics_raw` is ALLOWED to outlive.
 *
 * The coverage rule below exists because `dump.sh` could exclude raw from a
 * backup while raw was fully materialized into the rollups. A tier kept for less
 * time than raw breaks that, so it has to be declared here, deliberately, rather
 * than pass silently.
 *
 * `minute_rollups` is on the list because in 2.0.0 its retention is a
 * RESOLUTION window, not a coverage horizon: past 90 days a minute-resolution
 * read goes to raw (kept 1825 days) and a wider read goes to hourly (3650). What
 * that costs is the backup default, and `dump.sh` derives exactly that from the
 * live policies — `safe_to_exclude_raw` compares the retentions AND checks
 * whether the minute tier is refreshed at all, so a backup taken under this
 * shape includes raw.
 *
 * This replaces 1.x's `FROZEN_TIERS`. Those two aggregates were exempt from the
 * coverage rule because nothing refreshed them any more; here every tier is
 * refreshed, and the exemption is about retention alone. The distinction matters:
 * a frozen tier was decaying toward useless, while this one is load-bearing for
 * every short-horizon chart.
 */
export const RAW_MAY_OUTLIVE_TIERS = ["minute_rollups"] as const;

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
 * is never allowed in a migration: a recreate can only re-materialize as far
 * back as raw reaches, so it silently loses every older bucket. 2.0.0's
 * 0000_baseline.sql suspended that rule exactly once, under a dated note, and it
 * is back in force — which is why this parser gates the files rather than
 * trusting them.
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
 * Database image references a compose file or a workflow `services:` block
 * names. Only images that ARE a database are returned — a compose file also
 * names the server image, and a workflow also names actions' own images.
 */
export function databaseImages(yaml: string): string[] {
  const refs: string[] = [];
  for (const line of yaml.split("\n")) {
    const match = /^\s*image:\s*(\S+)\s*$/.exec(line);
    if (!match?.[1]) continue;
    if (/timescale|postgres/i.test(match[1])) refs.push(match[1]);
  }
  return refs;
}

/** The `ARG TIMESCALEDB_VERSION=` a Dockerfile's apt patterns interpolate. */
export function timescaledbPin(dockerfile: string): string | undefined {
  return /^\s*ARG\s+TIMESCALEDB_VERSION=(\S+)/m.exec(dockerfile)?.[1];
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

/**
 * Memory knobs the addon must size itself.
 *
 * The addon sets WAL and worker knobs but used to set no memory knobs at all,
 * so it inherited PostgreSQL's stock 128 MB shared_buffers / 4 MB work_mem
 * while the compose path gets timescaledb-tune sizing. The compose files run on
 * a real machine and may be retuned per host; the addon most often runs on a
 * 2 GB Home Assistant box and has nobody to tune it, so the sizing is pinned
 * here rather than left to the default.
 */
const REQUIRED_ADDON_MEMORY_SETTINGS = [
  "shared_buffers",
  "work_mem",
  "effective_cache_size",
  "maintenance_work_mem",
  "max_connections",
] as const;

/**
 * TimescaleDB's job scheduler on a small box. 8 workers x (cagg refresh over a
 * compressed chunk) does not fit in a 2 GB box alongside the server and the
 * ingest; the jobs queue instead of failing, which is the behaviour we want.
 */
const REQUIRED_ADDON_BACKGROUND_WORKERS = "4";

export interface CheckIO {
  read: (path: string) => string;
  log: (line: string) => void;
  error: (line: string) => void;
}

export const ADDON_CONF = "sunreye/rootfs/etc/s6-overlay/s6-rc.d/init-postgres/run";
const POLICY_SQL = "packages/db/src/timescale/policies.sql";

/**
 * The ONE database image every deployment surface and CI service must name.
 *
 * timescale/timescaledb carries no timescaledb_toolkit at any tag, and the -ha
 * image that does is 1333 MB and moves `data_directory` out from under the
 * compose volume mounts. This image is built from docker/timescaledb/Dockerfile
 * — postgres:17-bookworm plus the pinned extension, the toolkit, and the same
 * versioned-.so prune the addon performs.
 *
 * Why a gate: the new baseline schema needs `time_weight('LOCF', …)` and
 * `counter_agg` from the toolkit. If dev/CI and the addon ever carry different
 * extensions, a migration passes on one and fails on the other — the exact class
 * of bug apps/server/db-tests exists to catch, and it would catch it only on
 * whichever side CI happens to run.
 */
export const REQUIRED_DB_IMAGE = "ghcr.io/sunreye/timescaledb:pg17-ts2.28.2";

/**
 * The FULL patch version both Dockerfiles pin.
 *
 * A `2.28.*` apt pattern is not a pin: a rebuild resolves whatever patch is
 * newest (2.28.3 today), so the addon and the dev/CI image can ship different
 * extension binaries from the same commit — and the loader compatibility rule
 * the prune below rests on is stated in terms of a known version.
 */
export const REQUIRED_TIMESCALEDB_VERSION = "2.28.2";

/** Every file that names a database image. All six must agree. */
export const DB_IMAGE_SURFACES = [
  "docker-compose.yml",
  "docker-compose.db.yml",
  "docker/docker-compose.yml",
  ".github/workflows/ci.yml",
  ".github/workflows/db-restore.yml",
  ".github/workflows/db-weighted-rollups.yml",
] as const;

/** Compose files that start a postgres with `-c` flags. */
export const COMPOSE_PG_SURFACES = [
  "docker-compose.yml",
  "docker/docker-compose.yml",
  // The standalone dev database. It was exempt from this check, which is
  // backwards: it is the surface a storage measurement is taken on.
  "docker-compose.db.yml",
] as const;

/**
 * The workflow that publishes the image. It exists because a GitHub Actions
 * `services:` block cannot build an image inline, and three workflows consume
 * one — so the tag has to be in a registry before any of them runs.
 */
export const IMAGE_BUILD_WORKFLOW = ".github/workflows/db-image.yml";

/** The two Dockerfiles that install the extension from packagecloud. */
export const TIMESCALEDB_DOCKERFILES = [
  "sunreye/Dockerfile",
  "docker/timescaledb/Dockerfile",
] as const;

/**
 * #134. Rollup rows are materialized grouped by *bucket*, so without a
 * segmentby a per-metric range scan touches essentially every page in the
 * range — measured, 1 row per 8 KB block against ~143 rows/block in
 * metrics_raw. Every tier must therefore mirror metrics_raw's segmentby AND
 * carry a compression policy, because a segmentby with no policy never
 * compresses and a policy with no segmentby compresses into the wrong shape.
 * Neither half is any use alone, which is exactly how the original defect
 * survived: minute_rollups had the policy, hourly and daily had neither.
 *
 * THREE tiers since 2.0.0, not six. The two generations 1.x had to keep
 * refreshed forever — the unweighted originals and the dur_ms-weighted second
 * family — were collapsed into one that is right from birth.
 */
const ROLLUP_TIERS = ["minute_rollups", "hourly_rollups", "daily_rollups"] as const;
/**
 * The int2 identity, mirroring metrics_raw. Was `metric, inverter_id`;
 * `inverter_id` held the PROFILE id, so it was never a device key at all.
 */
const REQUIRED_SEGMENTBY = "device_id, metric_id";
/** The numbered structural file that declares the rollups' storage layout. */
const ROLLUP_STRUCTURAL_SQL = ["packages/db/src/timescale/0000_baseline.sql"];

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
/** Is raw deliberately allowed to reach back further than this tier? */
function rawMayOutlive(tier: string): boolean {
  return (RAW_MAY_OUTLIVE_TIERS as readonly string[]).includes(tier);
}

/**
 * Rollup tiers raw must not outlive.
 *
 * The declared ones are exempt: raw outliving them is a decision, and the backup
 * default derives from the live policies rather than from this list.
 */
function coverageProblems(days: Record<string, number>, raw: number): string[] {
  return Object.entries(days)
    .filter(
      ([target, retention]) =>
        target !== "metrics_raw" && !rawMayOutlive(target) && retention < raw,
    )
    .map(
      ([target, retention]) =>
        `metrics_raw is kept ${raw} day(s) but ${target} only ${retention} — raw then covers a range the rollups do not, and the addon's default backup excludes raw (#121, #133).`,
    );
}

/** Every retention policy must be authoritative on an already-configured database. */
function authoritativeRetentionProblems(policySql: string, targets: string[]): string[] {
  return targets
    .filter((target) => !removesRetentionBeforeAdding(policySql, target))
    .map(
      (target) =>
        `policies.sql adds a retention policy for ${target} without removing it first — \`if_not_exists => TRUE\` is a no-op on a configured deployment, so an interval change would never reach an existing database.`,
    );
}

function retentionProblems(io: CheckIO): string[] {
  const policySql = io.read(POLICY_SQL);
  const days = retentionDays(policySql);
  const raw = days["metrics_raw"];
  // Raw kept forever is not a failure — it is a deliberate shape. But the backup
  // default then has to include raw, which dump.sh handles.
  if (raw === undefined) return [];
  if (!Number.isFinite(raw)) {
    return ["metrics_raw retention interval is unparseable in policies.sql."];
  }
  const refresh =
    raw <= WIDEST_REFRESH_DAYS
      ? [
          `metrics_raw retention is ${raw} day(s), inside the widest continuous-aggregate refresh window (${WIDEST_REFRESH_DAYS} days) — a refresh would reach a chunk retention has dropped.`,
        ]
      : [];
  return [
    ...refresh,
    ...coverageProblems(days, raw),
    ...authoritativeRetentionProblems(policySql, Object.keys(days)),
  ];
}

/** #134: the tier compresses into the shape a per-metric range scan can use. */
function segmentbyProblems(tier: string, declared: string | undefined): string[] {
  if (declared === undefined) {
    return [`${tier} declares no compression settings in any numbered file (#134).`];
  }
  if (declared !== REQUIRED_SEGMENTBY) {
    return [
      `${tier} compress_segmentby is '${declared}', expected '${REQUIRED_SEGMENTBY}' — a rollup that does not mirror metrics_raw decompresses batches it does not need (#134).`,
    ];
  }
  return [];
}

/**
 * Every tier must be refreshed. There is one generation now, so an aggregate
 * nothing refreshes is an aggregate nothing can read — 1.x could leave the
 * minute pair frozen because a second family still answered those buckets.
 */
function refreshStateProblems(tier: string, refreshed: string[]): string[] {
  return refreshed.includes(tier)
    ? []
    : [
        `policies.sql arms no refresh policy for ${tier}; with one rollup generation an aggregate nothing refreshes is an aggregate nothing can read.`,
      ];
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

  const perTier = ROLLUP_TIERS.flatMap((tier) => [
    ...segmentbyProblems(tier, segmentby[tier]),
    ...(compressed.includes(tier)
      ? []
      : [
          `policies.sql declares no compression policy for ${tier}, so it can never compress (#134).`,
        ]),
    ...refreshStateProblems(tier, refreshed),
  ]);

  return [
    ...perTier,
    ...structural.flatMap((f) =>
      continuousAggregateDrops(f.sql).map(
        (drop) => `${f.path} would destroy a continuous aggregate: ${drop}`,
      ),
    ),
  ];
}

/** Step 2: exactly one database image, named identically on all six surfaces. */
function imageProblems(io: CheckIO): string[] {
  return DB_IMAGE_SURFACES.flatMap((surface) => {
    const refs = databaseImages(io.read(surface));
    if (refs.length === 0) {
      return [
        `${surface} names no database image; every surface must use '${REQUIRED_DB_IMAGE}' — dev/CI and the addon have to carry the same extensions (timescaledb_toolkit) or a migration passes on one and fails on the other.`,
      ];
    }
    return refs
      .filter((ref) => ref !== REQUIRED_DB_IMAGE)
      .map(
        (ref) =>
          `${surface} uses database image '${ref}', expected '${REQUIRED_DB_IMAGE}' — one image, or the toolkit exists on only one side.`,
      );
  });
}

/** Whatever the six surfaces pull has to be something we actually publish. */
function publishProblems(io: CheckIO): string[] {
  const workflow = io.read(IMAGE_BUILD_WORKFLOW);
  const repository = REQUIRED_DB_IMAGE.split(":")[0];
  const problems: string[] = [];
  if (repository !== undefined && !workflow.includes(repository)) {
    problems.push(
      `${IMAGE_BUILD_WORKFLOW} does not build '${repository}', which all ${DB_IMAGE_SURFACES.length} surfaces pull — a workflow \`services:\` block cannot build an image inline, so an unpublished tag fails every database job.`,
    );
  }
  if (!workflow.includes("docker/timescaledb/Dockerfile")) {
    problems.push(
      `${IMAGE_BUILD_WORKFLOW} does not build docker/timescaledb/Dockerfile, so the published image and the checked-in one can diverge.`,
    );
  }
  return problems;
}

/** The extension pin: full patch, the same in both Dockerfiles, toolkit installed. */
function pinProblems(io: CheckIO): string[] {
  const problems: string[] = [];
  for (const dockerfile of TIMESCALEDB_DOCKERFILES) {
    const content = io.read(dockerfile);
    const pin = timescaledbPin(content);
    if (pin === undefined) {
      problems.push(`${dockerfile} declares no ARG TIMESCALEDB_VERSION.`);
    } else if (!/^\d+\.\d+\.\d+$/.test(pin)) {
      problems.push(
        `${dockerfile} pins TIMESCALEDB_VERSION='${pin}', which is not a full patch version — the apt pattern then floats to whatever patch is newest, so two builds of this commit can ship different extension binaries. Expected '${REQUIRED_TIMESCALEDB_VERSION}'.`,
      );
    } else if (pin !== REQUIRED_TIMESCALEDB_VERSION) {
      problems.push(
        `${dockerfile} pins TIMESCALEDB_VERSION='${pin}', expected '${REQUIRED_TIMESCALEDB_VERSION}' — the addon and the dev/CI image must ship the same extension.`,
      );
    }
    if (!content.includes("timescaledb-toolkit-postgresql-")) {
      problems.push(
        `${dockerfile} does not install timescaledb-toolkit-postgresql-\${PG_MAJOR}; the baseline schema needs time_weight('LOCF', …) and counter_agg from timescaledb_toolkit.`,
      );
    }
    if (!content.includes("timescaledb-tsl-${TIMESCALEDB_VERSION}.")) {
      problems.push(
        `${dockerfile} lost the versioned-.so prune — the deb ships a .so per release since 2.17 (~420 MB), and keeping them all is most of the image.`,
      );
    }
  }
  return problems;
}

/** #111 follow-up: the addon sizes its own memory instead of inheriting defaults. */
function addonMemoryProblems(settings: Record<string, string>): string[] {
  const problems = REQUIRED_ADDON_MEMORY_SETTINGS.filter((key) => settings[key] === undefined).map(
    (key) =>
      `${ADDON_CONF}: ${key} is unset, so the addon inherits the PostgreSQL default while the compose path is tuned — on a 2 GB Home Assistant box that is where it hurts.`,
  );
  const workers = settings["timescaledb.max_background_workers"];
  if (workers !== REQUIRED_ADDON_BACKGROUND_WORKERS) {
    problems.push(
      `${ADDON_CONF}: timescaledb.max_background_workers is '${workers ?? "unset"}', expected '${REQUIRED_ADDON_BACKGROUND_WORKERS}' — 8 concurrent jobs do not fit in a 2 GB box alongside the server and the ingest.`,
    );
  }
  return problems;
}

export function checkStorageTuning(io: CheckIO): number {
  const addonSettings = parsePgConf(io.read(ADDON_CONF));
  const problems = [
    ...policyProblems(io),
    ...rollupProblems(io),
    ...retentionProblems(io),
    ...settingsProblems(ADDON_CONF, addonSettings),
    ...addonMemoryProblems(addonSettings),
    ...COMPOSE_PG_SURFACES.flatMap((compose) =>
      settingsProblems(compose, parseComposePgFlags(io.read(compose))),
    ),
    ...imageProblems(io),
    ...pinProblems(io),
    ...publishProblems(io),
  ];

  for (const problem of problems) io.error(`✗ ${problem}`);
  if (problems.length > 0) return 1;
  io.log("✓ storage tuning: compress_after 2 hours, checkpoint_timeout 2h, wal_compression zstd.");
  io.log(
    `✓ one database image: ${REQUIRED_DB_IMAGE} on ${DB_IMAGE_SURFACES.length} surfaces, TimescaleDB ${REQUIRED_TIMESCALEDB_VERSION} pinned with the toolkit in both Dockerfiles.`,
  );
  io.log(
    `✓ rollup compression: ${ROLLUP_TIERS.length} tiers segmented by '${REQUIRED_SEGMENTBY}', each refreshed and with a compression policy; raw may outlive ${RAW_MAY_OUTLIVE_TIERS.length} of them by declaration.`,
  );
  return 0;
}

if (import.meta.main) {
  const { readFileSync } = await import("node:fs");
  process.exit(
    checkStorageTuning({
      // A surface that has gone missing is a finding, not a stack trace: the
      // checks below all report "declares no …" for empty content, which names
      // the file the way every other failure does.
      read: (path) => {
        try {
          return readFileSync(path, "utf8");
        } catch {
          return "";
        }
      },
      log: (line) => console.log(line),
      error: (line) => console.error(line),
    }),
  );
}
