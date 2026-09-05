import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  compressSegmentBy,
  compressionPolicies,
  continuousAggregateDrops,
  refreshPolicies,
  RAW_MAY_OUTLIVE_TIERS,
  parseComposePgFlags,
  parsePgConf,
  removesBeforeAdding,
  removesRetentionBeforeAdding,
  retentionDays,
  intervalDays,
  checkStorageTuning,
  cli,
  productionCheckIo,
  databaseImages,
  timescaledbPin,
  DB_IMAGE_SURFACES,
  REQUIRED_DB_IMAGE,
  REQUIRED_TIMESCALEDB_VERSION,
  TIMESCALEDB_DOCKERFILES,
  ADDON_CONF,
  COMPOSE_PG_SURFACES,
  IMAGE_BUILD_WORKFLOW,
} from "./storage-tuning";

const REPO = join(import.meta.dir, "..");
const TIMESCALE = join(REPO, "packages/db/src/timescale");

const read = (path: string) => readFileSync(join(REPO, path), "utf8");
const policies = readFileSync(join(TIMESCALE, "policies.sql"), "utf8");
/**
 * The structural file. 1.x had four numbered files, and the 2-hour retune had one
 * of its own (`0001_compress_after_2h.sql`) so the change had a point in history;
 * 2.0.0 collapsed them into a baseline, and the interval it recorded now lives
 * only in policies.sql, where it is re-applied on every start.
 */
const baselineMigration = readFileSync(join(TIMESCALE, "0000_baseline.sql"), "utf8");

/** A conf/compose stand-in that satisfies every non-policy half of the gate. */
const TUNED_CONF = [
  "checkpoint_timeout = '2h'",
  "wal_compression = 'zstd'",
  "shared_buffers = '256MB'",
  "work_mem = '8MB'",
  "effective_cache_size = '1GB'",
  "maintenance_work_mem = '128MB'",
  "max_connections = 40",
  "timescaledb.max_background_workers = 4",
  "",
].join("\n");
const TUNED_DOCKERFILE = [
  `ARG TIMESCALEDB_VERSION=${REQUIRED_TIMESCALEDB_VERSION}`,
  '       "timescaledb-2-postgresql-${PG_MAJOR}=${TIMESCALEDB_VERSION}.*" \\',
  '       "timescaledb-2-loader-postgresql-${PG_MAJOR}=${TIMESCALEDB_VERSION}.*" \\',
  '       "timescaledb-toolkit-postgresql-${PG_MAJOR}=1:1.25.0*" \\',
  "    && find \"/usr/lib/postgresql/${PG_MAJOR}/lib\" -name 'timescaledb-*.so' \\",
  '       ! -name "timescaledb-${TIMESCALEDB_VERSION}.*" \\',
  '       ! -name "timescaledb-tsl-${TIMESCALEDB_VERSION}.*" -delete \\',
  "",
].join("\n");
const TUNED_COMPOSE = [
  `    image: ${REQUIRED_DB_IMAGE}`,
  "      - checkpoint_timeout=2h",
  "      - wal_compression=zstd",
  "",
].join("\n");

/**
 * `checkStorageTuning` over the shipped files, with `policies.sql` substituted.
 * Everything the policy half does not care about is stubbed tuned, so a failure
 * here is always about the SQL under test — except the SQL files themselves and
 * the image/pin surfaces, which are read from the tree.
 */
const runShipped = (policySql: string) => {
  const errors: string[] = [];
  const code = checkStorageTuning({
    read: (path) =>
      path.endsWith("policies.sql")
        ? policySql
        : path.endsWith(".sql")
          ? read(path)
          : path.includes("init-postgres")
            ? TUNED_CONF
            : (COMPOSE_PG_SURFACES as readonly string[]).includes(path)
              ? TUNED_COMPOSE
              : read(path),
    log: () => {},
    error: (line) => errors.push(line),
  });
  return { code, errors };
};

const ADDON_CONF_SCRIPT = "sunreye/rootfs/etc/s6-overlay/s6-rc.d/init-postgres/run";
const COMPOSE_FILES = ["docker-compose.yml", "docker/docker-compose.yml", "docker-compose.db.yml"];

describe("compressionPolicies", () => {
  test("reads the target and the interval of an add", () => {
    expect(
      compressionPolicies("SELECT add_compression_policy('metrics_raw', INTERVAL '2 hours');"),
    ).toEqual([{ target: "metrics_raw", after: "2 hours" }]);
  });

  test("reads the columnstore spelling with a named after argument", () => {
    expect(
      compressionPolicies(
        "SELECT add_columnstore_policy('metrics_raw', after => INTERVAL '2 hours');",
      ),
    ).toEqual([{ target: "metrics_raw", after: "2 hours" }]);
  });

  test("a later add for the same target wins", () => {
    const sql = [
      "SELECT add_compression_policy('m', INTERVAL '1 day');",
      "SELECT add_compression_policy('m', INTERVAL '2 hours');",
    ].join(`\n--> statement-breakpoint\n`);
    expect(compressionPolicies(sql)).toEqual([{ target: "m", after: "2 hours" }]);
  });

  test("a remove leaves no policy behind", () => {
    const sql = [
      "SELECT add_compression_policy('m', INTERVAL '1 day');",
      "SELECT remove_compression_policy('m', if_exists => TRUE);",
    ].join(`\n--> statement-breakpoint\n`);
    expect(compressionPolicies(sql)).toEqual([]);
  });

  test("a commented-out policy does not count", () => {
    expect(compressionPolicies("-- SELECT add_compression_policy('m', INTERVAL '1 day');")).toEqual(
      [],
    );
  });

  test("an empty file has no policies", () => {
    expect(compressionPolicies("")).toEqual([]);
  });
});

describe("removesBeforeAdding", () => {
  const removeThenAdd = [
    "SELECT remove_compression_policy('m', if_exists => TRUE);",
    "SELECT add_compression_policy('m', INTERVAL '2 hours');",
  ].join(`\n--> statement-breakpoint\n`);

  test("true when the remove precedes the add", () => {
    expect(removesBeforeAdding(removeThenAdd, "m")).toBe(true);
  });

  test("false for an add-only file — if_not_exists keeps the old interval", () => {
    expect(
      removesBeforeAdding("SELECT add_compression_policy('m', INTERVAL '2 hours');", "m"),
    ).toBe(false);
  });

  test("false for another target's remove+add", () => {
    expect(removesBeforeAdding(removeThenAdd, "other")).toBe(false);
  });
});

describe("continuousAggregateDrops", () => {
  test("flags a dropped materialized view", () => {
    expect(continuousAggregateDrops("DROP MATERIALIZED VIEW minute_rollups;")).toHaveLength(1);
  });

  test("ignores a mention inside a comment", () => {
    expect(continuousAggregateDrops("-- never DROP MATERIALIZED VIEW minute_rollups")).toEqual([]);
  });

  test("a policy-only statement is not a drop", () => {
    expect(continuousAggregateDrops("SELECT remove_compression_policy('m');")).toEqual([]);
  });
});

describe("parsePgConf", () => {
  test("reads assignments and strips quotes", () => {
    expect(parsePgConf("wal_compression = zstd\nlisten_addresses = '127.0.0.1'\n")).toEqual({
      wal_compression: "zstd",
      listen_addresses: "127.0.0.1",
    });
  });

  test("a trailing comment is not part of the value", () => {
    expect(parsePgConf("checkpoint_timeout = 2h # wider spacing")?.checkpoint_timeout).toBe("2h");
  });

  test("a commented-out setting is absent", () => {
    expect(parsePgConf("# wal_compression = off").wal_compression).toBeUndefined();
  });

  test("the last assignment wins, as postgres reads it", () => {
    expect(
      parsePgConf("checkpoint_timeout = 30min\ncheckpoint_timeout = 2h").checkpoint_timeout,
    ).toBe("2h");
  });

  test("a dotted setting name is a key", () => {
    expect(parsePgConf("timescaledb.telemetry_level = off")["timescaledb.telemetry_level"]).toBe(
      "off",
    );
  });

  test("an empty conf has no settings", () => {
    expect(parsePgConf("")).toEqual({});
  });
});

describe("parseComposePgFlags", () => {
  test("reads the -c key=value list items", () => {
    const yaml = [
      "    command:",
      "      - postgres",
      "      - -c",
      "      - wal_compression=zstd",
    ].join("\n");
    expect(parseComposePgFlags(yaml)).toEqual({ wal_compression: "zstd" });
  });

  test("the later flag wins, as on the postgres command line", () => {
    const yaml = "      - checkpoint_timeout=30min\n      - checkpoint_timeout=2h";
    expect(parseComposePgFlags(yaml).checkpoint_timeout).toBe("2h");
  });

  test("a compose file with no flags yields nothing", () => {
    expect(parseComposePgFlags("services:\n  postgres:\n    image: x\n")).toEqual({});
  });
});

describe("metrics_raw compression policy (#110)", () => {
  test("compresses after 2 hours", () => {
    expect(compressionPolicies(policies)).toContainEqual({
      target: "metrics_raw",
      after: "2 hours",
    });
  });

  test("is authoritative: the policy is removed before it is re-added", () => {
    expect(removesBeforeAdding(policies, "metrics_raw")).toBe(true);
  });

  test("re-applying policies.sql converges on one 2-hour policy", () => {
    const twice = `${policies}\n--> statement-breakpoint\n${policies}`;
    expect(compressionPolicies(twice).filter((p) => p.target === "metrics_raw")).toEqual([
      { target: "metrics_raw", after: "2 hours" },
    ]);
  });

  test("the baseline enables compression on metrics_raw but declares no interval", () => {
    // Structure belongs in the numbered file, tuning in policies.sql. An
    // interval here would be applied once and then never reach an existing
    // deployment again — which is exactly why 1.x needed a numbered retune file.
    expect(compressSegmentBy(baselineMigration)["metrics_raw"]).toBe(GATE_SEGMENTBY);
    expect(compressionPolicies(baselineMigration)).toEqual([]);
  });

  test("the baseline drops no continuous aggregate", () => {
    expect(continuousAggregateDrops(baselineMigration)).toEqual([]);
  });
});

describe("WAL and checkpoint settings (#111)", () => {
  const expected = { checkpoint_timeout: "2h", wal_compression: "zstd" } as const;

  test("the addon startup path writes them into sunreye.conf", () => {
    const settings = parsePgConf(read(ADDON_CONF_SCRIPT));
    expect(settings.checkpoint_timeout).toBe(expected.checkpoint_timeout);
    expect(settings.wal_compression).toBe(expected.wal_compression);
  });

  test("the addon never disables full_page_writes — SD has no atomic write", () => {
    const settings = parsePgConf(read(ADDON_CONF_SCRIPT));
    expect(settings.full_page_writes ?? "on").toBe("on");
  });

  for (const compose of COMPOSE_FILES) {
    test(`${compose} passes the same settings as -c flags`, () => {
      const flags = parseComposePgFlags(read(compose));
      expect(flags.checkpoint_timeout).toBe(expected.checkpoint_timeout);
      expect(flags.wal_compression).toBe(expected.wal_compression);
    });

    test(`${compose} never disables full_page_writes`, () => {
      expect(parseComposePgFlags(read(compose)).full_page_writes ?? "on").toBe("on");
    });
  }
});

/**
 * Every rollup tier the #134 half of the gate requires; see the describe below.
 *
 * Three since 2.0.0. 1.x had six because the dur_ms-weighted family had to be
 * added alongside the unweighted one it corrected, and neither could be dropped.
 */
const GATE_ROLLUP_TIERS = ["minute_rollups", "hourly_rollups", "daily_rollups"] as const;

/** The int2 identity every timeseries relation compresses by since 2.0.0. */
const GATE_SEGMENTBY = "device_id, metric_id";

/** The rollup half of a passing fixture, so the #110/#111 tests below can ignore it. */
const rollupSegmentBySql = (tiers: readonly string[]) =>
  tiers
    .map(
      (t) =>
        `ALTER MATERIALIZED VIEW ${t} SET (timescaledb.compress = true, timescaledb.compress_segmentby = '${GATE_SEGMENTBY}');`,
    )
    .join("\n--> statement-breakpoint\n");

const rollupPolicySql = (tiers: readonly string[]) =>
  tiers
    .flatMap((t) => [
      // Every tier is refreshed now: with one generation, an unrefreshed
      // aggregate is one nothing can read.
      `SELECT add_continuous_aggregate_policy('${t}', start_offset => INTERVAL '1 day');`,
      `SELECT remove_compression_policy('${t}', if_exists => TRUE);`,
      `SELECT add_compression_policy('${t}', INTERVAL '7 days', if_not_exists => TRUE);`,
    ])
    .join("\n--> statement-breakpoint\n");

/** A whole file set the gate passes on, for per-surface substitution below. */
const GOOD_FILES: Record<string, string> = {
  "packages/db/src/timescale/0000_baseline.sql": rollupSegmentBySql(GATE_ROLLUP_TIERS),
  "packages/db/src/timescale/policies.sql":
    "SELECT remove_compression_policy('metrics_raw', if_exists => TRUE);\n" +
    "--> statement-breakpoint\n" +
    "SELECT add_compression_policy('metrics_raw', INTERVAL '2 hours', if_not_exists => TRUE);\n" +
    "--> statement-breakpoint\n" +
    rollupPolicySql(GATE_ROLLUP_TIERS),
  "sunreye/rootfs/etc/s6-overlay/s6-rc.d/init-postgres/run": `${TUNED_CONF}full_page_writes = 'on'\n`,
  "docker-compose.yml": TUNED_COMPOSE,
  "docker/docker-compose.yml": TUNED_COMPOSE,
  "docker-compose.db.yml": TUNED_COMPOSE,
  ".github/workflows/ci.yml": `        image: ${REQUIRED_DB_IMAGE}\n`,
  ".github/workflows/db-restore.yml": `        image: ${REQUIRED_DB_IMAGE}\n`,
  ".github/workflows/db-image.yml":
    "  IMAGE: ghcr.io/sunreye/timescaledb\n          file: docker/timescaledb/Dockerfile\n",
  "sunreye/Dockerfile": TUNED_DOCKERFILE,
  "docker/timescaledb/Dockerfile": TUNED_DOCKERFILE,
};
/** `checkStorageTuning` over `GOOD_FILES`, with the named surfaces replaced. */
const runGate = (over: Record<string, string> = {}) => {
  const files = { ...GOOD_FILES, ...over };
  const errors: string[] = [];
  const code = checkStorageTuning({
    read: (path) => files[path] ?? "",
    log: () => {},
    error: (line) => errors.push(line),
  });
  return { code, errors };
};

describe("checkStorageTuning", () => {
  const run = runGate;

  test("passes when every surface carries the tuned values", () => {
    expect(run()).toEqual({ code: 0, errors: [] });
  });

  test("fails when compress_after drifts back to a day", () => {
    const { code, errors } = run({
      "packages/db/src/timescale/policies.sql":
        "SELECT remove_compression_policy('metrics_raw', if_exists => TRUE);\n" +
        "--> statement-breakpoint\n" +
        "SELECT add_compression_policy('metrics_raw', INTERVAL '1 day');\n" +
        "--> statement-breakpoint\n" +
        rollupPolicySql(GATE_ROLLUP_TIERS),
    });
    expect(code).toBe(1);
    expect(errors.join("\n")).toMatch(/compress_after is '1 day'/);
  });

  test("fails when a policy is added without removing the old one first", () => {
    const { code, errors } = run({
      "packages/db/src/timescale/policies.sql":
        "SELECT add_compression_policy('metrics_raw', INTERVAL '2 hours', if_not_exists => TRUE);\n" +
        "--> statement-breakpoint\n" +
        rollupPolicySql(GATE_ROLLUP_TIERS),
    });
    expect(code).toBe(1);
    expect(errors.join("\n")).toMatch(/remove metrics_raw's policy before/);
  });

  test("fails when one compose file drifts out of step with the others", () => {
    const { code, errors } = run({
      "docker/docker-compose.yml": "      - checkpoint_timeout=30min\n      - wal_compression=on\n",
    });
    expect(code).toBe(1);
    expect(errors.join("\n")).toMatch(/checkpoint_timeout is '30min'/);
    expect(errors.join("\n")).toMatch(/wal_compression is 'on'/);
  });

  test("refuses full_page_writes=off however tempting the FPI saving", () => {
    const { code, errors } = run({
      "sunreye/rootfs/etc/s6-overlay/s6-rc.d/init-postgres/run":
        "checkpoint_timeout = '2h'\nwal_compression = 'zstd'\nfull_page_writes = 'off'\n",
    });
    expect(code).toBe(1);
    expect(errors.join("\n")).toMatch(/full_page_writes is off/);
  });

  test("fails when the policy file would destroy a continuous aggregate", () => {
    const { code, errors } = run({
      "packages/db/src/timescale/policies.sql":
        "DROP MATERIALIZED VIEW minute_rollups;\n" +
        "--> statement-breakpoint\n" +
        "SELECT remove_compression_policy('metrics_raw', if_exists => TRUE);\n" +
        "--> statement-breakpoint\n" +
        "SELECT add_compression_policy('metrics_raw', INTERVAL '2 hours');\n" +
        "--> statement-breakpoint\n" +
        rollupPolicySql(GATE_ROLLUP_TIERS),
    });
    expect(code).toBe(1);
    expect(errors.join("\n")).toMatch(/destroy a continuous aggregate/);
  });
});

/** The one structural file, since 2.0.0 collapsed the four into a baseline. */
const BASELINE = readFileSync(join(TIMESCALE, "0000_baseline.sql"), "utf8");

/**
 * The file's STATEMENTS, comments removed.
 *
 * The header explains at length what `avg(value)` and the dur_ms weighting got
 * wrong, so an assertion that the file no longer CONTAINS them has to look at
 * the SQL and not at the prose about the SQL.
 */
const BASELINE_SQL = BASELINE.split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

describe("compressSegmentBy", () => {
  test("reads the segmentby of a continuous aggregate", () => {
    expect(
      compressSegmentBy(
        "ALTER MATERIALIZED VIEW hourly_rollups SET (\n" +
          "  timescaledb.compress = true,\n" +
          "  timescaledb.compress_segmentby = 'device_id, metric_id'\n);",
      ),
    ).toEqual({ hourly_rollups: "device_id, metric_id" });
  });

  test("reads the segmentby of a plain hypertable too", () => {
    expect(
      compressSegmentBy(
        "ALTER TABLE metrics_raw SET (timescaledb.compress, timescaledb.compress_segmentby = 'device_id, metric_id');",
      ),
    ).toEqual({ metrics_raw: "device_id, metric_id" });
  });

  test("compression enabled with no segmentby is recorded as the empty string, not absent", () => {
    // This is precisely the pre-#134 state of minute_rollups: compression on,
    // segmentby missing, so a per-metric query decompresses batches it does not
    // need. "Absent" and "explicitly nothing" have to be distinguishable.
    expect(
      compressSegmentBy(
        "ALTER MATERIALIZED VIEW minute_rollups SET (timescaledb.compress = true);",
      ),
    ).toEqual({
      minute_rollups: "",
    });
  });

  test("a later statement for the same target wins", () => {
    const sql = [
      "ALTER MATERIALIZED VIEW m SET (timescaledb.compress = true);",
      "ALTER MATERIALIZED VIEW m SET (timescaledb.compress_segmentby = 'metric');",
    ].join(`\n--> statement-breakpoint\n`);
    expect(compressSegmentBy(sql)).toEqual({ m: "metric" });
  });

  test("a commented-out setting does not count", () => {
    expect(
      compressSegmentBy("-- ALTER MATERIALIZED VIEW m SET (timescaledb.compress = true);"),
    ).toEqual({});
  });
});

describe("refreshPolicies", () => {
  test("reads the target of a continuous-aggregate refresh policy", () => {
    expect(
      refreshPolicies(
        "SELECT add_continuous_aggregate_policy('hourly_rollups',\n  start_offset => INTERVAL '3 hours');",
      ),
    ).toEqual(["hourly_rollups"]);
  });

  test("a commented-out policy does not count", () => {
    expect(refreshPolicies("-- SELECT add_continuous_aggregate_policy('x');")).toEqual([]);
  });
});

describe("rollup compression (#134)", () => {
  test("every rollup tier segments by the int2 identity, mirroring metrics_raw", () => {
    const declared = compressSegmentBy(BASELINE);
    for (const tier of GATE_ROLLUP_TIERS) {
      expect(declared[tier], `${tier} must declare a segmentby`).toBe(GATE_SEGMENTBY);
    }
    // metrics_raw itself, which the tiers exist to mirror.
    expect(declared["metrics_raw"]).toBe(GATE_SEGMENTBY);
  });

  test("every rollup tier has a compression policy, or it can never compress at all", () => {
    // The original defect: policies.sql armed minute_rollups alone, so
    // hourly_rollups and daily_rollups would never compress no matter what
    // compress_after said.
    const targets = compressionPolicies(policies).map((p) => p.target);
    for (const tier of GATE_ROLLUP_TIERS) expect(targets).toContain(tier);
  });

  test("each rollup compression policy is authoritative: removed before it is re-added", () => {
    for (const tier of GATE_ROLLUP_TIERS) expect(removesBeforeAdding(policies, tier)).toBe(true);
  });

  test("re-applying policies.sql converges on one policy per tier", () => {
    const twice = `${policies}\n--> statement-breakpoint\n${policies}`;
    const found = compressionPolicies(twice);
    for (const tier of GATE_ROLLUP_TIERS) {
      expect(found.filter((p) => p.target === tier)).toHaveLength(1);
    }
  });

  test("the baseline creates the three tiers and drops nothing", () => {
    // The never-DROP rule was suspended once, under a dated note in the file
    // header, to REPLACE two generations. The replacement itself must not carry a
    // drop: 0000_baseline.sql only ever runs on a database that has never had
    // these aggregates, and a DROP in it would mean it was written to run
    // somewhere else.
    expect(continuousAggregateDrops(BASELINE)).toEqual([]);
  });

  test("the baseline says, with a date, why the never-DROP rule was suspended", () => {
    // The one thing a future reader must not have to reconstruct: that this was a
    // deliberate one-time break and not a precedent.
    expect(BASELINE).toMatch(/NEVER-DROP RULE IS SUSPENDED, ONCE, ON 2026-08-27/);
    expect(BASELINE).toMatch(/NOT PRECEDENT/);
  });

  test("the tiers materialize toolkit PARTIALS, never a finished mean", () => {
    // `average(tw)` of a one-sample bucket is NULL and a mean of means is not a
    // mean, so the partial is what makes both interpolation and the hierarchy
    // possible. A finished average here would be the 1.x defect again.
    expect(BASELINE_SQL).toContain("time_weight('LOCF', time, value)");
    expect(BASELINE_SQL).toContain("rollup(tw)");
    expect(BASELINE_SQL).not.toMatch(/\bavg\(value\)/);
    // And the dur_ms weighting it replaced is gone from the aggregates.
    expect(BASELINE_SQL).not.toMatch(/sum\(value \* coalesce\(dur_ms/);
  });

  test("counter_agg is on the hourly and daily tiers only", () => {
    // 184 B per CounterSummary partial: on the minute tier that is ~28 MB per
    // device-day uncompressed, which is the hot window this release shrinks.
    const minuteBlock = BASELINE_SQL.slice(
      BASELINE_SQL.indexOf("CREATE MATERIALIZED VIEW IF NOT EXISTS minute_rollups"),
      BASELINE_SQL.indexOf("CREATE MATERIALIZED VIEW IF NOT EXISTS hourly_rollups"),
    );
    expect(minuteBlock).not.toContain("counter_agg");
    expect(BASELINE_SQL).toContain("counter_agg(time, value)");
    expect(BASELINE_SQL).toContain("rollup(ctr)");
  });

  test("the daily tier reads the hourly tier, not raw", () => {
    const dailyBlock = BASELINE_SQL.slice(
      BASELINE_SQL.indexOf("CREATE MATERIALIZED VIEW IF NOT EXISTS daily_rollups"),
    );
    expect(dailyBlock).toContain("FROM hourly_rollups");
    expect(dailyBlock).not.toContain("FROM metrics_raw");
  });

  test("every created aggregate is named *_rollups, or drizzle would emit DROP VIEW for it", () => {
    // drizzle.config.ts's `tablesFilter: ["!*_rollups"]` is the only thing that
    // keeps push/pull from trying to drop a continuous aggregate.
    const created = [...BASELINE_SQL.matchAll(/CREATE MATERIALIZED VIEW IF NOT EXISTS (\w+)/g)];
    expect(created).toHaveLength(GATE_ROLLUP_TIERS.length);
    for (const [, name] of created) expect(name).toMatch(/_rollups$/);
  });

  test("the baseline guards the toolkit with an actionable error", () => {
    // Without timescaledb_toolkit the file cannot be applied at all, and
    // "extension is not available" is not an action a Home Assistant addon user
    // can take — replacing the image is, so the message names it.
    expect(BASELINE_SQL).toContain("CREATE EXTENSION IF NOT EXISTS timescaledb_toolkit");
    expect(BASELINE_SQL).toMatch(/RAISE EXCEPTION/);
    expect(BASELINE_SQL).toContain(REQUIRED_DB_IMAGE);
  });

  test("every tier is refreshed — with one generation, nothing else answers its buckets", () => {
    const refreshed = refreshPolicies(policies);
    for (const tier of GATE_ROLLUP_TIERS) expect(refreshed).toContain(tier);
  });

  test("the refresh offsets are a chain: the child never outruns its parent", () => {
    // daily_rollups is materialized FROM hourly_rollups, so a daily end_offset
    // at or below hourly's would build days from unfinished hours.
    const endOffsets = Object.fromEntries(
      [
        ...policies.matchAll(
          /add_continuous_aggregate_policy\('(\w+)'[\s\S]*?end_offset\s*=>\s*INTERVAL '([^']+)'/g,
        ),
      ].map(([, tier, offset]) => [tier, intervalDays(offset ?? "")]),
    );
    expect(endOffsets["daily_rollups"]).toBeGreaterThan(endOffsets["hourly_rollups"] ?? 0);
  });
});

describe("checkStorageTuning — rollup compression (#134)", () => {
  const SEGMENTBY_SQL = (tiers: readonly string[], segmentby = GATE_SEGMENTBY) =>
    segmentby === GATE_SEGMENTBY
      ? rollupSegmentBySql(tiers)
      : tiers
          .map(
            (t) =>
              `ALTER MATERIALIZED VIEW ${t} SET (timescaledb.compress = true, timescaledb.compress_segmentby = '${segmentby}');`,
          )
          .join("\n--> statement-breakpoint\n");

  const POLICY_SQL_FOR = (tiers: readonly string[]) =>
    [
      "SELECT remove_compression_policy('metrics_raw', if_exists => TRUE);",
      "SELECT add_compression_policy('metrics_raw', INTERVAL '2 hours', if_not_exists => TRUE);",
      rollupPolicySql(tiers),
    ].join("\n--> statement-breakpoint\n");

  // Only the SQL differs from the shared passing set — everything else (the
  // conf, the compose flags, the image surfaces) stays tuned so a failure here
  // is always about the rollups.
  const GOOD: Record<string, string> = {
    ...GOOD_FILES,
    "packages/db/src/timescale/policies.sql": POLICY_SQL_FOR(GATE_ROLLUP_TIERS),
    "packages/db/src/timescale/0000_baseline.sql": SEGMENTBY_SQL(GATE_ROLLUP_TIERS),
  };
  const run = (over: Record<string, string> = {}) => runGate({ ...GOOD, ...over });

  test("passes when every rollup tier is segmented and has a compression policy", () => {
    expect(run()).toEqual({ code: 0, errors: [] });
  });

  test("fails when a rollup tier has compression on but no segmentby", () => {
    // The original minute_rollups defect: compressed, but interleaving every
    // metric within a batch.
    const { code, errors } = run({
      "packages/db/src/timescale/0000_baseline.sql":
        "ALTER MATERIALIZED VIEW minute_rollups SET (timescaledb.compress = true);\n" +
        "--> statement-breakpoint\n" +
        SEGMENTBY_SQL(["hourly_rollups", "daily_rollups"]),
    });
    expect(code).toBe(1);
    expect(errors.join("\n")).toMatch(/minute_rollups/);
    expect(errors.join("\n")).toMatch(/segmentby/i);
  });

  test("fails when a tier has no compression policy at all", () => {
    const { code, errors } = run({
      "packages/db/src/timescale/policies.sql": POLICY_SQL_FOR(
        GATE_ROLLUP_TIERS.filter((t) => t !== "daily_rollups"),
      ),
    });
    expect(code).toBe(1);
    expect(errors.join("\n")).toMatch(/daily_rollups/);
  });

  test("fails when a tier is never refreshed — nothing else answers its buckets", () => {
    const { code, errors } = run({
      "packages/db/src/timescale/policies.sql": POLICY_SQL_FOR(GATE_ROLLUP_TIERS).replace(
        "SELECT add_continuous_aggregate_policy('hourly_rollups', start_offset => INTERVAL '1 day');",
        "SELECT 1;",
      ),
    });
    expect(code).toBe(1);
    expect(errors.join("\n")).toMatch(/hourly_rollups/);
  });

  test("fails when a segmentby drifts away from metrics_raw's columns", () => {
    // The 1.x identity, specifically: a tier left on 'metric, inverter_id' after
    // the re-key would compress by columns the hypertable no longer has.
    const { code, errors } = run({
      "packages/db/src/timescale/0000_baseline.sql": SEGMENTBY_SQL(
        GATE_ROLLUP_TIERS,
        "metric, inverter_id",
      ),
    });
    expect(code).toBe(1);
    expect(errors.join("\n")).toMatch(/metric, inverter_id/);
  });

  test("fails when a numbered migration would drop a continuous aggregate", () => {
    const { code, errors } = run({
      "packages/db/src/timescale/0000_baseline.sql":
        "DROP MATERIALIZED VIEW minute_rollups;\n--> statement-breakpoint\n" +
        SEGMENTBY_SQL(GATE_ROLLUP_TIERS),
    });
    expect(code).toBe(1);
    expect(errors.join("\n")).toMatch(/destroy a continuous aggregate/);
  });

  test("the real repo files pass the gate", () => {
    const errors: string[] = [];
    const code = checkStorageTuning({ read, log: () => {}, error: (l) => errors.push(l) });
    expect(errors).toEqual([]);
    expect(code).toBe(0);
  });
});

describe("retentionDays", () => {
  test("reads each target's interval in days", () => {
    expect(
      retentionDays(
        [
          "SELECT add_retention_policy('metrics_raw', INTERVAL '90 days', if_not_exists => TRUE);",
          "--> statement-breakpoint",
          "SELECT add_retention_policy('hourly_rollups', INTERVAL '3650 days', if_not_exists => TRUE);",
        ].join("\n"),
      ),
    ).toEqual({ metrics_raw: 90, hourly_rollups: 3650 });
  });

  test("a target with no policy has no entry — that is what 'kept forever' means", () => {
    // `daily_rollups` deliberately has none. An entry of Infinity would invite a
    // caller to compare it numerically and get a nonsense answer.
    expect(
      retentionDays("SELECT add_retention_policy('minute_rollups', INTERVAL '90 days');"),
    ).not.toHaveProperty("daily_rollups");
  });

  test("a remove drops the earlier declaration, so re-running the file converges", () => {
    const sql = [
      "SELECT add_retention_policy('metrics_raw', INTERVAL '7 days');",
      "--> statement-breakpoint",
      "SELECT remove_retention_policy('metrics_raw', if_exists => TRUE);",
      "--> statement-breakpoint",
      "SELECT add_retention_policy('metrics_raw', INTERVAL '90 days');",
    ].join("\n");
    expect(retentionDays(sql)).toEqual({ metrics_raw: 90 });
  });

  test("converts every interval unit the policies could use", () => {
    expect(intervalDays("90 days")).toBe(90);
    expect(intervalDays("2 hours")).toBeCloseTo(2 / 24, 8);
    expect(intervalDays("30 minutes")).toBeCloseTo(30 / 1440, 8);
    expect(intervalDays("2 weeks")).toBe(14);
    expect(intervalDays("1 year")).toBe(365);
  });

  test("an interval it cannot read is NaN, not a guess", () => {
    // A silent 0 would make a broken policy look like the tightest possible one.
    expect(Number.isNaN(intervalDays("a fortnight"))).toBe(true);
    expect(Number.isNaN(intervalDays(""))).toBe(true);
  });
});

describe("the retention invariant", () => {
  /**
   * `checkStorageTuning` over the SHIPPED policy file, with one retention
   * interval rewritten — so the invariant is asserted against the real file
   * rather than against a fixture that could drift away from it.
   */
  const withRetention = (target: string, interval: string) => {
    const rewritten = policies.replace(
      new RegExp(`add_retention_policy\\('${target}', INTERVAL '[^']+'`),
      `add_retention_policy('${target}', INTERVAL '${interval}'`,
    );
    return runShipped(rewritten);
  };

  test("the shipped policies satisfy it", () => {
    expect(runShipped(policies)).toEqual({ code: 0, errors: [] });
  });

  test("raw outliving the shortest LIVE rollup fails, naming both", () => {
    // This is the state in which the addon's default backup silently stops
    // covering a time range — the reason dump.sh derives the same rule.
    // "Live" because the frozen minute aggregates are exempt: they stopped being
    // refreshed and are decaying under their own retention, so raw outliving
    // them is the point, not a defect.
    const { code, errors } = withRetention("metrics_raw", "4000 days");
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("hourly_rollups");
    expect(errors.join("\n")).toContain("4000");
  });

  test("raw outliving the FROZEN minute aggregates is not a finding", () => {
    // The whole shape of the change: raw is the minute-resolution record now,
    // so it is expected to reach far past the aggregates that used to hold it.
    expect(withRetention("metrics_raw", "1825 days").code).toBe(0);
  });

  test("raw inside the widest refresh window fails", () => {
    // A refresh would reach for a chunk retention has already dropped.
    const { code, errors } = withRetention("metrics_raw", "2 days");
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("refresh window");
  });

  test("raw equal to the shortest live rollup retention is allowed", () => {
    // The boundary: equal is still fully materialized into the hourly tier.
    expect(withRetention("metrics_raw", "3650 days").code).toBe(0);
  });

  test("shortening a live rollup below raw fails too — the invariant is symmetric", () => {
    expect(withRetention("hourly_rollups", "30 days").code).toBe(1);
  });

  test("shortening the minute tier is allowed — raw is declared free to outlive it", () => {
    // It is a resolution window, not a coverage horizon: past it, a
    // minute-resolution read goes to raw and a wider one to hourly. The cost is
    // the backup default, and dump.sh derives that from the live policies.
    expect(withRetention("minute_rollups", "30 days").code).toBe(0);
  });
});

describe("retention policies are authoritative on an existing database", () => {
  // `add_retention_policy(…, if_not_exists => TRUE)` is a NO-OP where a policy
  // already exists. Measured on an upgraded database before this was fixed: the
  // hourly tier stayed at 730 days while policies.sql said 3650, silently, with
  // the migration reporting success. Same trap the compression policies already
  // document — these tests are what stop it coming back.
  const RETENTION_TARGETS = ["metrics_raw", "minute_rollups", "hourly_rollups"];

  test.each(RETENTION_TARGETS)("%s is removed before it is added", (target) => {
    expect(removesRetentionBeforeAdding(policies, target)).toBe(true);
  });

  test("an add-only retention policy is a finding, not a style preference", () => {
    const addOnly = policies.replace(
      "SELECT remove_retention_policy('hourly_rollups', if_exists => TRUE);",
      "SELECT 1;",
    );
    expect(removesRetentionBeforeAdding(addOnly, "hourly_rollups")).toBe(false);
    const errors: string[] = [];
    checkStorageTuning({
      read: (path) =>
        path.endsWith("policies.sql")
          ? addOnly
          : path.endsWith(".sql")
            ? read(path)
            : path.includes("init-postgres")
              ? "checkpoint_timeout = '2h'\nwal_compression = 'zstd'\n"
              : "      - checkpoint_timeout=2h\n      - wal_compression=zstd\n",
      log: () => {},
      error: (line) => errors.push(line),
    });
    expect(errors.join("\n")).toContain("no-op on a configured deployment");
  });

  test("the order matters: adding then removing leaves no policy at all", () => {
    const wrongOrder = [
      "SELECT add_retention_policy('m', INTERVAL '90 days');",
      "--> statement-breakpoint",
      "SELECT remove_retention_policy('m', if_exists => TRUE);",
    ].join("\n");
    expect(removesRetentionBeforeAdding(wrongOrder, "m")).toBe(false);
    expect(retentionDays(wrongOrder)).not.toHaveProperty("m");
  });
});

describe("the minute tier is live, and deliberately shorter than raw", () => {
  /**
   * 1.x FROZE the minute pair: once a raw row became an interval (#117) they
   * stopped being cheaper than the rows they summarized — 361 MB/device-year for
   * raw against 333 MB for the two of them — while remaining the ceiling on raw's
   * retention, since raw could not outlive the shortest aggregate. Raw answered
   * minute reads instead.
   *
   * 2.0.0 reverses that, and these tests pin the reversal so it cannot drift back
   * by accident. Two of the three premises are gone: there is ONE minute
   * aggregate storing a 49 B partial rather than two storing six doubles, and raw
   * now reaches 1825 days — so "raw answers minute reads" means every
   * short-horizon chart scans a five-year hypertable. What replaced the retention
   * ceiling is an explicit declaration (`RAW_MAY_OUTLIVE_TIERS`) plus dump.sh
   * including raw in the backup.
   */
  test("every tier is refreshed, the minute tier included", () => {
    const armed = refreshPolicies(policies);
    for (const tier of ["minute_rollups", "hourly_rollups", "daily_rollups"]) {
      expect(armed).toContain(tier);
    }
  });

  test("nothing is frozen any more — a freeze would leave buckets nothing answers", () => {
    // With one generation there is no second family to serve a tier's buckets, so
    // `remove_continuous_aggregate_policy` has no legitimate use here. Checked
    // against the STATEMENTS: the file explains the 1.x freeze in prose, and
    // deleting that explanation would be the wrong way to pass this.
    const statements = policies
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(statements).not.toContain("remove_continuous_aggregate_policy");
  });

  test("the minute tier is the only tier raw is allowed to outlive", () => {
    expect([...RAW_MAY_OUTLIVE_TIERS]).toEqual(["minute_rollups"]);
    const days = retentionDays(policies);
    const raw = days["metrics_raw"] ?? 0;
    expect(days["minute_rollups"]).toBeLessThan(raw);
    // And the tier that IS the long-horizon record must not be.
    expect(days["hourly_rollups"]).toBeGreaterThan(raw);
  });

  test("dropping the minute tier's retention entirely is a finding", () => {
    // Kept forever, it would grow without bound at minute resolution — the one
    // thing its 90 days is for.
    const forever = policies.replace(
      /SELECT (?:remove|add)_retention_policy\('minute_rollups'[^;]*;/g,
      "SELECT 1;",
    );
    expect(retentionDays(forever)).not.toHaveProperty("minute_rollups");
  });

  test("every tier keeps a compression policy", () => {
    const compressed = compressionPolicies(policies).map((p) => p.target);
    for (const tier of ["minute_rollups", "hourly_rollups", "daily_rollups"]) {
      expect(compressed).toContain(tier);
    }
  });

  test("un-arming a tier's refresh is a finding, not a silent freeze", () => {
    // Re-pointed rather than deleted, so the mutation leaves valid-looking SQL
    // the parser still reads — a commented-out call would still match the regex
    // on the same line and the test would pass for the wrong reason.
    const unarmed = policies.replace(
      "add_continuous_aggregate_policy('minute_rollups',",
      "add_continuous_aggregate_policy('some_other_rollups',",
    );
    const { code, errors } = runShipped(unarmed);
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("minute_rollups");
  });
});

describe("databaseImages", () => {
  test("reads every database image reference of a compose file", () => {
    expect(
      databaseImages("services:\n  db:\n    image: timescale/timescaledb:2.28.2-pg17\n"),
    ).toEqual(["timescale/timescaledb:2.28.2-pg17"]);
  });

  test("reads the image of a workflow service block", () => {
    expect(
      databaseImages("    services:\n      timescaledb:\n        image: ghcr.io/x/timescaledb:t\n"),
    ).toEqual(["ghcr.io/x/timescaledb:t"]);
  });

  test("ignores images that are not a database", () => {
    expect(
      databaseImages(
        "    image: ghcr.io/sunreye/sunreye-server:${SUNREYE_TAG:-latest}\n    image: oven/bun:1.4\n",
      ),
    ).toEqual([]);
  });
});

describe("timescaledbPin", () => {
  test("reads the ARG the apt patterns interpolate", () => {
    expect(timescaledbPin("ARG PG_MAJOR=17\nARG TIMESCALEDB_VERSION=2.28.2\n")).toBe("2.28.2");
  });

  test("is undefined when the file declares no pin", () => {
    expect(timescaledbPin("FROM postgres:17-bookworm\n")).toBeUndefined();
  });
});

/**
 * Step 2: one image, everywhere.
 *
 * The dev/CI database and the addon must carry the SAME extensions, or a
 * migration that needs `timescaledb_toolkit` passes in one and fails in the
 * other — precisely the class of bug apps/server/db-tests exists to catch. Five
 * separate files name that image and nothing linked them together.
 */
describe("one database image across every surface", () => {
  for (const surface of DB_IMAGE_SURFACES) {
    test(`${surface} names the one database image`, () => {
      expect(databaseImages(read(surface))).toEqual([REQUIRED_DB_IMAGE]);
    });
  }

  test("the gate names the file that drifts", () => {
    const { code, errors } = runShipped(policies);
    expect(code).toBe(0);
    expect(errors).toEqual([]);
  });
});

describe("checkStorageTuning — one database image", () => {
  test("reads every one of the five image surfaces", () => {
    const seen: string[] = [];
    checkStorageTuning({
      read: (path) => {
        seen.push(path);
        return "";
      },
      log: () => {},
      error: () => {},
    });
    for (const surface of DB_IMAGE_SURFACES) expect(seen).toContain(surface);
  });

  test("fails naming the drifting surface and both refs", () => {
    const { code, errors } = runGate({
      ".github/workflows/ci.yml": "        image: timescale/timescaledb:2.28.2-pg17\n",
    });
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain(".github/workflows/ci.yml");
    expect(errors.join("\n")).toContain("timescale/timescaledb:2.28.2-pg17");
    expect(errors.join("\n")).toContain(REQUIRED_DB_IMAGE);
  });

  test("fails when a surface names no database image at all", () => {
    const { code, errors } = runGate({ "docker-compose.db.yml": "services: {}\n" });
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("docker-compose.db.yml");
  });
});

describe("docker-compose.db.yml is tuned like every other surface", () => {
  test("the gate reads it", () => {
    const seen: string[] = [];
    checkStorageTuning({
      read: (path) => {
        seen.push(path);
        return "";
      },
      log: () => {},
      error: () => {},
    });
    expect(seen).toContain("docker-compose.db.yml");
  });

  test("the gate reports it when its WAL settings drift", () => {
    const { code, errors } = runGate({
      "docker-compose.db.yml": `    image: ${REQUIRED_DB_IMAGE}\n      - checkpoint_timeout=5min\n`,
    });
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("docker-compose.db.yml: checkpoint_timeout");
  });

  test("the shipped file carries the tuned values", () => {
    const flags = parseComposePgFlags(read("docker-compose.db.yml"));
    expect(flags.checkpoint_timeout).toBe("2h");
    expect(flags.wal_compression).toBe("zstd");
  });
});

/**
 * A floating `2.28.*` pattern is not a pin: a rebuild today resolves 2.28.3,
 * so the addon and the dev/CI image can ship different extension binaries from
 * the same commit. Both Dockerfiles therefore pin the full patch, identically.
 */
describe("the TimescaleDB pin is a full patch version in both Dockerfiles", () => {
  for (const dockerfile of TIMESCALEDB_DOCKERFILES) {
    test(`${dockerfile} pins ${REQUIRED_TIMESCALEDB_VERSION}`, () => {
      expect(timescaledbPin(read(dockerfile))).toBe(REQUIRED_TIMESCALEDB_VERSION);
    });

    test(`${dockerfile} installs the toolkit`, () => {
      expect(read(dockerfile)).toContain("timescaledb-toolkit-postgresql-");
    });

    test(`${dockerfile} keeps the versioned-.so prune`, () => {
      expect(read(dockerfile)).toContain("timescaledb-*.so");
      expect(read(dockerfile)).toContain('! -name "timescaledb-tsl-${TIMESCALEDB_VERSION}.*"');
    });
  }

  test("the image tag carries the same version the Dockerfiles pin", () => {
    expect(REQUIRED_DB_IMAGE).toContain(REQUIRED_TIMESCALEDB_VERSION);
  });

  test("the gate fails on a floating pin", () => {
    const { code, errors } = runGate({
      "sunreye/Dockerfile": TUNED_DOCKERFILE.replace(
        `ARG TIMESCALEDB_VERSION=${REQUIRED_TIMESCALEDB_VERSION}`,
        "ARG TIMESCALEDB_VERSION=2.28",
      ),
    });
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("sunreye/Dockerfile");
    expect(errors.join("\n")).toContain("2.28");
  });

  test("the gate fails when the two Dockerfiles disagree", () => {
    const { code, errors } = runGate({
      "docker/timescaledb/Dockerfile": TUNED_DOCKERFILE.replace(
        `ARG TIMESCALEDB_VERSION=${REQUIRED_TIMESCALEDB_VERSION}`,
        "ARG TIMESCALEDB_VERSION=2.29.2",
      ),
    });
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("2.29.2");
  });

  test("the gate fails when a Dockerfile drops the toolkit", () => {
    const { code, errors } = runGate({
      "docker/timescaledb/Dockerfile": TUNED_DOCKERFILE.replace(
        '       "timescaledb-toolkit-postgresql-${PG_MAJOR}=1:1.25.0*" \\',
        "",
      ),
    });
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("timescaledb_toolkit");
  });
});

describe("the one image is published by a workflow", () => {
  test("db-image.yml builds the repository every surface pulls from", () => {
    const workflow = read(IMAGE_BUILD_WORKFLOW);
    expect(workflow).toContain(REQUIRED_DB_IMAGE.split(":")[0]);
    expect(workflow).toContain("docker/timescaledb/Dockerfile");
  });

  test("the gate fails when the workflow stops building that repository", () => {
    const { code, errors } = runGate({ [IMAGE_BUILD_WORKFLOW]: "on: workflow_dispatch\n" });
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain(IMAGE_BUILD_WORKFLOW);
  });
});

/**
 * The addon set WAL and worker knobs but no memory knobs at all, so it silently
 * inherited PostgreSQL's 128 MB shared_buffers / 4 MB work_mem defaults while
 * the compose path got tuned sizing. On a 2 GB Home Assistant box that is the
 * surface where it hurts most.
 */
describe("the addon sizes its memory knobs", () => {
  const settings = () => parsePgConf(read(ADDON_CONF));

  for (const key of [
    "shared_buffers",
    "work_mem",
    "effective_cache_size",
    "maintenance_work_mem",
    "max_connections",
  ]) {
    test(`sunreye.conf sets ${key}`, () => {
      expect(settings()[key]).toBeDefined();
    });
  }

  test("timescaledb.max_background_workers is 4, not 8 — a 2 GB box has no room for 8", () => {
    expect(settings()["timescaledb.max_background_workers"]).toBe("4");
  });

  test("the gate reports a missing memory knob", () => {
    const { code, errors } = runGate({
      [ADDON_CONF]: TUNED_CONF.replace("work_mem = '8MB'\n", ""),
    });
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("work_mem");
  });
});

// ---------------------------------------------------------------------------
// The two boundaries the gate's own failure modes depend on: a retention
// interval it cannot read, and the entry point that wires it to the filesystem.
// ---------------------------------------------------------------------------

describe("retentionProblems: an interval the gate cannot read", () => {
  /**
   * The passing policy SQL with ONE thing wrong: a metrics_raw retention
   * interval the parser cannot read. Built on the good set on purpose — a
   * hand-written minimal file would trip the compression and refresh checks too,
   * and then the test would pass for the wrong reason.
   */
  const unparseable = [
    GOOD_FILES["packages/db/src/timescale/policies.sql"],
    "SELECT remove_retention_policy('metrics_raw', if_exists => TRUE);",
    "SELECT add_retention_policy('metrics_raw', INTERVAL 'forever', if_not_exists => TRUE);",
  ].join("\n--> statement-breakpoint\n");

  test("an unparseable metrics_raw interval is reported, never treated as zero days", () => {
    // The danger is silence: NaN compares false against every threshold, so an
    // interval the parser cannot read would otherwise pass every check below it.
    expect(intervalDays("forever")).toBeNaN();
    const { code, errors } = runGate({ "packages/db/src/timescale/policies.sql": unparseable });
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain(
      "metrics_raw retention interval is unparseable in policies.sql.",
    );
  });

  test("the unparseable interval is the ONLY finding — later checks do not run on NaN", () => {
    // NaN would otherwise slip past the refresh-window and coverage comparisons
    // silently, reporting nothing at all.
    const { errors } = runGate({ "packages/db/src/timescale/policies.sql": unparseable });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("unparseable");
  });

  test("a readable interval outside the refresh window passes the same surface", () => {
    const readable = [
      GOOD_FILES["packages/db/src/timescale/policies.sql"],
      "SELECT remove_retention_policy('metrics_raw', if_exists => TRUE);",
      "SELECT add_retention_policy('metrics_raw', INTERVAL '1825 days', if_not_exists => TRUE);",
    ].join("\n--> statement-breakpoint\n");
    expect(runGate({ "packages/db/src/timescale/policies.sql": readable })).toEqual({
      code: 0,
      errors: [],
    });
  });

  test("no metrics_raw retention policy at all is a deliberate shape, not a finding", () => {
    // Raw kept forever: dump.sh then includes raw in the default backup.
    const { errors } = runGate({
      "packages/db/src/timescale/policies.sql":
        "SELECT add_retention_policy('minute_rollups', INTERVAL '90 days', if_not_exists => TRUE);",
    });
    expect(errors.join("\n")).not.toContain("metrics_raw retention");
  });
});

describe("productionCheckIo", () => {
  test("reads a surface that exists off the real filesystem", () => {
    const content = productionCheckIo.read("packages/db/src/timescale/policies.sql");
    expect(content).toContain("add_retention_policy");
  });

  test("a surface that has gone missing reads as empty, so the gate names the file", () => {
    // A stack trace would tell a reader nothing about which surface vanished;
    // every check reports "declares no …" for empty content instead.
    expect(productionCheckIo.read("packages/db/src/timescale/no-such-file.sql")).toBe("");
  });

  test("log and error reach the two console streams", () => {
    const out: string[] = [];
    const err: string[] = [];
    const realLog = console.log;
    const realError = console.error;
    console.log = (...a: unknown[]) => void out.push(a.join(" "));
    console.error = (...a: unknown[]) => void err.push(a.join(" "));
    try {
      productionCheckIo.log("✓ tuned");
      productionCheckIo.error("✗ drifted");
    } finally {
      console.log = realLog;
      console.error = realError;
    }
    expect(out).toEqual(["✓ tuned"]);
    expect(err).toEqual(["✗ drifted"]);
  });
});

describe("cli", () => {
  test("the repo's own surfaces pass the gate", () => {
    // The gate guards this repo; if it fails here it fails in CI.
    const out: string[] = [];
    const err: string[] = [];
    const code = cli({
      read: productionCheckIo.read,
      log: (l) => out.push(l),
      error: (l) => err.push(l),
    });
    expect(err).toEqual([]);
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("storage tuning");
  });

  test("defaults to the real filesystem when handed no io", () => {
    const realLog = console.log;
    console.log = () => {};
    try {
      expect(cli()).toBe(0);
    } finally {
      console.log = realLog;
    }
  });
});
