import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  compressionPolicies,
  continuousAggregateDrops,
  parseComposePgFlags,
  parsePgConf,
  removesBeforeAdding,
  checkStorageTuning,
} from "./storage-tuning";

const REPO = join(import.meta.dir, "..");
const TIMESCALE = join(REPO, "packages/db/src/timescale");

const read = (path: string) => readFileSync(join(REPO, path), "utf8");
const policies = readFileSync(join(TIMESCALE, "policies.sql"), "utf8");
const compressAfterMigration = readFileSync(join(TIMESCALE, "0001_compress_after_2h.sql"), "utf8");

const ADDON_CONF_SCRIPT = "sunreye/rootfs/etc/s6-overlay/s6-rc.d/init-postgres/run";
const COMPOSE_FILES = ["docker-compose.yml", "docker/docker-compose.yml"];

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

describe("checkStorageTuning", () => {
  const GOOD: Record<string, string> = {
    "packages/db/src/timescale/policies.sql":
      "SELECT remove_compression_policy('metrics_raw', if_exists => TRUE);\n" +
      "--> statement-breakpoint\n" +
      "SELECT add_compression_policy('metrics_raw', INTERVAL '2 hours', if_not_exists => TRUE);",
    "sunreye/rootfs/etc/s6-overlay/s6-rc.d/init-postgres/run":
      "checkpoint_timeout = '2h'\nwal_compression = 'zstd'\nfull_page_writes = 'on'\n",
    "docker-compose.yml": "      - checkpoint_timeout=2h\n      - wal_compression=zstd\n",
    "docker/docker-compose.yml": "      - checkpoint_timeout=2h\n      - wal_compression=zstd\n",
  };
  const run = (over: Record<string, string> = {}) => {
    const files = { ...GOOD, ...over };
    const errors: string[] = [];
    const code = checkStorageTuning({
      read: (path) => files[path] ?? "",
      log: () => {},
      error: (line) => errors.push(line),
    });
    return { code, errors };
  };

  test("passes when every surface carries the tuned values", () => {
    expect(run()).toEqual({ code: 0, errors: [] });
  });

  test("fails when compress_after drifts back to a day", () => {
    const { code, errors } = run({
      "packages/db/src/timescale/policies.sql":
        "SELECT remove_compression_policy('metrics_raw', if_exists => TRUE);\n" +
        "--> statement-breakpoint\n" +
        "SELECT add_compression_policy('metrics_raw', INTERVAL '1 day');",
    });
    expect(code).toBe(1);
    expect(errors.join("\n")).toMatch(/compress_after is '1 day'/);
  });

  test("fails when a policy is added without removing the old one first", () => {
    const { code, errors } = run({
      "packages/db/src/timescale/policies.sql":
        "SELECT add_compression_policy('metrics_raw', INTERVAL '2 hours', if_not_exists => TRUE);",
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
        "SELECT add_compression_policy('metrics_raw', INTERVAL '2 hours');",
    });
    expect(code).toBe(1);
    expect(errors.join("\n")).toMatch(/destroy a continuous aggregate/);
  });
});
