import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  compressSegmentBy,
  compressionPolicies,
  continuousAggregateDrops,
  refreshPolicies,
  FROZEN_TIERS,
  parseComposePgFlags,
  parsePgConf,
  removesBeforeAdding,
  removesRetentionBeforeAdding,
  retentionDays,
  intervalDays,
  checkStorageTuning,
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
const compressAfterMigration = readFileSync(join(TIMESCALE, "0001_compress_after_2h.sql"), "utf8");

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

  test("the numbered migration retunes the policy without an add-only statement", () => {
    expect(compressionPolicies(compressAfterMigration)).toEqual([
      { target: "metrics_raw", after: "2 hours" },
    ]);
    expect(removesBeforeAdding(compressAfterMigration, "metrics_raw")).toBe(true);
  });

  test("the numbered migration drops no continuous aggregate", () => {
    expect(continuousAggregateDrops(compressAfterMigration)).toEqual([]);
    expect(compressAfterMigration).not.toMatch(/CREATE\s+MATERIALIZED\s+VIEW/i);
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

/** Every rollup tier the #134 half of the gate requires; see the describe below. */
const GATE_ROLLUP_TIERS = [
  "minute_rollups",
  "hourly_rollups",
  "daily_rollups",
  "weighted_minute_rollups",
  "weighted_hourly_rollups",
  "weighted_daily_rollups",
] as const;

/** The rollup half of a passing fixture, so the #110/#111 tests below can ignore it. */
const rollupSegmentBySql = (tiers: readonly string[]) =>
  tiers
    .map(
      (t) =>
        `ALTER MATERIALIZED VIEW ${t} SET (timescaledb.compress = true, timescaledb.compress_segmentby = 'metric, inverter_id');`,
    )
    .join("\n--> statement-breakpoint\n");

const rollupPolicySql = (tiers: readonly string[]) =>
  tiers
    .flatMap((t) => [
      // A frozen tier states the removal instead — arming a refresh for one is
      // itself a finding, so a fixture that armed all six would never pass.
      (FROZEN_TIERS as readonly string[]).includes(t)
        ? `SELECT remove_continuous_aggregate_policy('${t}', if_not_exists => TRUE);`
        : `SELECT add_continuous_aggregate_policy('${t}', start_offset => INTERVAL '1 day');`,
      `SELECT remove_compression_policy('${t}', if_exists => TRUE);`,
      `SELECT add_compression_policy('${t}', INTERVAL '7 days', if_not_exists => TRUE);`,
    ])
    .join("\n--> statement-breakpoint\n");

/** A whole file set the gate passes on, for per-surface substitution below. */
const GOOD_FILES: Record<string, string> = {
  "packages/db/src/timescale/0002_weighted_rollups.sql": rollupSegmentBySql(
    GATE_ROLLUP_TIERS.filter((t) => t.startsWith("weighted_")),
  ),
  "packages/db/src/timescale/0003_rollup_compression_segmentby.sql": rollupSegmentBySql(
    GATE_ROLLUP_TIERS.filter((t) => !t.startsWith("weighted_")),
  ),
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
  ".github/workflows/db-weighted-rollups.yml": `        image: ${REQUIRED_DB_IMAGE}\n`,
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

const WEIGHTED_ROLLUPS = readFileSync(join(TIMESCALE, "0002_weighted_rollups.sql"), "utf8");
const LEGACY_SEGMENTBY = readFileSync(
  join(TIMESCALE, "0003_rollup_compression_segmentby.sql"),
  "utf8",
);

describe("compressSegmentBy", () => {
  test("reads the segmentby of a continuous aggregate", () => {
    expect(
      compressSegmentBy(
        "ALTER MATERIALIZED VIEW hourly_rollups SET (\n" +
          "  timescaledb.compress = true,\n" +
          "  timescaledb.compress_segmentby = 'metric, inverter_id'\n);",
      ),
    ).toEqual({ hourly_rollups: "metric, inverter_id" });
  });

  test("reads the segmentby of a plain hypertable too", () => {
    expect(
      compressSegmentBy(
        "ALTER TABLE metrics_raw SET (timescaledb.compress, timescaledb.compress_segmentby = 'inverter_id, metric');",
      ),
    ).toEqual({ metrics_raw: "inverter_id, metric" });
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
  test("every rollup tier segments by metric and inverter, mirroring metrics_raw", () => {
    const declared = {
      ...compressSegmentBy(WEIGHTED_ROLLUPS),
      ...compressSegmentBy(LEGACY_SEGMENTBY),
    };
    for (const tier of GATE_ROLLUP_TIERS) {
      expect(declared[tier], `${tier} must declare a segmentby`).toBe("metric, inverter_id");
    }
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

  test("the numbered migrations create the weighted aggregates and drop none", () => {
    expect(continuousAggregateDrops(WEIGHTED_ROLLUPS)).toEqual([]);
    expect(continuousAggregateDrops(LEGACY_SEGMENTBY)).toEqual([]);
    // The legacy fix is in-place only: it must not contain a CREATE either, since
    // a create under an existing name is a recreate by another route.
    expect(LEGACY_SEGMENTBY).not.toMatch(/CREATE\s+MATERIALIZED\s+VIEW/i);
  });

  test("the weighted aggregates materialize the two sums, never their quotient", () => {
    // An expression over aggregates inside a continuous-aggregate definition is
    // a portability risk, and the parts stay composable. The read layer divides.
    expect(WEIGHTED_ROLLUPS).toContain("sum(value * coalesce(dur_ms, 1000))");
    expect(WEIGHTED_ROLLUPS).toContain("sum(coalesce(dur_ms, 1000))");
    expect(WEIGHTED_ROLLUPS).not.toMatch(/sum\([^)]*\)\s*\/\s*sum\(/);
  });

  test("every weighted aggregate is named *_rollups, or drizzle would emit DROP VIEW for it", () => {
    // drizzle.config.ts's `tablesFilter: ["!*_rollups"]` is the only thing that
    // keeps push/pull from trying to drop a continuous aggregate.
    const created = [...WEIGHTED_ROLLUPS.matchAll(/CREATE MATERIALIZED VIEW IF NOT EXISTS (\w+)/g)];
    expect(created).toHaveLength(3);
    for (const [, name] of created) expect(name).toMatch(/_rollups$/);
  });

  test("every live aggregate is refreshed, or the read cutover never prefers it", () => {
    const refreshed = refreshPolicies(policies);
    const live = GATE_ROLLUP_TIERS.filter((t) => !(FROZEN_TIERS as readonly string[]).includes(t));
    for (const tier of live) expect(refreshed).toContain(tier);
    expect(live).toHaveLength(GATE_ROLLUP_TIERS.length - FROZEN_TIERS.length);
  });
});

describe("checkStorageTuning — rollup compression (#134)", () => {
  const SEGMENTBY_SQL = (tiers: readonly string[], segmentby = "metric, inverter_id") =>
    segmentby === "metric, inverter_id"
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
    "packages/db/src/timescale/0002_weighted_rollups.sql": SEGMENTBY_SQL(
      GATE_ROLLUP_TIERS.filter((t) => t.startsWith("weighted_")),
    ),
    "packages/db/src/timescale/0003_rollup_compression_segmentby.sql": SEGMENTBY_SQL(
      GATE_ROLLUP_TIERS.filter((t) => !t.startsWith("weighted_")),
    ),
  };
  const run = (over: Record<string, string> = {}) => runGate({ ...GOOD, ...over });

  test("passes when every rollup tier is segmented and has a compression policy", () => {
    expect(run()).toEqual({ code: 0, errors: [] });
  });

  test("fails when a rollup tier has compression on but no segmentby", () => {
    // The original minute_rollups defect: compressed, but interleaving every
    // metric within a batch.
    const { code, errors } = run({
      "packages/db/src/timescale/0003_rollup_compression_segmentby.sql":
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

  test("fails when a weighted aggregate is never refreshed — the cutover would never prefer it", () => {
    const { code, errors } = run({
      "packages/db/src/timescale/policies.sql": POLICY_SQL_FOR(GATE_ROLLUP_TIERS).replace(
        "SELECT add_continuous_aggregate_policy('weighted_hourly_rollups', start_offset => INTERVAL '1 day');",
        "SELECT 1;",
      ),
    });
    expect(code).toBe(1);
    expect(errors.join("\n")).toMatch(/weighted_hourly_rollups/);
  });

  test("fails when a segmentby drifts away from metrics_raw's columns", () => {
    const { code, errors } = run({
      "packages/db/src/timescale/0002_weighted_rollups.sql": SEGMENTBY_SQL(
        GATE_ROLLUP_TIERS.filter((t) => t.startsWith("weighted_")),
        "inverter_id",
      ),
    });
    expect(code).toBe(1);
    expect(errors.join("\n")).toMatch(/inverter_id/);
  });

  test("fails when a numbered migration would drop a continuous aggregate", () => {
    const { code, errors } = run({
      "packages/db/src/timescale/0003_rollup_compression_segmentby.sql":
        "DROP MATERIALIZED VIEW minute_rollups;\n--> statement-breakpoint\n" +
        SEGMENTBY_SQL(GATE_ROLLUP_TIERS.filter((t) => !t.startsWith("weighted_"))),
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

  test("shortening a frozen aggregate is allowed — decaying is what it is for", () => {
    expect(withRetention("minute_rollups", "30 days").code).toBe(0);
  });
});

describe("retention policies are authoritative on an existing database", () => {
  // `add_retention_policy(…, if_not_exists => TRUE)` is a NO-OP where a policy
  // already exists. Measured on an upgraded database before this was fixed: the
  // hourly tier stayed at 730 days while policies.sql said 3650, silently, with
  // the migration reporting success. Same trap the compression policies already
  // document — these tests are what stop it coming back.
  const RETENTION_TARGETS = [
    "metrics_raw",
    "minute_rollups",
    "hourly_rollups",
    "weighted_minute_rollups",
    "weighted_hourly_rollups",
  ];

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

describe("the minute aggregates are frozen, not dropped", () => {
  /**
   * Once a raw row became an interval (#117), the minute aggregates stopped
   * being cheaper than the rows they summarize — 361 MB/device-year for raw
   * against 333 MB for the pair — while remaining the ceiling on raw retention,
   * since raw may not outlive the shortest aggregate. So they stopped being
   * refreshed rather than being dropped: every bucket already materialized keeps
   * answering reads until its own retention ages it out, which is what makes
   * this survivable on a deployment whose raw does not reach back that far.
   */
  const FROZEN = ["minute_rollups", "weighted_minute_rollups"] as const;

  test("no refresh policy is armed for either of them", () => {
    const armed = refreshPolicies(policies);
    for (const tier of FROZEN) expect(armed).not.toContain(tier);
  });

  test("the hour and day tiers are still refreshed", () => {
    const armed = refreshPolicies(policies);
    for (const tier of [
      "hourly_rollups",
      "daily_rollups",
      "weighted_hourly_rollups",
      "weighted_daily_rollups",
    ]) {
      expect(armed).toContain(tier);
    }
  });

  test("the freeze is applied to existing databases, not just omitted for new ones", () => {
    // Omitting the `add_` is enough for a fresh install and does NOTHING to a
    // deployment that already has the policy — the same trap `if_not_exists`
    // sets for compression and retention. The removal has to be stated.
    for (const tier of FROZEN) {
      expect(policies).toContain(`remove_continuous_aggregate_policy('${tier}'`);
    }
  });

  test("they keep a retention policy, or a frozen aggregate would linger forever", () => {
    const days = retentionDays(policies);
    for (const tier of FROZEN) expect(days[tier]).toBeGreaterThan(0);
  });

  test("they keep their compression policy — the buckets already materialized still compress", () => {
    const compressed = compressionPolicies(policies).map((p) => p.target);
    for (const tier of FROZEN) expect(compressed).toContain(tier);
  });

  test("a re-armed refresh policy is a finding, not a silent resumption", () => {
    const rearmed = policies.replace(
      "-- FROZEN: minute_rollups",
      `SELECT add_continuous_aggregate_policy('minute_rollups',
  start_offset => INTERVAL '10 minutes',
  end_offset   => INTERVAL '1 minute',
  schedule_interval => INTERVAL '1 minute',
  if_not_exists => TRUE);
--> statement-breakpoint
-- FROZEN: minute_rollups`,
    );
    const { code, errors } = runShipped(rearmed);
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
 * other — precisely the class of bug apps/server/db-tests exists to catch. Six
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
  test("reads every one of the six image surfaces", () => {
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
